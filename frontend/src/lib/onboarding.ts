import type { User } from "@/context/AuthContext";

const ONBOARDING_PROTECTED_PATHS = new Set([
  "/dashboard",
  "/upload",
  "/record",
  "/realtime",
  "/history",
  "/api",
  "/custom-dictionary",
  "/transcription-settings",
]);

export function needsOnboarding(user: User | null | undefined) {
  return Boolean(user && user.onboardingCompleted === false);
}

export function isOnboardingProtectedPath(pathname: string) {
  return (
    ONBOARDING_PROTECTED_PATHS.has(pathname) ||
    /^\/transcript\/\d+$/.test(pathname) ||
    pathname.startsWith("/checkout/")
  );
}
