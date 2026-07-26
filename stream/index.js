'use strict';

const idlix = require('../lib/idlix-client');
const mapper = require('../lib/mapper');

/**
 * Handle stream requests.
 * Parses idlix IDs, fetches stream sources from IDLIX, returns Stremio streams.
 */
async function streamHandler({ type, id }) {
  try {
    const parsed = mapper.parseId(id);
    if (!parsed || !parsed.slug) {
      return { streams: [] };
    }

    const contentType = parsed.type || (type === 'series' ? 'series' : 'movie');
    let streamPayload = null;

    if (contentType === 'series' && parsed.season && parsed.episode) {
      streamPayload = await idlix.getEpisodeStream(
        parsed.slug,
        parsed.season,
        parsed.episode
      );
    } else if (contentType === 'series') {
      // Series root id without episode — no streams
      return { streams: [] };
    } else {
      streamPayload = await idlix.getMovieStream(parsed.slug);
    }

    // Fallback: detail.videoSources if stream endpoint empty
    if (!streamPayload || (!streamPayload.streamUrl && !streamPayload.videoSources)) {
      const detail =
        contentType === 'series'
          ? await idlix.getSeries(parsed.slug)
          : await idlix.getMovie(parsed.slug);
      if (detail && (detail.videoSources || detail.streamUrl)) {
        streamPayload = detail;
      }
    }

    if (!streamPayload) {
      return { streams: [] };
    }

    const sources = mapper.extractVideoSources(streamPayload);
    const streams = mapper.toStreams(sources, {
      slug: parsed.slug,
      bingeGroup: `idlix-${parsed.slug}`,
    });

    return { streams };
  } catch (err) {
    console.error('[stream] error:', err.message);
    return { streams: [] };
  }
}

module.exports = streamHandler;
