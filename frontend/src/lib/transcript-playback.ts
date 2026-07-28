export type TimedWord = {
  start: number;
  end: number;
};

type EditableTimedWord = TimedWord & {
  text: string;
};

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
      return `${source.slice(0, foundAt)}${replacement}${source.slice(
        foundAt + wordText.length,
      )}`;
    }
    cursor = foundAt + wordText.length;
  }
  return null;
}
