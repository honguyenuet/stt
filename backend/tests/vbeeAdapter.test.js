const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  buildVbeeTranscriptionForm,
  createApproximateTimedWords,
  getWavDurationSeconds,
  normalizeVbeeWords,
  usesOpenAiCompatibleVbeeApi,
} = require("../services/transcriptionService");

after(async () => {
  await pool.end();
});

test("Vbee UAT uses the OpenAI-compatible transcription endpoint", () => {
  assert.equal(
    usesOpenAiCompatibleVbeeApi("/api/v1/audio/transcriptions"),
    true,
  );
  assert.equal(usesOpenAiCompatibleVbeeApi("/stt"), false);
});

test("Vbee UAT multipart body uses file, model and timestamped response", () => {
  const form = buildVbeeTranscriptionForm(
    { buffer: Buffer.from("wav") },
    "sample.wav",
    "vi",
  );
  const entries = Object.fromEntries(form.entries());

  assert.equal(entries.model, "vbee-stt");
  assert.equal(entries.response_format, "verbose_json");
  assert.equal(entries.language, "vi");
  assert.ok(entries.file instanceof Blob);
  assert.equal(entries.mode, undefined);
});

test("Vbee verbose segments become timestamped editable words", () => {
  const words = normalizeVbeeWords({
    text: "Xin chào các bạn",
    duration: 2,
    segments: [{ id: 0, start: 0.5, end: 1.7, text: "Xin chào các bạn" }],
  });

  assert.deepEqual(
    words.map((word) => word.text),
    ["Xin", "chào", "các", "bạn"],
  );
  assert.equal(words[0].start, 500);
  assert.equal(words.at(-1).end, 1700);
});

test("Vbee JSON text receives an approximate editable timeline", () => {
  const words = createApproximateTimedWords("Xin chào bạn", 3, 6);
  assert.deepEqual(
    words.map((word) => word.text),
    ["Xin", "chào", "bạn"],
  );
  assert.equal(words[0].start, 6000);
  assert.equal(words.at(-1).end, 9000);
});

test("WAV duration is read from the RIFF header", () => {
  const buffer = Buffer.alloc(44 + 32_000);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(32_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(32_000, 40);

  assert.equal(getWavDurationSeconds(buffer), 1);
});
