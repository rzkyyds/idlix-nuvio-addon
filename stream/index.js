'use strict';

const cloudstream = require('../lib/cloudstream-sources');
const upstreams = require('../lib/upstream-addons');
const { filterStreams, isNsfw } = require('../lib/nsfw-filter');
const { cleanStreamList } = require('../lib/stream-cleaner');

async function streamHandler({ type, id }) {
  try {
    if (isNsfw(id)) return { streams: [] };

    if (id && id.startsWith('cs:')) {
      return { streams: cleanStreamList(filterStreams(await cloudstream.getStreams(id))) };
    }

    return { streams: cleanStreamList(filterStreams(await upstreams.getAddonStreams(type, id))) };
  } catch (err) {
    console.error('[stream] error:', err.message);
    return { streams: [] };
  }
}

module.exports = streamHandler;
