export const DEFAULT_AUTH_REDIRECT = "/dashboard";

const AUTH_REDIRECT_ALLOWLIST = new Set([
  "/dashboard",
  "/upload",
  "/record",
  "/realtime",
  "/history",
  "/api",
  "/pricing",
  "/custom-dictionary",
  "/transcription-settings",
  "/admin",
]);

export function getSafeAuthRedirect(from?: string | null) {
  if (!from) return DEFAULT_AUTH_REDIRECT;
  if (!from.startsWith("/") || from.startsWith("//")) {
    return DEFAULT_AUTH_REDIRECT;
  }

  const path = from.split("?")[0].split("#")[0];
  if (path.startsWith("/checkout/")) return from;
  if (AUTH_REDIRECT_ALLOWLIST.has(path)) return from;
  return DEFAULT_AUTH_REDIRECT;
}

export function redirectAfterAuth(from?: string | null) {
  window.location.assign(getSafeAuthRedirect(from));
}
