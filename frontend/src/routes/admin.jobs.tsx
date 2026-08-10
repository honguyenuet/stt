import { createFileRoute } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
  Pager,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { canMutate } from "@/lib/admin/admin-auth";
import { useAdminSession } from "@/lib/admin/use-admin-session";
import { formatDateTime, formatDuration, jobStatusLabel } from "@/lib/admin/formatters";
import { ADMIN_JOB_REFRESH_MS } from "@/lib/admin/realtime";
import {
  cancelTranscriptionJob,
  listTranscriptionJobs,
  retryTranscriptionJob,
} from "@/lib/admin/transcriptions-service";
import type {
  JobStatus,
  PaginatedResponse,
  TranscriptionJob,
} from "@/lib/admin/types";

export const Route = createFileRoute("/admin/jobs")({
  component: AdminJobsPage,
});

const statuses: Array<JobStatus | "all"> = [
  "all",
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
];
const languages = ["all", "vi", "en", "ja", "ko", "zh"];

function AdminJobsPage() {
  const session = useAdminSession();
  const [rows, setRows] = useState<PaginatedResponse<TranscriptionJob> | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [language, setLanguage] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TranscriptionJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    (showLoading = true) => {
      if (showLoading) setLoading(true);
      if (showLoading) setError("");
      void listTranscriptionJobs({ page, limit: 5, search, status, language })
        .then(setRows)
        .catch((err) =>
          setError(err instanceof Error ? err.message : "Không tải được tác vụ"),
        )
        .finally(() => {
          if (showLoading) setLoading(false);
        });
    },
    [language, page, search, status],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => load(false), ADMIN_JOB_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!selected || !rows) return;
    const nextSelected = rows.data.find(
      (job) => job.job_id === selected.job_id,
    );
    if (nextSelected && nextSelected.status !== selected.status) {
      setSelected(nextSelected);
    }
  }, [rows, selected]);

  async function mutate(
    action: () => Promise<TranscriptionJob>,
    success: string,
  ) {
    try {
      const job = await action();
      setSelected(job);
      toast.success(success);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Thao tác thất bại");
    }
  }

  const mayMutate = session ? canMutate(session.user.role) : false;

  return (
    <div className="space-y-5">
      <AdminPanel>
        <AdminPanelHeader
          title="Tác vụ chuyển giọng nói"
          description="Tìm theo mã tác vụ, tên tệp hoặc thư điện tử người dùng."
        />
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm tác vụ, tệp hoặc thư điện tử"
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as JobStatus | "all");
              setPage(1);
            }}
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          >
            {statuses.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? "Tất cả trạng thái" : jobStatusLabel[item]}
              </option>
            ))}
          </select>
          <select
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          >
            {languages.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? "Tất cả ngôn ngữ" : item}
              </option>
            ))}
          </select>
          <button
            onClick={() => load()}
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-[#fbf8ef] text-xs uppercase text-[#756894]">
                <tr>
                  {[
                    "Mã tác vụ",
                    "Người dùng",
                    "Tệp",
                    "Ngôn ngữ",
                    "Thời lượng",
                    "Trạng thái",
                    "Attempt",
                    "Tiến độ",
                    "Xử lý",
                    "Ngày tạo",
                    "Hoàn tất",
                    "",
                  ].map((head) => (
                    <th key={head} className="px-4 py-3">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#efe7d8]">
                {rows?.data.map((job) => (
                  <tr key={job.job_id} className="hover:bg-[#fbf8ef]">
                    <td className="px-4 py-3 font-mono text-xs">
                      {job.job_id}
                    </td>
                    <td className="px-4 py-3">{job.user_email}</td>
                    <td className="px-4 py-3 font-bold">{job.file_name}</td>
                    <td className="px-4 py-3">{job.language}</td>
                    <td className="px-4 py-3">
                      {formatDuration(job.duration)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.status} />
                      {job.dead_lettered && (
                        <span className="mt-1 block rounded-md bg-red-50 px-2 py-1 text-xs font-black text-red-700">
                          DLQ
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {job.max_attempts ? `${job.attempts || 0}/${job.max_attempts}` : "-"}
                    </td>
                    <td className="px-4 py-3">
                      {typeof job.progress === "number" ? `${job.progress}%` : "-"}
                    </td>
                    <td className="px-4 py-3">
                      {formatDuration(job.processing_time)}
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(job.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(job.completed_at)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelected(job)}
                        className="font-black underline"
                      >
                        Chi tiết
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
            title={`Chi tiết tác vụ: ${selected.job_id}`}
            action={
              <button
                onClick={() => setSelected(null)}
                className="rounded-md border px-3 py-2 text-sm font-bold"
              >
                Đóng
              </button>
            }
          />
          <div className="grid gap-5 p-4 xl:grid-cols-2">
            <div className="space-y-2 text-sm">
              <p>
                <b>Tệp:</b> {selected.file_name}
              </p>
              <p>
                <b>Người dùng:</b> {selected.user_name} ({selected.user_email})
              </p>
              <p>
                <b>Trạng thái:</b> <StatusBadge status={selected.status} />
              </p>
              {selected.error_message && (
                <p className="rounded-md bg-red-50 p-3 text-red-800">
                  <b>Lỗi:</b> {selected.error_message}
                </p>
              )}
              {selected.dead_lettered && (
                <p className="rounded-md bg-red-50 p-3 text-red-800">
                  <b>Dead-letter:</b>{" "}
                  {selected.dead_letter_reason || "Job đã hết lượt retry tự động."}
                </p>
              )}
              <div className="grid gap-2 rounded-md bg-[#fbf8ef] p-3 text-xs text-[#756894] sm:grid-cols-2">
                <span>
                  <b>Queue ID:</b> {selected.queue_job_id || "-"}
                </span>
                <span>
                  <b>Stage:</b> {selected.progress_stage || "-"}
                </span>
                <span>
                  <b>Attempt:</b>{" "}
                  {selected.max_attempts
                    ? `${selected.attempts || 0}/${selected.max_attempts}`
                    : "-"}
                </span>
                <span>
                  <b>Retry kế tiếp:</b>{" "}
                  {selected.next_retry_at
                    ? formatDateTime(selected.next_retry_at)
                    : "-"}
                </span>
                <span>
                  <b>Timeout:</b>{" "}
                  {selected.timeout_seconds
                    ? formatDuration(selected.timeout_seconds)
                    : "-"}
                </span>
                <span>
                  <b>Recovered:</b>{" "}
                  {selected.recovered_at
                    ? formatDateTime(selected.recovered_at)
                    : "-"}
                </span>
              </div>
              <pre className="max-h-64 overflow-auto rounded-md bg-[#fbf8ef] p-3 text-xs">
                {selected.transcript || "Chưa có kết quả văn bản."}
              </pre>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(selected.job_id);
                  toast.success("Đã sao chép mã tác vụ");
                }}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold"
              >
                <Copy className="h-4 w-4" /> Sao chép mã tác vụ
              </button>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={!mayMutate || selected.status !== "failed"}
                  onClick={() =>
                    void mutate(
                      () => retryTranscriptionJob(selected.job_id),
                      "Đã đưa tác vụ vào hàng chờ",
                    )
                  }
                  className="rounded-md bg-[#21104a] px-3 py-2 text-sm font-black text-white disabled:opacity-40"
                >
                  Chạy lại tác vụ lỗi
                </button>
                <button
                  disabled={
                    !mayMutate ||
                    (selected.status !== "queued" &&
                      selected.status !== "processing")
                  }
                  onClick={() =>
                    void mutate(
                      () => cancelTranscriptionJob(selected.job_id),
                      "Đã hủy tác vụ",
                    )
                  }
                  className="rounded-md border border-red-200 px-3 py-2 text-sm font-black text-red-700 disabled:opacity-40"
                >
                  Hủy tác vụ
                </button>
              </div>
              <p className="text-sm text-[#756894]">
                Không cho chạy lại tác vụ đã hoàn tất. Chỉ có thể hủy tác vụ
                đang chờ hoặc đang xử lý nếu máy chủ hỗ trợ.
              </p>
            </div>
          </div>
        </AdminPanel>
      )}
    </div>
  );
}
