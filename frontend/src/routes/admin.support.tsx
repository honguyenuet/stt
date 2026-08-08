import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
  Pager,
} from "@/components/admin/admin-ui";
import { canReplySupport, canUpdateSupportStatus } from "@/lib/admin/admin-auth";
import { formatDateTime } from "@/lib/admin/formatters";
import {
  getSupportMessages,
  listSupportTickets,
  replySupportTicket,
  updateSupportTicketStatus,
} from "@/lib/admin/support-service";
import { useAdminSession } from "@/lib/admin/use-admin-session";
import type {
  AdminSupportMessage,
  AdminSupportTicket,
  PaginatedResponse,
  SupportTicketStatus,
} from "@/lib/admin/types";

export const Route = createFileRoute("/admin/support")({
  component: AdminSupportPage,
});

const statuses: Array<SupportTicketStatus | "all"> = [
  "all",
  "open",
  "pending",
  "resolved",
  "closed",
];
const supportStatuses: SupportTicketStatus[] = [
  "open",
  "pending",
  "resolved",
  "closed",
];

const supportStatusLabel: Record<SupportTicketStatus, string> = {
  open: "Đang mở",
  pending: "Đã phản hồi",
  resolved: "Đã xử lý",
  closed: "Đã đóng",
};

const supportStatusTone: Record<SupportTicketStatus, string> = {
  open: "bg-amber-100 text-amber-900",
  pending: "bg-blue-100 text-blue-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-700",
};

