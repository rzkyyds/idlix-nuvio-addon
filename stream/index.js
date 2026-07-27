'use strict';

const idlix = require('../lib/idlix-client');
const mapper = require('../lib/mapper');
const upstreams = require('../lib/upstream-addons');
const { filterStreams, isNsfw } = require('../lib/nsfw-filter');

async function streamHandler({ type, id, config }) {
  try {
    if (isNsfw(id)) return { streams: [] };

    const upstreamDirectStreams = await upstreams.getAddonStreams(type, id);

    let parsed = mapper.parseId(id);
    if (!parsed) return { streams: upstreamDirectStreams };

    // Resolve IMDB IDs to IDLIX slugs
    if (parsed.imdbId && !parsed.slug) {
      const resolved = await mapper.resolveImdbToIdlix(parsed.imdbId, type);
      if (resolved && resolved.slug) {
        parsed = resolved;
      }
    }

    if (!parsed || !parsed.slug) return { streams: upstreamDirectStreams };

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

    if (!streamPayload) return { streams: upstreamDirectStreams };

    // Build proxy base: use addon's own URL as proxy endpoint
    const proxyBase = (config && config.proxyBase) || process.env.ADDON_URL || '';

    const sources = mapper.extractVideoSources(streamPayload);
    const streams = mapper.toStreams(sources, {
      slug: parsed.slug,
      bingeGroup: `idlix-${parsed.slug}`,
      proxyBase,
    });

    // Add web player external URL — browser has BoringSSL TLS, can play directly
    const addonUrl = process.env.ADDON_URL || 'https://kisutnuvio.zeabur.app';
    const idlixApiUrl = process.env.IDLIX_API_URL || 'https://kisutidlix.zeabur.app/api';
    const streamApiPath = contentType === 'series' && parsed.season
      ? `/series/${parsed.slug}/season/${parsed.season}/episode/${parsed.episode}/stream`
      : `/movie/${parsed.slug}/stream`;
    const title = streamPayload.title || parsed.slug;
    if (streams[0]) {
      streams[0].externalUrl = `${addonUrl}/watch.html?url=${encodeURIComponent(idlixApiUrl + streamApiPath)}&name=${encodeURIComponent(title)}`;
    }

    return { streams: filterStreams([...streams, ...upstreamDirectStreams]) };
  } catch (err) {
    console.error('[stream] error:', err.message);
    return { streams: [] };
  }
}

module.exports = streamHandler;
