export interface TranscriptTextComparison {
  prefix: string;
  removed: string;
  added: string;
  suffix: string;
  hasChanges: boolean;
}

export function compareTranscriptText(
  beforeValue: unknown,
  afterValue: unknown,
): TranscriptTextComparison {
  const before = String(beforeValue ?? "");
  const after = String(afterValue ?? "");
  if (before === after) {
    return {
      prefix: before,
      removed: "",
      added: "",
      suffix: "",
      hasChanges: false,
    };
  }

  let prefixLength = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (
    prefixLength < maxPrefix &&
    before[prefixLength] === after[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffix = Math.min(
    before.length - prefixLength,
    after.length - prefixLength,
  );
  while (
    suffixLength < maxSuffix &&
    before[before.length - suffixLength - 1] ===
      after[after.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  return {
    prefix: before.slice(0, prefixLength),
    removed: before.slice(
      prefixLength,
      suffixLength ? before.length - suffixLength : before.length,
    ),
    added: after.slice(
      prefixLength,
      suffixLength ? after.length - suffixLength : after.length,
    ),
    suffix: suffixLength ? before.slice(-suffixLength) : "",
    hasChanges: true,
  };
}
