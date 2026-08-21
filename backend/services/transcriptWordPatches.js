const MAX_TRANSCRIPT_WORD_PATCHES = 100_000;
const WORD_PATCH_FIELDS = new Set(["index", "text", "speaker"]);
const ESTIMATED_WORDS_PER_SECOND = 2.5;

function invalidWordPatch(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeTranscriptWordPatches(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_TRANSCRIPT_WORD_PATCHES
  ) {
    throw invalidWordPatch("Danh sách thay đổi từ không hợp lệ");
  }

  const seenIndexes = new Set();
  return value.map((patch) => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw invalidWordPatch("Một thay đổi từ không hợp lệ");
    }
    if (Object.keys(patch).some((field) => !WORD_PATCH_FIELDS.has(field))) {
      throw invalidWordPatch("Thay đổi từ chứa trường không hỗ trợ");
    }

    const index = Number(patch.index);
    if (!Number.isSafeInteger(index) || index < 0) {
      throw invalidWordPatch("Chỉ số từ không hợp lệ");
    }
    if (seenIndexes.has(index)) {
      throw invalidWordPatch("Chỉ số từ bị trùng lặp");
    }
    seenIndexes.add(index);

    const hasText = Object.prototype.hasOwnProperty.call(patch, "text");
    const hasSpeaker = Object.prototype.hasOwnProperty.call(patch, "speaker");
    if (!hasText && !hasSpeaker) {
      throw invalidWordPatch("Một thay đổi từ phải có nội dung hoặc người nói");
    }

    const normalized = { index };
    if (hasText) {
      if (typeof patch.text !== "string") {
        throw invalidWordPatch("Nội dung từ không hợp lệ");
      }
      const text = patch.text.trim();
      if (!text || text.length > 500) {
        throw invalidWordPatch("Nội dung từ không hợp lệ");
      }
      normalized.text = text;
    }
    if (hasSpeaker) {
      if (patch.speaker === null) {
        normalized.speaker = null;
      } else if (
        typeof patch.speaker === "string" ||
        typeof patch.speaker === "number"
      ) {
        const speaker = String(patch.speaker).trim();
        if (!speaker || speaker.length > 100) {
          throw invalidWordPatch("Người nói trong thay đổi từ không hợp lệ");
        }
        normalized.speaker = speaker;
      } else {
        throw invalidWordPatch("Người nói trong thay đổi từ không hợp lệ");
      }
    }
    return normalized;
  });
}

function applyTranscriptWordPatches(words, patches) {
  const nextWords = Array.isArray(words)
    ? words.map((word) => ({ ...word }))
    : [];
  for (const patch of patches) {
    const currentWord = nextWords[patch.index];
    if (!currentWord || typeof currentWord !== "object") {
      throw invalidWordPatch("Chỉ số từ nằm ngoài transcript");
    }
    nextWords[patch.index] = {
      ...currentWord,
      ...(patch.text === undefined ? {} : { text: patch.text }),
      ...(Object.prototype.hasOwnProperty.call(patch, "speaker")
        ? { speaker: patch.speaker }
        : {}),
    };
  }
  return nextWords;
}

function createApproximateTranscriptWords(transcriptText, durationSeconds) {
  const source = String(transcriptText || "").trim();
  const tokens = [];
  for (const match of source.matchAll(/\S+/g)) {
    if (tokens.length >= MAX_TRANSCRIPT_WORD_PATCHES) return [];
    tokens.push(match[0]);
  }
  if (!tokens.length) return [];

  const providedDuration = Number(durationSeconds);
  const timelineDurationSeconds =
    Number.isFinite(providedDuration) && providedDuration > 0
      ? providedDuration
      : Math.max(1, tokens.length / ESTIMATED_WORDS_PER_SECOND);
  const wordDurationMilliseconds =
    (timelineDurationSeconds * 1_000) / tokens.length;
  return tokens.map((text, index) => ({
    text,
    start: Math.round(wordDurationMilliseconds * index),
    end: Math.round(wordDurationMilliseconds * (index + 1)),
    speaker: null,
    confidence: null,
  }));
}

module.exports = {
  MAX_TRANSCRIPT_WORD_PATCHES,
  applyTranscriptWordPatches,
  createApproximateTranscriptWords,
  normalizeTranscriptWordPatches,
};
