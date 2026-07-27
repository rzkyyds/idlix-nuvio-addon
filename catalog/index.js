'use strict';

const cloudstream = require('../lib/cloudstream-sources');
const moviebox = require('../lib/moviebox-source');
const upstreams = require('../lib/upstream-addons');
const { filterMetas } = require('../lib/nsfw-filter');

const PAGE_SIZE = 20;

function pageFromSkip(skip) {
  const n = parseInt(skip, 10);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n / PAGE_SIZE) + 1;
}

async function catalogHandler({ type, id, extra = {} }) {
  try {
    const contentType = type === 'series' ? 'series' : 'movie';
    const page = pageFromSkip(extra.skip);
    let metas = [];

    switch (id) {
      case 'anime-latest':
        metas = await upstreams.getOnlyAnimesCatalog('sort_Latest', 'series');
        break;
      case 'anime-japan':
        metas = await upstreams.getOnlyAnimesCatalog('country_Japan', 'series');
        break;
      case 'anime-korea':
        metas = await upstreams.getOnlyAnimesCatalog('country_Korea', 'series');
        break;
      case 'search': {
        const query = (extra.search || '').trim();
        const [movieboxResults, cloudstreamResults] = await Promise.all([
          moviebox.search(query, contentType),
          cloudstream.search(query, contentType),
        ]);
        metas = movieboxResults.concat(cloudstreamResults);
        break;
      }
      case 'top': {
        const [movieboxResults, cloudstreamResults] = await Promise.all([
          moviebox.getCatalog(contentType, contentType, page),
          cloudstream.getCatalog(contentType, contentType, page),
        ]);
        metas = movieboxResults.concat(cloudstreamResults);
        break;
      }
      case 'genre': {
        const genre = (extra.genre || '').trim() || 'action';
        const [movieboxResults, cloudstreamResults] = await Promise.all([
          moviebox.getCatalog(genre, contentType, page),
          cloudstream.getCatalog(genre, contentType, page),
        ]);
        metas = movieboxResults.concat(cloudstreamResults);
        break;
      }
      case 'country': {
        const [movieboxResults, cloudstreamResults] = await Promise.all([
          moviebox.getCatalog('ott', 'movie', page),
          cloudstream.getCatalog('ott', 'movie', page),
        ]);
        metas = movieboxResults.concat(cloudstreamResults);
        break;
      }
      case 'network': {
        const [movieboxResults, cloudstreamResults] = await Promise.all([
          moviebox.getCatalog('series', 'series', page),
          cloudstream.getCatalog('series', 'series', page),
        ]);
        metas = movieboxResults.concat(cloudstreamResults);
        break;
      }
      default: {
        const [movieboxResults, cloudstreamResults] = await Promise.all([
          moviebox.getCatalog(contentType, contentType, page),
          cloudstream.getCatalog(contentType, contentType, page),
        ]);
        metas = movieboxResults.concat(cloudstreamResults);
        break;
      }
    }

    return { metas: filterMetas(metas) };
  } catch (err) {
    console.error('[catalog] error:', err.message);
    return { metas: [] };
  }
}

module.exports = catalogHandler;
