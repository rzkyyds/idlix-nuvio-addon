'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { getRouter } = require('stremio-addon-sdk');
const { AsyncLocalStorage } = require('async_hooks');

const addonInterface = require('./addon');

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

/**
 * Extract personalization params from query string and path segments
 * (e.g. /cookie=xxx/manifest.json or ?cookie=xxx)
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
 * Personalized manifest.json (NuvioStreamsAddon pattern).
 * Supports /manifest.json and path-param forms with cookie/region.
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

    if (userCookie) {
      isPersonalized = true;
      const cookieIdx = personalizedManifest.config.findIndex((c) => c.key === 'cookie');
      if (cookieIdx > -1) {
        personalizedManifest.config[cookieIdx].default = userCookie;
      } else {
        personalizedManifest.config.push({
          key: 'cookie',
          type: 'text',
          title: 'Cookie (auto-set)',
          default: userCookie,
          required: false,
          hidden: true,
        });
      }
    }

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
    name: 'IDLIX Nuvio Addon',
    version: addonInterface.manifest.version,
    manifest: '/manifest.json',
    status: 'ok',
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Proxy: route blocked CDN requests through Stealth for correct TLS fingerprint.
// Plain Node.js fetch() returns fake content (.png/.webp/.js) — Stealth gives real .ts.
//
// IDLIX stream returns URLs like .../config-XXX.json which are actually M3U8.
// Player rejects .json extension → serve with application/vnd.apple.mpegurl

const STEALTH_URL = (process.env.STEALTH_API_URL || 'https://kisutstealth.zeabur.app').replace(/\/$/, '');

/** Call the Stealth Go service — same pattern as IDLIX-API's browserFetch(). */
async function stealthFetch(targetUrl) {
  const resp = await fetch(`${STEALTH_URL}/v1/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: targetUrl,
      method: 'GET',
      disableMedia: true,
      headers: {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
      },
    }),
  });
  if (!resp.ok) {
    console.error(`[stealth] HTTP ${resp.status} from stealth service`);
    return null;
  }
  const data = await resp.json();
  if (data.status !== 'ok' || !data.solution) {
    console.error('[stealth] solve failed:', data);
    return null;
  }
  return {
    status: data.solution.status,
    ok: data.solution.status >= 200 && data.solution.status < 300,
    text: data.solution.response || '',
  };
}

app.get('/play', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing ?url=');

    const result = await stealthFetch(targetUrl);
    if (!result) return res.status(502).send('Stealth proxy error');

    let body = result.text || '';
    if (!body.trim()) return res.status(502).send('Empty response from CDN');

    const isM3u8 = body.trim().startsWith('#EXTM3U');
    const isJson = body.trim().startsWith('{') || body.trim().startsWith('[');

    // Rewrite relative segment URLs to absolute majorplay.net URLs.
    // Do NOT route variants through /play — CDN anti-hotlinking blocks Stealth
    // for sub-playlists. Player has real browser TLS and can fetch them directly.
    if (isM3u8) {
      const baseUrl = new URL(targetUrl);
      const rewriteUri = (uri) => new URL(uri, targetUrl).href;
      body = body.replace(/^(?!#)(\S+)/gm, (match) => rewriteUri(match));
      body = body.replace(/URI="([^"]+)"/g, (m, uri) => `URI="${rewriteUri(uri)}"`);
    }

    if (isM3u8) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(body);
    } else if (isJson) {
      try {
        const cfg = JSON.parse(body);
        const m3u8Url = cfg.url || cfg.stream || cfg.file;
        if (m3u8Url) return res.redirect(307, m3u8Url);
      } catch (_) {}
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(body);
    } else {
      // Binary segment — pass through directly
      const ext = (targetUrl.split('?')[0].split('.').pop() || '').toLowerCase();
      const mimeMap = { ts: 'video/mp2t', m4s: 'video/iso.segment', mp4: 'video/mp4', vtt: 'text/vtt' };
      res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
      res.send(Buffer.from(body, 'utf-8'));
    }
  } catch (err) {
    console.error('[play] proxy error:', err.message);
    res.status(502).send('Stream proxy error');
  }
});

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
  console.log(`IDLIX Nuvio Addon listening on http://127.0.0.1:${PORT}`);
  console.log(`Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log(`IDLIX API: ${process.env.IDLIX_API_URL || 'https://kisutidlix.zeabur.app/api'}`);
});
