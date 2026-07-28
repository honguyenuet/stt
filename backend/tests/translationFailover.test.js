const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  translateTranscript,
} = require("../services/translationService");

const ENV_NAMES = [
  "TRANSLATION_PROVIDER",
  "TRANSLATION_PROVIDER_CHAIN",
  "GOOGLE_TRANSLATE_API_KEY",
  "ASSEMBLYAI_API_KEY",
];
const originalEnv = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);
const originalFetch = global.fetch;

afterEach(() => {
  for (const name of ENV_NAMES) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
  global.fetch = originalFetch;
});

function quotaError() {
  const error = new Error(
    "MyMemory đã hết quota dịch miễn phí trong ngày.",
  );
  error.statusCode = 429;
  return error;
}

test("auto translation falls back from MyMemory quota to AssemblyAI", async () => {
  process.env.TRANSLATION_PROVIDER = "auto";
  process.env.TRANSLATION_PROVIDER_CHAIN =
    "mymemory,assemblyai,google-cloud-translation";
  process.env.ASSEMBLYAI_API_KEY = "assembly-test-key";
  process.env.GOOGLE_TRANSLATE_API_KEY = "google-test-key";
  global.fetch = async () => {
    throw new Error("Unexpected external request");
  };

  const attempts = [];
  const result = await translateTranscript({
    text: "Xin chào",
    sourceLanguage: "vi",
    targetLanguage: "en",
    providerRunners: {
      mymemory: async () => {
        attempts.push("mymemory");
        throw quotaError();
      },
      assemblyai: async () => {
        attempts.push("assemblyai");
        return {
          provider: "assemblyai-translation",
          text: "Hello",
          sourceLanguage: "vi",
          targetLanguage: "en",
        };
      },
      "google-cloud-translation": async () => {
        attempts.push("google-cloud-translation");
        throw new Error("Google must not run after AssemblyAI succeeds");
      },
    },
  });

  assert.deepEqual(attempts, ["mymemory", "assemblyai"]);
  assert.equal(result.provider, "assemblyai-translation");
  assert.equal(result.text, "Hello");
});

test("auto translation falls back to Google when MyMemory and AssemblyAI fail", async () => {
  process.env.TRANSLATION_PROVIDER = "auto";
  process.env.TRANSLATION_PROVIDER_CHAIN =
    "mymemory,assemblyai,google-cloud-translation";
  process.env.ASSEMBLYAI_API_KEY = "assembly-test-key";
  process.env.GOOGLE_TRANSLATE_API_KEY = "google-test-key";
  global.fetch = async () => {
    throw new Error("Unexpected external request");
  };

  const attempts = [];
  const result = await translateTranscript({
    text: "Xin chào",
    sourceLanguage: "vi",
    targetLanguage: "en",
    providerRunners: {
      mymemory: async () => {
        attempts.push("mymemory");
        throw quotaError();
      },
      assemblyai: async () => {
        attempts.push("assemblyai");
        throw new Error("AssemblyAI tạm thời không khả dụng");
      },
      "google-cloud-translation": async () => {
        attempts.push("google-cloud-translation");
        return {
          provider: "google-cloud-translation",
          text: "Hello",
          sourceLanguage: "vi",
          targetLanguage: "en",
        };
      },
    },
  });

  assert.deepEqual(attempts, [
    "mymemory",
    "assemblyai",
    "google-cloud-translation",
  ]);
  assert.equal(result.provider, "google-cloud-translation");
  assert.equal(result.text, "Hello");
});

test("AssemblyAI fallback reuses an existing AssemblyAI transcript ID", async () => {
  process.env.TRANSLATION_PROVIDER = "auto";
  process.env.TRANSLATION_PROVIDER_CHAIN = "mymemory,assemblyai";
  process.env.ASSEMBLYAI_API_KEY = "assembly-test-key";

  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("mymemory.translated.net")) {
      return {
        ok: false,
        status: 429,
        json: async () => ({
          responseStatus: 429,
          responseDetails: "YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY",
        }),
      };
    }
    if (String(url).includes("llm-gateway.assemblyai.com")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          language_code: "vi",
          translated_texts: { en: "Hello" },
          speech_understanding: {
            response: { translation: { status: "success" } },
          },
        }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await translateTranscript({
    text: "Xin chào",
    sourceLanguage: "vi",
    targetLanguage: "en",
    assemblyTranscriptId: "assembly-transcript-123",
  });

  assert.equal(result.provider, "assemblyai-translation");
  assert.equal(result.text, "Hello");
  assert.equal(requests.length, 2);
  const assemblyRequest = requests[1];
  assert.equal(
    assemblyRequest.url,
    "https://llm-gateway.assemblyai.com/v1/understanding",
  );
  assert.equal(assemblyRequest.options.headers.Authorization, "assembly-test-key");
  assert.equal(
    JSON.parse(assemblyRequest.options.body).transcript_id,
    "assembly-transcript-123",
  );
});
