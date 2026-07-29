"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { cleanStreamList } = require("../lib/stream-cleaner");

function fenixStream(language, url, quality = "720p") {
  return {
    name: "FenixFlix",
    description: `Example Movie\n${language}\nON ${quality}`,
    url,
    behaviorHints: {
      upstreamKey: "fenixflix",
      upstreamName: "FenixFlix",
    },
  };
}

test("prefers FenixFlix Legendado original audio over Portuguese Dublado", () => {
  const streams = cleanStreamList([
    fenixStream("Dublado", "https://cdn.example/dub.mp4"),
    fenixStream("Legendado", "https://cdn.example/original.mp4"),
  ]);

  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/original.mp4");
  assert.match(streams[0].description, /Legendado/);
});

test("hides Portuguese dub at other resolutions when original audio exists", () => {
  const streams = cleanStreamList([
    fenixStream("Dublado", "https://cdn.example/dub-1080.mp4", "1080p"),
    fenixStream("Legendado", "https://cdn.example/original-720.mp4", "720p"),
  ]);

  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/original-720.mp4");
});

test("keeps FenixFlix Dublado when no original-audio variant exists", () => {
  const streams = cleanStreamList([
    fenixStream("Dublado", "https://cdn.example/dub.mp4"),
  ]);

  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/dub.mp4");
});

test("language preference only affects FenixFlix streams", () => {
  const streams = cleanStreamList([
    {
      ...fenixStream("Dublado", "https://cdn.example/other-dub.mp4"),
      behaviorHints: { upstreamKey: "other", upstreamName: "Other" },
    },
    {
      ...fenixStream("Legendado", "https://cdn.example/other-original.mp4"),
      behaviorHints: { upstreamKey: "other", upstreamName: "Other" },
    },
  ]);

  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/other-dub.mp4");
});
