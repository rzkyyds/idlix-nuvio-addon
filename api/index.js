"use strict";

const cloudstream = require("../lib/cloudstream-sources");
const upstreams = require("../lib/upstream-addons");
const { NSFW_TERMS } = require("../lib/nsfw-filter");

function mountApi(app) {
  app.get("/api/sources", (req, res) => {
    res.json({
      ok: true,
      policy: {
        adult: false,
        p2p: false,
        nsfwFilterTerms: NSFW_TERMS,
      },
      cloudstreamSources: cloudstream.getSourceSummary(),
      streamUpstreams: [
        {
          id: "hdhub",
          name: "HdHub",
          coverage: ["foreign", "OTT", "anime", "bollywood", "movies", "series"],
          baseUrl: upstreams.HDHUB_BASE,
          mode: "stream aggregator for tt/tmdb/kitsu IDs",
        },
        {
          id: "flix-streams",
          name: "Flix-Streams",
          coverage: ["foreign", "OTT", "anime", "live", "movies", "series"],
          baseUrl: upstreams.FLIX_BASE,
          mode: "stream aggregator for tt/tmdb/anime IDs when public endpoint allows it",
        },
        {
          id: "onlyanimes",
          name: "OnlyAnimes",
          coverage: ["anime", "Japan", "Korea", "China", "US", "UK", "France"],
          baseUrl: upstreams.ONLYANIMES_BASE,
          mode: "catalog/meta/stream for oa:* IDs",
        },
      ],
    });
  });
}

module.exports = mountApi;
