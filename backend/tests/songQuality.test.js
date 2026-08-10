const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  assertProviderResultQuality,
  createProvidersExhaustedError,
  getSongTranscriptQuality,
  getSuspiciousPromoPhrases,
} = require("../services/transcriptionService");

after(async () => {
  await pool.end();
});

function makeWords(count, confidence, durationSeconds = 120) {
  const stepMs = (durationSeconds * 1000) / count;
  return Array.from({ length: count }, (_, index) => ({
    text: `word-${index}`,
    start: Math.round(index * stepMs),
    end: Math.round(Math.min(durationSeconds * 1000, (index + 0.7) * stepMs)),
    confidence,
  }));
}

function withMinimumConfidence(value, callback) {
  const previous = process.env.MIN_TRANSCRIPT_CONFIDENCE;
  process.env.MIN_TRANSCRIPT_CONFIDENCE = value;
  try {
    callback();
  } finally {
    if (previous === undefined) delete process.env.MIN_TRANSCRIPT_CONFIDENCE;
    else process.env.MIN_TRANSCRIPT_CONFIDENCE = previous;
  }
}

test("song transcripts at 90 percent confidence pass quality validation", () => {
  const result = {
    provider: "assemblyai",
    duration: 120,
    words: makeWords(120, 0.9),
  };

  withMinimumConfidence("0.9", () => {
    assert.equal(getSongTranscriptQuality(result).acceptable, true);
    assert.doesNotThrow(() => assertProviderResultQuality(result, "song"));
  });
});

test("song transcripts at 93 percent are not blocked by secondary diagnostics", () => {
  const result = {
    provider: "deepgram",
    duration: 240,
    words: makeWords(20, 0.93, 240),
  };

  withMinimumConfidence("0.9", () => {
    const quality = getSongTranscriptQuality(result);
    assert.ok(quality.reasons.includes("insufficient_lyrics"));
    assert.doesNotThrow(() => assertProviderResultQuality(result, "song"));
  });
});

test("song transcripts below 90 percent confidence are rejected", () => {
  const result = {
    provider: "assemblyai",
    duration: 120,
    words: makeWords(120, 0.899),
  };

  withMinimumConfidence("0.9", () => {
    assert.throws(
      () => assertProviderResultQuality(result, "song"),
      (error) =>
        error.code === "LOW_TRANSCRIPT_CONFIDENCE" &&
        /89,9%.*90%/.test(error.message),
    );
  });
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

test("short partial lyrics remain diagnostic when confidence is high", () => {
  const result = {
    provider: "deepgram",
    duration: 240,
    words: makeWords(20, 0.95, 240),
  };

  const quality = getSongTranscriptQuality(result);
  assert.equal(quality.acceptable, true);
  assert.ok(quality.reasons.includes("insufficient_lyrics"));
  assert.ok(quality.diagnosticReasons.includes("insufficient_lyrics"));
  assert.deepEqual(quality.blockingReasons, []);
});

test("low confidence and invalid timing reasons are reported together", () => {
  const words = Array.from({ length: 314 }, (_, index) => ({
    text: `word-${index}`,
    start: index * 630,
    end: index * 630 + (index === 300 ? 10_000 : 400),
    confidence: index < 104 || index === 300 ? 0.3 : 0.96,
  }));
  const result = {
    provider: "assemblyai",
    duration: 183,
    words,
  };

  const quality = getSongTranscriptQuality(result);
  assert.equal(quality.acceptable, false);
  assert.deepEqual(quality.blockingReasons, ["low_confidence"]);
  assert.ok(quality.reasons.includes("low_confidence"));
  assert.ok(
    quality.reasons.includes("too_many_low_confidence_words"),
  );
  assert.ok(quality.reasons.includes("timestamp_overrun"));
  assert.ok(quality.reasons.includes("invalid_word_timestamps"));
  assert.throws(
    () => assertProviderResultQuality(result, "song"),
    (error) =>
      error.providerFallbackEligible === true &&
      error.providerResultRejected === true,
  );
});

test("high-confidence partial song timelines remain diagnostic", () => {
  const result = {
    provider: "deepgram",
    duration: 183,
    words: makeWords(59, 0.91, 111),
  };

  const quality = getSongTranscriptQuality(result);
  assert.equal(quality.acceptable, true);
  assert.ok(quality.wordsPerMinute > quality.minimumWordsPerMinute);
  assert.ok(quality.timelineCoverage < quality.minimumTimelineCoverage);
  assert.ok(quality.reasons.includes("insufficient_timeline_coverage"));
  assert.ok(
    quality.diagnosticReasons.includes("insufficient_timeline_coverage"),
  );
  assert.doesNotThrow(() => assertProviderResultQuality(result, "song"));
});

test("spoken audio below 90 percent confidence is rejected", () => {
  const result = {
    provider: "assemblyai",
    duration: 120,
    words: makeWords(120, 0.89),
  };

  withMinimumConfidence("0.9", () => {
    assert.throws(
      () => assertProviderResultQuality(result, "speech"),
      (error) =>
        error.code === "LOW_TRANSCRIPT_CONFIDENCE" &&
        error.statusCode === 422,
    );
  });
});

test("spoken audio without a provider confidence score remains eligible", () => {
  const result = {
    provider: "vbee",
    duration: 120,
    words: makeWords(120, undefined),
  };

  withMinimumConfidence("0.9", () => {
    assert.doesNotThrow(() => assertProviderResultQuality(result, "speech"));
  });
});

test("known promotional hallucinations remain diagnostic at high confidence", () => {
  const result = {
    provider: "vbee",
    duration: 183,
    text: "Xin em dung tao khoang cach. Dang ky kenh de ung ho kenh nhe.",
    words: makeWords(240, 0.95, 183),
  };

  const quality = getSongTranscriptQuality(result);
  assert.deepEqual(getSuspiciousPromoPhrases(result), ["dang_ky_kenh"]);
  assert.equal(quality.acceptable, true);
  assert.ok(
    quality.reasons.includes("suspicious_promotional_hallucination"),
  );
  assert.ok(
    quality.diagnosticReasons.includes("suspicious_promotional_hallucination"),
  );
  assert.doesNotThrow(() => assertProviderResultQuality(result, "song"));
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
  assert.match(exhausted.message, /chỉ đạt 58%.*ngưỡng 90%/i);
});
