'use strict';

const { addonBuilder } = require('stremio-addon-sdk');
const catalogHandler = require('./catalog');
const metaHandler = require('./meta');
const streamHandler = require('./stream');

const COUNTRIES = [
  'US', 'GB', 'ID', 'KR', 'JP', 'CN', 'IN', 'TH', 'PH', 'MY',
  'SG', 'AU', 'CA', 'FR', 'DE', 'IT', 'ES', 'BR', 'MX', 'TR',
  'AR', 'HK', 'TW', 'VN', 'RU', 'NL', 'SE', 'NO', 'DK', 'BE',
];

const GENRE_LABELS = [
  'action', 'adventure', 'animation', 'comedy', 'crime', 'documentary',
  'drama', 'family', 'fantasy', 'history', 'horror', 'kids', 'music',
  'mystery', 'reality', 'romance', 'science-fiction', 'soap', 'talk',
  'thriller', 'tv-movie', 'war', 'western',
];

const manifest = {
  id: 'org.tonstreams.addon',
  version: '1.2.0',
  name: 'TonStreams',
  description: 'Indo + OTT from CloudStream-derived providers, plus anime and foreign direct HTTP streams. NSFW filtered, no IDLIX API, no P2P/torrents.',
  logo: 'https://via.placeholder.com/256x256.png?text=TonStreams',
  background: 'https://via.placeholder.com/1920x1080.png?text=TonStreams',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['cs', 'tt', 'tmdb', 'oa'],
  catalogs: [
    {
      type: 'movie',
      id: 'top',
      name: 'TonStreams Indo Movies',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'series',
      id: 'top',
      name: 'TonStreams Indo Series',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'movie',
      id: 'search',
      name: 'TonStreams Search Movies',
      extra: [{ name: 'search', isRequired: true }],
    },
    {
      type: 'series',
      id: 'search',
      name: 'TonStreams Search Series',
      extra: [{ name: 'search', isRequired: true }],
    },
    {
      type: 'movie',
      id: 'genre',
      name: 'TonStreams Indo Movie Genre',
      extra: [
        { name: 'genre', isRequired: true, options: GENRE_LABELS },
        { name: 'skip' },
      ],
    },
    {
      type: 'series',
      id: 'genre',
      name: 'TonStreams Indo Series Genre',
      extra: [
        { name: 'genre', isRequired: true, options: GENRE_LABELS },
        { name: 'skip' },
      ],
    },
    {
      type: 'movie',
      id: 'country',
      name: 'TonStreams Indo Movie Country',
      extra: [
        { name: 'genre', isRequired: true, options: COUNTRIES },
        { name: 'skip' },
      ],
    },
    {
      type: 'series',
      id: 'network',
      name: 'TonStreams Indo / OTT',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'series',
      id: 'anime-latest',
      name: 'TonStreams Anime Latest',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'series',
      id: 'anime-japan',
      name: 'TonStreams Anime Japan',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'series',
      id: 'anime-korea',
      name: 'TonStreams Anime Korea',
      extra: [{ name: 'skip' }],
    },
  ],
  behaviorHints: {
    adult: false,
    p2p: false,
    p2pNotSupported: true,
    configurable: true,
    configurationRequired: false,
  },
  config: [],
};
const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async (args) => {
  return catalogHandler(args);
});

builder.defineMetaHandler(async (args) => {
  return metaHandler(args);
});

builder.defineStreamHandler(async (args) => {
  return streamHandler(args);
});

module.exports = builder.getInterface();
