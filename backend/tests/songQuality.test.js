const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  assertProviderResultQuality,
  createProvidersExhaustedError,
  getSongTranscriptQuality,
} = require("../services/transcriptionService");

after(async () => {
  await pool.end();
});

function makeWords(count, confidence) {
  return Array.from({ length: count }, (_, index) => ({
    text: `word-${index}`,
    start: index * 500,
    end: index * 500 + 300,
    confidence,
  }));
}

test("high confidence song transcripts pass quality validation", () => {
  const result = {
    provider: "assemblyai",
    duration: 120,
    words: makeWords(120, 0.92),
  };

  assert.equal(getSongTranscriptQuality(result).acceptable, true);
  assert.doesNotThrow(() => assertProviderResultQuality(result, "song"));
});

test("low confidence song transcripts are rejected", () => {
  const result = {
    provider: "assemblyai",
    duration: 120,
    words: makeWords(120, 0.58),
  };

  assert.throws(
    () => assertProviderResultQuality(result, "song"),
    (error) =>
      error.code === "LOW_TRANSCRIPT_CONFIDENCE" &&
      error.providerResultRejected === true &&
      error.statusCode === 422,
  );
});

test("short partial lyrics are rejected even when confidence is high", () => {
  const result = {
    provider: "deepgram",
    duration: 240,
    words: makeWords(20, 0.95),
  };

  const quality = getSongTranscriptQuality(result);
  assert.equal(quality.acceptable, false);
  assert.ok(quality.reasons.includes("insufficient_lyrics"));
});

test("spoken audio is not subject to song confidence thresholds", () => {
  const result = {
    provider: "assemblyai",
    duration: 120,
    words: makeWords(5, 0.1),
  };

  assert.doesNotThrow(() => assertProviderResultQuality(result, "speech"));
});

test("provider exhaustion keeps the low-confidence explanation", () => {
  let qualityError;
  try {
    assertProviderResultQuality(
      {
        provider: "assemblyai",
        duration: 120,
        words: makeWords(120, 0.58),
      },
      "song",
    );
  } catch (error) {
    qualityError = error;
  }

  const exhausted = createProvidersExhaustedError({
    audioMode: "song",
    providerAttempts: [
      { provider: "assemblyai", status: "failed" },
      { provider: "vbee", status: "failed" },
    ],
    providerErrors: [
      { provider: "assemblyai", status: "failed", error: qualityError },
      {
        provider: "vbee",
        status: "failed",
        error: Object.assign(new Error("Not Found"), { statusCode: 404 }),
      },
    ],
  });

  assert.equal(exhausted.statusCode, 422);
  assert.match(exhausted.message, /độ tin cậy 58%/i);
});
