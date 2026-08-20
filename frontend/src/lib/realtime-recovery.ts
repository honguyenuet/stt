type RecoveryAction = "retry" | "wait-online" | "stop";

const FATAL_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "language-not-supported",
]);

export function getRealtimeRecoveryPlan({
  attempt,
  error,
  isOnline,
}: {
  attempt: number;
  error?: string | null;
  isOnline: boolean;
}): { action: RecoveryAction; delayMs: number } {
  if (FATAL_ERRORS.has(String(error || "").toLowerCase())) {
    return { action: "stop", delayMs: 0 };
  }
  if (!isOnline) return { action: "wait-online", delayMs: 0 };
  const safeAttempt = Math.max(0, Math.floor(Number(attempt) || 0));
  return {
    action: "retry",
    delayMs: Math.min(8_000, 500 * 2 ** safeAttempt),
  };
}
