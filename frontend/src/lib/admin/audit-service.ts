import { adminRequest, buildQuery } from "./api-client";
import type { AuditLog, ListAuditLogsParams, PaginatedResponse } from "./types";

function auditQuery(params: ListAuditLogsParams) {
  return buildQuery({
    page: params.page,
    limit: params.limit,
    search: params.search,
    action: params.action,
    actor: params.actor,
    targetType: params.targetType,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });
}

export function listAuditLogs(params: ListAuditLogsParams) {
  return adminRequest<PaginatedResponse<AuditLog>>(
    `/api/admin/audit-logs${auditQuery(params)}`,
  );
}

export function exportAuditLogsCsv(params: ListAuditLogsParams) {
  return adminRequest<{ filename: string; content: string }>(
    `/api/admin/audit-logs/export${auditQuery(params)}`,
  );
}
