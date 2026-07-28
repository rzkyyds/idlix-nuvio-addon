"use strict";

const axios = require("axios");
const cheerio = require("cheerio");
const cache = require("./cache");
const { filterMetas, filterStreams, isNsfw } = require("./nsfw-filter");
const { isDirectMedia, resolveDirectUrls, toDirectStream } = require("./direct-resolver");

const USER_AGENT = process.env.CLOUDSTREAM_USER_AGENT ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT = parseInt(process.env.CLOUDSTREAM_TIMEOUT_MS || "18000", 10);
const WEBSITE_JSON = process.env.CLOUDX_WEBSITE_JSON ||
  "https://raw.githubusercontent.com/Asm0d3usX/CloudX/builds/Website.json";
const ALLOW_UNSTABLE_SOURCES = process.env.ALLOW_UNSTABLE_SOURCES === "true";

const http = axios.create({
  timeout: TIMEOUT,
  headers: {
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
  validateStatus: (status) => status >= 200 && status < 500,
  maxRedirects: 5,
});

const SOURCES = [
  {
    id: "pusatmovie",
    name: "Pusatmovie",
    repo: "Asm0d3usX/CloudX",
    websiteJsonKey: "pusatmovie",
    defaultBaseUrl: "https://refugepdx.com",
    disabled: !ALLOW_UNSTABLE_SOURCES,
    disabledCatalogs: ["movie", "series", "ott"],
    types: ["movie", "series"],
    itemSelector: "article.item-infinite",
    titleSelector: "h2.entry-title > a",
    posterSelector: "div.content-thumbnail img, a img",
    qualitySelector: "div.gmr-quality-item > a, div.gmr-qual > a, div.gmr-qual",
    episodeBadgeSelector: "div.gmr-numbeps > span",
    searchPath: (q) => `?s=${encodeURIComponent(q)}&post_type[]=post&post_type[]=tv`,
    home: {
      movie: "year/2026/page/%d/",
      series: "category/serial-tv/page/%d/",
      ott: "country/indonesia/page/%d/",
    },
  },
  {
    id: "filmkita",
    name: "Filmkita",
    repo: "Asm0d3usX/CloudX",
    websiteJsonKey: "filmkita",
    defaultBaseUrl: "https://s9.iix.llc",
    // Search-only for now: direct HLS verified, but catalogs are broad and can add noisy/stale cards.
    disabledCatalogs: ["movie", "series", "ott"],
    types: ["movie", "series"],
    itemSelector: "article.item, article.item-infinite",
    titleSelector: "h2.entry-title > a, h1.grid-title > a",
    posterSelector: "a > img, div.content-thumbnail img",
    qualitySelector: "div.gmr-qual, div.gmr-quality-item > a",
    searchPath: (q) => `?s=${encodeURIComponent(q)}&post_type[]=post&post_type[]=tv`,
    home: {
      movie: "box-office/page/%d/",
      series: "tv-series/page/%d/",
      ott: "country/indonesia/page/%d/",
    },
  },
  {
    id: "filmlokal",
    name: "Filmlokal",
    repo: "Asm0d3usX/CloudX",
    websiteJsonKey: "filmlokal",
    defaultBaseUrl: "https://jorivet.com",
    disabledCatalogs: ["movie", "series", "ott"],
    types: ["movie"],
    itemSelector: "article.item",
    titleSelector: "h2.entry-title > a",
    posterSelector: "a > img, div.content-thumbnail img",
    qualitySelector: "div.gmr-qual, div.gmr-quality-item > a",
    searchPath: (q) => `?s=${encodeURIComponent(q)}&post_type[]=post`,
    home: {
      movie: "country/korea/page/%d/",
      ott: "country/philippines/page/%d/",
    },
  },
  {
    id: "layarwarna",
    name: "LayarWarna",
    repo: "Asm0d3usX/CloudX",
    websiteJsonKey: "layarwarna",
    defaultBaseUrl: "https://free.layarwarna21.tv",
    types: ["movie", "series"],
    itemSelector: "article.item",
    titleSelector: "h2.entry-title > a",
    posterSelector: "a > img, div.content-thumbnail img",
    qualitySelector: "div.gmr-qual, div.gmr-quality-item > a",
    searchPath: (q) => `?s=${encodeURIComponent(q)}&post_type[]=post&post_type[]=tv`,
    home: {
      movie: "box-office/page/%d/",
      series: "tv-series/page/%d/",
      ott: "country/indonesia/page/%d/",
    },
  },
  {
    id: "kawanfilm",
    name: "Kawanfilm",
    repo: "Asm0d3usX/CloudX",
    websiteJsonKey: "kawanfilm",
    defaultBaseUrl: "https://tv2.kawanfilm21.co",
    types: ["movie", "series"],
    itemSelector: "article.item",
    titleSelector: "h2.entry-title > a",
    posterSelector: "a > img, div.content-thumbnail img",
    qualitySelector: "div.gmr-qual, div.gmr-quality-item > a",
    searchPath: (q) => `?s=${encodeURIComponent(q)}&post_type[]=post&post_type[]=tv`,
    home: {
      movie: "box-office/page/%d/",
      series: "tv-series/page/%d/",
      ott: "country/indonesia/page/%d/",
    },
  },
  {
    id: "layarkaca",
    name: "LayarKaca",
    repo: "TeKuma25/IndoStream",
    defaultBaseUrl: "https://lk21.film",
    seriesBaseUrl: "https://tv14.nontondrama.click",
    types: ["movie", "series"],
    itemSelector: "article.mega-item",
    titleSelector: "h1.grid-title > a",
    posterSelector: "img",
    qualitySelector: "div.quality",
    searchPath: (q) => `/search.php?s=${encodeURIComponent(q)}#gsc.tab=0&gsc.q=${encodeURIComponent(q)}&gsc.page=1`,
    searchBase: "seriesBaseUrl",
    searchItemSelector: "div.search-item",
    searchTitleSelector: "a",
    searchPosterSelector: "img.img-thumbnail",
    home: {
      movie: "populer/page/%d/",
      series: "latest-series/page/%d/",
      ott: "country/south-korea/page/%d/",
    },
  },
].filter((source) => !isNsfw(`${source.id} ${source.name} ${source.defaultBaseUrl}`));

function b64urlEncode(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function b64urlDecode(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

function buildId(sourceId, type, url) {
  return `cs:${sourceId}:${type}:${b64urlEncode(url)}`;
}

function parseCloudStreamId(id) {
  if (!id || !id.startsWith("cs:")) return null;
  const parts = id.split(":");
  if (parts.length < 4) return null;
  return {
    sourceId: parts[1],
    type: parts[2] === "series" ? "series" : "movie",
    url: b64urlDecode(parts.slice(3).join(":")),
  };
}

function fixUrl(url, baseUrl) {
  if (!url) return null;
  const cleaned = String(url).trim();
  if (!cleaned || cleaned.startsWith("javascript:")) return null;
  if (cleaned.startsWith("//")) return `https:${cleaned}`;
  try {
    return new URL(cleaned, baseUrl).href;
  } catch (_) {
    return null;
  }
}

function imageAttr($, el) {
  const node = $(el);
  return node.attr("data-src") || node.attr("data-lazy-src") || node.attr("srcset")?.split(/\s+/)[0] || node.attr("src");
}

function cleanTitle(title) {
  return String(title || "")
    .replace(/^Permalink\s+(ke|to):?\s*/i, "")
    .replace(/\s+Season\s+\d+.*$/i, "")
    .replace(/\s+Episode\s+\d+.*$/i, "")
    .trim();
}

function sourceById(id) {
  return SOURCES.find((source) => source.id === id && !source.disabled) || null;
}

async function getWebsiteJson() {
  const key = "cloudstream:cloudx:website-json";
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const { status, data } = await axios.get(WEBSITE_JSON, { timeout: TIMEOUT, validateStatus: (s) => s >= 200 && s < 500 });
    const json = status >= 200 && status < 300 && data && typeof data === "object" ? data : {};
    cache.set(key, json, 1800);
    return json;
  } catch (err) {
    console.error(`[cloudstream] Website.json failed: ${err.message}`);
    cache.set(key, {}, 300);
    return {};
  }
}

async function resolveBaseUrl(source) {
  if (!source.websiteJsonKey) return source.defaultBaseUrl.replace(/\/$/, "");
  const key = `cloudstream:base:${source.id}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const json = await getWebsiteJson();
  const listed = Array.isArray(json[source.websiteJsonKey]) ? json[source.websiteJsonKey][0] : null;
  const base = (listed || source.defaultBaseUrl).replace(/\/$/, "");
  cache.set(key, base, 1800);
  return base;
}

async function fetchHtml(url, referer) {
  const key = `cloudstream:html:${url}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const { status, data } = await http.get(url, { headers: referer ? { referer } : undefined });
    if (status < 200 || status >= 300 || !data) {
      cache.set(key, null, 60);
      return null;
    }
    cache.set(key, String(data), 300);
    return String(data);
  } catch (err) {
    console.error(`[cloudstream] ${url} failed: ${err.message}`);
    cache.set(key, null, 60);
    return null;
  }
}

function inferItemType($, el, fallbackType, href) {
  const text = $(el).text();
  if (/episode|season|series|tv series|drama korea|drakor/i.test(text) || /\/tv\/|\/series\//i.test(href)) return "series";
  return fallbackType === "series" ? "series" : "movie";
}

function itemHasCategory($, el, category) {
  const wanted = String(category || "").toLowerCase();
  if (!wanted) return true;
  const text = $(el).text().toLowerCase();
  const hrefs = $(el).find("a").toArray().map((a) => ($(a).attr("href") || "").toLowerCase()).join(" ");

  if (wanted === "indonesia") {
    return /\bindonesia\b|\bindonesian\b/.test(text) || /\/country\/indonesia\b/.test(hrefs);
  }

  return text.includes(wanted) || hrefs.includes(`/category/${wanted}`) || hrefs.includes(`/genre/${wanted}`);
}

function toMetaPreview(source, $, el, baseUrl, fallbackType = "movie", selectorOverrides = {}) {
  const titleNode = $(el).find(selectorOverrides.titleSelector || source.titleSelector).first();
  const rawTitle = titleNode.attr("title") || titleNode.text();
  const title = cleanTitle(rawTitle);
  const href = fixUrl(titleNode.attr("href") || $(el).find("a").first().attr("href"), baseUrl);
  if (!title || !href || isNsfw(`${title} ${href}`)) return null;

  const posterNode = $(el).find(selectorOverrides.posterSelector || source.posterSelector).first();
  const poster = fixUrl(imageAttr($, posterNode), baseUrl);
  const quality = $(el).find(source.qualitySelector || "").text().trim().replace(/-/g, "");
  const type = inferItemType($, el, fallbackType, href);
  const yearMatch = $(el).text().match(/\b(19\d{2}|20\d{2})\b/);

  return {
    id: buildId(source.id, type, href),
    type,
    name: title,
    poster: poster || undefined,
    year: yearMatch ? yearMatch[1] : undefined,
    description: `${source.name}${quality ? ` • ${quality}` : ""}`,
    genres: [source.name, source.repo],
  };
}

async function catalogFromSource(source, bucket = "movie", page = 1) {
  if (source.disabledCatalogs?.includes(bucket)) return [];

  const baseUrl = await resolveBaseUrl(source);
  const pagePath = (source.home[bucket] || source.home.movie || "").replace("%d", String(page));
  const requestBase = bucket === "series" && source.seriesBaseUrl ? source.seriesBaseUrl : baseUrl;
  const html = await fetchHtml(fixUrl(pagePath, requestBase), requestBase);
  if (!html) return [];
  const $ = cheerio.load(html);

  return $(source.itemSelector).toArray()
    .map((el) => {
      const meta = toMetaPreview(source, $, el, requestBase, bucket === "series" ? "series" : "movie");
      if (!meta) return null;
      if (bucket === "movie" && meta.type !== "movie") return null;
      if (bucket === "series" && meta.type !== "series") return null;
      if (bucket === "ott" && !itemHasCategory($, el, "indonesia")) return null;
      return meta;
    })
    .filter(Boolean);
}

async function searchSource(source, query, type = "movie") {
  const baseUrl = await resolveBaseUrl(source);
  const requestBase = source.searchBase === "seriesBaseUrl" ? source.seriesBaseUrl : baseUrl;
  const path = source.searchPath ? source.searchPath(query) : `?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(fixUrl(path, requestBase), requestBase);
  if (!html) return [];
  const $ = cheerio.load(html);
  const selector = source.searchItemSelector || source.itemSelector;
  return $(selector).toArray()
    .map((el) => toMetaPreview(source, $, el, requestBase, type, {
      titleSelector: source.searchTitleSelector,
      posterSelector: source.searchPosterSelector,
    }))
    .filter((meta) => meta && (type === "series" ? meta.type === "series" : true));
}

async function getCatalog(bucket, type, page = 1) {
  const enabled = SOURCES.filter((source) => !source.disabled && (source.types.includes(type) || bucket === "ott"));
  const results = await Promise.allSettled(enabled.map((source) => catalogFromSource(source, bucket, page)));
  return filterMetas(results.flatMap((r) => r.status === "fulfilled" ? r.value : [])).slice(0, 50);
}

async function search(query, type = "movie") {
  if (!query || query.length < 2 || isNsfw(query)) return [];
  const enabled = SOURCES.filter((source) => !source.disabled && source.types.includes(type));
  const results = await Promise.allSettled(enabled.map((source) => searchSource(source, query, type)));
  const seen = new Set();
  return filterMetas(results.flatMap((r) => r.status === "fulfilled" ? r.value : [])).filter((meta) => {
    if (seen.has(meta.id)) return false;
    seen.add(meta.id);
    return true;
  }).slice(0, 50);
}

function parseEpisodes(source, $, pageUrl, poster) {
  const episodes = [];
  const selectors = [
    "div.vid-episodes a",
    "div.gmr-listseries a",
    "div.episode-list > a",
    "div.serial-wrapper a",
    "a[href*='episode']",
  ];
  selectors.forEach((selector) => {
    $(selector).each((_, el) => {
      const href = fixUrl($(el).attr("href"), pageUrl);
      if (!href || isNsfw(href)) return;
      const raw = $(el).attr("title") || $(el).text() || href;
      const episode = raw.match(/Episode\s*(\d+)/i)?.[1] || raw.match(/\b(\d{1,4})\b/)?.[1];
      const season = raw.match(/Season\s*(\d+)/i)?.[1] || href.match(/season-(\d+)/i)?.[1] || "1";
      const epNum = episode ? parseInt(episode, 10) : episodes.length + 1;
      episodes.push({
        id: buildId(source.id, "series", href),
        title: `Episode ${epNum}`,
        season: parseInt(season, 10) || 1,
        episode: epNum,
        thumbnail: poster || undefined,
      });
    });
  });
  const seen = new Set();
  return episodes.filter((ep) => {
    if (seen.has(ep.id)) return false;
    seen.add(ep.id);
    return true;
  }).sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
}

async function getMeta(id) {
  const parsed = parseCloudStreamId(id);
  if (!parsed || isNsfw(parsed.url)) return null;
  const source = sourceById(parsed.sourceId);
  if (!source) return null;
  const html = await fetchHtml(parsed.url, await resolveBaseUrl(source));
  if (!html) return null;
  const $ = cheerio.load(html);
  const title = cleanTitle($("h1.entry-title, li.last > span[itemprop=name], h1").first().text()) || parsed.url;
  if (isNsfw(title)) return null;
  const poster = fixUrl(imageAttr($, $("figure img, div.gmr-movie-data figure img, img.img-thumbnail, .poster img").first()), parsed.url);
  const description = $("div[itemprop=description] > p, div.content > blockquote, .desc, .synopsis").first().text().trim();
  const year = $("div.gmr-moviedata strong:contains(Year:) > a").first().text().trim() ||
    ($.root().text().match(/\b(19\d{2}|20\d{2})\b/) || [])[1];
  const genres = $("div.gmr-moviedata a, div.content h3 a").toArray().map((el) => $(el).text().trim()).filter(Boolean).slice(0, 12);
  const isSeries = parsed.type === "series" || /\/tv\/|episode|season/i.test(parsed.url + " " + $.root().text().slice(0, 2000));
  const meta = {
    id,
    type: isSeries ? "series" : "movie",
    name: title,
    poster: poster || undefined,
    background: poster || undefined,
    description: description || `${source.name} via CloudStream source (${source.repo})`,
    year: year || undefined,
    genres: [source.name].concat(genres).filter(Boolean).slice(0, 15),
    website: parsed.url,
  };
  if (isSeries) {
    meta.videos = parseEpisodes(source, $, parsed.url, poster);
    if (!meta.videos.length) {
      meta.videos = [{ id, title: "Episode 1", season: 1, episode: 1, thumbnail: poster || undefined }];
    }
  }
  return meta;
}

function normalizeEmbedUrl(url, pageUrl) {
  const fixed = fixUrl(url, pageUrl);
  if (!fixed) return null;
  return fixed.replace(/\s/g, "");
}

async function ajaxIframes($, pageUrl, baseUrl) {
  const postId = $("div#muvipro_player_content_id").attr("data-id");
  if (!postId) return [];
  const tabs = $("div.tab-content-ajax").toArray().map((el) => $(el).attr("id")).filter(Boolean);
  const ajaxUrl = fixUrl("/wp-admin/admin-ajax.php", baseUrl || pageUrl);
  const found = [];
  await Promise.allSettled(tabs.map(async (tab) => {
    const body = new URLSearchParams({ action: "muvipro_player_content", tab, post_id: postId });
    const { status, data } = await http.post(ajaxUrl, body.toString(), {
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        referer: pageUrl,
        "x-requested-with": "XMLHttpRequest",
      },
    });
    if (status >= 200 && status < 300 && data) {
      const $$ = cheerio.load(String(data));
      $$('iframe').each((_, iframe) => {
        const src = normalizeEmbedUrl($$(iframe).attr("data-litespeed-src") || $$(iframe).attr("src"), pageUrl);
        if (src) found.push(src);
      });
    }
  }));
  return found;
}

async function getStreams(id) {
  const parsed = parseCloudStreamId(id);
  if (!parsed || isNsfw(parsed.url)) return [];
  const source = sourceById(parsed.sourceId);
  if (!source) return [];
  const baseUrl = await resolveBaseUrl(source);
  const html = await fetchHtml(parsed.url, baseUrl);
  if (!html) return [];
  const $ = cheerio.load(html);
  const raw = [];

  $("iframe").each((_, el) => {
    const src = normalizeEmbedUrl($(el).attr("data-litespeed-src") || $(el).attr("src"), parsed.url);
    if (src) raw.push(src);
  });
  $("ul#loadProviders > li a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.trim().startsWith("#")) return;
    const fixed = normalizeEmbedUrl(href, parsed.url);
    if (fixed) raw.push(fixed);
  });
  $("ul.gmr-download-list li a, a[href*='.m3u8'], a[href*='.mp4']").each((_, el) => {
    const href = normalizeEmbedUrl($(el).attr("href"), parsed.url);
    if (href) raw.push(href);
  });
  raw.push(...await ajaxIframes($, parsed.url, baseUrl));

  const seen = new Set();
  const embedUrls = raw.filter((url) => {
    if (!url || isNsfw(url) || seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  const directResolved = [];
  await Promise.allSettled(embedUrls.slice(0, 12).map(async (embedUrl) => {
    const directUrls = isDirectMedia(embedUrl) ? [embedUrl] : await resolveDirectUrls(embedUrl, parsed.url);
    directUrls.forEach((directUrl) => {
      if (directUrl && !isNsfw(directUrl)) {
        directResolved.push(toDirectStream(directUrl, source.name, embedUrl, directResolved.length));
      }
    });
  }));

  const directSeen = new Set();
  const directStreams = directResolved.filter((stream) => {
    if (!stream.url || directSeen.has(stream.url)) return false;
    directSeen.add(stream.url);
    return true;
  });

  if (directStreams.length) return filterStreams(directStreams).slice(0, 30);

  if (process.env.ALLOW_EXTERNAL_FALLBACK !== "true") return [];

  // Optional fallback for debugging. Disabled by default so every shown stream is native-player compatible.
  const streams = embedUrls.map((url, idx) => {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return {
      name: `${source.name}\n${host}`,
      title: `${source.name} • External ${idx + 1}\n${host}`,
      externalUrl: url,
      behaviorHints: {
        notWebReady: true,
        bingeGroup: `cloudstream-external-${source.id}-${host}`,
      },
    };
  });
  return filterStreams(streams).slice(0, 30);
}

function getSourceSummary() {
  return SOURCES.map(({ id, name, repo, defaultBaseUrl, websiteJsonKey, disabled, types, home }) => ({
    id,
    name,
    repo,
    baseUrl: defaultBaseUrl,
    dynamicDomainKey: websiteJsonKey || null,
    disabled: !!disabled,
    types,
    catalogs: Object.keys(home),
  }));
}

module.exports = {
  SOURCES,
  getSourceSummary,
  parseCloudStreamId,
  getCatalog,
  search,
  getMeta,
  getStreams,
};
