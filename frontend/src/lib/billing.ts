import type { BillingCycle, PlanCode, QuotaStatus } from "@/lib/quota";
import { getApiBaseUrl } from "./api-base-url";

const API_URL = getApiBaseUrl();

export type OrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired";
export type PaidPlanCode = Exclude<PlanCode, "free">;
export type BillingProductType = "subscription" | "top_up";
export type TopUpCode =
  | "topup_1h"
  | "topup_3h"
  | "topup_5h"
  | "topup_10h"
  | "topup_20h"
  | "topup_50h"
  | "topup_100h";

export interface BillingOrder {
  id: string;
  userId: number;
  plan: PlanCode;
  productType: BillingProductType;
  productCode: PaidPlanCode | TopUpCode;
  label: string;
  billingCycle: BillingCycle;
  quotaSeconds: number;
  validDays: number | null;
  amount: number;
  currency: string;
  status: OrderStatus;
  provider: string;
  providerOrderId?: string | null;
  paymentUrl?: string | null;
  paymentCode?: string | null;
  paymentQrCode?: string | null;
  paymentLinkId?: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt?: string | null;
  expiresAt?: string | null;
}

export interface CheckoutResponse {
  order: BillingOrder;
  paymentUrl: string;
}

export interface BillingCatalogPlan {
  code: PlanCode;
  label: string;
  enabled: boolean;
  monthly: { price: number | null; quotaSeconds: number };
  yearly: { price: number | null; quotaSeconds: number };
  limits: {
    maxUploadMb: number;
    maxRecordSeconds: number;
    maxFileSeconds: number;
  };
  queueWeight: number;
  seats: number | null;
  retentionDays: number;
  apiAccess: boolean;
  apiAccessLabel?: string;
  webhookAccess?: boolean;
  maxConcurrentJobs?: number | null;
  transcriptLimit?: number | null;
  rolloverLabel?: string;
  supportLevel?: string;
}

export interface BillingCatalogTopUp {
  code: TopUpCode;
  label: string;
  quotaSeconds: number;
  price: number;
  validDays: number | null;
}

export interface BillingCatalog {
  plans: BillingCatalogPlan[];
  topUps: BillingCatalogTopUp[];
}

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Yêu cầu không thành công");
  return data;
}

export async function fetchBillingCatalog(): Promise<BillingCatalog> {
  const res = await fetch(`${API_URL}/api/billing/plans`, {
    cache: "no-store",
  });
  return readJson<BillingCatalog>(res);
}

export async function createCheckout(
  token: string,
  plan: PaidPlanCode,
  billingCycle: BillingCycle,
): Promise<CheckoutResponse> {
  const res = await fetch(`${API_URL}/api/billing/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      plan,
      billingCycle,
      productType: "subscription",
      productCode: plan,
    }),
  });
  return readJson<CheckoutResponse>(res);
}

export async function createTopUpCheckout(
  token: string,
  productCode: TopUpCode,
): Promise<CheckoutResponse> {
  const res = await fetch(`${API_URL}/api/billing/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ productType: "top_up", productCode }),
  });
  return readJson<CheckoutResponse>(res);
}

export async function fetchBillingOrder(
  token: string,
  orderId: string,
): Promise<BillingOrder> {
  const res = await fetch(`${API_URL}/api/billing/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await readJson<{ order: BillingOrder }>(res);
  return data.order;
}

export async function cancelBillingOrder(
  token: string,
  orderId: string,
): Promise<BillingOrder> {
  const res = await fetch(`${API_URL}/api/billing/orders/${orderId}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await readJson<{ order: BillingOrder }>(res);
  return data.order;
}

async function updateSubscription(
  token: string,
  action: "cancel" | "resume",
): Promise<QuotaStatus> {
  const res = await fetch(`${API_URL}/api/billing/subscription/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await readJson<{ quota: QuotaStatus }>(res);
  return data.quota;
}

export function cancelPlanAtPeriodEnd(token: string) {
  return updateSubscription(token, "cancel");
}

export function resumeCancelledPlan(token: string) {
  return updateSubscription(token, "resume");
}
