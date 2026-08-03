import { adminRequest, buildQuery } from "./api-client";
import type {
  AdminSupportMessage,
  AdminSupportTicket,
  ListSupportTicketsParams,
  PaginatedResponse,
  SupportTicketStatus,
} from "./types";

export function listSupportTickets(params: ListSupportTicketsParams) {
  return adminRequest<PaginatedResponse<AdminSupportTicket>>(
    `/api/admin/support/tickets${buildQuery({
      page: params.page,
      limit: params.limit,
      search: params.search,
      status: params.status,
      category: params.category,
    })}`,
  );
}

export function getSupportMessages(ticketId: string) {
  return adminRequest<{ messages: AdminSupportMessage[] }>(
    `/api/admin/support/tickets/${ticketId}/messages`,
  );
}

export function replySupportTicket(ticketId: string, message: string) {
  return adminRequest<{
    ticket: AdminSupportTicket;
    message: AdminSupportMessage;
  }>(`/api/admin/support/tickets/${ticketId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function updateSupportTicketStatus(
  ticketId: string,
  status: SupportTicketStatus,
) {
  return adminRequest<AdminSupportTicket>(
    `/api/admin/support/tickets/${ticketId}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
  );
}
