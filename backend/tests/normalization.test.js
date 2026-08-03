const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  normalizeBillingCycle,
  normalizePlan,
} = require("../services/quotaService");
const {
  normalizeTranslateTarget,
} = require("../services/translationService");
const {
  getTranscriptionProvider,
  getTranscriptionProviderStatus,
  getVbeeAuthHeaders,
} = require("../services/transcriptionService");

after(async () => {
  await pool.end();
});

test("legacy premium accounts use the special plan policy", () => {
  assert.equal(normalizePlan("premium"), "special");
  assert.equal(normalizePlan("pro"), "special");
});

test("billing cycle input is normalized", () => {
  assert.equal(normalizeBillingCycle("yearly"), "yearly");
  assert.equal(normalizeBillingCycle("unexpected"), "monthly");
});

test("no-translation values normalize to an empty target", () => {
  assert.equal(normalizeTranslateTarget("none"), "");
  assert.equal(normalizeTranslateTarget(""), "");
});

test("auto provider mode supports one Vbee API key and legacy credentials", () => {
  const names = [
    "TRANSCRIPTION_PROVIDER",
    "TRANSCRIPTION_PROVIDER_CHAIN",
    "VBEE_STT_TOKEN",
    "VBEE_STT_APP_ID",
    "VBEE_API_KEY",
    "VBEE_API_KEY_HEADER",
    "VBEE_API_KEY_SCHEME",
    "ASSEMBLYAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "SONIX_API_KEY",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );

  try {
    process.env.TRANSCRIPTION_PROVIDER = "auto";
    process.env.TRANSCRIPTION_PROVIDER_CHAIN =
      "vbee,assemblyai,deepgram,sonix";
    process.env.VBEE_STT_TOKEN = "";
    process.env.VBEE_STT_APP_ID = "";
    process.env.VBEE_API_KEY = "...";
    process.env.ASSEMBLYAI_API_KEY = "assembly-test-key";
    process.env.DEEPGRAM_API_KEY = "deepgram-test-key";
    process.env.SONIX_API_KEY = "";

    assert.equal(getTranscriptionProvider(), "assemblyai");
    assert.deepEqual(getTranscriptionProviderStatus(), {
      preference: "auto",
      active: "assemblyai",
      chain: ["assemblyai", "vbee", "deepgram", "sonix"],
      configured: {
        vbee: false,
        assemblyai: true,
        deepgram: true,
        sonix: false,
      },
    });

    process.env.VBEE_API_KEY = "vbee-single-test-key";
    process.env.VBEE_API_KEY_HEADER = "Authorization";
    process.env.VBEE_API_KEY_SCHEME = "Bearer";

    assert.equal(getTranscriptionProvider(), "vbee");
    assert.deepEqual(getVbeeAuthHeaders(), {
      Authorization: "Bearer vbee-single-test-key",
    });

    process.env.VBEE_API_KEY = "";
    process.env.VBEE_STT_TOKEN = "vbee-test-token";
    process.env.VBEE_STT_APP_ID = "vbee-test-app-id";

    assert.equal(getTranscriptionProvider(), "vbee");
    assert.equal(getTranscriptionProviderStatus().active, "vbee");
    assert.deepEqual(getVbeeAuthHeaders(), {
      Authorization: "Bearer vbee-test-token",
      "App-Id": "vbee-test-app-id",
    });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
