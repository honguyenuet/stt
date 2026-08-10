const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  normalizeSonixWords,
  normalizeVbeeWords,
} = require("../services/transcriptionService");

after(() => pool.end());

test("Vbee utterance confidence is preserved on normalized words", () => {
  const words = normalizeVbeeWords({
    segments: [
      { start: 0, end: 1, text: "Xin chào", confidence: 0.94 },
    ],
  });

  assert.deepEqual(
    words.map((word) => word.confidence),
    [0.94, 0.94],
  );
});

test("Sonix word confidence is preserved on normalized words", () => {
  const words = normalizeSonixWords({
    transcript: [
      {
        speaker: "A",
        words: [
          { text: "Xin", start_time: 0, end_time: 0.3, confidence: 0.93 },
        ],
      },
    ],
  });

  assert.equal(words[0].confidence, 0.93);
});
