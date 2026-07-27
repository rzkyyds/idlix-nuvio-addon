'use strict';

const cloudstream = require('../lib/cloudstream-sources');
const upstreams = require('../lib/upstream-addons');
const { isNsfw } = require('../lib/nsfw-filter');

async function metaHandler({ type, id }) {
  try {
    if (id && id.startsWith('oa:')) {
      const meta = await upstreams.getOnlyAnimesMeta(type, id);
      return { meta: meta && !isNsfw(meta) ? meta : null };
    }

    if (id && id.startsWith('cs:')) {
      const meta = await cloudstream.getMeta(id);
      return { meta: meta && !isNsfw(meta) ? meta : null };
    }

    return { meta: null };
  } catch (err) {
    console.error('[meta] error:', err.message);
    return { meta: null };
  }
}

module.exports = metaHandler;
