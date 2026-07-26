'use strict';

const axios = require('axios');
const cache = require('./cache');

const BASE_URL = (process.env.IDLIX_API_URL || 'https://kisutidlix.zeabur.app/api').replace(/\/$/, '');
const DEFAULT_TTL = cache.DEFAULT_TTL;

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    Accept: 'application/json',
    'User-Agent': 'idlix-nuvio-addon/1.0',
  },
});

async function request(path, params = {}, ttlSeconds = DEFAULT_TTL) {
  const cacheKey = `idlix:${path}:${JSON.stringify(params)}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const { data } = await http.get(path, { params });
    if (!data || data.success === false) {
      return null;
    }
    const result = data.data !== undefined ? data : { data: data };
    cache.set(cacheKey, result, ttlSeconds);
    return result;
  } catch (err) {
    console.error(`[idlix-client] GET ${path} failed:`, err.message);
    return null;
  }
}

function unwrap(response) {
  if (!response) return null;
  return response.data !== undefined ? response.data : response;
}

async function getHomepage() {
  // Prefer grouped sections; fall back to flat home list
  let res = await request('/home/sections');
  if (res) return unwrap(res);
  res = await request('/home');
  return unwrap(res);
}

async function getMovie(slug) {
  const res = await request(`/movie/${encodeURIComponent(slug)}`);
  return unwrap(res);
}

async function getSeries(slug) {
  const res = await request(`/series/${encodeURIComponent(slug)}`);
  return unwrap(res);
}

async function search(query, page = 1) {
  const res = await request('/search', { q: query, page });
  return unwrap(res) || [];
}

async function getGenre(type, genre, page = 1) {
  const params = { page };
  if (type) params.type = type === 'series' ? 'series' : 'movie';
  const res = await request(`/genre/${encodeURIComponent(genre)}`, params);
  return unwrap(res) || [];
}

async function getCountry(type, country, page = 1) {
  const params = { page };
  if (type) params.type = type === 'series' ? 'series' : 'movie';
  const res = await request(`/country/${encodeURIComponent(country)}`, params);
  return unwrap(res) || [];
}

async function getYear(type, year, page = 1) {
  const params = { page };
  if (type) params.type = type === 'series' ? 'series' : 'movie';
  const res = await request(`/year/${encodeURIComponent(year)}`, params);
  return unwrap(res) || [];
}

async function getNetwork(type, network, page = 1) {
  const params = { page };
  if (type) params.type = type === 'series' ? 'series' : 'movie';
  const res = await request(`/network/${encodeURIComponent(network)}`, params);
  return unwrap(res) || [];
}

async function getLeaderboard() {
  const res = await request('/leaderboard');
  return unwrap(res);
}

async function getMovieStream(slug) {
  // Streams expire — shorter TTL
  const res = await request(`/movie/${encodeURIComponent(slug)}/stream`, {}, 120);
  return unwrap(res);
}

async function getEpisodeStream(slug, season, episode) {
  const path = `/series/${encodeURIComponent(slug)}/season/${season}/episode/${episode}/stream`;
  const res = await request(path, {}, 120);
  return unwrap(res);
}

async function listMovies(page = 1) {
  const res = await request('/movie', { page });
  return unwrap(res) || [];
}

async function listSeries(page = 1) {
  const res = await request('/series', { page });
  return unwrap(res) || [];
}

module.exports = {
  getHomepage,
  getMovie,
  getSeries,
  search,
  getGenre,
  getCountry,
  getYear,
  getNetwork,
  getLeaderboard,
  getMovieStream,
  getEpisodeStream,
  listMovies,
  listSeries,
  BASE_URL,
};
