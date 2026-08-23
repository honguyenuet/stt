import { describe, expect, it } from "vitest";
import { canEditTranscript, isTranscriptOwner } from "./transcript-access";

describe("transcript project access", () => {
  it("keeps legacy owner responses editable but respects explicit read-only access", () => {
    expect(canEditTranscript(undefined)).toBe(true);
    expect(canEditTranscript(true)).toBe(true);
    expect(canEditTranscript(false)).toBe(false);
  });

  it("compares normalized positive user ids without accepting missing ids", () => {
    expect(isTranscriptOwner("7", 7)).toBe(true);
    expect(isTranscriptOwner(7, 8)).toBe(false);
    expect(isTranscriptOwner(undefined, undefined)).toBe(false);
  });
});
