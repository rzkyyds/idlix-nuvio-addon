"use strict";

const axios = require("axios");
const cache = require("./cache");
const { filterMetas, filterStreams, isNsfw } = require("./nsfw-filter");

const USER_AGENT = process.env.MOVIEBOX_USER_AGENT ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT = parseInt(process.env.MOVIEBOX_TIMEOUT_MS || "16000", 10);
const MAIN_API = (process.env.MOVIEBOX_MAIN_API || "https://h5-api.aoneroom.com").replace(/\/$/, "");
const WEB_API = (process.env.MOVIEBOX_WEB_API || "https://filmboom.top").replace(/\/$/, "");

const CATALOGS = {
  indonesiaMovies: "6528093688173053896",
  indonesiaDrama: "5283462032510044280",
  indonesiaHorror: "5848753831881965888",
};

const http = axios.create({
  timeout: TIMEOUT,
  headers: {
    "user-agent": USER_AGENT,
    accept: "application/json,text/plain,*/*",
  },
  validateStatus: (status) => status >= 200 && status < 500,
});

function buildId(type, subjectId, season = 0, episode = 0) {
  const safeType = type === "series" ? "series" : "movie";
  return `mb:${safeType}:${subjectId}:${season || 0}:${episode || 0}`;
}

function parseId(id) {
  if (!id || !id.startsWith("mb:")) return null;
  const [, rawType, subjectId, rawSeason = "0", rawEpisode = "0"] = String(id).split(":");
  if (!subjectId) return null;
  return {
    type: rawType === "series" ? "series" : "movie",
    subjectId,
    season: parseInt(rawSeason, 10) || 0,
    episode: parseInt(rawEpisode, 10) || 0,
  };
}

function firstYear(date) {
  const year = String(date || "").match(/^(19\d{2}|20\d{2})/)?.[1];
  return year ? parseInt(year, 10) : undefined;
}

function toMetaPreview(item, forcedType) {
  const title = String(item?.title || "").trim();
  const subjectId = item?.subjectId;
  if (!title || !subjectId || isNsfw(`${title} ${subjectId}`)) return null;
  const type = forcedType || (item.subjectType === 2 ? "series" : "movie");
  return {
    id: buildId(type, subjectId),
    type,
    name: title,
    poster: item.cover?.url || undefined,
    year: firstYear(item.releaseDate),
    description: ["MovieBox direct MP4", item.countryName, item.genre].filter(Boolean).join(" • "),
    genres: ["MovieBox", "Direct MP4"].concat(String(item.genre || "").split(",").map((x) => x.trim()).filter(Boolean)).slice(0, 12),
  };
}

async function cachedJson(key, ttlSeconds, loader) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const value = await loader();
    cache.set(key, value, ttlSeconds);
    return value;
  } catch (err) {
    console.error(`[moviebox] ${key} failed: ${err.message}`);
    cache.set(key, null, 60);
    return null;
  }
}

async function rankingList(catalogId, page = 1, perPage = 20) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const key = `moviebox:ranking:${catalogId}:${safePage}:${perPage}`;
  return cachedJson(key, 900, async () => {
    const { status, data } = await http.get(`${MAIN_API}/wefeed-h5api-bff/ranking-list/content`, {
      params: { id: catalogId, page: safePage, perPage },
    });
    if (status < 200 || status >= 300 || data?.code !== 0) return [];
    return data?.data?.subjectList || [];
  }) || [];
}

async function getCatalog(bucket = "movie", type = "movie", page = 1) {
  const forcedType = type === "series" ? "series" : "movie";
  const catalogIds = forcedType === "series"
    ? [CATALOGS.indonesiaDrama]
    : bucket === "ott"
      ? [CATALOGS.indonesiaMovies, CATALOGS.indonesiaHorror]
      : [CATALOGS.indonesiaMovies];

  const pages = await Promise.allSettled(catalogIds.map((id) => rankingList(id, page)));
  const metas = pages
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter((item) => forcedType === "series" ? item.subjectType === 2 : item.subjectType === 1)
    .map((item) => toMetaPreview(item, forcedType))
    .filter(Boolean);

  const seen = new Set();
  return filterMetas(metas).filter((meta) => {
    if (seen.has(meta.id)) return false;
    seen.add(meta.id);
    return true;
  }).slice(0, 50);
}

async function search(query, type = "movie") {
  const q = String(query || "").trim();
  if (q.length < 2 || isNsfw(q)) return [];
  const forcedType = type === "series" ? "series" : "movie";
  const key = `moviebox:search:${forcedType}:${q.toLowerCase()}`;
  const items = await cachedJson(key, 600, async () => {
    const { status, data } = await http.post(`${WEB_API}/wefeed-h5-bff/web/subject/search`, {
      keyword: q,
      page: "1",
      perPage: "20",
      subjectType: forcedType === "series" ? "2" : "1",
    }, {
      headers: { "content-type": "application/json" },
    });
    if (status < 200 || status >= 300 || data?.code !== 0) return [];
    return data?.data?.items || [];
  }) || [];

  return filterMetas(items
    .filter((item) => forcedType === "series" ? item.subjectType === 2 : item.subjectType === 1)
    .map((item) => toMetaPreview(item, forcedType))
    .filter(Boolean)).slice(0, 20);
}

