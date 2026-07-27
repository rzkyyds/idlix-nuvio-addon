"use strict";

const axios = require("axios");
const cache = require("./cache");

const USER_AGENT = process.env.TITLE_ALIAS_USER_AGENT ||
  "TonStreams/1.0 (+https://kisutnuvio.zeabur.app)";
const TIMEOUT = parseInt(process.env.TITLE_ALIAS_TIMEOUT_MS || "7000", 10);
const CINEMETA_BASE_URL = (process.env.CINEMETA_BASE_URL || "https://v3-cinemeta.strem.io").replace(/\/$/, "");
const WIKIDATA_SPARQL_URL = process.env.WIKIDATA_SPARQL_URL || "https://query.wikidata.org/sparql";

const STATIC_ALIASES = new Map([
  ["crocodile tears", ["air mata buaya"]],
  ["crocodile tears 2024", ["air mata buaya"]],
  ["crocodile tears 2026", ["air mata buaya"]],
]);

const http = axios.create({
  timeout: TIMEOUT,
  headers: {
    "user-agent": USER_AGENT,
    accept: "application/json,text/plain,*/*",
  },
  validateStatus: (status) => status >= 200 && status < 500,
});

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAlias(value) {
  const cleaned = String(value || "")
    .replace(/\s*\((?:film|movie|tv series|seri televisi)?\s*\d{4}\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 ? cleaned : "";
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const cleaned = cleanAlias(value);
    const key = normalizeTitle(cleaned);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(cleanAlias);
}

async function cinemetaSearch(query, type) {
  const catalogType = type === "series" ? "series" : "movie";
  const url = `${CINEMETA_BASE_URL}/catalog/${catalogType}/top/search=${encodeURIComponent(query)}.json`;
  const { status, data } = await http.get(url);
  if (status < 200 || status >= 300) return [];
  return Array.isArray(data?.metas) ? data.metas : [];
}

async function wikidataIndonesianLabelsForImdb(imdbId) {
  if (!imdbId || !/^tt\d+$/i.test(imdbId)) return [];
  const sparql = `
SELECT ?idLabel WHERE {
  ?item wdt:P345 "${imdbId}".
  OPTIONAL { ?item rdfs:label ?idLabel FILTER(LANG(?idLabel)="id") }
} LIMIT 5`;
  const { status, data } = await http.get(WIKIDATA_SPARQL_URL, {
    params: { format: "json", query: sparql },
  });
  if (status < 200 || status >= 300) return [];
  const rows = data?.results?.bindings || [];
  return unique(rows.map((row) => row?.idLabel?.value));
}

async function dynamicAliases(query, type) {
  const metas = await cinemetaSearch(query, type);
  const exact = metas.find((meta) => normalizeTitle(meta?.name) === normalizeTitle(query)) || metas[0];
  const imdbId = exact?.imdb_id || exact?.id;
  return wikidataIndonesianLabelsForImdb(imdbId);
}

async function titleAliases(query, type = "movie") {
  const q = cleanAlias(query);
  if (!q) return [];
  const normalized = normalizeTitle(q);
  const staticAliases = STATIC_ALIASES.get(normalized) || [];
  const key = `title-aliases:${type}:${normalized}`;
  const cached = cache.get(key);
  if (cached !== undefined) return unique([q].concat(staticAliases, cached));

  try {
    const aliases = await dynamicAliases(q, type);
    cache.set(key, aliases, 24 * 60 * 60);
    return unique([q].concat(staticAliases, aliases));
  } catch (err) {
    console.error(`[title-aliases] ${q} failed: ${err.message}`);
    cache.set(key, [], 10 * 60);
    return unique([q].concat(staticAliases));
  }
}

module.exports = {
  titleAliases,
  normalizeTitle,
};
