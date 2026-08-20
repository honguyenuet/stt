import { describe, expect, it } from "vitest";
import { getRealtimeRecoveryPlan } from "./realtime-recovery";

describe("realtime recovery policy", () => {
  it("uses capped exponential backoff for recoverable interruptions", () => {
    expect(getRealtimeRecoveryPlan({ attempt: 0, error: "network", isOnline: true })).toEqual({
      action: "retry",
      delayMs: 500,
    });
    expect(getRealtimeRecoveryPlan({ attempt: 9, error: "network", isOnline: true })).toEqual({
      action: "retry",
      delayMs: 8_000,
    });
  });

  it("waits while offline and stops for microphone permission failures", () => {
    expect(getRealtimeRecoveryPlan({ attempt: 2, error: "network", isOnline: false })).toEqual({
      action: "wait-online",
      delayMs: 0,
    });
    expect(getRealtimeRecoveryPlan({ attempt: 0, error: "not-allowed", isOnline: true })).toEqual({
      action: "stop",
      delayMs: 0,
    });
  });
});
