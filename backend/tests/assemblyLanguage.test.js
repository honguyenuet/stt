const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  assertExpectedSpeakerCount,
  buildAssemblyTranscriptParams,
  countSpeakerLabels,
  hasSpeakerLabels,
  normalizeAssemblyWords,
  normalizeSpeakerCount,
  prioritizeProvidersForLanguage,
  prioritizeProvidersForSpeakerLabels,
} = require("../services/transcriptionService");

const originalAssemblySpeechModels = process.env.ASSEMBLYAI_SPEECH_MODELS;

after(async () => {
  if (originalAssemblySpeechModels === undefined) {
    delete process.env.ASSEMBLYAI_SPEECH_MODELS;
  } else {
    process.env.ASSEMBLYAI_SPEECH_MODELS = originalAssemblySpeechModels;
  }
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

test("AssemblyAI default models do not use the deprecated universal-3-pro", () => {
  delete process.env.ASSEMBLYAI_SPEECH_MODELS;

  const params = buildParams({ language: "en" });

  assert.deepEqual(params.speech_models, [
    "universal-3-5-pro",
    "universal-2",
  ]);
});

test("legacy AssemblyAI model configuration is upgraded automatically", () => {
  process.env.ASSEMBLYAI_SPEECH_MODELS = "universal-3-pro,universal-2";

  const params = buildParams({ language: "en" });

  assert.deepEqual(params.speech_models, [
    "universal-3-5-pro",
    "universal-2",
  ]);
});

test("AssemblyAI respects a manually selected language", () => {
  delete process.env.ASSEMBLYAI_SPEECH_MODELS;
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
  assert.equal(params.speaker_labels, true);
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

test("AssemblyAI receives the exact expected speaker count", () => {
  const params = buildParams({
    language: "vi",
    audioMode: "song",
    speakerLabels: true,
    speakerCount: 2,
  });

  assert.equal(params.speaker_labels, true);
  assert.equal(params.speakers_expected, 2);
});

test("speaker count is normalized and validated between one and ten", () => {
  assert.equal(normalizeSpeakerCount("auto"), null);
  assert.equal(normalizeSpeakerCount(""), null);
  assert.equal(normalizeSpeakerCount("2"), 2);
  assert.throws(
    () => normalizeSpeakerCount(0),
    (error) => error.statusCode === 400 && /1 đến 10/i.test(error.message),
  );
  assert.throws(
    () => normalizeSpeakerCount(11),
    (error) => error.statusCode === 400 && /1 đến 10/i.test(error.message),
  );
});

test("provider output with too many speaker labels is rejected", () => {
  const result = {
    words: [
      { text: "Một", speaker: "A" },
      { text: "Hai", speaker: "B" },
      { text: "Ba", speaker: "C" },
    ],
  };

  assert.equal(countSpeakerLabels(result), 3);
  assert.throws(
    () => assertExpectedSpeakerCount(result, 2, "assemblyai"),
    (error) =>
      error.code === "SPEAKER_COUNT_MISMATCH" &&
      error.providerFallbackEligible === true,
  );
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

test("spoken diarization prioritizes providers that request speaker labels", () => {
  assert.deepEqual(
    prioritizeProvidersForSpeakerLabels(
      ["vbee", "sonix", "deepgram", "assemblyai"],
      true,
      "speech",
    ),
    ["assemblyai", "deepgram", "sonix", "vbee"],
  );
});

test("provider order is unchanged when diarization is disabled", () => {
  const providers = ["vbee", "assemblyai", "deepgram"];
  assert.deepEqual(
    prioritizeProvidersForSpeakerLabels(providers, false, "speech"),
    providers,
  );
});

test("song diarization is sent to AssemblyAI and prioritized", () => {
  const params = buildParams({
    language: "auto",
    audioMode: "song",
    speakerLabels: true,
  });

  assert.equal(params.speaker_labels, true);
  assert.deepEqual(
    prioritizeProvidersForSpeakerLabels(
      ["vbee", "sonix", "deepgram", "assemblyai"],
      true,
      "song",
    ),
    ["assemblyai", "deepgram", "sonix", "vbee"],
  );
});

test("AssemblyAI utterance speakers are copied to every timed word", () => {
  const words = normalizeAssemblyWords({
    utterances: [
      {
        speaker: "A",
        words: [
          { text: "Xin", start: 0, end: 200 },
          { text: "chào", start: 210, end: 500 },
        ],
      },
    ],
  });

  assert.deepEqual(
    words.map((word) => word.speaker),
    ["A", "A"],
  );
  assert.equal(hasSpeakerLabels({ words }), true);
  assert.equal(hasSpeakerLabels({ words: [{ text: "Xin", speaker: null }] }), false);
});

test("dictionary terms are normalized and capped", () => {
  const terms = Array.from({ length: 205 }, (_, index) => ` term-${index} `);
  terms.unshift("", "   ");
  const params = buildParams({ dictionaryKeywords: terms });

  assert.equal(params.keyterms_prompt.length, 200);
  assert.equal(params.keyterms_prompt[0], "term-0");
  assert.equal(params.keyterms_prompt[199], "term-199");
});
