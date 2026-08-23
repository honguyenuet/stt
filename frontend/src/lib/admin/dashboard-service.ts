import { adminRequest } from "./api-client";
import type { DashboardSummary } from "./types";

export function fetchDashboardSummary() {
  return adminRequest<DashboardSummary>("/api/admin/dashboard");
}

export function cleanupObservabilityLogs(retentionDays?: number) {
  return adminRequest<{
    retentionDays: number;
    deletedRequestLogs: number;
    deletedWebhookDeliveries: number;
    deletedResolvedAlerts: number;
  }>("/api/admin/observability/cleanup", {
    method: "POST",
    body: JSON.stringify({ retentionDays }),
  });
}
