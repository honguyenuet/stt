import { describe, expect, it } from "vitest";
import {
  clampSeekTime,
  confidenceLevel,
  findActiveWordIndex,
  findTimedWordTextRange,
  formatPlaybackTime,
  normalizeTimedWordBounds,
  summarizeConfidence,
  replaceTimedWordInText,
} from "./transcript-playback";

const words = [
  { start: 500, end: 900 },
  { start: 1_000, end: 1_450 },
  { start: 2_000, end: 2_400 },
];

describe("transcript playback helpers", () => {
  it("finds only the word that is currently being spoken", () => {
    expect(findActiveWordIndex(words, 300)).toBe(-1);
    expect(findActiveWordIndex(words, 700)).toBe(0);
    expect(findActiveWordIndex(words, 1_200)).toBe(1);
    expect(findActiveWordIndex(words, 1_800)).toBe(-1);
    expect(findActiveWordIndex(words, 2_600)).toBe(-1);
  });

  it("clamps ten-second seeking inside the audio duration", () => {
    expect(clampSeekTime(4, -10, 90)).toBe(0);
    expect(clampSeekTime(86, 10, 90)).toBe(90);
    expect(clampSeekTime(45, 10, 90)).toBe(55);
  });

  it("normalizes second-based word timestamps to milliseconds", () => {
    expect(
      normalizeTimedWordBounds(
        [
          { start: 0.5, end: 0.9 },
          { start: 1, end: 1.45 },
        ],
        2,
      ),
    ).toEqual([
      { start: 500, end: 900 },
      { start: 1_000, end: 1_450 },
    ]);
  });

  it("keeps millisecond-based word timestamps unchanged", () => {
    expect(normalizeTimedWordBounds(words, 3)).toEqual(words);
  });

  it("formats playback time for short and long audio", () => {
    expect(formatPlaybackTime(65)).toBe("1:05");
    expect(formatPlaybackTime(3_661)).toBe("1:01:01");
  });

  it("replaces one timed word without changing speaker labels or punctuation", () => {
    const editableWords = [
      { text: "Hello", start: 0, end: 500 },
      { text: "world.", start: 500, end: 1_000 },
    ];

    expect(
      replaceTimedWordInText(
        "Speaker 0: Hello world.",
        editableWords,
        1,
        "everyone.",
      ),
    ).toBe("Speaker 0: Hello everyone.");
  });

  it("finds the editable text range for the active timed word", () => {
    const editableWords = [
      { text: "Hello", start: 0, end: 500 },
      { text: "world.", start: 500, end: 1_000 },
    ];

    expect(
      findTimedWordTextRange("Speaker 0: Hello world.", editableWords, 1),
    ).toEqual({ start: 17, end: 23 });
  });

  it("returns null when the timed word cannot be mapped safely", () => {
    expect(
      replaceTimedWordInText(
        "Nội dung đã khác",
        [{ text: "Hello", start: 0, end: 500 }],
        0,
        "Hi",
      ),
    ).toBeNull();
  });

  it("classifies word confidence for the review heatmap", () => {
    expect(confidenceLevel(null)).toBe("unknown");
    expect(confidenceLevel(0.94)).toBe("high");
    expect(confidenceLevel(0.76)).toBe("medium");
    expect(confidenceLevel(0.49)).toBe("low");
  });

  it("summarizes only words that have valid confidence", () => {
    expect(
      summarizeConfidence([
        { confidence: 0.9 },
        { confidence: 0.7 },
        { confidence: null },
        { confidence: Number.NaN },
      ]),
    ).toEqual({
      average: 0.8,
      lowCount: 0,
      reviewedCount: 2,
    });
  });
});
