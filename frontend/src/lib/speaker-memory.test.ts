import { describe, expect, it } from "vitest";
import {
  applyRememberedSpeakerLabels,
  rememberSpeakerLabel,
  renameRememberedSpeakerLabel,
} from "./speaker-memory";

describe("speaker memory", () => {
  it("remembers a cleaned label and applies it to later transcripts", () => {
    const memory = rememberSpeakerLabel({}, "speaker 0", "  Lan  ");
    expect(memory).toEqual({ "speaker 0": "Lan" });
    expect(
      applyRememberedSpeakerLabels(
        [
          { text: "Xin", speaker: "speaker 0" },
          { text: "chào", speaker: "speaker 1" },
        ],
        memory,
      ),
    ).toEqual([
      { text: "Xin", speaker: "Lan" },
      { text: "chào", speaker: "speaker 1" },
    ]);
  });

  it("ignores unsafe or empty aliases and caps stored entries", () => {
    expect(rememberSpeakerLabel({}, "speaker 0", "<script>")).toEqual({});
    const crowded = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`speaker ${index}`, `Tên ${index}`]),
    );
    expect(Object.keys(rememberSpeakerLabel(crowded, "speaker 101", "Lan"))).toHaveLength(100);
  });

  it("updates the original speaker key when a remembered name is renamed", () => {
    expect(
      renameRememberedSpeakerLabel(
        { "speaker 0": "Lan" },
        "Lan",
        "Lan Nguyễn",
      ),
    ).toEqual({ "speaker 0": "Lan Nguyễn" });
  });
});
