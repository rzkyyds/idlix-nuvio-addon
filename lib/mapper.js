'use strict';

/**
 * Transform IDLIX API responses into Stremio meta/stream objects.
 */

function detectType(item, fallback = 'movie') {
  if (!item) return fallback;
  if (item.type === 'series' || item.type === 'tv') return 'series';
  if (item.type === 'movie') {
    // IDLIX list endpoints often mis-label series as movie; trust link endpoint
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
  return cast
    .map((c) => (typeof c === 'string' ? c : c && c.name))
    .filter(Boolean);
}

function buildId(type, slug) {
  return `idlix:${type}:${slug}`;
}

function parseId(id) {
  if (!id || typeof id !== 'string') return null;

  // idlix:movie:slug
  // idlix:series:slug
  // idlix:series:slug:season:episode
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

  // Allow plain imdb ids through (no IDLIX mapping)
  if (id.startsWith('tt')) {
    return { type: null, slug: null, imdbId: id, raw: id };
  }

  return null;
}

/**
 * Map a list item to Stremio MetaPreview
 */
function toMetaPreview(item, fallbackType = 'movie') {
  if (!item) return null;
  const slug = extractSlug(item);
  if (!slug || slug === 'undefined') return null;

  const type = detectType(item, fallbackType);
  const genres = Array.isArray(item.genres)
    ? item.genres
    : item.genre
      ? [].concat(item.genre)
      : undefined;

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

/**
 * Map movie/series detail to Stremio MetaDetail
 */
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

/**
 * Normalize stream API payload into a videoSources-like array, then map to Stremio streams.
 * IDLIX stream endpoint returns: { streamUrl, subtitles, title, maxHeight, ... }
 * Also accepts detail.videoSources[] if present.
 */
function extractVideoSources(payload) {
  if (!payload) return [];

  if (Array.isArray(payload.videoSources) && payload.videoSources.length) {
    return payload.videoSources;
  }

  // Nested data wrapper
  if (payload.data && (payload.data.streamUrl || payload.data.videoSources)) {
    return extractVideoSources(payload.data);
  }

  const sources = [];
  if (payload.streamUrl) {
    const quality =
      payload.maxHeight
        ? `${payload.maxHeight}p`
        : guessQualityFromTitle(payload.title) || 'HD';
    const url = payload.streamUrl;
    const type = guessStreamType(url, payload);
    sources.push({
      quality,
      url,
      type,
      title: payload.title,
      subtitles: payload.subtitles,
    });
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
  if (lower.includes('m3u8') || lower.includes('config-') || lower.includes('.json')) {
    return 'm3u8';
  }
  if (lower.includes('.mp4')) return 'mp4';
  return 'm3u8';
}

/**
 * Stream mapping: videoSources → Stremio stream objects
 */
function toStreams(videoSources, { slug, bingeGroup } = {}) {
  const sources = Array.isArray(videoSources) ? videoSources : extractVideoSources(videoSources);
  if (!sources.length) return [];

  const group = bingeGroup || (slug ? `idlix-${slug}` : 'idlix');

  return sources
    .map((source) => {
      const url = source.url || source.file || source.src;
      if (!url) return null;

      const quality = source.quality || source.label || 'HD';
      const type = guessStreamType(url, source);
      const name = `IDLIX\n${quality}`;
      const title = source.title ? `${quality}\n${source.title}` : `${quality}\nIDLIX`;

      const stream = {
        name,
        title,
        url,
        behaviorHints: {
          notWebReady: type === 'm3u8',
          bingeGroup: group,
        },
      };

      if (Array.isArray(source.subtitles) && source.subtitles.length) {
        stream.subtitles = source.subtitles
          .map((sub, idx) => ({
            id: sub.lang || sub.label || `sub-${idx}`,
            url: sub.url,
            lang: sub.lang || sub.label || 'unk',
          }))
          .filter((s) => s.url);
      }

      return stream;
    })
    .filter(Boolean);
}

module.exports = {
  detectType,
  extractSlug,
  buildId,
  parseId,
  toMetaPreview,
  toMetaPreviewList,
  toMetaDetail,
  extractVideoSources,
  toStreams,
};
