import { describe, expect, it } from "vitest";
import {
  normalizeEstimatedRemainingSeconds,
  tickEstimatedRemainingSeconds,
} from "./job-progress";

describe("job progress countdown", () => {
  it("decreases a positive estimate every second", () => {
    expect(tickEstimatedRemainingSeconds(9_960)).toBe(9_959);
  });

  it("keeps an active estimate at one second instead of becoming zero", () => {
    expect(tickEstimatedRemainingSeconds(1)).toBe(1);
  });

  it("ignores missing and invalid estimates", () => {
    expect(tickEstimatedRemainingSeconds(null)).toBeNull();
    expect(normalizeEstimatedRemainingSeconds(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeEstimatedRemainingSeconds(0)).toBeNull();
  });

  it("rounds provider estimates up to whole seconds", () => {
    expect(normalizeEstimatedRemainingSeconds(15.2)).toBe(16);
  });
});
