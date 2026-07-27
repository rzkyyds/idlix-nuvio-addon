"use strict";

const NSFW_TERMS = [
  "adult", "xxx", "x-rated", "x rated", "porn", "porno", "pornhub", "hentai",
  "jav", "av idol", "gravure", "erotic", "erotica", "sex", "sexy", "nude",
  "nudity", "18+", "onlyfans", "camgirl", "webcam", "bokep", "mesum",
  "semi", "blue film", "bf japan", "uncensored", "nsfw"
];

function haystack(value) {
  if (!value) return "";
  if (typeof value === "string") return value.toLowerCase();
  if (Array.isArray(value)) return value.map(haystack).join(" ");
  if (typeof value === "object") {
    return [
      value.name, value.title, value.description, value.overview,
      value.genre, value.genres, value.category, value.categories,
      value.type, value.id
    ].map(haystack).join(" ");
  }
  return String(value).toLowerCase();
}

function isNsfw(value) {
  const text = haystack(value).replace(/[._-]+/g, " ");
  return NSFW_TERMS.some((term) => text.includes(term));
}

function filterMetas(metas) {
  return Array.isArray(metas) ? metas.filter((m) => !isNsfw(m)) : [];
}

function filterStreams(streams) {
  return Array.isArray(streams) ? streams.filter((s) => !isNsfw(s)) : [];
}

module.exports = { NSFW_TERMS, isNsfw, filterMetas, filterStreams };
