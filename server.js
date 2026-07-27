'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const { getRouter } = require('stremio-addon-sdk');
const { AsyncLocalStorage } = require('async_hooks');

const addonInterface = require('./addon');
const mountApi = require('./api');

const PORT = parseInt(process.env.PORT || '7000', 10);
const app = express();

// Per-request config isolation (cookie / prefs), NuvioStreamsAddon-style
const requestContext = new AsyncLocalStorage();

function getRequestConfig() {
  const store = requestContext.getStore();
  return (store && store.config) || {};
}

global.getRequestConfig = getRequestConfig;
global.requestContext = requestContext;

app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);
mountApi(app);

/**
 * Extract personalization params from query string and path segments.
 */
app.use((req, res, next) => {
  const pathParams = {};

  if (req.path !== '/manifest.json' && !req.path.endsWith('/manifest.json')) {
    const pathSegments = req.path.split('/').filter(Boolean);
    if (pathSegments.length && pathSegments[pathSegments.length - 1] === 'manifest.json') {
      pathSegments.pop();
    }

    const resourceIdx = pathSegments.findIndex((s) =>
      ['catalog', 'meta', 'stream', 'subtitles'].includes(s)
    );
    const paramSegments = resourceIdx !== -1 ? pathSegments.slice(0, resourceIdx) : pathSegments;

    paramSegments.forEach((segment) => {
      const idx = segment.indexOf('=');
      if (idx > 0) {
        pathParams[segment.slice(0, idx)] = segment.slice(idx + 1);
      }
    });
  }

  const requestConfig = {};
  const cookie = pathParams.cookie || req.query.cookie;
  const region = pathParams.region || req.query.region;

  if (cookie) {
    try {
      requestConfig.cookie = decodeURIComponent(cookie);
    } catch (e) {
      requestConfig.cookie = cookie;
    }
  }
  if (region) {
    requestConfig.region = String(region).toUpperCase();
  }

  global.currentRequestConfig = requestConfig;

  requestContext.run({ config: requestConfig }, () => {
    req.nuvioConfig = requestConfig;
    next();
  });
});

/**
 * Personalized manifest.json. Supports /manifest.json and optional region path params.
 */
app.get('*manifest.json', (req, res) => {
  try {
    const userCookie =
      (global.currentRequestConfig && global.currentRequestConfig.cookie) ||
      getRequestConfig().cookie;
    const userRegion =
      (global.currentRequestConfig && global.currentRequestConfig.region) ||
      getRequestConfig().region;

    const originalManifest = addonInterface.manifest;
    const personalizedManifest = JSON.parse(JSON.stringify(originalManifest));

    if (!personalizedManifest.config) {
      personalizedManifest.config = [];
    }

    let isPersonalized = false;

    if (userRegion) {
      isPersonalized = true;
      personalizedManifest.name = `${originalManifest.name} (${userRegion})`;
      personalizedManifest.description = `${originalManifest.description} [Region: ${userRegion}]`;
      personalizedManifest.config.push({
        key: 'region',
        type: 'text',
        title: 'Region (auto-set)',
        default: userRegion,
        required: false,
        hidden: true,
      });
    }

    if (isPersonalized) {
      const identifierSource = `${userCookie || 'nocookie'}-${userRegion || 'noregion'}`;
      const hash = crypto.createHash('sha1').update(identifierSource).digest('hex').substring(0, 8);
      personalizedManifest.id = `${originalManifest.id}_${hash}`;
      // Installed addons should not require re-configuration
      if (personalizedManifest.behaviorHints) {
        delete personalizedManifest.behaviorHints.configurationRequired;
      }
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(personalizedManifest));
  } catch (err) {
    console.error('[server] manifest error:', err.message);
    res.status(500).json({ error: 'Failed to generate manifest' });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({
    name: 'TonStreams Addon',
    version: addonInterface.manifest.version,
    manifest: '/manifest.json',
    status: 'ok',
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Static files

app.use(express.static(path.join(__dirname, 'public')));

// Stremio SDK router (catalog / meta / stream)
const addonRouter = getRouter(addonInterface);
app.use(addonRouter);

// Clear request-scoped globals after response
app.use((req, res, next) => {
  const originalEnd = res.end;
  res.end = function endWrapper(...args) {
    global.currentRequestConfig = {};
    return originalEnd.apply(this, args);
  };
  next();
});

app.listen(PORT, () => {
  console.log(`TonStreams Addon listening on http://127.0.0.1:${PORT}`);
  console.log(`Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log('Indo/OTT source: CloudStream repos (no IDLIX API)');
});
