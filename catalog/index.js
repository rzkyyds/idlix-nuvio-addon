'use strict';

const cloudstream = require('../lib/cloudstream-sources');
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
        metas = await cloudstream.search(query, contentType);
        break;
      }
      case 'top':
        metas = await cloudstream.getCatalog(contentType, contentType, page);
        break;
      case 'genre': {
        const genre = (extra.genre || '').trim() || 'action';
        metas = await cloudstream.getCatalog(genre, contentType, page);
        break;
      }
      case 'country':
      case 'network':
        metas = await cloudstream.getCatalog('ott', contentType, page);
        break;
      default:
        metas = await cloudstream.getCatalog(contentType, contentType, page);
        break;
    }

    return { metas: filterMetas(metas) };
  } catch (err) {
    console.error('[catalog] error:', err.message);
    return { metas: [] };
  }
}

module.exports = catalogHandler;
