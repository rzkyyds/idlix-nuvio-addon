"use strict";

const { isNsfw } = require("./nsfw-filter");

const MAX_STREAM_SIZE_BYTES = parseInt(
  process.env.MAX_STREAM_SIZE_BYTES || String(10 * 1024 ** 3),
  10,
);

const BLOCKED_STREAM_TERMS = [
  "[download]",
  "download |",
  "download only",
  "10gbps download",
  "donation needed",
  "donation",
  "donate",
  "premium only",
  "vip only",
  "subscription",
  "sub only",
  "join discord",
  "telegram",
  "hubcdn",
  "hls stream",
  "[castle]",
];

const UNAUTHORIZED_STREAM_HOST_PATTERNS = [
  /\.r2\.cloudflarestorage\.com\b/i,
  /\.r2\.dev\b/i,
  /\bhub\.latent\.click\b/i,
  /\bbzzhr\.co\b/i,
  /\bgpdl\.hubcloud\.cx\b/i,
  /\bhubcloud\.cx\/pl\/sl\.php\b/i,
  /\bpixel\.hubcloud\.cx\b/i,
  /\bgpdl2?\.hubcloud\.cx\b/i,
  /\b(?:img1\.)?(?:bcxvo|flkow|flucb|hvncw)\.com\b/i,
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

function streamSizeBytes(stream) {
  const value = stream?.behaviorHints?.videoSize;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = textOf(stream);
  const match = text.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(gb|gib|mb|mib)(?:[^a-z]|$)/i);
  if (!match) return 0;

  const amount = parseFloat(match[1]);
  if (!Number.isFinite(amount)) return 0;
  const unit = match[2].toLowerCase();
  return unit.startsWith("g") ? amount * 1024 ** 3 : amount * 1024 ** 2;
}

function isTooLarge(stream) {
  const size = streamSizeBytes(stream);
  if (MAX_STREAM_SIZE_BYTES > 0 && size > MAX_STREAM_SIZE_BYTES) return true;

  // Unknown-size 4K/remux rows are usually well above the user's 10GB ceiling.
  // Keep the list conservative unless the upstream gives a concrete size under the cap.
  if (!size && /\b(4k|uhd|2160p|2160|remux)\b/i.test(textOf(stream))) return true;
  return false;
}

function hasKnownUnauthorizedHost(stream) {
  const url = String(stream?.url || stream?.externalUrl || "");
  return UNAUTHORIZED_STREAM_HOST_PATTERNS.some((pattern) => pattern.test(url));
}

function isBlockedStream(stream) {
  const text = textOf(stream).replace(/[._-]+/g, " ");
  const rawText = textOf(stream);
  return isNsfw(stream) || isTooLarge(stream) || hasKnownUnauthorizedHost(stream) || BLOCKED_STREAM_TERMS.some((term) => {
    const normalizedTerm = term.replace(/[._-]+/g, " ").toLowerCase();
    return text.includes(normalizedTerm) || rawText.includes(term.toLowerCase());
  });
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
  const size = streamSizeBytes(stream);
  if (size > 0) {
    if (size >= 7 * 1024 ** 3) return "2160p";
    if (size >= 2 * 1024 ** 3) return "1080p";
    if (size >= 700 * 1024 ** 2) return "720p";
  }
  return "auto";
}

function scoreStream(stream) {
  let score = 0;
  const text = textOf(stream);
  if (stream?.url) score += 1000;
  if (!stream?.externalUrl) score += 300;
  if (stream?.behaviorHints?.notWebReady) score -= 100;

  // Prefer native-player streams with clearer release metadata. Pixeldrain is reliable as a last resort,
  // but its opaque file IDs often hurt subtitle addon matching.
  if (/\.m3u8(?:[?#]|$)|\.mp4(?:[?#]|$)|\.webm(?:[?#]|$)/i.test(text)) score += 140;
  if (/\b(web[- ]?dl|webrip|bluray|remux|hdrip|dvdrip|x264|x265|h\.?264|h\.?265|ddp|aac)\b/i.test(text)) score += 70;
  if (/\bfsl(?:v2)?\b|cdn\.fsl|fsl-buckets|fukggl|gigabytes/i.test(text)) score += 80;
  if (/froststream/i.test(text)) score += 120;
  if (/pixeldrain/i.test(text)) score -= 120;
  if (/10gbps download only/i.test(text)) score -= 80;
  if (/hubcdn|hls stream|googleusercontent/i.test(text)) score -= 500;

  const size = streamSizeBytes(stream);
  if (size > 0) score += Math.min(size / (1024 ** 3), 10);
  if (/castle/i.test(text)) score -= 20; // Castle HLS is frequently short-lived/signed, so keep it behind stable direct files.
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
  UNAUTHORIZED_STREAM_HOST_PATTERNS,
  MAX_STREAM_SIZE_BYTES,
  cleanStreamList,
  resolutionKey,
};
