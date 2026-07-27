"use strict";

const axios = require("axios");
const cheerio = require("cheerio");
const cache = require("./cache");

const USER_AGENT = process.env.CLOUDSTREAM_USER_AGENT ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT = parseInt(process.env.EXTRACTOR_TIMEOUT_MS || "16000", 10);
const MAX_DEPTH = parseInt(process.env.EXTRACTOR_MAX_DEPTH || "2", 10);

const http = axios.create({
  timeout: TIMEOUT,
  maxRedirects: 5,
  validateStatus: (status) => status >= 200 && status < 500,
  headers: {
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
});

function isDirectMedia(url) {
  return /\.(m3u8|mp4|webm)(?:[?#]|$)/i.test(String(url || ""));
}

function streamType(url) {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return "hls";
  if (/\.mp4(?:[?#]|$)/i.test(url)) return "mp4";
  if (/\.webm(?:[?#]|$)/i.test(url)) return "webm";
  return "http";
}

function normalizeUrl(url, baseUrl) {
  if (!url) return null;
  let value = String(url).trim()
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/^['"]|['"]$/g, "");
  if (!value || value.startsWith("javascript:")) return null;
  if (value.startsWith("//")) value = `https:${value}`;
  try {
    return new URL(value, baseUrl).href;
  } catch (_) {
    return null;
  }
}

function canonicalEmbedUrl(url) {
  const value = String(url || "");
  if (/\.(m3u8|mp4|webm)(?:[?#]|$)/i.test(value)) return value;

  // CloudX ports these same host transforms from CloudStream's Kotlin extractors.
  if (/\/(d|download|file|f)\//i.test(value) && /(dingtezuni|movearnpre|mivalyo|ryderjet|morencius|bingezove)\.com/i.test(value)) {
    return value.replace(/\/(d|download|file|f)\//i, "/v/");
  }
  if (/hgcloud\.to\/f\//i.test(value)) return value.replace("/f/", "/e/");
  if (/luluvdoo\.com\/d\//i.test(value)) return value.replace("/d/", "/e/").replace("luluvdoo.com", "luluvid.com");
  if (/veev\.to\/d\//i.test(value)) return value.replace("/d/", "/e/");
  if (/minochinos\.com\/download\//i.test(value)) return value.replace("/download/", "/embed/");
  return value;
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function unpackPacker(html) {
  const text = String(html || "");
  const unpacked = [];
  const pattern = /eval\(function\(p,a,c,k,e(?:,d)?\)[\s\S]{0,500}?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)\)\)/g;
  let match;
  while ((match = pattern.exec(text))) {
    try {
      let payload = match[1]
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, "\\");
      const radix = parseInt(match[2], 10);
      let count = parseInt(match[3], 10);
      const words = match[4].split("|");
      while (count > 0) {
        count -= 1;
        const word = words[count];
        if (!word) continue;
        payload = payload.replace(new RegExp(`\\b${count.toString(radix)}\\b`, "g"), word);
      }
      unpacked.push(payload);
    } catch (err) {
      console.error(`[resolver] packer unpack failed: ${err.message}`);
    }
  }
  return unpacked;
}

function extractMediaUrls(html, baseUrl) {
  const texts = [String(html || ""), ...unpackPacker(html)];
  const candidates = [];
  const patterns = [
    /https?:\\?\/\\?\/[^"'\s<>\\]+?\.(?:m3u8|mp4|webm)(?:\?[^"'\s<>]*)?/gi,
    /(?:file|src|source|url)\s*[:=]\s*["']([^"']+?\.(?:m3u8|mp4|webm)(?:\?[^"']*)?)["']/gi,
    /["']([^"']+?\.(?:m3u8|mp4|webm)(?:\?[^"']*)?)["']/gi,
  ];
  for (const text of texts) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text))) {
        const raw = match[1] || match[0];
        const fixed = normalizeUrl(raw, baseUrl);
        if (fixed && isDirectMedia(fixed)) candidates.push(fixed);
      }
    }
  }
  return unique(candidates);
}

function extractIframeUrls(html, baseUrl) {
  const $ = cheerio.load(String(html || ""));
  const urls = [];
  $("iframe, source, video").each((_, el) => {
    const src = $(el).attr("data-src") || $(el).attr("data-litespeed-src") || $(el).attr("src");
    const fixed = normalizeUrl(src, baseUrl);
    if (fixed) urls.push(fixed);
  });
  return unique(urls);
}

async function fetchText(url, referer) {
  const cacheKey = `resolver:${url}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const { status, data, headers, request } = await http.get(url, {
      headers: referer ? { referer, origin: new URL(referer).origin } : undefined,
      responseType: "text",
    });
    if (status < 200 || status >= 300 || !data) {
      cache.set(cacheKey, null, 120);
      return null;
    }
    const finalUrl = request?.res?.responseUrl || url;
    const payload = { text: String(data), contentType: headers["content-type"] || "", finalUrl };
    cache.set(cacheKey, payload, 600);
    return payload;
  } catch (err) {
    console.error(`[resolver] ${url} failed: ${err.message}`);
    cache.set(cacheKey, null, 120);
    return null;
  }
}

async function resolveDirectUrls(inputUrl, referer, depth = 0) {
  const url = canonicalEmbedUrl(inputUrl);
  if (!url) return [];
  if (isDirectMedia(url)) return [url];
  if (depth > MAX_DEPTH) return [];

  const payload = await fetchText(url, referer);
  if (!payload) return [];

  const media = extractMediaUrls(payload.text, payload.finalUrl);
  if (media.length) return media;

  const iframes = extractIframeUrls(payload.text, payload.finalUrl)
    .filter((iframe) => iframe !== url && !iframe.includes("youtube.com") && !iframe.includes("youtu.be"));
  const nested = [];
  for (const iframe of iframes.slice(0, 4)) {
    nested.push(...await resolveDirectUrls(iframe, payload.finalUrl, depth + 1));
  }
  return unique(nested);
}

function toDirectStream(url, sourceName, originalUrl, index) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return {
    name: `${sourceName}\n${host}`,
    title: `${sourceName} • Direct ${index + 1}\n${host}`,
    url,
    behaviorHints: {
      bingeGroup: `cloudstream-direct-${host}`,
      videoSize: undefined,
    },
    ...(streamType(url) === "hls" ? { ytId: undefined } : {}),
    originalUrl,
  };
}

module.exports = {
  isDirectMedia,
  resolveDirectUrls,
  toDirectStream,
};
