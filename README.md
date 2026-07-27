# Kisut Streams Addon

Stremio/Nuvio addon aggregator for Indo movies/series, OTT/network catalogs, anime catalogs, and foreign/global direct HTTP streams.

## Sources

- `IDLIX_API_URL` — Indo movies/series catalog, metadata, and streams.
- `HdHub` upstream addon — foreign/global movies and series streams for `tt*`, `tmdb:*`, and `kitsu:*` IDs.
- `Flix-Streams` upstream addon — extra direct HTTP stream source when its public endpoint accepts the request.
- `OnlyAnimes` upstream addon — anime catalogs, metadata, and episode streams for `oa:*` IDs.

The addon is configured as non-adult and non-P2P. It filters NSFW-looking catalog/meta/stream entries with a denylist before returning data to Stremio/Nuvio.

## Local run

```bash
npm install
PORT=7000 ADDON_URL=http://127.0.0.1:7000 npm start
```

Open:

```text
http://127.0.0.1:7000/manifest.json
```

## Useful endpoints

```text
GET /manifest.json
GET /api/sources
GET /catalog/movie/top.json
GET /catalog/series/top.json
GET /catalog/series/anime-japan.json
GET /stream/movie/tt0137523.json
GET /stream/series/<id>.json
```

## Environment

```env
PORT=7000
ADDON_URL=https://your-addon-domain.example
IDLIX_API_URL=https://kisutidlix.zeabur.app/api
CACHE_TTL=300
UPSTREAM_TIMEOUT_MS=18000
MAX_UPSTREAM_STREAMS=40
ENABLE_HDHUB=true
ENABLE_FLIX_STREAMS=true
HDHUB_ADDON_URL=https://hdhub.thevolecitor.qzz.io/eyJ0b3...YyJ9
FLIX_STREAMS_ADDON_URL=https://flixnest.app/flix-streams
ONLYANIMES_ADDON_URL=https://onlyanimes.stravo.site/local
```

## Notes

- This is HTTP/direct-stream oriented, not torrent/debrid.
- Some upstream providers return donation/config links before playable streams; the addon keeps them if upstream exposes them as Stremio streams.
- IDLIX/MajorPlay can require the existing web-player/externalUrl path for Android TV because native players may receive CDN decoys.
