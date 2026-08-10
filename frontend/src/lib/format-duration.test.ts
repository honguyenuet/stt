import { describe, expect, it } from "vitest";
import {
  formatMediaDuration,
  normalizeMediaDuration,
  sumMediaDurations,
} from "./format-duration";

describe("media duration utilities", () => {
  it("normalizes valid numeric and string durations", () => {
    expect(normalizeMediaDuration(61.4)).toBe(61);
    expect(normalizeMediaDuration("3600")).toBe(3600);
  });

  it("rejects invalid and unreasonable durations", () => {
    expect(normalizeMediaDuration(null)).toBeNull();
    expect(normalizeMediaDuration(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeMediaDuration(32 * 24 * 60 * 60)).toBeNull();
  });

  it("sums only valid media durations as a number", () => {
    expect(sumMediaDurations([60, "120", null, undefined, "invalid"])).toBe(
      180,
    );
  });

  it("formats long durations without overflowing scientific notation", () => {
    expect(formatMediaDuration(2 * 3600 + 46 * 60)).toBe("2 giờ 46 phút");
  });
});
