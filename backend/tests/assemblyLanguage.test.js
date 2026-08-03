const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  buildAssemblyTranscriptParams,
  prioritizeProvidersForLanguage,
} = require("../services/transcriptionService");

after(async () => {
  await pool.end();
});

function buildParams(overrides = {}) {
  return buildAssemblyTranscriptParams({
    file: { buffer: Buffer.from("audio") },
    speakerLabels: false,
    language: "auto",
    audioMode: "speech",
    dictionaryKeywords: [],
    ...overrides,
  });
}

test("AssemblyAI respects a manually selected language", () => {
  const params = buildParams({ language: "vi" });

  assert.equal(params.language_code, "vi");
  assert.equal(params.language_detection, undefined);
  assert.equal(params.language_codes, undefined);
});

test("AssemblyAI uses Vietnamese-English code switching for multi", () => {
  const params = buildParams({
    language: "multi",
    audioMode: "song",
  });

  assert.deepEqual(params.speech_models, ["universal-2"]);
  assert.equal(params.language_detection, true);
  assert.deepEqual(params.language_detection_options, {
    expected_languages: ["vi", "en"],
    fallback_language: "auto",
    code_switching: true,
    code_switching_confidence_threshold: 0.3,
  });
  assert.equal(params.language_codes, undefined);
  assert.equal(params.language_code, undefined);
});

test("song auto detection is constrained to Vietnamese and English", () => {
  const params = buildParams({
    language: "auto",
    audioMode: "song",
    speakerLabels: true,
  });

  assert.deepEqual(params.speech_models, ["universal-2"]);
  assert.equal(params.speaker_labels, false);
  assert.equal(params.language_detection, true);
  assert.deepEqual(params.language_detection_options, {
    expected_languages: ["vi", "en"],
    fallback_language: "auto",
    code_switching: true,
    code_switching_confidence_threshold: 0.3,
  });
});

test("speaker diarization remains available for spoken audio", () => {
  const params = buildParams({
    language: "vi",
    audioMode: "speech",
    speakerLabels: true,
  });

  assert.equal(params.speaker_labels, true);
});

test("multi language jobs prioritize the code-switching provider", () => {
  assert.deepEqual(
    prioritizeProvidersForLanguage(
      ["vbee", "assemblyai", "deepgram", "sonix"],
      "multi",
      "speech",
    ),
    ["assemblyai", "vbee", "deepgram", "sonix"],
  );
});

test("single language jobs preserve the configured provider order", () => {
  assert.deepEqual(
    prioritizeProvidersForLanguage(
      ["vbee", "assemblyai", "deepgram", "sonix"],
      "vi",
      "speech",
    ),
    ["vbee", "assemblyai", "deepgram", "sonix"],
  );
});

test("dictionary terms are normalized and capped", () => {
  const terms = Array.from({ length: 205 }, (_, index) => ` term-${index} `);
  terms.unshift("", "   ");
  const params = buildParams({ dictionaryKeywords: terms });

  assert.equal(params.keyterms_prompt.length, 200);
  assert.equal(params.keyterms_prompt[0], "term-0");
  assert.equal(params.keyterms_prompt[199], "term-199");
});
