'use strict';

const cloudstream = require('../lib/cloudstream-sources');
const moviebox = require('../lib/moviebox-source');
const upstreams = require('../lib/upstream-addons');
const { filterStreams, isNsfw } = require('../lib/nsfw-filter');
const { cleanStreamList } = require('../lib/stream-cleaner');
const { filterStreamsByTitle, getExpectedTitle } = require('../lib/title-match-filter');

async function streamHandler({ type, id }) {
  try {
    if (isNsfw(id)) return { streams: [] };

    if (id && id.startsWith('cs:')) {
      return { streams: cleanStreamList(filterStreams(await cloudstream.getStreams(id))) };
    }

    if (id && id.startsWith('mb:')) {
      return { streams: cleanStreamList(filterStreams(await moviebox.getStreams(id))) };
    }

    const expectedTitle = await getExpectedTitle(type, id);
    const streams = filterStreamsByTitle(await upstreams.getAddonStreams(type, id), expectedTitle);
    return { streams: cleanStreamList(filterStreams(streams)) };
  } catch (err) {
    console.error('[stream] error:', err.message);
    return { streams: [] };
  }
}

module.exports = streamHandler;
