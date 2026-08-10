const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isStaleMerge,
  mergeMultitrackTranscripts,
  normalizeTrackName,
} = require("../services/multitrackService");
const pool = require("../db");

test.after(() => pool.end());

test("multitrack merge orders words by timestamp and keeps track speakers", () => {
  const result = mergeMultitrackTranscripts([
    {
      trackIndex: 0,
      trackName: "An",
      duration: 8,
      sourceLanguage: "vi",
      words: [
        { text: "Xin", start: 0, end: 300, confidence: 0.94 },
        { text: "chào", start: 300, end: 650, confidence: 0.91 },
      ],
    },
    {
      trackIndex: 1,
      trackName: "Bình",
      duration: 10,
      sourceLanguage: "vi",
      words: [{ text: "Chào bạn", start: 900, end: 1500, confidence: 0.88 }],
    },
  ]);

  assert.deepEqual(
    result.words.map((word) => [word.text, word.speaker]),
    [
      ["Xin", "track-1"],
      ["chào", "track-1"],
      ["Chào bạn", "track-2"],
    ],
  );
  assert.equal(result.duration, 10);
  assert.equal(result.sourceLanguage, "vi");
  assert.deepEqual(result.speakerNames, {
    "track-1": "An",
    "track-2": "Bình",
  });
  assert.equal(result.text, "An: Xin chào\n\nBình: Chào bạn");
});

test("multitrack merge falls back to safe speaker names", () => {
  assert.equal(normalizeTrackName("", 2), "Người nói 3");
  assert.equal(normalizeTrackName("  MC chính  ", 0), "MC chính");
});

test("multitrack merge lease only retries a stale merge", () => {
  const now = Date.parse("2026-07-29T12:00:00.000Z");
  assert.equal(
    isStaleMerge(
      {
        status: "merging",
        updated_at: new Date(now - 2 * 60 * 1000).toISOString(),
      },
      now,
    ),
    false,
  );
  assert.equal(
    isStaleMerge(
      {
        status: "merging",
        updated_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      },
      now,
    ),
    true,
  );
  assert.equal(
    isStaleMerge(
      {
        status: "completed",
        updated_at: new Date(now - 60 * 60 * 1000).toISOString(),
      },
      now,
    ),
    false,
  );
});
