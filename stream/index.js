'use strict';

const idlix = require('../lib/idlix-client');
const mapper = require('../lib/mapper');

async function streamHandler({ type, id, config }) {
  try {
    let parsed = mapper.parseId(id);
    if (!parsed) return { streams: [] };

    // Resolve IMDB IDs to IDLIX slugs
    if (parsed.imdbId && !parsed.slug) {
      const resolved = await mapper.resolveImdbToIdlix(parsed.imdbId, type);
      if (resolved && resolved.slug) {
        parsed = resolved;
      }
    }

    if (!parsed || !parsed.slug) return { streams: [] };

    const contentType = parsed.type || (type === 'series' ? 'series' : 'movie');
    let streamPayload = null;

    if (contentType === 'series' && parsed.season && parsed.episode) {
      streamPayload = await idlix.getEpisodeStream(parsed.slug, parsed.season, parsed.episode);
    } else if (contentType === 'series') {
      // IMDB resolved to series but no season/episode — try movie stream as fallback
      // (IDLIX miscategorizes some movies as series)
      streamPayload = await idlix.getMovieStream(parsed.slug);
      if (!streamPayload) {
        streamPayload = await idlix.getMovie(parsed.slug);
      }
    } else {
      streamPayload = await idlix.getMovieStream(parsed.slug);
    }

    if (!streamPayload || (!streamPayload.streamUrl && !streamPayload.videoSources)) {
      const detail = contentType === 'series'
        ? await idlix.getSeries(parsed.slug)
        : await idlix.getMovie(parsed.slug);
      if (detail && (detail.videoSources || detail.streamUrl)) {
        streamPayload = detail;
      }
    }

    if (!streamPayload) return { streams: [] };

    // Build proxy base: use addon's own URL as proxy endpoint
    const proxyBase = (config && config.proxyBase) || process.env.ADDON_URL || '';

    const sources = mapper.extractVideoSources(streamPayload);
    const streams = mapper.toStreams(sources, {
      slug: parsed.slug,
      bingeGroup: `idlix-${parsed.slug}`,
      proxyBase,
    });

    return { streams };
  } catch (err) {
    console.error('[stream] error:', err.message);
    return { streams: [] };
  }
}

module.exports = streamHandler;
