const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  annotateProviderError,
  createHttpError,
  createProviderResultError,
  createProvidersExhaustedError,
  isProviderFallbackEligible,
} = require("../services/transcriptionService");

after(async () => {
  await pool.end();
});

test("Vbee upload rejection is eligible for provider failover", () => {
  const error = annotateProviderError(
    createHttpError(415, "Vbee khong doc duoc file"),
    {
      provider: "vbee",
      stage: "upload",
    },
  );

  assert.equal(isProviderFallbackEligible(error), true);
  assert.equal(error.provider, "vbee");
  assert.equal(error.providerStage, "upload");
});

test("shared input validation error does not trigger provider failover", () => {
  const error = createHttpError(400, "Khong co du lieu audio");
  assert.equal(isProviderFallbackEligible(error), false);
});

test("empty transcript can fall through to the next provider", () => {
  const error = createProviderResultError("vbee", "speech");
  assert.equal(error.statusCode, 422);
  assert.equal(error.providerResultRejected, true);
  assert.equal(error.retryable, false);
  assert.equal(isProviderFallbackEligible(error), true);
});

test("final provider error is emitted only after all attempts are exhausted", () => {
  const providerAttempts = [
    {
      provider: "vbee",
      status: "failed",
      httpStatus: 415,
      stage: "upload",
    },
    {
      provider: "assemblyai",
      status: "failed",
      httpStatus: 503,
      stage: "upload_and_transcribe",
    },
    {
      provider: "sonix",
      status: "skipped",
      httpStatus: 503,
    },
  ];
  const exhausted = createProvidersExhaustedError({
    providerAttempts,
    providerErrors: [
      {
        provider: "vbee",
        status: "failed",
        error: annotateProviderError(createHttpError(415, "invalid media"), {
          provider: "vbee",
          stage: "upload",
        }),
      },
      {
        provider: "assemblyai",
        status: "failed",
        error: annotateProviderError(createHttpError(503, "unavailable"), {
          provider: "assemblyai",
          stage: "upload_and_transcribe",
        }),
      },
      {
        provider: "sonix",
        status: "skipped",
        error: Object.assign(createHttpError(503, "missing key"), {
          providerConfiguration: true,
        }),
      },
    ],
    audioMode: "speech",
  });

  assert.equal(exhausted.statusCode, 503);
  assert.equal(exhausted.retryable, true);
  assert.equal(exhausted.code, "TRANSCRIPTION_PROVIDERS_EXHAUSTED");
  assert.deepEqual(exhausted.providerAttempts, providerAttempts);
  assert.match(exhausted.message, /Vbee, AssemblyAI/);
});

test("all providers returning empty text produces a non-retryable 422", () => {
  const vbeeError = createProviderResultError("vbee", "speech");
  const assemblyError = createProviderResultError("assemblyai", "speech");
  const error = createProvidersExhaustedError({
    providerAttempts: [
      { provider: "vbee", status: "failed", httpStatus: 422 },
      { provider: "assemblyai", status: "failed", httpStatus: 422 },
    ],
    providerErrors: [
      { provider: "vbee", status: "failed", error: vbeeError },
      { provider: "assemblyai", status: "failed", error: assemblyError },
    ],
    audioMode: "speech",
  });

  assert.equal(error.statusCode, 422);
  assert.equal(error.retryable, false);
  assert.match(error.message, /Các API chuyển đổi đã được thử/);
});
