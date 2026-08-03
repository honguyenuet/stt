import {
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

export function logoutAdmin() {
  clearAdminSession();
}

export function readAdminSession() {
  return getAdminSession();
}

export function canMutate(role: AdminRole) {
  return role === "admin";
}

export function canManageSettings(role: AdminRole) {
  return role === "admin";
}

export function canReplySupport(role: AdminRole) {
  return role === "admin" || role === "support";
}
