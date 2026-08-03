const MAX_REASONABLE_MEDIA_SECONDS = 31 * 24 * 60 * 60;

export function normalizeMediaDuration(
  value?: number | string | null,
): number | null {
  const seconds = Number(value);
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > MAX_REASONABLE_MEDIA_SECONDS
  ) {
    return null;
  }
  return Math.round(seconds);
}

export function formatMediaDuration(
  value?: number | string | null,
  emptyText = "Chưa xử lý",
) {
  const total = normalizeMediaDuration(value);
  if (total === null) return emptyText;

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours} giờ`);
  if (minutes > 0) parts.push(`${minutes} phút`);
  if (seconds > 0 && hours === 0) parts.push(`${seconds} giây`);

  return parts.length > 0 ? parts.join(" ") : "0 giây";
}

export function sumMediaDurations(
  values: Array<number | string | null | undefined>,
) {
  return values.reduce(
    (total, value) => total + (normalizeMediaDuration(value) ?? 0),
    0,
  );
}
