const MIN_TRANSCRIPT_EDITOR_HEIGHT = 224;
const MIN_PLAIN_TRANSCRIPT_EDITOR_HEIGHT = 520;
const TRANSCRIPT_EDITOR_VIEWPORT_RATIO = 0.8;

export function getAdaptiveTranscriptEditorHeight({
  contentHeight,
  viewportHeight,
}: {
  contentHeight: number;
  viewportHeight: number;
}): number {
  const content = Math.max(0, Math.ceil(Number(contentHeight) || 0));
  const viewport = Math.max(0, Number(viewportHeight) || 0);
  const maximum = Math.max(
    MIN_TRANSCRIPT_EDITOR_HEIGHT,
    Math.floor(viewport * TRANSCRIPT_EDITOR_VIEWPORT_RATIO),
  );

  return Math.min(Math.max(MIN_TRANSCRIPT_EDITOR_HEIGHT, content), maximum);
}

export function getPlainTranscriptEditorHeight({
  contentHeight,
  viewportHeight,
}: {
  contentHeight: number;
  viewportHeight: number;
}): number {
  return getAdaptiveTranscriptEditorHeight({
    contentHeight: Math.max(MIN_PLAIN_TRANSCRIPT_EDITOR_HEIGHT, contentHeight),
    viewportHeight,
  });
}
