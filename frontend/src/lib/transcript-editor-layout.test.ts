import { describe, expect, it } from "vitest";
import {
  getAdaptiveTranscriptEditorHeight,
  getPlainTranscriptEditorHeight,
  TRANSCRIPT_AUDIO_PLAYER_CLASS_NAME,
} from "./transcript-editor-layout";

describe("adaptive transcript editor height", () => {
  it("grows with short transcript content instead of keeping a fixed desktop panel", () => {
    expect(
      getAdaptiveTranscriptEditorHeight({
        contentHeight: 420,
        viewportHeight: 900,
      }),
    ).toBe(420);
  });

  it("keeps enough room for a short transcript", () => {
    expect(
      getAdaptiveTranscriptEditorHeight({
        contentHeight: 80,
        viewportHeight: 900,
      }),
    ).toBe(224);
  });

  it("caps an extremely long transcript while preserving virtual scrolling", () => {
    expect(
      getAdaptiveTranscriptEditorHeight({
        contentHeight: 20_000,
        viewportHeight: 900,
      }),
    ).toBe(720);
  });

  it("keeps the plain-text editor comfortably tall after switching modes", () => {
    expect(
      getPlainTranscriptEditorHeight({
        contentHeight: 180,
        viewportHeight: 900,
      }),
    ).toBe(520);
  });

  it("keeps playback reachable on phones without pinning it on desktop", () => {
    expect(TRANSCRIPT_AUDIO_PLAYER_CLASS_NAME).toContain("sticky top-14 z-30");
    expect(TRANSCRIPT_AUDIO_PLAYER_CLASS_NAME).toContain("sm:static");
  });
});
