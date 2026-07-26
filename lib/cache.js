'use strict';

const Cache = require('ttl-cache');

const DEFAULT_TTL = parseInt(process.env.CACHE_TTL || '300', 10);

const cache = new Cache({
  ttl: DEFAULT_TTL,
  interval: 60,
});

function get(key) {
  return cache.get(key);
}

function set(key, value, ttlSeconds) {
  cache.set(key, value);
  if (typeof ttlSeconds === 'number' && ttlSeconds > 0) {
    cache.ttl(key, ttlSeconds);
  }
  return value;
}

module.exports = {
  get,
  set,
  DEFAULT_TTL,
};
