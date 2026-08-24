import { describe, expect, it } from "vitest";
import { buildTranscriptSavePayload } from "./transcript-save";

const baseWords = Array.from({ length: 6_000 }, (_, index) => ({
  text: `từ-${index}`,
  start: index * 400,
  end: (index + 1) * 400,
  speaker: index < 3_000 ? "A" : "B",
  confidence: 0.95,
}));

describe("buildTranscriptSavePayload", () => {
  it("keeps text-only autosave small for a long history transcript", () => {
    const payload = buildTranscriptSavePayload(
      "Nội dung đã chỉnh sửa",
      baseWords,
      baseWords,
    );

    expect(payload).toEqual({ text: "Nội dung đã chỉnh sửa" });
    expect(JSON.stringify(payload).length).toBeLessThan(100);
  });

  it("sends only changed text and speaker fields", () => {
    const currentWords = baseWords.slice();
    currentWords[12] = { ...currentWords[12], text: "đã sửa" };
    currentWords[4_500] = { ...currentWords[4_500], speaker: "Khách hàng" };

    const payload = buildTranscriptSavePayload(
      "Nội dung đã chỉnh sửa",
      currentWords,
      baseWords,
    );

    expect(payload).toEqual({
      text: "Nội dung đã chỉnh sửa",
      wordPatches: [
        { index: 12, text: "đã sửa" },
        { index: 4_500, speaker: "Khách hàng" },
      ],
    });
    expect("words" in payload).toBe(false);
  });

  it("asks the server to initialize timestamps for text-only history", () => {
    const payload = buildTranscriptSavePayload(
      "Nội dung đã chỉnh sửa",
      baseWords,
      baseWords,
      { initializeWordTimeline: true },
    );

    expect(payload).toEqual({
      text: "Nội dung đã chỉnh sửa",
      initializeWordTimeline: true,
    });
    expect("words" in payload).toBe(false);
  });

  it("falls back to the full timeline when timestamp structure changes", () => {
    const currentWords = baseWords.slice();
    currentWords[2] = { ...currentWords[2], start: 123 };

    const payload = buildTranscriptSavePayload(
      "Nội dung",
      currentWords,
      baseWords,
    );

    expect(payload).toEqual({ text: "Nội dung", words: currentWords });
  });
});
