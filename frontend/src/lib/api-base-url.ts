const LOCAL_BACKEND_URL = "http://localhost:3001";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

type ResolveApiBaseUrlOptions = {
  envApiUrl?: string;
  hostname?: string;
};

function normalizeUrl(url: string | undefined) {
  const value = url?.trim();
  return value ? value.replace(/\/+$/, "") : undefined;
}

function getCurrentHostname() {
  return typeof window === "undefined" ? undefined : window.location.hostname;
}

export function resolveApiBaseUrl({
  envApiUrl,
  hostname,
}: ResolveApiBaseUrlOptions) {
  if (hostname && LOCAL_HOSTNAMES.has(hostname)) return LOCAL_BACKEND_URL;
  return normalizeUrl(envApiUrl) ?? LOCAL_BACKEND_URL;
}

export function getApiBaseUrl() {
  return resolveApiBaseUrl({
    envApiUrl: import.meta.env.VITE_API_URL as string | undefined,
    hostname: getCurrentHostname(),
  });
}

export function getAdminApiBaseUrl() {
  return resolveApiBaseUrl({
    envApiUrl:
      (import.meta.env.VITE_ADMIN_API_URL as string | undefined) ??
      (import.meta.env.VITE_API_URL as string | undefined),
    hostname: getCurrentHostname(),
  });
}
