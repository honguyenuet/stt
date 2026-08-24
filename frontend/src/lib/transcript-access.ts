export function canEditTranscript(value: unknown): boolean {
  return value !== false;
}

export function isTranscriptOwner(
  ownerUserId: unknown,
  currentUserId: unknown,
): boolean {
  const owner = Number(ownerUserId);
  const current = Number(currentUserId);
  return (
    Number.isSafeInteger(owner) &&
    owner > 0 &&
    Number.isSafeInteger(current) &&
    current > 0 &&
    owner === current
  );
}
