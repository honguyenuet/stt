export function normalizeEstimatedRemainingSeconds(
  value?: number | null,
): number | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.ceil(seconds);
}

export function tickEstimatedRemainingSeconds(
  value?: number | null,
): number | null {
  const seconds = normalizeEstimatedRemainingSeconds(value);
  if (seconds === null) return null;
  return Math.max(1, seconds - 1);
}
