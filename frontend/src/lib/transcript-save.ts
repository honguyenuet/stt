export interface TranscriptSaveWord {
  text: string;
  start: number;
  end: number;
  speaker?: string | number | null;
  confidence?: number | null;
}

export interface TranscriptWordPatch {
  index: number;
  text?: string;
  speaker?: string | number | null;
}

export type TranscriptSavePayload =
  | { text: string; initializeWordTimeline: true }
  | { text: string; wordPatches?: TranscriptWordPatch[] }
  | { text: string; words: TranscriptSaveWord[] };

function sameTimelineWord(
  current: TranscriptSaveWord,
  saved: TranscriptSaveWord,
) {
  return (
    current.start === saved.start &&
    current.end === saved.end &&
    (current.confidence ?? null) === (saved.confidence ?? null)
  );
}

export function buildTranscriptSavePayload(
  text: string,
  currentWords: TranscriptSaveWord[],
  savedWords: TranscriptSaveWord[],
  options: { initializeWordTimeline?: boolean } = {},
): TranscriptSavePayload {
  if (options.initializeWordTimeline) {
    return { text, initializeWordTimeline: true };
  }
  if (currentWords.length !== savedWords.length) {
    return { text, words: currentWords };
  }

  const wordPatches: TranscriptWordPatch[] = [];
  for (let index = 0; index < currentWords.length; index += 1) {
    const current = currentWords[index];
    const saved = savedWords[index];
    if (!current || !saved || !sameTimelineWord(current, saved)) {
      return { text, words: currentWords };
    }

    const patch: TranscriptWordPatch = { index };
    if (current.text !== saved.text) patch.text = current.text;
    if ((current.speaker ?? null) !== (saved.speaker ?? null)) {
      patch.speaker = current.speaker ?? null;
    }
    if (patch.text !== undefined || "speaker" in patch) {
      wordPatches.push(patch);
    }
  }

  return wordPatches.length ? { text, wordPatches } : { text };
}
