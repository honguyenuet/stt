import { getApiBaseUrl } from "./api-base-url";

const API_URL = getApiBaseUrl();

export interface SupportTicket {
  id: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  email: string | null;
  name: string | null;
  pageUrl: string | null;
  userPlan: string | null;
  latestMessage: string;
  adminMessageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessage {
  id: number;
  ticketId: number;
  sender: "user" | "admin";
  message: string;
  createdAt: string;
}

export interface CreateSupportTicketPayload {
  subject: string;
  category: string;
  message: string;
  email?: string;
  name?: string;
  pageUrl?: string;
  priority?: string;
  metadata?: Record<string, unknown>;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Không thể kết nối hỗ trợ Vbee");
  return data;
}

function authHeaders(token?: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchSupportTickets(token: string) {
  const res = await fetch(`${API_URL}/api/support/tickets`, {
    headers: authHeaders(token),
  });
  return readJson<{ tickets: SupportTicket[] }>(res);
}

export async function createSupportTicket(
  token: string | null,
  payload: CreateSupportTicketPayload,
) {
  const res = await fetch(`${API_URL}/api/support/tickets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  });
  return readJson<{ ticket: SupportTicket }>(res);
}

export async function fetchSupportMessages(token: string, ticketId: number) {
  const res = await fetch(`${API_URL}/api/support/tickets/${ticketId}/messages`, {
    headers: authHeaders(token),
  });
  return readJson<{ messages: SupportMessage[] }>(res);
}

export async function replySupportTicket(
  token: string,
  ticketId: number,
  message: string,
) {
  const res = await fetch(`${API_URL}/api/support/tickets/${ticketId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ message }),
  });
  return readJson<{ message: SupportMessage }>(res);
}