function AdminSupportPage() {
  const session = useAdminSession();
  const mayUpdateStatus = session
    ? canUpdateSupportStatus(session.user.role)
    : false;
  const mayReply = session ? canReplySupport(session.user.role) : false;
  const [rows, setRows] =
    useState<PaginatedResponse<AdminSupportTicket> | null>(null);
  const [messages, setMessages] = useState<AdminSupportMessage[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SupportTicketStatus | "all">("all");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminSupportTicket | null>(null);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadTickets = useCallback(() => {
    setLoading(true);
    setError("");
    void listSupportTickets({ page, limit: 8, search, status, category })
      .then((result) => {
        setRows(result);
        if (
          selected &&
          !result.data.some((ticket) => ticket.id === selected.id)
        ) {
          setSelected(null);
          setMessages([]);
        }
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Không tải được phản hồi hỗ trợ",
        ),
      )
      .finally(() => setLoading(false));
  }, [category, page, search, selected, status]);

  useEffect(loadTickets, [loadTickets]);

  function openTicket(ticket: AdminSupportTicket) {
    setSelected(ticket);
    setReply("");
    setMessageLoading(true);
    void getSupportMessages(ticket.id)
      .then((result) => setMessages(result.messages))
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Không tải được hội thoại",
        ),
      )
      .finally(() => setMessageLoading(false));
  }

  async function handleReply() {
    if (!selected || !reply.trim()) return;
    setSaving(true);
    try {
      const result = await replySupportTicket(selected.id, reply);
      setReply("");
      setSelected(result.ticket);
      setMessages((current) => [...current, result.message]);
      toast.success("Đã gửi phản hồi hỗ trợ");
      loadTickets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không gửi được phản hồi");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(nextStatus: SupportTicketStatus) {
    if (!selected) return;
    setSaving(true);
    try {
      const ticket = await updateSupportTicketStatus(selected.id, nextStatus);
      setSelected(ticket);
      toast.success("Đã cập nhật trạng thái ticket");
      loadTickets();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Không cập nhật được trạng thái",
      );
    } finally {
      setSaving(false);
    }
  }

  const categories = useMemo(() => {
    const values = new Set(rows?.data.map((ticket) => ticket.category) || []);
    return Array.from(values).filter(Boolean).sort();
  }, [rows]);

  return (
    <div className="space-y-5">
      <AdminPanel>
        <AdminPanelHeader
          title="Phản hồi hỗ trợ"
          description="Theo dõi yêu cầu từ mục Hỗ trợ và phản hồi trực tiếp cho người dùng."
          action={
            <button
              onClick={loadTickets}
              className="inline-flex items-center gap-2 rounded-md border border-[#e4ddcf] px-3 py-2 text-sm font-bold"
            >
              <RefreshCw className="h-4 w-4" />
              Tải lại
            </button>
          }
        />
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm chủ đề, email, nội dung"
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as SupportTicketStatus | "all");
              setPage(1);
            }}
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          >
            {statuses.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? "Tất cả trạng thái" : supportStatusLabel[item]}
              </option>
            ))}
          </select>
          <input
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            list="support-categories"
            placeholder="Lọc category"
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          />
          <datalist id="support-categories">
            {categories.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <button
            onClick={() => {
              setSearch("");
              setStatus("all");
              setCategory("");
              setPage(1);
            }}
            className="rounded-md bg-[#21104a] px-3 py-2 text-sm font-black text-white"
          >
            Xóa lọc
          </button>
        </div>
        <PageState
          loading={loading}
          error={error}
          empty={!rows?.data.length}
          onRetry={loadTickets}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-[#fbf8ef] text-xs uppercase text-[#756894]">
                <tr>
                  {[
                    "Chủ đề",
                    "Người gửi",
                    "Category",
                    "Ưu tiên",
                    "Trạng thái",
                    "Tin mới nhất",
                    "Cập nhật",
                    "",
                  ].map((head) => (
                    <th key={head} className="px-4 py-3">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#efe7d8]">
                {rows?.data.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className={
                      selected?.id === ticket.id
                        ? "bg-[#fff7d8]"
                        : "hover:bg-[#fbf8ef]"
                    }
                  >
                    <td className="px-4 py-3">
                      <p className="font-black">{ticket.subject}</p>
                      {ticket.page_url && (
                        <p className="mt-1 max-w-[220px] truncate text-xs text-[#756894]">
                          {ticket.page_url}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold">{ticket.user_name}</p>
                      <p className="text-xs text-[#756894]">
                        {ticket.user_email || "Chưa có email"}
                      </p>
                    </td>
                    <td className="px-4 py-3">{ticket.category}</td>
                    <td className="px-4 py-3">{ticket.priority}</td>
                    <td className="px-4 py-3">
                      <SupportStatusBadge status={ticket.status} />
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      <p className="line-clamp-2 text-[#574875]">
                        {ticket.latest_message || "Chưa có nội dung"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(ticket.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openTicket(ticket)}
                        className="font-black text-[#21104a] underline"
                      >
                        Mở
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows && (
            <Pager
              page={rows.page}
              totalPages={rows.total_pages}
              onPageChange={setPage}
            />
          )}
        </PageState>
      </AdminPanel>

      {selected && (
        <AdminPanel>
          <AdminPanelHeader
            title={selected.subject}
            description={`${selected.user_name} - ${selected.user_email || "chưa có email"}`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selected.status}
                  disabled={!mayUpdateStatus || saving}
                  onChange={(e) =>
                    void handleStatusChange(
                      e.target.value as SupportTicketStatus,
                    )
                  }
                  className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm font-bold disabled:opacity-50"
                >
                  {supportStatuses.map((item) => (
                    <option key={item} value={item}>
                      {supportStatusLabel[item]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    setSelected(null);
                    setMessages([]);
                  }}
                  className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm font-bold"
                >
                  Đóng
                </button>
              </div>
            }
          />
          <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3">
              {messageLoading ? (
                <div className="rounded-md border border-dashed border-[#e4ddcf] p-5 text-sm font-bold text-[#756894]">
                  Đang tải hội thoại...
                </div>
              ) : (
                <div className="max-h-[520px] space-y-3 overflow-y-auto rounded-md border border-[#efe7d8] bg-[#fbf8ef] p-3">
                  {messages.map((item) => (
                    <div
                      key={item.id}
                      className={`flex ${item.sender === "admin" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[78%] rounded-md px-3 py-2 text-sm ${
                          item.sender === "admin"
                            ? "bg-[#21104a] text-white"
                            : "border border-[#e4ddcf] bg-white text-[#21104a]"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{item.message}</p>
                        <p
                          className={`mt-2 text-xs ${
                            item.sender === "admin"
                              ? "text-white/70"
                              : "text-[#756894]"
                          }`}
                        >
                          {item.sender === "admin" ? "CMS" : "Người dùng"} -
                          {formatDateTime(item.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={
                    mayReply
                      ? "Nhập phản hồi hỗ trợ..."
                      : "Tài khoản này chỉ được xem hội thoại"
                  }
                  disabled={!mayReply || saving}
                  className="min-h-32 w-full rounded-md border border-[#e4ddcf] px-3 py-2 text-sm disabled:bg-[#f7f4ec]"
                />
                <button
                  disabled={!mayReply || saving || reply.trim().length < 2}
                  onClick={() => void handleReply()}
                  className="inline-flex items-center gap-2 rounded-md bg-[#21104a] px-4 py-2 text-sm font-black text-white disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                  Gửi phản hồi
                </button>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <InfoRow label="Mã ticket" value={`#${selected.id}`} />
              <InfoRow label="Trạng thái" value={supportStatusLabel[selected.status]} />
              <InfoRow label="Category" value={selected.category} />
              <InfoRow label="Ưu tiên" value={selected.priority} />
              <InfoRow label="Gói" value={selected.user_plan || "Chưa có"} />
              <InfoRow label="Tạo lúc" value={formatDateTime(selected.created_at)} />
              <InfoRow
                label="Cập nhật"
                value={formatDateTime(selected.updated_at)}
              />
              {selected.page_url && (
                <a
                  href={selected.page_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all rounded-md border border-[#e4ddcf] p-3 font-bold text-[#21104a] underline"
                >
                  {selected.page_url}
                </a>
              )}
            </div>
          </div>
        </AdminPanel>
      )}
    </div>
  );
}

function SupportStatusBadge({ status }: { status: SupportTicketStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${supportStatusTone[status]}`}
    >
      {supportStatusLabel[status]}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#efe7d8] bg-[#fbf8ef] p-3">
      <p className="text-xs font-bold uppercase text-[#756894]">{label}</p>
      <p className="mt-1 break-words font-black">{value}</p>
    </div>
  );
}
