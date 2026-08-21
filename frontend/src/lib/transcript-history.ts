export function canOpenTranscriptEditor(item: {
  status?: string | null;
  text?: string | null;
}) {
  return item.status === "completed" || Boolean(String(item.text || "").trim());
}
