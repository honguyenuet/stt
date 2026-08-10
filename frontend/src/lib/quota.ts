import { getApiBaseUrl } from "./api-base-url";

const API_URL = getApiBaseUrl();

export type PlanCode = "free" | "standard" | "special" | "business";
export type BillingCycle = "monthly" | "yearly";

export interface QuotaStatus {
  userId?: number;
  plan: PlanCode;
  label: string;
  baseQuotaSeconds: number;
  quotaSeconds: number;
  topUpGrantedSeconds: number;
  topUpRemainingSeconds: number;
  topUpNextExpiry?: string | null;
  usedSeconds: number;
  remainingSeconds: number;
  percentUsed: number;
  alertSeconds: number;
  maxAlertSeconds: number;
  planStartedAt?: string | null;
  planExpiresAt?: string | null;
  cancelAtPeriodEnd: boolean;
  cancellationRequestedAt?: string | null;
  shouldAlert: boolean;
  isLimitReached: boolean;
  limits: {
    maxUploadMb: number;
    maxRecordSeconds: number;
    maxFileSeconds: number;
    maxConcurrentJobs?: number | null;
    transcriptLimit?: number | null;
    retentionDays?: number;
    webhookAccess?: boolean;
    apiAccess?: boolean;
    supportedFormats?: string[];
  };
}

const PLAN_LABELS: Record<PlanCode, string> = {
  free: "Miễn phí",
  standard: "Tiêu chuẩn",
  special: "Đặc biệt",
  business: "Chuyên nghiệp",
};

export function formatPlanLabel(plan: PlanCode) {
  return PLAN_LABELS[plan];
}

export function formatQuotaTime(seconds?: number | null) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export async function fetchQuota(token: string): Promise<QuotaStatus> {
  const res = await fetch(`${API_URL}/api/quota`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as QuotaStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || "Không tải được quota");
  return data;
}

export async function saveQuotaAlert(token: string, alertMinutes: number) {
  const res = await fetch(`${API_URL}/api/quota/alert`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ alertMinutes }),
  });
  const data = (await res.json()) as QuotaStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || "Không lưu được cảnh báo");
  return data;
}

export async function upgradeQuota(
  token: string,
  plan: PlanCode = "special",
  billingCycle: BillingCycle = "monthly",
) {
  const res = await fetch(`${API_URL}/api/quota/upgrade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ plan, billingCycle }),
  });
  const data = (await res.json()) as QuotaStatus & { error?: string };
  if (!res.ok) throw new Error(data.error || "Không nâng cấp được gói");
  return data;
}
