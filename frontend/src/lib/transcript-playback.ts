export type TimedWord = {
  start: number;
  end: number;
};

type EditableTimedWord = TimedWord & {
  text: string;
};

export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export function confidenceLevel(value: number | null | undefined): ConfidenceLevel {
  if (value === null || value === undefined) return "unknown";
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return "unknown";
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.65) return "medium";
  return "low";
}

export function summarizeConfidence(
  words: Array<{ confidence?: number | null }>,
) {
  const values = words
    .filter(
      (word) => word.confidence !== null && word.confidence !== undefined,
    )
    .map((word) => Number(word.confidence))
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    return { average: null, lowCount: 0, reviewedCount: 0 };
  }
  return {
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    lowCount: values.filter((value) => value < 0.65).length,
    reviewedCount: values.length,
  };
}

export function findActiveWordIndex(
  words: TimedWord[],
  milliseconds: number,
) {
  let low = 0;
  let high = words.length - 1;
  let candidate = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (words[middle].start <= milliseconds) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (candidate < 0) return -1;
  return milliseconds <= words[candidate].end + 120 ? candidate : -1;
}

export function clampSeekTime(
  currentSeconds: number,
  deltaSeconds: number,
  durationSeconds: number,
) {
  const current = Number.isFinite(currentSeconds) ? currentSeconds : 0;
  const duration =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : Number.POSITIVE_INFINITY;
  return Math.min(duration, Math.max(0, current + deltaSeconds));
}

export function formatPlaybackTime(seconds: number) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainingSeconds = value % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function replaceTimedWordInText(
  transcriptText: string,
  words: EditableTimedWord[],
  wordIndex: number,
  replacement: string,
) {
  const range = findTimedWordTextRange(transcriptText, words, wordIndex);
  if (!range) return null;

  return `${String(transcriptText || "").slice(0, range.start)}${replacement}${String(
    transcriptText || "",
  ).slice(range.end)}`;
}

export function findTimedWordTextRange(
  transcriptText: string,
  words: EditableTimedWord[],
  wordIndex: number,
) {
  if (
    wordIndex < 0 ||
    wordIndex >= words.length ||
    !String(words[wordIndex]?.text || "")
  ) {
    return null;
  }

  const source = String(transcriptText || "");
  const sourceLower = source.toLocaleLowerCase();
  let cursor = 0;
  for (let index = 0; index <= wordIndex; index += 1) {
    const wordText = String(words[index]?.text || "");
    const foundAt = sourceLower.indexOf(
      wordText.toLocaleLowerCase(),
      cursor,
    );
    if (foundAt < 0) return null;
    if (index === wordIndex) {
      return { start: foundAt, end: foundAt + wordText.length };
    }
    cursor = foundAt + wordText.length;
  }
  return null;
}
