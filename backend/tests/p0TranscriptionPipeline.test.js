const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeVbeeWords } = require("../services/transcriptionService");
const { normalizeTranscriptionStatus } = require("../services/transcriptionQueue");
const { generateTranscriptInsights } = require("../services/transcriptInsightsService");
const { createTranscriptExport } = require("../services/transcriptExportService");
const pool = require("../db");

test.after(() => pool.end());

test("P0 upload to queue to provider to transcript export contract", () => {
  const upload = { filename: "hop-du-an.wav", status: "pending" };
  assert.equal(normalizeTranscriptionStatus(upload.status), "queued");

  const words = normalizeVbeeWords({
    utterances: [
      { text: "Lan sẽ gửi báo cáo.", start: 0, end: 1.5, confidence: 0.98, speaker: 0 },
    ],
  });
  const text = words.map((word) => word.text).join(" ");
  const insights = generateTranscriptInsights({ text, words, template: "meeting" });
  const exported = createTranscriptExport({ format: "srt", text, words });

  assert.equal(text, "Lan sẽ gửi báo cáo.");
  assert.equal(insights.actionItems.length, 1);
  assert.match(exported.contentType, /subrip/);
  assert.match(exported.content, /00:00:00,000 --> 00:00:01,500/);
  assert.match(exported.content, /Lan sẽ gửi báo cáo\./);
});
