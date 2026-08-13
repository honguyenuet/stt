import { adminRequest, buildQuery } from "./api-client";
import type { ReportSummary, SystemStatus } from "./types";

export function fetchReportSummary(params: { dateFrom?: string; dateTo?: string } = {}) {
  return adminRequest<ReportSummary>(
    `/api/admin/reports/summary${buildQuery(params)}`,
  );
}

export function exportReportCsv(params: { dateFrom?: string; dateTo?: string } = {}) {
  return adminRequest<{ filename: string; content: string }>(
    `/api/admin/reports/export${buildQuery(params)}`,
  );
}

export function fetchSystemStatus() {
  return adminRequest<SystemStatus>("/api/admin/system/status");
}
