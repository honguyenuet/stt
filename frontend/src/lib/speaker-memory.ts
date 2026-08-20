type SpeakerWord = {
  speaker?: string | number | null;
};

export type SpeakerMemory = Record<string, string>;

function cleanSpeakerKey(value: unknown) {
  return String(value ?? "").trim().slice(0, 100);
}

function cleanSpeakerLabel(value: unknown) {
  const withoutControlCharacters = Array.from(String(value ?? ""))
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("");
  const label = withoutControlCharacters
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return label && !/[<>]/.test(label) ? label : "";
}

export function normalizeSpeakerMemory(value: unknown): SpeakerMemory {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, label]) => [cleanSpeakerKey(key), cleanSpeakerLabel(label)])
      .filter(([key, label]) => key && label)
      .slice(-100),
  );
}

export function rememberSpeakerLabel(
  memory: unknown,
  sourceSpeaker: unknown,
  label: unknown,
): SpeakerMemory {
  const key = cleanSpeakerKey(sourceSpeaker);
  const cleanLabel = cleanSpeakerLabel(label);
  const entries = Object.entries(normalizeSpeakerMemory(memory));
  if (!key || !cleanLabel) return Object.fromEntries(entries);
  const withoutKey = entries.filter(([existingKey]) => existingKey !== key);
  return Object.fromEntries([...withoutKey, [key, cleanLabel]].slice(-100));
}

export function renameRememberedSpeakerLabel(
  memory: unknown,
  previousLabel: unknown,
  nextLabel: unknown,
): SpeakerMemory {
  const aliases = normalizeSpeakerMemory(memory);
  const previous = cleanSpeakerKey(previousLabel);
  const next = cleanSpeakerLabel(nextLabel);
  if (!previous || !next) return aliases;
  const matchingKeys = Object.entries(aliases)
    .filter(([key, label]) => key === previous || label === previous)
    .map(([key]) => key);
  if (!matchingKeys.length) return rememberSpeakerLabel(aliases, previous, next);
  return Object.fromEntries(
    Object.entries(aliases).map(([key, label]) => [
      key,
      matchingKeys.includes(key) ? next : label,
    ]),
  );
}

export function applyRememberedSpeakerLabels<T extends SpeakerWord>(
  words: T[],
  memory: unknown,
): T[] {
  const aliases = normalizeSpeakerMemory(memory);
  return words.map((word) => {
    const key = cleanSpeakerKey(word.speaker);
    return key && aliases[key] ? { ...word, speaker: aliases[key] } : word;
  });
}
