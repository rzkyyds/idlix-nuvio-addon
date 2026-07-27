"use strict";

const axios = require("axios");
const cache = require("./cache");
const { filterMetas, filterStreams, isNsfw } = require("./nsfw-filter");

const DEFAULT_TIMEOUT = parseInt(process.env.UPSTREAM_TIMEOUT_MS || "18000", 10);
const HDHUB_BASE = (process.env.HDHUB_ADDON_URL || "https://hdhub.thevolecitor.qzz.io/eyJ0b3...YyJ9").replace(/\/$/, "");
const FLIX_BASE = (process.env.FLIX_STREAMS_ADDON_URL || "https://flixnest.app/flix-streams").replace(/\/$/, "");
const ONLYANIMES_BASE = (process.env.ONLYANIMES_ADDON_URL || "https://onlyanimes.stravo.site/local").replace(/\/$/, "");

const STREAM_UPSTREAMS = [
  { key: "hdhub", name: "HdHub", base: HDHUB_BASE, enabled: process.env.ENABLE_HDHUB !== "false" },
  { key: "flix", name: "Flix-Streams", base: FLIX_BASE, enabled: process.env.ENABLE_FLIX_STREAMS !== "false" },
];

const http = axios.create({
  timeout: DEFAULT_TIMEOUT,
  headers: {
    accept: "application/json",
    "user-agent": "kisut-streams-addon/1.0 (+stremio; no-p2p)"
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

function decorateStream(stream, upstreamName) {
  if (!stream || typeof stream !== "object") return null;
  const cloned = { ...stream };
  const rawName = cloned.name || upstreamName;
  cloned.name = rawName.includes(upstreamName) ? rawName : `${upstreamName}\n${rawName}`;
  if (cloned.title && !String(cloned.title).includes(upstreamName)) {
    cloned.title = `${upstreamName}\n${cloned.title}`;
  }
  cloned.behaviorHints = {
    ...(cloned.behaviorHints || {}),
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
    return filterStreams((data && data.streams) || []).map((s) => decorateStream(s, "OnlyAnimes")).filter(Boolean);
  }

  const normalizedId = normalizeStreamId(type, id);
  const results = await Promise.all(STREAM_UPSTREAMS.filter((u) => u.enabled).map(async (u) => {
    const url = `${u.base}/stream/${encodeURIComponent(type)}/${encodeURIComponent(normalizedId)}.json`;
    const data = await getJson(url, 180);
    const streams = filterStreams((data && data.streams) || []);
    return streams.map((s) => decorateStream(s, u.name)).filter(Boolean);
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
  ONLYANIMES_BASE,
  getAddonStreams,
  getOnlyAnimesCatalog,
  getOnlyAnimesMeta,
};
