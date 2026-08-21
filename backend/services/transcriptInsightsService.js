const TRANSCRIPT_TEMPLATES = new Set([
  "meeting",
  "interview",
  "podcast",
  "lecture",
]);

const STOP_WORDS = new Set(
  `các cái cho của có cùng cũng đã đang để được gì khi là lại làm một như nhưng
   những nói này nếu nên ra rằng sau sẽ theo thì trong trước trên và vào về với
   tôi bạn chúng ta họ anh chị em our the this that with from have has were was
   will would could should about into your their there here what when where who`
    .split(/\s+/)
    .filter(Boolean),
);

const TECHNICAL_TERMS = new Set([
  "api",
  "billing",
  "provider",
  "production",
  "queue",
  "retry",
  "timeout",
  "webhook",
]);

function normalizeTranscriptTemplate(value) {
  const template = String(value || "")
    .trim()
    .toLowerCase();
  return TRANSCRIPT_TEMPLATES.has(template) ? template : "meeting";
}

function normalizeText(value, maxLength = 2_000_000) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function splitSentences(text) {
  return (text.match(/[^.!?\n]+(?:[.!?]+|$)/gu) || [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 3)
    .slice(0, 2_000);
}

function stripSentencePunctuation(value) {
  return value.replace(/[\s.!?]+$/u, "").trim();
}

function extractDeadline(sentence) {
  const match = sentence.match(
    /(?:trước|vào|hạn(?: chót)?|by|before)?\s*((?:\d{1,2}[\/-]){2}\d{2,4}|\d{4}-\d{2}-\d{2})/iu,
  );
  return match?.[1] || null;
}

function extractActionOwner(sentence) {
  const match = sentence.match(
    /^([\p{L}][\p{L}'’-]{1,30})(?:\s+[\p{L}][\p{L}'’-]{1,30})?\s+(?:sẽ|cần|phải|phụ trách|will|needs? to|must)(?:\s|:|,|$)/iu,
  );
  if (!match) return null;
  return match[1].slice(0, 80);
}

function extractKeywords(text) {
  const counts = new Map();
  const firstSeen = new Map();
  const words =
    text.toLocaleLowerCase("vi-VN").match(/[\p{L}\p{N}_-]{3,}/gu) || [];
  words.forEach((word, index) => {
    if (STOP_WORDS.has(word) || /^\d+$/u.test(word)) return;
    counts.set(word, (counts.get(word) || 0) + 1);
    if (!firstSeen.has(word)) firstSeen.set(word, index);
  });
  return [...counts]
    .sort((left, right) => {
      const leftScore = left[1] + (TECHNICAL_TERMS.has(left[0]) ? 3 : 0);
      const rightScore = right[1] + (TECHNICAL_TERMS.has(right[0]) ? 3 : 0);
      return (
        rightScore - leftScore ||
        firstSeen.get(left[0]) - firstSeen.get(right[0])
      );
    })
    .slice(0, 12)
    .map(([word]) => word);
}

function sentenceStartMs(sentence, words, fallbackIndex) {
  if (!Array.isArray(words) || words.length === 0)
    return fallbackIndex * 180_000;
  const firstToken = sentence
    .toLocaleLowerCase("vi-VN")
    .match(/[\p{L}\p{N}]+/u)?.[0];
  if (!firstToken) return fallbackIndex * 180_000;
  const match = words.find((word) =>
    String(word?.text || "")
      .toLocaleLowerCase("vi-VN")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .startsWith(firstToken),
  );
  const start = Number(match?.start);
  return Number.isFinite(start) && start >= 0 ? start : fallbackIndex * 180_000;
}

function buildChapters(sentences, words, template) {
  if (!sentences.length) return [];
  const chapterSize =
    template === "lecture" ? 4 : template === "podcast" ? 5 : 3;
  const chapters = [];
  for (let index = 0; index < sentences.length; index += chapterSize) {
    const group = sentences.slice(index, index + chapterSize);
    const startMs = sentenceStartMs(group[0], words, chapters.length);
    const nextSentence = sentences[index + chapterSize];
    const endMs = nextSentence
      ? sentenceStartMs(nextSentence, words, chapters.length + 1)
      : Math.max(
          startMs + 1_000,
          Number(words?.[words.length - 1]?.end) || startMs + 180_000,
        );
    chapters.push({
      title: stripSentencePunctuation(group[0]).slice(0, 72),
      startMs,
      endMs: Math.max(startMs + 1_000, endMs),
      summary: group.join(" ").slice(0, 600),
    });
  }
  return chapters.slice(0, 24);
}

function generateTranscriptInsights({
  text,
  words = [],
  template = "meeting",
}) {
  const cleanText = normalizeText(text);
  if (!cleanText) {
    const error = new Error("Transcript chưa có nội dung để tạo phân tích");
    error.statusCode = 409;
    throw error;
  }
  const normalizedTemplate = normalizeTranscriptTemplate(template);
  const sentences = splitSentences(cleanText);
  const keyPoints = sentences
    .filter((sentence) => sentence.length >= 20)
    .slice(0, normalizedTemplate === "lecture" ? 8 : 6)
    .map(stripSentencePunctuation);
  const actionItems = sentences
    .filter((sentence) =>
      /(?:^|[\s,:;-])(sẽ|cần|phải|phụ trách|todo|action item|will|needs? to|must)(?:[\s,:;-]|$)/iu.test(
        sentence,
      ),
    )
    .slice(0, 20)
    .map((sentence) => ({
      text: stripSentencePunctuation(sentence).slice(0, 500),
      owner: extractActionOwner(sentence),
      deadline: extractDeadline(sentence),
    }));
  const decisions = sentences
    .filter((sentence) =>
      /\b(quyết định|thống nhất|chốt|đồng ý|decision|decided|agreed)\b/iu.test(
        sentence,
      ),
    )
    .slice(0, 12)
    .map((sentence) => stripSentencePunctuation(sentence).slice(0, 500));
  const questions = sentences
    .filter((sentence) => /\?+$/u.test(sentence))
    .slice(0, 12)
    .map((sentence) => sentence.slice(0, 500));

  return {
    template: normalizedTemplate,
    summary: (keyPoints.length ? keyPoints : [cleanText])
      .slice(0, 3)
      .join(" ")
      .slice(0, 1_200),
    keyPoints,
    actionItems,
    decisions,
    chapters: buildChapters(sentences, words, normalizedTemplate),
    keywords: extractKeywords(cleanText),
    questions,
    generatedAt: new Date().toISOString(),
    generator: "extractive-v1",
  };
}

module.exports = {
  generateTranscriptInsights,
  normalizeTranscriptTemplate,
};
