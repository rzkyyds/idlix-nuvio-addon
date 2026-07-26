'use strict';

const axios = require('axios');
const idlixCache = require('./cache');

function detectType(item, fallback = 'movie') {
  if (!item) return fallback;
  if (item.type === 'series' || item.type === 'tv') return 'series';
  if (item.type === 'movie') {
    const endpoint = (item.link && item.link.endpoint) || '';
    if (endpoint.startsWith('series/')) return 'series';
    return 'movie';
  }
  const endpoint = (item.link && item.link.endpoint) || '';
  if (endpoint.startsWith('series/')) return 'series';
  if (endpoint.startsWith('movie/')) return 'movie';
  return fallback;
}

function extractSlug(item) {
  if (!item) return null;
  if (item.slug) return item.slug;
  const endpoint = (item.link && item.link.endpoint) || '';
  const parts = endpoint.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : null;
}

function castNames(cast) {
  if (!Array.isArray(cast)) return [];
  return cast.map((c) => (typeof c === 'string' ? c : c && c.name)).filter(Boolean);
}

function buildId(type, slug) {
  return `idlix:${type}:${slug}`;
}

function parseId(id) {
  if (!id || typeof id !== 'string') return null;

  if (id.startsWith('idlix:')) {
    const parts = id.split(':');
    if (parts.length < 3) return null;
    const type = parts[1] === 'series' ? 'series' : 'movie';
    const slug = parts[2];
    if (!slug) return null;
    const result = { type, slug, raw: id };
    if (type === 'series' && parts.length >= 5) {
      result.season = parseInt(parts[3], 10);
      result.episode = parseInt(parts[4], 10);
    }
    return result;
  }

  if (id.startsWith('tt')) {
    return { type: null, slug: null, imdbId: id, raw: id };
  }

  return null;
}

async function resolveImdbToIdlix(imdbId, contentType = 'movie') {
  if (!imdbId || !imdbId.startsWith('tt')) return null;

  const cacheKey = `imdb-resolve:${imdbId}:${contentType}`;
  const cached = idlixCache.get(cacheKey);
  if (cached) return cached;

  try {
    const { data: cm } = await axios.get(
      `https://v3-cinemeta.strem.io/meta/${contentType}/${imdbId}.json`,
      { timeout: 8000 }
    );
    const meta = cm && cm.meta;
    if (!meta || !meta.name) return null;

    const idlixUrl = (process.env.IDLIX_API_URL || 'https://kisutidlix.zeabur.app/api').replace(/\/$/, '');
    const { data: idlixRes } = await axios.get(
      `${idlixUrl}/search`,
      { params: { q: meta.name }, timeout: 15000 }
    );

    const results = idlixRes && idlixRes.data;
    if (!Array.isArray(results) || !results.length) return null;

    const best = findBestMatch(results, meta.name, meta.year, contentType);
    if (!best) return null;

    const slug = extractSlug(best);
    const resolvedType = detectType(best, contentType);
    const result = { type: resolvedType, slug, imdbId };

    idlixCache.set(cacheKey, result, 3600);
    return result;
  } catch (err) {
    console.error(`[imdb-resolve] ${imdbId}:`, err.message);
    return null;
  }
}

