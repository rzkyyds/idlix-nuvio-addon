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
  id: 'org.idlix.addon',
  version: '1.0.0',
  name: 'IDLIX',
  description: 'Watch movies and series from IDLIX via IDLIX-API. Catalogs, search, and streams for Nuvio/Stremio.',
  logo: 'https://via.placeholder.com/256x256.png?text=IDLIX',
  background: 'https://via.placeholder.com/1920x1080.png?text=IDLIX',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['idlix', 'tt'],
  catalogs: [
    {
      type: 'movie',
      id: 'top',
      name: 'IDLIX Top',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'movie',
      id: 'genre',
      name: 'IDLIX Genre',
      extra: [
        { name: 'genre', isRequired: true, options: GENRE_LABELS },
        { name: 'skip' },
      ],
    },
    {
      type: 'movie',
      id: 'year',
      name: 'IDLIX Year',
      extra: [
        { name: 'genre', isRequired: true, options: YEARS },
        { name: 'skip' },
      ],
    },
    {
      type: 'movie',
      id: 'country',
      name: 'IDLIX Country',
      extra: [
        { name: 'genre', isRequired: true, options: COUNTRIES },
        { name: 'skip' },
      ],
    },
    {
      type: 'movie',
      id: 'search',
      name: 'IDLIX Search',
      extra: [{ name: 'search', isRequired: true }],
    },
    {
      type: 'series',
      id: 'top',
      name: 'IDLIX Top Series',
      extra: [{ name: 'skip' }],
    },
    {
      type: 'series',
      id: 'genre',
      name: 'IDLIX Series Genre',
      extra: [
        { name: 'genre', isRequired: true, options: GENRE_LABELS },
        { name: 'skip' },
      ],
    },
    {
      type: 'series',
      id: 'network',
      name: 'IDLIX Network',
      extra: [
        { name: 'genre', isRequired: true, options: NETWORK_OPTIONS },
        { name: 'skip' },
      ],
    },
    {
      type: 'series',
      id: 'search',
      name: 'IDLIX Series Search',
      extra: [{ name: 'search', isRequired: true }],
    },
  ],
  behaviorHints: {
    adult: false,
    p2p: false,
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
