import type { AdminSession, PaginatedResponse } from "./types";
import { getAdminApiBaseUrl } from "../api-base-url";

const ADMIN_SESSION_KEY = "vbee_admin_session";
const API_URL = getAdminApiBaseUrl();

export class AdminApiError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

export function getAdminSession() {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AdminSession;
    if (!session.token || session.expiresAt < Date.now()) {
      clearAdminSession();
      return null;
    }
    return session;
  } catch {
    clearAdminSession();
    return null;
  }
}

export function saveAdminSession(session: AdminSession) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

export function clearAdminSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

export function buildQuery(
  params: Record<string, string | number | undefined>,
) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  const value = query.toString();
  return value ? `?${value}` : "";
}

export async function adminRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const session = getAdminSession();
  if (!session) throw new AdminApiError("Phiên admin đã hết hạn", 401);

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    if (res.status === 401) clearAdminSession();
    throw new AdminApiError(
      data.error || "Admin API request failed",
      res.status,
    );
  }
  return data;
}

export async function adminBlobRequest(path: string): Promise<Blob> {
  const session = getAdminSession();
  if (!session) throw new AdminApiError("Phiên admin đã hết hạn", 401);

  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) clearAdminSession();
    throw new AdminApiError(
      data.error || "Không tải được nội dung tệp",
      res.status,
    );
  }
  return res.blob();
}

export async function adminPublicRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok)
    throw new AdminApiError(
      data.error || "Admin API request failed",
      res.status,
    );
  return data;
}

export function paginate<T>(
  rows: T[],
  page: number,
  limit: number,
): PaginatedResponse<T> {
  const safePage = Math.max(1, page);
  const safeLimit = Math.max(1, limit);
  const total = rows.length;
  const total_pages = Math.max(1, Math.ceil(total / safeLimit));
  const start = (safePage - 1) * safeLimit;
  return {
    data: rows.slice(start, start + safeLimit),
    page: safePage,
    limit: safeLimit,
    total,
    total_pages,
  };
}

export function includesText(value: string | null | undefined, search = "") {
  return String(value || "")
    .toLowerCase()
    .includes(search.trim().toLowerCase());
}
