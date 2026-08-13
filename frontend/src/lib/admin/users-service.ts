import { adminRequest, buildQuery } from "./api-client";
import type {
  AdminRole,
  AssignableAdminRole,
  AdminUser,
  BillingCycle,
  ListUsersParams,
  ManagedUserPlan,
  PaginatedResponse,
  UserStatus,
} from "./types";

export function listUsers(params: ListUsersParams) {
  return adminRequest<PaginatedResponse<AdminUser>>(
    `/api/admin/users${buildQuery({
      page: params.page,
      limit: params.limit,
      search: params.search,
      role: params.role,
      status: params.status,
    })}`,
  );
}

export function getUserDetail(userId: string) {
  return adminRequest<PaginatedResponse<AdminUser>>(
    `/api/admin/users${buildQuery({ search: userId, page: 1, limit: 1 })}`,
  ).then((result) => result.data[0] ?? null);
}

export function updateUserStatus(
  userId: string,
  status: Exclude<UserStatus, "deleted">,
) {
  return adminRequest<AdminUser>(`/api/admin/users/${userId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function updateUserRole(userId: string, role: AssignableAdminRole) {
  return adminRequest<AdminUser>(`/api/admin/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function adjustUserQuota(
  userId: string,
  deltaMinutes: number,
  reason: string,
) {
  return adminRequest<AdminUser>(`/api/admin/users/${userId}/quota`, {
    method: "POST",
    body: JSON.stringify({ deltaMinutes, reason }),
  });
}

export function updateUserPlan(
  userId: string,
  plan: ManagedUserPlan,
  billingCycle: BillingCycle = "monthly",
) {
  return adminRequest<AdminUser>(`/api/admin/users/${userId}/plan`, {
    method: "PATCH",
    body: JSON.stringify({ plan, billingCycle }),
  });
}

export function deleteUserAccount(userId: string) {
  return adminRequest<AdminUser>(`/api/admin/users/${userId}`, {
    method: "DELETE",
  });
}
