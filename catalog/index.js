'use strict';

const idlix = require('../lib/idlix-client');
const mapper = require('../lib/mapper');

const PAGE_SIZE = 20;

function pageFromSkip(skip) {
  const n = parseInt(skip, 10);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n / PAGE_SIZE) + 1;
}

function asArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return [];
}

function paginateLocal(items, skip) {
  const start = parseInt(skip, 10) || 0;
  if (!start) return items;
  return items.slice(start, start + PAGE_SIZE);
}

/**
 * Handle all Stremio catalog requests.
 * Routes to IDLIX endpoints based on catalog id.
 */
async function catalogHandler({ type, id, extra = {} }) {
  try {
    const contentType = type === 'series' ? 'series' : 'movie';
    const page = pageFromSkip(extra.skip);
    let items = [];

    switch (id) {
      case 'search': {
        const query = (extra.search || '').trim();
        if (!query || query.length < 2) {
          return { metas: [] };
        }
        const results = asArray(await idlix.search(query, page));
        // IDLIX often mislabels series as movie; prefer link.endpoint when present
        items = results.filter((item) => {
          const endpoint = (item.link && item.link.endpoint) || '';
          const isSeries = endpoint.startsWith('series/') || item.type === 'series';
          return contentType === 'series' ? isSeries : !isSeries;
        });
        // If typing filter removed everything, return unfiltered search hits
        if (!items.length) items = results;
        break;
      }

      case 'top': {
        const board = await idlix.getLeaderboard();
        if (board) {
          items = contentType === 'series'
            ? asArray(board.topSeries)
            : asArray(board.topMovies);
        }
        if (!items.length) {
          // Fallback: homepage / browse lists
          if (contentType === 'series') {
            items = asArray(await idlix.listSeries(page));
          } else {
            items = asArray(await idlix.listMovies(page));
          }
        }
        items = paginateLocal(items, extra.skip);
        break;
      }

      case 'genre': {
        const genre = (extra.genre || '').toLowerCase().trim();
        if (!genre) return { metas: [] };
        items = asArray(await idlix.getGenre(contentType, genre, page));
        break;
      }

      case 'year': {
        const year = (extra.genre || extra.year || '').toString().trim();
        if (!year) return { metas: [] };
        items = asArray(await idlix.getYear(contentType, year, page));
        break;
      }

      case 'country': {
        const country = (extra.genre || extra.country || '').toString().trim();
        if (!country) return { metas: [] };
        items = asArray(await idlix.getCountry(contentType, country, page));
        break;
      }

      case 'network': {
        const network = (extra.genre || extra.network || '').toString().trim();
        if (!network) return { metas: [] };
        items = asArray(await idlix.getNetwork(contentType, network, page));
        break;
      }

      default: {
        // Unknown catalog id — try homepage sections / browse
        if (contentType === 'series') {
          items = asArray(await idlix.listSeries(page));
        } else {
          items = asArray(await idlix.listMovies(page));
        }
        break;
      }
    }

    const metas = mapper.toMetaPreviewList(items, contentType);
    return { metas };
  } catch (err) {
    console.error('[catalog] error:', err.message);
    return { metas: [] };
  }
}

module.exports = catalogHandler;
