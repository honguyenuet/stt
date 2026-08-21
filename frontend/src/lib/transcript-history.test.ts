import { describe, expect, it } from "vitest";
import { canOpenTranscriptEditor } from "./transcript-history";

describe("transcript history editing", () => {
  it("opens a completed transcript even when its text is empty", () => {
    expect(
      canOpenTranscriptEditor({ status: "completed", text: "" }),
    ).toBe(true);
  });

  it("keeps generated text editable even when the job status is not completed", () => {
    expect(
      canOpenTranscriptEditor({ status: "failed", text: "Nội dung đã tạo" }),
    ).toBe(true);
  });

  it("keeps unfinished items without text in the status view", () => {
    expect(canOpenTranscriptEditor({ status: "processing", text: "  " })).toBe(
      false,
    );
  });
});
