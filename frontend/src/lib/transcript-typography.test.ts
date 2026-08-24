import { describe, expect, it } from "vitest";
import {
  EDITABLE_TIMED_WORD_CLASS_NAME,
  TRANSCRIPT_WORD_FLOW_CLASS_NAME,
  editableTimedWordWidthCh,
} from "./transcript-typography";

describe("transcript editor typography", () => {
  it("keeps separate editable words visibly spaced on both axes", () => {
    expect(TRANSCRIPT_WORD_FLOW_CLASS_NAME).toContain("gap-x-2");
    expect(TRANSCRIPT_WORD_FLOW_CLASS_NAME).toContain("gap-y-2");
    expect(EDITABLE_TIMED_WORD_CLASS_NAME).not.toContain("mr-0.5");
  });

  it("uses Vietnamese-friendly content typography with enough glyph height", () => {
    expect(TRANSCRIPT_WORD_FLOW_CLASS_NAME).toContain("font-content");
    expect(TRANSCRIPT_WORD_FLOW_CLASS_NAME).toContain("font-medium");
    expect(EDITABLE_TIMED_WORD_CLASS_NAME).toContain("text-[17px]");
    expect(EDITABLE_TIMED_WORD_CLASS_NAME).toContain("leading-9");
    expect(EDITABLE_TIMED_WORD_CLASS_NAME).toContain("tracking-[0.01em]");
    expect(EDITABLE_TIMED_WORD_CLASS_NAME).not.toContain("font-medium");
  });

  it("gives short and decomposed Vietnamese words enough editable width", () => {
    expect(editableTimedWordWidthCh("tôi")).toBe(4.25);
    expect(editableTimedWordWidthCh("Giữa")).toBe(5.25);
    expect(editableTimedWordWidthCh("Giu\u031b\u0303a")).toBe(5.25);
  });
});
