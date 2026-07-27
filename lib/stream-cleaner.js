"use strict";

const { isNsfw } = require("./nsfw-filter");

const BLOCKED_STREAM_TERMS = [
  "donation needed",
  "donation",
  "donate",
  "premium only",
  "vip only",
  "subscription",
  "sub only",
  "join discord",
  "telegram",
];

function textOf(stream) {
  return [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.url,
    stream?.externalUrl,
  ].filter(Boolean).join(" ").toLowerCase();
}

function isBlockedStream(stream) {
  const text = textOf(stream).replace(/[._-]+/g, " ");
  return isNsfw(stream) || BLOCKED_STREAM_TERMS.some((term) => text.includes(term));
}

function resolutionRank(key) {
  if (key === "2160p") return 2160;
  if (key === "1440p") return 1440;
  if (key === "1080p") return 1080;
  if (key === "720p") return 720;
  if (key === "480p") return 480;
  if (key === "360p") return 360;
  return 0;
}

function resolutionKey(stream) {
  const text = textOf(stream);
  if (/\b(4k|uhd|2160p|2160)\b/i.test(text)) return "2160p";
  const match = text.match(/\b(1440|1080|720|480|360)p?\b/i);
  if (match) return `${match[1]}p`;
  const size = stream?.behaviorHints?.videoSize;
  if (typeof size === "number" && size > 0) {
    if (size >= 7 * 1024 ** 3) return "2160p";
    if (size >= 2 * 1024 ** 3) return "1080p";
    if (size >= 700 * 1024 ** 2) return "720p";
  }
  return "auto";
}

function scoreStream(stream) {
  let score = 0;
  if (stream?.url) score += 1000;
  if (!stream?.externalUrl) score += 300;
  if (stream?.behaviorHints?.notWebReady) score -= 100;
  const size = stream?.behaviorHints?.videoSize;
  if (typeof size === "number" && size > 0) score += Math.min(size / (1024 ** 3), 80);
  if (/castle/i.test(textOf(stream))) score -= 10; // Castle sidecar subs caused seek desync in Nuvio/Stremio.
  return score;
}

function stripProblematicSubtitles(stream) {
  if (process.env.INCLUDE_UPSTREAM_SUBTITLES === "true") return stream;
  if (!stream || !Array.isArray(stream.subtitles)) return stream;
  const cloned = { ...stream };
  delete cloned.subtitles;
  return cloned;
}

function cleanStreamList(streams, { onePerResolution = true } = {}) {
  if (!Array.isArray(streams)) return [];

  const byUrl = new Map();
  for (const raw of streams) {
    if (!raw || typeof raw !== "object" || isBlockedStream(raw)) continue;
    const stream = stripProblematicSubtitles(raw);
    const urlKey = stream.url || stream.externalUrl || `${stream.name}:${stream.title}`;
    if (!urlKey) continue;
    const existing = byUrl.get(urlKey);
    if (!existing || scoreStream(stream) > scoreStream(existing)) byUrl.set(urlKey, stream);
  }

  let result = Array.from(byUrl.values());
  if (onePerResolution) {
    const grouped = new Map();
    for (const stream of result) {
      const key = resolutionKey(stream);
      const existing = grouped.get(key);
      if (!existing || scoreStream(stream) > scoreStream(existing)) grouped.set(key, stream);
    }
    result = Array.from(grouped.values());
  }

  return result.sort((a, b) => {
    const ra = resolutionRank(resolutionKey(a));
    const rb = resolutionRank(resolutionKey(b));
    if (rb !== ra) return rb - ra;
    return scoreStream(b) - scoreStream(a);
  });
}

module.exports = {
  BLOCKED_STREAM_TERMS,
  cleanStreamList,
  resolutionKey,
};
