const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateTranscriptInsights,
  normalizeStoredTranscriptInsights,
  normalizeTranscriptTemplate,
} = require("../services/transcriptInsightsService");

test("meeting insights extract summary, actions, decisions, chapters and keywords", () => {
  const text = [
    "Nhóm thống nhất phát hành bản thử nghiệm vào ngày 25/08/2026.",
    "Lan sẽ hoàn thiện tài liệu hướng dẫn trước ngày 23/08/2026.",
    "Minh cần kiểm tra webhook thanh toán và báo lại cho cả nhóm.",
    "Quyết định dùng hàng đợi hiện tại vì đã có retry và timeout.",
    "Khi nào chúng ta kiểm thử trên môi trường production?",
  ].join(" ");
  const words = text.split(/\s+/).map((word, index) => ({
    text: word,
    start: index * 500,
    end: index * 500 + 450,
    speaker: index < 18 ? "1" : "2",
  }));

  const insights = generateTranscriptInsights({
    text,
    words,
    template: "meeting",
  });

  assert.equal(insights.template, "meeting");
  assert.match(insights.summary, /phát hành bản thử nghiệm/i);
  assert.equal(insights.keyPoints.length >= 2, true);
  assert.equal(insights.actionItems.length >= 2, true);
  assert.equal(
    insights.actionItems.some((item) => item.owner === "Lan"),
    true,
  );
  assert.equal(
    insights.actionItems.some((item) => /23\/08\/2026/.test(item.deadline)),
    true,
  );
  assert.equal(
    insights.decisions.some((item) => /hàng đợi/i.test(item)),
    true,
  );
  assert.equal(insights.chapters.length >= 1, true);
  assert.equal(insights.keywords.includes("webhook"), true);
  assert.equal(insights.questions.length, 1);
});

test("transcript template falls back to meeting for unsupported values", () => {
  assert.equal(normalizeTranscriptTemplate("podcast"), "podcast");
  assert.equal(normalizeTranscriptTemplate("unknown"), "meeting");
});

test("stored transcript insights preserve the nullable API contract", () => {
  assert.equal(normalizeStoredTranscriptInsights(null), null);
  assert.equal(normalizeStoredTranscriptInsights({}), null);
  assert.deepEqual(
    normalizeStoredTranscriptInsights(
      { summary: "Tóm tắt cũ" },
      "interview",
    ),
    {
      template: "interview",
      summary: "Tóm tắt cũ",
      keyPoints: [],
      actionItems: [],
      decisions: [],
      chapters: [],
      keywords: [],
      questions: [],
      generatedAt: "",
      generator: "",
    },
  );
});
