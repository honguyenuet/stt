import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Files,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { fetchDashboardSummary } from "@/lib/admin/dashboard-service";
import { formatDuration, formatMinutes } from "@/lib/admin/formatters";
import { ADMIN_SUMMARY_REFRESH_MS } from "@/lib/admin/realtime";
import type { DashboardSummary } from "@/lib/admin/types";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboardPage,
});

function AdminDashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load(showLoading = true) {
    if (showLoading) setLoading(true);
    if (showLoading) setError("");
    void fetchDashboardSummary()
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Lỗi không xác định"),
      )
      .finally(() => {
        if (showLoading) setLoading(false);
      });
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(
      () => load(false),
      ADMIN_SUMMARY_REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <PageState loading={loading} error={error} empty={!data} onRetry={load}>
      {data && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric
              icon={<Users className="h-5 w-5" />}
              label="Người dùng"
              value={data.total_users}
            />
            <Metric
              icon={<Files className="h-5 w-5" />}
              label="Tệp đã tải lên"
              value={data.total_files}
            />
            <Metric
              icon={<CheckCircle2 className="h-5 w-5" />}
              label="Tác vụ"
              value={data.total_jobs}
            />
            <Metric
              icon={<Clock3 className="h-5 w-5" />}
              label="Số phút đã xử lý"
              value={formatMinutes(data.processed_minutes)}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
            <AdminPanel>
              <AdminPanelHeader
                title="Mức sử dụng 7 ngày"
                description="Mức sử dụng web và API theo ngày"
              />
              <div className="flex h-72 items-end gap-3 px-5 py-4">
                {data.usage.map((point) => {
                  const total = point.web_minutes + point.api_minutes;
                  return (
                    <div
                      key={point.date}
                      className="flex flex-1 flex-col items-center gap-2"
                    >
                      <div className="flex h-56 w-full items-end rounded-md bg-slate-100 px-2">
                        <div
                          className="w-full rounded-t-md bg-indigo-600"
                          style={{ height: `${Math.min(100, total / 2)}%` }}
                          title={`${total} phút`}
                        />
                      </div>
                      <span className="text-xs font-bold text-slate-500">
                        {point.date.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </AdminPanel>

            <AdminPanel>
              <AdminPanelHeader
                title="Tình trạng tác vụ"
                description="Tỷ lệ xử lý và trạng thái"
              />
              <div className="space-y-4 px-5 py-4">
                <div className="grid grid-cols-2 gap-3">
                  <Metric
                    label="Thành công"
                    value={`${data.success_rate}%`}
                    compact
                  />
                  <Metric
                    label="Thất bại"
                    value={`${data.failure_rate}%`}
                    compact
                    icon={<AlertTriangle className="h-4 w-4" />}
                  />
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                  Thời gian xử lý TB:{" "}
                  {formatDuration(data.average_processing_time)}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(data.jobs_by_status).map(
                    ([status, count]) => (
                      <div
                        key={status}
                        className="rounded-md border border-slate-200 p-3"
                      >
                        <StatusBadge
                          status={status as keyof typeof data.jobs_by_status}
                        />
                        <p className="mt-2 text-xl font-black">{count}</p>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </AdminPanel>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <JobList title="Tác vụ gần nhất" jobs={data.recent_jobs} />
            <JobList title="Tác vụ lỗi gần nhất" jobs={data.recent_failed_jobs} />
          </div>
        </div>
      )}
    </PageState>
  );
}

function Metric({
  icon,
  label,
  value,
  compact = false,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${compact ? "" : "min-h-28"}`}
    >
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-sm font-bold">{label}</span>
        {icon && (
          <span className="grid h-9 w-9 place-items-center rounded-md bg-slate-100 text-slate-600">
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-black tracking-tight text-slate-950">
        {value}
      </p>
    </div>
  );
}

function JobList({
  title,
  jobs,
}: {
  title: string;
  jobs: DashboardSummary["recent_jobs"];
}) {
  return (
    <AdminPanel>
      <AdminPanelHeader title={title} />
      <div className="divide-y divide-slate-200">
        {jobs.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Không có tác vụ.</p>
        ) : (
          jobs.map((job) => (
            <div
              key={job.job_id}
              className="grid gap-2 p-4 md:grid-cols-[1fr_auto] md:items-center"
            >
              <div>
                <p className="font-black text-slate-950">{job.file_name}</p>
                <p className="text-sm text-slate-500">{job.user_email}</p>
              </div>
              <StatusBadge status={job.status} />
            </div>
          ))
        )}
      </div>
    </AdminPanel>
  );
}
