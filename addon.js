'use strict';

const { addonBuilder } = require('stremio-addon-sdk');
const catalogHandler = require('./catalog');
const metaHandler = require('./meta');
const streamHandler = require('./stream');

const YEARS = Array.from({ length: 30 }, (_, i) => String(2026 - i));

const COUNTRIES = [
  'US', 'GB', 'ID', 'KR', 'JP', 'CN', 'IN', 'TH', 'PH', 'MY',
  'SG', 'AU', 'CA', 'FR', 'DE', 'IT', 'ES', 'BR', 'MX', 'TR',
  'AR', 'HK', 'TW', 'VN', 'RU', 'NL', 'SE', 'NO', 'DK', 'BE',
];

// Values match IDLIX API slugs (Stremio shows option strings as-is)
const GENRE_LABELS = [
  'action', 'adventure', 'animation', 'comedy', 'crime', 'documentary',
  'drama', 'family', 'fantasy', 'history', 'horror', 'kids', 'music',
  'mystery', 'reality', 'romance', 'science-fiction', 'soap', 'talk',
  'thriller', 'tv-movie', 'war', 'western',
];

const NETWORK_OPTIONS = [
  'netflix',
  'hbo',
  'prime-video',
  'disney-plus',
  'apple-tv-plus',
];

const manifest = {
  id: 'org.kisut.streams',
  version: '1.1.0',
  name: 'Kisut Streams',
  description: 'Indo + OTT + anime + foreign direct HTTP streams. Aggregates IDLIX API, HdHub, Flix-Streams, and OnlyAnimes. NSFW filtered, no P2P/torrents.',
  logo: 'https://via.placeholder.com/256x256.png?text=Kisut',
  background: 'https://via.placeholder.com/1920x1080.png?text=Kisut+Streams',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['idlix', 'tt', 'tmdb', 'oa'],
  catalogs: [
    {
      type: 'movie',
      id: 'top',
      name: 'Kisut Indo Movies',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'series',
      id: 'top',
      name: 'Kisut Indo Series',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'movie',
      id: 'search',
      name: 'Kisut Search Movies',
      extra: [{ name: 'search', isRequired: true }],
    },
    {
      type: 'series',
      id: 'search',
      name: 'Kisut Search Series',
      extra: [{ name: 'search', isRequired: true }],
    },
    {
      type: 'movie',
      id: 'genre',
      name: 'Kisut Indo Movie Genre',
      extra: [
        { name: 'genre', isRequired: true, options: GENRE_LABELS },
        { name: 'skip' },
      ],
    },
    {
      type: 'series',
      id: 'genre',
      name: 'Kisut Indo Series Genre',
      extra: [
        { name: 'genre', isRequired: true, options: GENRE_LABELS },
        { name: 'skip' },
      ],
    },
    {
      type: 'movie',
      id: 'country',
      name: 'Kisut Indo Movie Country',
      extra: [
        { name: 'genre', isRequired: true, options: COUNTRIES },
        { name: 'skip' },
      ],
    },
    {
      type: 'series',
      id: 'network',
      name: 'Kisut OTT / Network',
      extra: [
        { name: 'genre', isRequired: true, options: NETWORK_OPTIONS },
        { name: 'skip' },
      ],
    },
    {
      type: 'series',
      id: 'anime-latest',
      name: 'Kisut Anime Latest',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'series',
      id: 'anime-japan',
      name: 'Kisut Anime Japan',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'series',
      id: 'anime-korea',
      name: 'Kisut Anime Korea',
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
  config: [
    {
      key: 'cookie',
      type: 'text',
      title: 'Optional Cookie / Token',
      default: '',
      required: false,
    },
  ],
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