function findBestMatch(results, targetTitle, targetYear, targetType) {
  if (!Array.isArray(results) || !results.length) return null;

  const normalized = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  const tTitle = normalized(targetTitle);

  const scored = results.map((item) => {
    const iTitle = normalized(item.title || item.originalTitle || '');
    const iYear = item.year;
    const iType = detectType(item, targetType);

    let score = 0;
    if (iTitle === tTitle) score += 100;
    else if (iTitle.includes(tTitle) || tTitle.includes(iTitle)) score += 50;

    if (iYear === targetYear) score += 20;
    if (iType === targetType) score += 10;

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score >= 50 ? scored[0].item : null;
}

function toMetaPreview(item, fallbackType = 'movie') {
  if (!item) return null;
  const slug = extractSlug(item);
  if (!slug || slug === 'undefined') return null;

  const type = detectType(item, fallbackType);
  const genres = Array.isArray(item.genres)
    ? item.genres
    : item.genre ? [].concat(item.genre) : undefined;

  return {
    id: buildId(type, slug),
    type,
    name: item.title || item.originalTitle || slug,
    year: item.year || undefined,
    poster: item.poster || (item.link && item.link.thumbnail) || undefined,
    description: item.description || item.overview || undefined,
    genres: genres && genres.length ? genres : undefined,
    cast: castNames(item.cast).length ? castNames(item.cast) : undefined,
    imdbRating: item.rating != null ? String(item.rating) : undefined,
  };
}

function toMetaPreviewList(items, fallbackType = 'movie') {
  if (!Array.isArray(items)) return [];
  return items.map((i) => toMetaPreview(i, fallbackType)).filter(Boolean);
}

function buildEpisodeVideos(detail, slug) {
  const seasons = Array.isArray(detail.seasons) ? detail.seasons : [];
  const videos = [];

  for (const season of seasons) {
    const seasonNumber = season.seasonNumber || season.season || 1;
    const episodeCount = season.episodeCount || (Array.isArray(season.episodes) ? season.episodes.length : 0);
    const namedEpisodes = Array.isArray(season.episodes) ? season.episodes : [];

    if (namedEpisodes.length > 0) {
      for (const ep of namedEpisodes) {
        const epNum = ep.episodeNumber || ep.episode || ep.number;
        if (!epNum) continue;
        videos.push({
          id: `${buildId('series', slug)}:${seasonNumber}:${epNum}`,
          title: ep.title || ep.name || `Episode ${epNum}`,
          season: seasonNumber,
          episode: epNum,
          overview: ep.overview || ep.description || undefined,
          thumbnail: ep.thumbnail || ep.poster || detail.poster || undefined,
          released: ep.released || ep.airDate || undefined,
        });
      }
    } else if (episodeCount > 0) {
      for (let ep = 1; ep <= episodeCount; ep++) {
        videos.push({
          id: `${buildId('series', slug)}:${seasonNumber}:${ep}`,
          title: `Episode ${ep}`,
          season: seasonNumber,
          episode: ep,
          thumbnail: detail.poster || undefined,
        });
      }
    }
  }

  return videos;
}

function toMetaDetail(detail, type, slug) {
  if (!detail) return null;

  const resolvedType = type || detectType(detail, 'movie');
  const resolvedSlug = slug || detail.slug || extractSlug(detail);
  if (!resolvedSlug) return null;

  const cast = castNames(detail.cast);
  const genres = Array.isArray(detail.genres) ? detail.genres : [];
  const director = detail.director
    ? Array.isArray(detail.director)
      ? detail.director.map((d) => d.name || d).filter(Boolean)
      : [detail.director.name || detail.director].filter(Boolean)
    : undefined;

  const meta = {
    id: buildId(resolvedType, resolvedSlug),
    type: resolvedType,
    name: detail.title || detail.originalTitle || resolvedSlug,
    year: detail.year || undefined,
    poster: detail.poster || undefined,
    background: detail.backdrop || detail.background || detail.poster || undefined,
    description: detail.description || detail.overview || undefined,
    genres: genres.length ? genres : undefined,
    cast: cast.length ? cast : undefined,
    director: director && director.length ? director : undefined,
    runtime: detail.runtimeMinutes
      ? `${detail.runtimeMinutes} min`
      : detail.runtime || undefined,
    imdbRating: detail.rating != null ? String(detail.rating) : undefined,
    country: detail.country || undefined,
    website: detail.watchUrl || undefined,
    trailers: detail.trailer
      ? [{ source: extractYoutubeId(detail.trailer), type: 'Trailer' }].filter((t) => t.source)
      : undefined,
  };

  if (resolvedType === 'series') {
    meta.videos = buildEpisodeVideos(detail, resolvedSlug);
  }

  return meta;
}

function extractYoutubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

function extractVideoSources(payload) {
  if (!payload) return [];

  if (Array.isArray(payload.videoSources) && payload.videoSources.length) {
    return payload.videoSources;
  }

  if (payload.data && (payload.data.streamUrl || payload.data.videoSources)) {
    return extractVideoSources(payload.data);
  }

  const sources = [];
  if (payload.streamUrl) {
    const quality = payload.maxHeight
      ? `${payload.maxHeight}p`
      : guessQualityFromTitle(payload.title) || 'HD';
    const url = payload.streamUrl;
    const type = guessStreamType(url, payload);
    sources.push({ quality, url, type, title: payload.title, subtitles: payload.subtitles });
  }

  return sources;
}

function guessQualityFromTitle(title) {
  if (!title) return null;
  const m = String(title).match(/(2160|1080|720|480|360)p/i);
  return m ? `${m[1]}p` : null;
}

function guessStreamType(url, source) {
  if (source && source.type) return source.type;
  if (!url) return 'mp4';
  const lower = String(url).toLowerCase();
  if (lower.includes('m3u8') || lower.includes('config-') || lower.includes('.json')) return 'm3u8';
  if (lower.includes('.mp4')) return 'mp4';
  return 'm3u8';
}

function toStreams(videoSources, { slug, bingeGroup, proxyBase } = {}) {
  const sources = Array.isArray(videoSources) ? videoSources : extractVideoSources(videoSources);
  if (!sources.length) return [];

  const group = bingeGroup || (slug ? `idlix-${slug}` : 'idlix');
  const proxy = proxyBase || process.env.PROXY_BASE || '';

  return sources.map((source) => {
    const url = source.url || source.file || source.src;
    if (!url) return null;

    const quality = source.quality || source.label || 'HD';
    const type = guessStreamType(url, source);
    const name = `IDLIX\n${quality}`;
    const title = source.title ? `${quality}\n${source.title}` : `${quality}\nIDLIX`;

    // IDLIX config.json URLs need proxy unwrapping — player rejects .json extension
    const finalUrl = (url.includes('config-') && url.includes('.json'))
      ? `${proxy}/play?url=${encodeURIComponent(url)}`
      : url;

    const stream = {
      name, title,
      url: finalUrl,
      // Proxy handles content-type, so notWebReady not needed
      behaviorHints: { bingeGroup: group },
    };

    if (Array.isArray(source.subtitles) && source.subtitles.length) {
      stream.subtitles = source.subtitles.map((sub, idx) => ({
        id: sub.lang || sub.label || `sub-${idx}`,
        url: sub.url,
        lang: sub.lang || sub.label || 'unk',
      })).filter((s) => s.url);
    }

    return stream;
  }).filter(Boolean);
}

module.exports = {
  detectType,
  extractSlug,
  buildId,
  parseId,
  resolveImdbToIdlix,
  toMetaPreview,
  toMetaPreviewList,
  toMetaDetail,
  extractVideoSources,
  toStreams,
};
