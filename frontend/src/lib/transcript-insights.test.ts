import { describe, expect, it } from "vitest";
import { normalizeTranscriptInsights } from "./transcript-insights";

describe("normalizeTranscriptInsights", () => {
  it("treats missing or empty stored insights as absent", () => {
    expect(normalizeTranscriptInsights(null, "meeting")).toBeNull();
    expect(normalizeTranscriptInsights({}, "meeting")).toBeNull();
  });

  it("fills missing legacy insight collections with safe empty arrays", () => {
    expect(
      normalizeTranscriptInsights(
        { summary: "Tóm tắt cũ", generatedAt: "2026-08-24T00:00:00.000Z" },
        "interview",
      ),
    ).toEqual({
      template: "interview",
      summary: "Tóm tắt cũ",
      keyPoints: [],
      actionItems: [],
      decisions: [],
      chapters: [],
      keywords: [],
      questions: [],
      generatedAt: "2026-08-24T00:00:00.000Z",
      generator: "",
    });
  });
});
