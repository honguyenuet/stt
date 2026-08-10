import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
  Pager,
} from "@/components/admin/admin-ui";
import { auditActionLabel, formatDateTime } from "@/lib/admin/formatters";
import { listAuditLogs } from "@/lib/admin/audit-service";
import type {
  AuditAction,
  AuditLog,
  PaginatedResponse,
} from "@/lib/admin/types";

export const Route = createFileRoute("/admin/audit-logs")({
  component: AdminAuditLogsPage,
});

const actions: Array<AuditAction | "all"> = [
  "all",
  "user.suspend",
  "user.activate",
  "user.role_update",
  "quota.adjust",
  "transcription.retry",
  "transcription.cancel",
  "file.delete",
  "settings.update",
  "support.reply",
  "support.status_update",
];

function AdminAuditLogsPage() {
  const [rows, setRows] = useState<PaginatedResponse<AuditLog> | null>(null);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<AuditAction | "all">("all");
  const [actor, setActor] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    setError("");
    void listAuditLogs({ page, limit: 8, search, action, actor })
      .then(setRows)
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Không tải được nhật ký kiểm toán",
        ),
      )
      .finally(() => setLoading(false));
  }

  useEffect(load, [page, search, action, actor]);

  return (
    <AdminPanel>
      <AdminPanelHeader
        title="Nhật ký kiểm toán"
        description="Chỉ đọc, không sửa hoặc xóa."
      />
      <div className="grid gap-3 p-4 md:grid-cols-4">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm hành động hoặc đối tượng"
          className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
        />
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value as AuditAction | "all");
            setPage(1);
          }}
          className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
        >
          {actions.map((item) => (
            <option key={item} value={item}>
              {item === "all" ? "Tất cả hành động" : auditActionLabel[item]}
            </option>
          ))}
        </select>
        <input
          value={actor}
          onChange={(e) => {
            setActor(e.target.value);
            setPage(1);
          }}
          placeholder="Người thực hiện"
          className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
        />
        <button
          onClick={load}
          className="rounded-md bg-[#21104a] px-3 py-2 text-sm font-black text-white"
        >
          Tải lại
        </button>
      </div>
      <PageState
        loading={loading}
        error={error}
        empty={!rows?.data.length}
        onRetry={load}
      >
        <div className="divide-y divide-[#efe7d8]">
          {rows?.data.map((log) => (
            <div
              key={log.id}
              className="grid gap-3 p-4 xl:grid-cols-[220px_180px_1fr]"
            >
              <div>
                <p className="font-black">{log.actor}</p>
                <p className="text-sm text-[#756894]">
                  {formatDateTime(log.created_at)}
                </p>
              </div>
              <div>
                <p className="text-sm font-black">
                  {auditActionLabel[log.action]}
                </p>
                <p className="font-mono text-xs">
                  {log.target_type}:{log.target_id}
                </p>
              </div>
              <pre className="overflow-auto rounded-md bg-[#fbf8ef] p-3 text-xs">
                {JSON.stringify(log.details, null, 2)}
              </pre>
            </div>
          ))}
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
  );
}
