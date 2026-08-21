import { describe, expect, it } from "vitest";
import { compareTranscriptText } from "./transcript-version";

describe("transcript version comparison", () => {
  it("shows the removed and added parts while keeping shared context", () => {
    expect(
      compareTranscriptText(
        "Xin chào cả nhóm. Hôm nay bàn về webhook.",
        "Xin chào mọi người. Hôm nay bàn về webhook.",
      ),
    ).toEqual({
      prefix: "Xin chào ",
      removed: "cả nhóm",
      added: "mọi người",
      suffix: ". Hôm nay bàn về webhook.",
      hasChanges: true,
    });
  });

  it("reports identical content without fabricated changes", () => {
    expect(compareTranscriptText("Không đổi", "Không đổi")).toEqual({
      prefix: "Không đổi",
      removed: "",
      added: "",
      suffix: "",
      hasChanges: false,
    });
  });
});
