export type TimedWord = {
  start: number;
  end: number;
};

type EditableTimedWord = TimedWord & {
  text: string;
};

const ESTIMATED_WORDS_PER_SECOND = 2.5;
const AUDIO_ACCESS_REFRESH_MARGIN_MS = 15_000;
const MAX_AUTOMATIC_AUDIO_RECOVERY_ATTEMPTS = 1;
const AUDIO_RECOVERY_PROGRESS_SECONDS = 2;
export const MAX_EDITABLE_TIMED_WORDS = 100_000;

export type TranscriptFollowMode = "following" | "manual";
export type TranscriptFollowEvent =
  | "playback-position"
  | "user-scroll"
  | "resume";

export function audioAccessNeedsRefresh(
  expiresAtMilliseconds: number | null,
  nowMilliseconds = Date.now(),
) {
  return (
    expiresAtMilliseconds !== null &&
    Number.isFinite(expiresAtMilliseconds) &&
    expiresAtMilliseconds <= nowMilliseconds + AUDIO_ACCESS_REFRESH_MARGIN_MS
  );
}

export function createAudioRecoveryPlan(
  currentTimeSeconds: number,
  playbackWasRequested: boolean,
  recoveryAttempts: number,
) {
  if (recoveryAttempts >= MAX_AUTOMATIC_AUDIO_RECOVERY_ATTEMPTS) return null;
  const safeCurrentTimeSeconds =
    Number.isFinite(currentTimeSeconds) && currentTimeSeconds > 0
      ? currentTimeSeconds
      : 0;
  return {
    playWhenReady: playbackWasRequested,
    seekMilliseconds: Math.round(safeCurrentTimeSeconds * 1_000),
  };
}

export function audioRecoveryMadeProgress(
  recoveryStartSeconds: number | null,
  currentTimeSeconds: number,
) {
  return (
    recoveryStartSeconds !== null &&
    Number.isFinite(recoveryStartSeconds) &&
    Number.isFinite(currentTimeSeconds) &&
    currentTimeSeconds >=
      recoveryStartSeconds + AUDIO_RECOVERY_PROGRESS_SECONDS
  );
}

export function nextTranscriptFollowMode(
  currentMode: TranscriptFollowMode,
  event: TranscriptFollowEvent,
): TranscriptFollowMode {
  if (event === "user-scroll") return "manual";
  if (event === "resume") return "following";
  return currentMode;
}

export function canUseSyncEditor(wordCount: number) {
  return (
    Number.isFinite(wordCount) &&
    wordCount > 0 &&
    wordCount <= MAX_EDITABLE_TIMED_WORDS
  );
}

export function createApproximateTimedWords(
  transcriptText: string,
  durationSeconds: number | null | undefined,
  maxWords = Number.POSITIVE_INFINITY,
) {
  const source = String(transcriptText || "").trim();
  const safeMaxWords =
    Number.isSafeInteger(maxWords) && maxWords > 0
      ? maxWords
      : Number.POSITIVE_INFINITY;
  const tokens: string[] = [];
  for (const match of source.matchAll(/\S+/g)) {
    if (tokens.length >= safeMaxWords) return [];
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
  }));
}

export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export function confidenceLevel(
  value: number | null | undefined,
): ConfidenceLevel {
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
    .filter((word) => word.confidence !== null && word.confidence !== undefined)
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

export function findActiveWordIndex(words: TimedWord[], milliseconds: number) {
  if (!Number.isFinite(milliseconds)) return -1;

  const toleranceMilliseconds = 80;
  const lowerBound = milliseconds - toleranceMilliseconds;
  const upperBound = milliseconds + toleranceMilliseconds;
  let low = 0;
  let high = words.length - 1;
  let candidate = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (words[middle].end >= lowerBound) {
      candidate = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  if (candidate < 0) return -1;
  const word = words[candidate];
  return word.start <= upperBound && word.end >= lowerBound ? candidate : -1;
}

export function normalizeTimedWordBounds<TWord extends TimedWord>(
  words: TWord[],
  durationSeconds?: number | null,
) {
  const duration = Number(durationSeconds);
  const maxEnd = words.reduce((max, word) => {
    const start = Number(word.start);
    const end = Number(word.end);
    return Math.max(
      max,
      Number.isFinite(start) ? start : 0,
      Number.isFinite(end) ? end : 0,
    );
  }, 0);
  const scale =
    Number.isFinite(duration) &&
    duration > 0 &&
    maxEnd > 0 &&
    maxEnd <= duration + 1
      ? 1000
      : 1;

  return words.map((word) => {
    const rawStart = Number(word.start) * scale;
    const start = Number.isFinite(rawStart) ? Math.max(0, rawStart) : 0;
    const rawEnd = Number(word.end) * scale;
    const end = Number.isFinite(rawEnd) ? Math.max(start, rawEnd) : start;
    return {
      ...word,
      start: Math.round(start),
      end: Math.round(end),
    };
  });
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
    const foundAt = sourceLower.indexOf(wordText.toLocaleLowerCase(), cursor);
    if (foundAt < 0) return null;
    if (index === wordIndex) {
      return { start: foundAt, end: foundAt + wordText.length };
    }
    cursor = foundAt + wordText.length;
  }
  return null;
}

export function indexTimedWordTextRanges(
  transcriptText: string,
  words: EditableTimedWord[],
) {
  const source = String(transcriptText || "");
  const sourceLower = source.toLocaleLowerCase();
  let cursor = 0;
  return words.map((word) => {
    const wordText = String(word?.text || "");
    if (!wordText) return null;
    const start = sourceLower.indexOf(wordText.toLocaleLowerCase(), cursor);
    if (start < 0) return null;
    const end = start + wordText.length;
    cursor = end;
    return { start, end };
  });
}
