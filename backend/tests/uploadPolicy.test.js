const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { normalizeAllowedFormats } = require("../services/uploadStorage");

describe("CMS upload policy", () => {
  test("allows configured media formats and drops executable extensions", () => {
    const formats = normalizeAllowedFormats([
      "MP3",
      "wav",
      "exe",
      "php",
      "mp3",
    ]);

    assert.deepEqual([...formats], ["mp3", "wav"]);
  });

  test("falls back to safe media defaults when the CMS list is empty", () => {
    const formats = normalizeAllowedFormats(["exe"]);

    assert.deepEqual([...formats], [
      "mp3",
      "wav",
      "m4a",
      "ogg",
      "flac",
      "aac",
      "mp4",
      "webm",
    ]);
  });
});
