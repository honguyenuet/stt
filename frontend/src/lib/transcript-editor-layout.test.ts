import { describe, expect, it } from "vitest";
import { getAdaptiveTranscriptEditorHeight } from "./transcript-editor-layout";

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
});
