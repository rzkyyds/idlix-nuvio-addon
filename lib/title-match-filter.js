"use strict";

const axios = require("axios");
const cache = require("./cache");

const CINEMETA_BASE = (process.env.CINEMETA_BASE_URL || "https://v3-cinemeta.strem.io").replace(/\/$/, "");
const TITLE_TIMEOUT_MS = parseInt(process.env.TITLE_MATCH_TIMEOUT_MS || "5000", 10);

const http = axios.create({
  timeout: TITLE_TIMEOUT_MS,
  headers: {
    accept: "application/json",
    "user-agent": "tonstreams-addon/1.0 (+title-match)",
  },
  validateStatus: (status) => status >= 200 && status < 500,
});

const EXTRA_TITLE_PATTERNS = [
  /\[[^\]]*\]\s*[^\n]*?\b(19\d{2}|20\d{2})\b/g,
  /(?:^|\n)\s*([^\n]+?)\s+\b(19\d{2}|20\d{2})\b/g,
];

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\b(19\d{2}|20\d{2})\b/g, " ")
    .replace(/\b(4k|uhd|2160p|1080p|720p|480p|360p|imax|bluray|web[- ]?dl|hdr|dv|hevc|x265|x264|h\.?264|h\.?265|hindi|english|multi|dual|audio|esub|sub|ddp|aac|dts|nf|amzn|org|remux|sdr|10bit|hdhub4u|vegamovies|mkv|mp4|com|tv|ms|is|nl)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compact(value) {
  return normalizeTitle(value).replace(/\s+/g, "");
}

async function getExpectedTitle(type, id) {
  if (!id || !id.startsWith("tt")) return null;
  const imdbId = id.split(":")[0];
  const key = `title-match:${type}:${imdbId}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  try {
    const { status, data } = await http.get(`${CINEMETA_BASE}/meta/${encodeURIComponent(type)}/${encodeURIComponent(imdbId)}.json`);
    const title = status >= 200 && status < 300 && data?.meta?.name ? String(data.meta.name) : null;
    cache.set(key, title, title ? 3600 : 300);
    return title;
  } catch (err) {
    console.error(`[title-match] cinemeta ${type}/${imdbId} failed: ${err.message}`);
    cache.set(key, null, 300);
    return null;
  }
}

function streamText(stream) {
  return [stream?.name, stream?.title, stream?.description, stream?.url]
    .filter(Boolean)
    .join("\n");
}

function hasExpectedTitle(stream, expectedTitle) {
  const expected = compact(expectedTitle);
  if (!expected || expected.length < 4) return true;
  return compact(streamText(stream)).includes(expected);
}

function looksLikeSpecificWrongTitle(stream, expectedTitle) {
  const text = streamText(stream);
  if (hasExpectedTitle(stream, expectedTitle)) return false;

  // FrostStream's tt endpoints frequently return localized Portuguese titles while still matching
  // the requested IMDb ID. Do not throw those away just because Cinemeta's English title differs.
  if (stream?.behaviorHints?.upstreamKey === "froststream") return false;

  // Streams with explicit filenames/titles but not the requested title are bad upstream matches
  // (e.g. Toy Story returning Jingle All The Way/Beverly Hills Ninja). Generic Castle rows
  // often only say "Quality: 480p" and are kept because they do not expose a title to compare.
  if (/\b(19\d{2}|20\d{2})\b/.test(text) && /\.(mkv|mp4|webm)\b|\bbluray\b|\bweb[- ]?dl\b|\bhdrip\b|\buhd\b|\bremux\b/i.test(text)) {
    return true;
  }

  for (const pattern of EXTRA_TITLE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}

function filterStreamsByTitle(streams, expectedTitle) {
  if (!expectedTitle || !Array.isArray(streams)) return streams || [];
  return streams.filter((stream) => !looksLikeSpecificWrongTitle(stream, expectedTitle));
}

module.exports = {
  filterStreamsByTitle,
  getExpectedTitle,
  normalizeTitle,
};
