import {
  adminRequest,
  adminPublicRequest,
  clearAdminSession,
  getAdminSession,
  saveAdminSession,
} from "./api-client";
import type { AdminRole, AdminSession } from "./types";

export async function loginAdmin(email: string, password: string) {
  const session = await adminPublicRequest<AdminSession>(
    "/api/admin/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), password }),
    },
  );
  saveAdminSession(session);
  return session;
}

export async function exchangeAdminSession(authToken: string) {
  const session = await adminPublicRequest<AdminSession>(
    "/api/admin/auth/exchange",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    },
  );
  saveAdminSession(session);
  return session;
}

export async function validateAdminSession() {
  return adminRequest<{ user: AdminSession["user"] }>("/api/admin/auth/me");
}

export function logoutAdmin() {
  clearAdminSession();
}

export function readAdminSession() {
  return getAdminSession();
}

export function canMutate(role: AdminRole) {
  return role === "admin" || role === "super_admin";
}

export function canManageSettings(role: AdminRole) {
  return role === "super_admin";
}
