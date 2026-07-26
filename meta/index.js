'use strict';

const idlix = require('../lib/idlix-client');
const mapper = require('../lib/mapper');

async function metaHandler({ type, id }) {
  try {
    let parsed = mapper.parseId(id);
    if (!parsed) return { meta: null };

    // Resolve IMDB IDs to IDLIX slugs
    if (parsed.imdbId && !parsed.slug) {
      const resolved = await mapper.resolveImdbToIdlix(parsed.imdbId, type);
      if (resolved && resolved.slug) {
        parsed = resolved;
      }
    }

    if (!parsed || !parsed.slug) return { meta: null };

    const contentType = parsed.type || (type === 'series' ? 'series' : 'movie');
    let detail = null;

    if (contentType === 'series') {
      detail = await idlix.getSeries(parsed.slug);
      if (!detail) detail = await idlix.getMovie(parsed.slug);
    } else {
      detail = await idlix.getMovie(parsed.slug);
      if (!detail) detail = await idlix.getSeries(parsed.slug);
    }

    if (!detail) return { meta: null };

    const resolvedType = detail.type === 'series' || detail.type === 'tv' ? 'series' : contentType;
    const meta = mapper.toMetaDetail(detail, resolvedType, parsed.slug);
    if (!meta) return { meta: null };

    // Attach IMDB ID if we resolved one
    if (parsed.imdbId) meta.imdb_id = parsed.imdbId;

    return { meta };
  } catch (err) {
    console.error('[meta] error:', err.message);
    return { meta: null };
  }
}

module.exports = metaHandler;