async function getDetail(subjectId) {
  const key = `moviebox:detail:${subjectId}`;
  return cachedJson(key, 1800, async () => {
    const { status, data } = await http.get(`${WEB_API}/wefeed-h5-bff/web/subject/detail`, {
      params: { subjectId },
    });
    if (status < 200 || status >= 300 || data?.code !== 0) return null;
    return data?.data || null;
  });
}

function buildEpisodes(subjectId, detail, poster) {
  const seasons = detail?.resource?.seasons || [];
  const episodes = [];
  seasons.forEach((seasonData) => {
    const season = parseInt(seasonData.se, 10) || 1;
    const listed = String(seasonData.allEp || "")
      .split(",")
      .map((value) => parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    const maxEp = parseInt(seasonData.maxEp, 10) || Math.max(0, ...listed);
    const epNumbers = listed.length ? listed : Array.from({ length: Math.min(maxEp, 250) }, (_, idx) => idx + 1);
    epNumbers.forEach((episode) => {
      episodes.push({
        id: buildId("series", subjectId, season, episode),
        title: `Episode ${episode}`,
        season,
        episode,
        thumbnail: poster || undefined,
      });
    });
  });
  return episodes;
}

async function getMeta(id) {
  const parsed = parseId(id);
  if (!parsed || isNsfw(parsed.subjectId)) return null;
  const detail = await getDetail(parsed.subjectId);
  const subject = detail?.subject;
  if (!subject) return null;
  const type = subject.subjectType === 2 || parsed.type === "series" ? "series" : "movie";
  const title = String(subject.title || "").trim();
  if (!title || isNsfw(title)) return null;
  const poster = subject.cover?.url || undefined;
  const genres = String(subject.genre || "").split(",").map((x) => x.trim()).filter(Boolean);
  const meta = {
    id: buildId(type, parsed.subjectId),
    type,
    name: title,
    poster,
    background: poster,
    description: subject.description || "MovieBox direct MP4",
    year: firstYear(subject.releaseDate),
    genres: ["MovieBox", "Direct MP4"].concat(genres).slice(0, 15),
    website: `${WEB_API}/spa/videoPlayPage/movies/${subject.detailPath || ""}?id=${parsed.subjectId}`,
  };
  if (type === "series") {
    meta.videos = buildEpisodes(parsed.subjectId, detail, poster);
    if (!meta.videos.length) {
      meta.videos = [{ id: buildId("series", parsed.subjectId, 1, 1), title: "Episode 1", season: 1, episode: 1, thumbnail: poster }];
    }
  }
  return meta;
}

async function getStreams(id) {
  const parsed = parseId(id);
  if (!parsed || isNsfw(parsed.subjectId)) return [];
  const detail = await getDetail(parsed.subjectId);
  const subject = detail?.subject || {};
  const season = parsed.type === "series" ? parsed.season || 1 : 0;
  const episode = parsed.type === "series" ? parsed.episode || 1 : 0;
  const cacheKey = `moviebox:streams:${parsed.subjectId}:${season}:${episode}`;
  const streams = await cachedJson(cacheKey, 120, async () => {
    const referer = `${WEB_API}/spa/videoPlayPage/movies/${subject.detailPath || ""}?id=${parsed.subjectId}&type=/movie/detail&lang=en`;
    const { status, data } = await http.get(`${WEB_API}/wefeed-h5-bff/web/subject/play`, {
      params: { subjectId: parsed.subjectId, se: season, ep: episode },
      headers: { referer },
    });
    if (status < 200 || status >= 300 || data?.code !== 0) return [];
    return data?.data?.streams || [];
  }) || [];

  const seen = new Set();
  const direct = streams
    .filter((stream) => stream?.url && /^https?:\/\//i.test(stream.url))
    .filter((stream) => {
      if (seen.has(stream.url)) return false;
      seen.add(stream.url);
      return true;
    })
    .map((stream, index) => ({
      name: `MovieBox\n${stream.resolutions || "Direct"}`,
      title: `MovieBox • ${stream.resolutions || "Direct"} ${stream.format || "MP4"}`,
      url: stream.url,
      behaviorHints: {
        bingeGroup: `moviebox-${parsed.subjectId}-${stream.resolutions || index}`,
      },
    }));

  return filterStreams(direct).slice(0, 8);
}

module.exports = {
  parseId,
  getCatalog,
  search,
  getMeta,
  getStreams,
};
