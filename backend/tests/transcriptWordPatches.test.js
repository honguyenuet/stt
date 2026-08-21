const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyTranscriptWordPatches,
  createApproximateTranscriptWords,
  normalizeTranscriptWordPatches,
} = require("../services/transcriptWordPatches");

const words = [
  { text: "Xin", start: 0, end: 400, speaker: "A", confidence: 0.98 },
  { text: "chào", start: 400, end: 900, speaker: "A", confidence: 0.96 },
  { text: "bạn", start: 900, end: 1_300, speaker: "B", confidence: 0.95 },
];

test("normalizes compact word patches at the API boundary", () => {
  assert.deepEqual(
    normalizeTranscriptWordPatches([
      { index: 1, text: "  chào bạn  " },
      { index: 2, speaker: "  Khách hàng  " },
    ]),
    [
      { index: 1, text: "chào bạn" },
      { index: 2, speaker: "Khách hàng" },
    ],
  );
});

test("updates only changed word fields and preserves timestamps", () => {
  const result = applyTranscriptWordPatches(
    words,
    normalizeTranscriptWordPatches([
      { index: 1, text: "chào nhé" },
      { index: 2, speaker: "Khách hàng" },
    ]),
  );

  assert.deepEqual(result, [
    words[0],
    { ...words[1], text: "chào nhé" },
    { ...words[2], speaker: "Khách hàng" },
  ]);
  assert.equal(result[1].start, 400);
  assert.equal(result[1].end, 900);
});

test("creates a server-side timeline when history contains only text", () => {
  assert.deepEqual(createApproximateTranscriptWords("Xin chào bạn", 3), [
    { text: "Xin", start: 0, end: 1_000, speaker: null, confidence: null },
    { text: "chào", start: 1_000, end: 2_000, speaker: null, confidence: null },
    { text: "bạn", start: 2_000, end: 3_000, speaker: null, confidence: null },
  ]);
});

test("rejects ambiguous or out-of-range word patches", () => {
  assert.throws(
    () => normalizeTranscriptWordPatches([{ index: 0 }]),
    /thay đổi từ/i,
  );
  assert.throws(
    () => normalizeTranscriptWordPatches([{ index: 0, text: "x", start: 1 }]),
    /trường không hỗ trợ/i,
  );
  assert.throws(
    () =>
      normalizeTranscriptWordPatches([
        { index: 0, text: "x" },
        { index: 0, text: "y" },
      ]),
    /trùng lặp/i,
  );
  assert.throws(
    () => applyTranscriptWordPatches(words, [{ index: 99, text: "x" }]),
    /chỉ số từ/i,
  );
});
