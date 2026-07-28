"use strict";

const axios = require("axios");
const cache = require("./cache");
const { filterMetas, filterStreams, isNsfw } = require("./nsfw-filter");

const DEFAULT_TIMEOUT = parseInt(process.env.UPSTREAM_TIMEOUT_MS || "18000", 10);
const HDHUB_BASE = (process.env.HDHUB_ADDON_URL || "https://hdhub.thevolecitor.qzz.io/eyJ0b3...YyJ9").replace(/\/$/, "");
const FLIX_BASE = (process.env.FLIX_STREAMS_ADDON_URL || "https://flixnest.app/flix-streams").replace(/\/$/, "");
const FROSTSTREAM_BASE = (process.env.FROSTSTREAM_ADDON_URL || "https://froststream.cloutteam.com").replace(/\/$/, "");
const FENIXFLIX_BASE = (process.env.FENIXFLIX_ADDON_URL || "https://fenixflix-ur9u.onrender.com").replace(/\/$/, "");
const ONLYANIMES_BASE = (process.env.ONLYANIMES_ADDON_URL || "https://onlyanimes.stravo.site/local").replace(/\/$/, "");
const WEBSTREAMR_BASE = (process.env.WEBSTREAMR_ADDON_URL || "").replace(/\/$/, "");
const NUVIO_STREAMS_BASE = (process.env.NUVIO_STREAMS_ADDON_URL || "").replace(/\/$/, "");

function parseExtraStreamUpstreams(value) {
  return String(value || "")
    .split(",")
    .map((entry, idx) => {
      const trimmed = entry.trim();
      if (!trimmed) return null;
      const [rawName, ...urlParts] = trimmed.includes("=") ? trimmed.split("=") : [`Extra HTTP ${idx + 1}`, trimmed];
      const base = urlParts.join("=").trim().replace(/\/$/, "");
      if (!base || !/^https?:\/\//i.test(base)) return null;
      const name = rawName.trim() || `Extra HTTP ${idx + 1}`;
      return { key: `extra-${idx + 1}`, name, base, enabled: true };
    })
    .filter(Boolean);
}

const STREAM_UPSTREAMS = [
  { key: "hdhub", name: "HdHub", base: HDHUB_BASE, enabled: process.env.ENABLE_HDHUB !== "false" },
  { key: "fenixflix", name: "FenixFlix", base: FENIXFLIX_BASE, enabled: Boolean(FENIXFLIX_BASE) && process.env.ENABLE_FENIXFLIX !== "false" },
  { key: "froststream", name: "FrostStream", base: FROSTSTREAM_BASE, enabled: Boolean(FROSTSTREAM_BASE) && process.env.ENABLE_FROSTSTREAM === "true" },
  { key: "flix", name: "Flix-Streams", base: FLIX_BASE, enabled: process.env.ENABLE_FLIX_STREAMS !== "false" },
  { key: "webstreamr", name: "WebStreamr", base: WEBSTREAMR_BASE, enabled: Boolean(WEBSTREAMR_BASE) && process.env.ENABLE_WEBSTREAMR !== "false" },
  { key: "nuviostreams", name: "Nuvio Streams", base: NUVIO_STREAMS_BASE, enabled: Boolean(NUVIO_STREAMS_BASE) && process.env.ENABLE_NUVIO_STREAMS !== "false" },
  ...parseExtraStreamUpstreams(process.env.EXTRA_STREAM_ADDON_URLS),
];

const http = axios.create({
  timeout: DEFAULT_TIMEOUT,
  headers: {
    accept: "application/json",
    "user-agent": "tonstreams-addon/1.0 (+stremio; no-p2p)"
  },
  validateStatus: (status) => status >= 200 && status < 500,
});

function cacheKey(kind, url) {
  return `upstream:${kind}:${url}`;
}

async function getJson(url, ttlSeconds = 300) {
  const key = cacheKey("json", url);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const { status, data } = await http.get(url);
    if (status < 200 || status >= 300 || !data || typeof data !== "object") {
      cache.set(key, null, 60);
      return null;
    }
    cache.set(key, data, ttlSeconds);
    return data;
  } catch (err) {
    console.error(`[upstream] ${url} failed: ${err.message}`);
    cache.set(key, null, 30);
    return null;
  }
}

function decorateStream(stream, upstreamName, upstreamKey = upstreamName) {
  if (!stream || typeof stream !== "object") return null;
  const cloned = { ...stream };
  const rawName = cloned.name || upstreamName;
  cloned.name = rawName.includes(upstreamName) ? rawName : `${upstreamName}\n${rawName}`;
  if (cloned.title && !String(cloned.title).includes(upstreamName)) {
    cloned.title = `${upstreamName}\n${cloned.title}`;
  }
  cloned.behaviorHints = {
    ...(cloned.behaviorHints || {}),
    upstreamKey,
    upstreamName,
    bingeGroup: `${upstreamName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${cloned.behaviorHints?.bingeGroup || "direct"}`,
  };
  return cloned;
}

function normalizeStreamId(type, id) {
  // Stremio series IDs are usually tt123:season:episode. Preserve exactly.
  if (id.startsWith("tmdb:")) return id;
  if (id.startsWith("tt")) return id;
  return id;
}

async function getAddonStreams(type, id) {
  if (!id || isNsfw(id)) return [];

  // OnlyAnimes uses its own oa: IDs, so proxy those directly.
  if (id.startsWith("oa:")) {
    const url = `${ONLYANIMES_BASE}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
    const data = await getJson(url, 180);
    return filterStreams((data && data.streams) || []).map((s) => decorateStream(s, "OnlyAnimes", "onlyanimes")).filter(Boolean);
  }

  const normalizedId = normalizeStreamId(type, id);
  const results = await Promise.all(STREAM_UPSTREAMS.filter((u) => u.enabled).map(async (u) => {
    const url = `${u.base}/stream/${encodeURIComponent(type)}/${encodeURIComponent(normalizedId)}.json`;
    const data = await getJson(url, 180);
    const streams = filterStreams((data && data.streams) || []);
    return streams.map((s) => decorateStream(s, u.name, u.key)).filter(Boolean);
  }));

  const seen = new Set();
  return results.flat().filter((s) => {
    const key = s.url || s.externalUrl || `${s.name}:${s.title}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, parseInt(process.env.MAX_UPSTREAM_STREAMS || "40", 10));
}

async function getOnlyAnimesCatalog(remoteId, type = "series", extraPath = "") {
  const suffix = extraPath ? `/${extraPath}` : "";
  const url = `${ONLYANIMES_BASE}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(remoteId)}${suffix}.json`;
  const data = await getJson(url, 600);
  return filterMetas((data && data.metas) || []);
}

async function getOnlyAnimesMeta(type, id) {
  if (!id.startsWith("oa:") || isNsfw(id)) return null;
  const url = `${ONLYANIMES_BASE}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
  const data = await getJson(url, 600);
  return data && data.meta && !isNsfw(data.meta) ? data.meta : null;
}

module.exports = {
  STREAM_UPSTREAMS,
  HDHUB_BASE,
  FLIX_BASE,
  FROSTSTREAM_BASE,
  FENIXFLIX_BASE,
  ONLYANIMES_BASE,
  WEBSTREAMR_BASE,
  NUVIO_STREAMS_BASE,
  getAddonStreams,
  getOnlyAnimesCatalog,
  getOnlyAnimesMeta,
};
