'use strict';

const idlix = require('../lib/idlix-client');
const mapper = require('../lib/mapper');

/**
 * Handle meta requests for movies and series.
 * Parses idlix:{type}:{slug} IDs.
 */
async function metaHandler({ type, id }) {
  try {
    const parsed = mapper.parseId(id);
    if (!parsed || !parsed.slug) {
      return { meta: null };
    }

    const contentType = parsed.type || (type === 'series' ? 'series' : 'movie');
    let detail = null;

    if (contentType === 'series') {
      detail = await idlix.getSeries(parsed.slug);
      // Fallback: some entries are only under /movie
      if (!detail) detail = await idlix.getMovie(parsed.slug);
    } else {
      detail = await idlix.getMovie(parsed.slug);
      if (!detail) detail = await idlix.getSeries(parsed.slug);
    }

    if (!detail) {
      return { meta: null };
    }

    const resolvedType =
      detail.type === 'series' || detail.type === 'tv'
        ? 'series'
        : contentType;

    const meta = mapper.toMetaDetail(detail, resolvedType, parsed.slug);
    if (!meta) return { meta: null };

    return { meta };
  } catch (err) {
    console.error('[meta] error:', err.message);
    return { meta: null };
  }
}

module.exports = metaHandler;
