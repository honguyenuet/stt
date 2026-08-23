import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Files,
  Gauge,
  Server,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import {
  cleanupObservabilityLogs,
  fetchDashboardSummary,
} from "@/lib/admin/dashboard-service";
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

          {data.observability && (
            <OperationalPanel observability={data.observability} />
          )}
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

function OperationalPanel({
  observability,
}: {
  observability: NonNullable<DashboardSummary["observability"]>;
}) {
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [cleanupRunning, setCleanupRunning] = useState(false);

  async function runCleanup() {
    setCleanupRunning(true);
    setCleanupMessage("");
    try {
      const result = await cleanupObservabilityLogs(
        observability.logRetentionDays,
      );
      setCleanupMessage(
        `Đã dọn ${result.deletedRequestLogs} request log, ${result.deletedWebhookDeliveries} webhook delivery, ${result.deletedResolvedAlerts} alert đã resolve.`,
      );
    } catch (error) {
      setCleanupMessage(
        error instanceof Error ? error.message : "Không dọn được log vận hành",
      );
    } finally {
      setCleanupRunning(false);
    }
  }

  return (
    <AdminPanel>
      <AdminPanelHeader
        title="Vận hành hệ thống"
        description="Request id, metrics queue/provider, cảnh báo lỗi và uptime"
      />
      <div className="grid gap-4 p-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 xl:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-black text-slate-950">
              Cảnh báo vận hành
            </p>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-black text-slate-600">
              {observability.alerts.length} active
            </span>
          </div>
          {observability.alerts.length === 0 ? (
            <p className="mt-3 text-sm font-bold text-emerald-700">
              Không có cảnh báo lỗi đang vượt ngưỡng.
            </p>
          ) : (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {observability.alerts.map((alert) => (
                <div
                  key={`${alert.code}-${alert.message}`}
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900"
                >
                  {alert.message}
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
            <p className="text-xs font-bold text-slate-600">
              Retention log vận hành: {observability.logRetentionDays} ngày
            </p>
            <button
              type="button"
              onClick={() => void runCleanup()}
              disabled={cleanupRunning}
              className="rounded-md bg-slate-950 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
            >
              {cleanupRunning ? "Đang dọn..." : "Dọn log cũ"}
            </button>
          </div>
          {cleanupMessage && (
            <p className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
              {cleanupMessage}
            </p>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 xl:col-span-2">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black">
            Alert events
          </div>
          <div className="divide-y divide-slate-200">
            {observability.alertEvents.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                Chưa có lịch sử alert vận hành.
              </p>
            ) : (
              observability.alertEvents.slice(0, 6).map((alert) => (
                <div
                  key={alert.id}
                  className="grid gap-2 p-4 text-xs md:grid-cols-[120px_1fr_auto]"
                >
                  <span
                    className={`w-fit rounded-md px-2 py-1 font-black ${
                      alert.status === "active"
                        ? "bg-red-50 text-red-700"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {alert.status}
                  </span>
                  <div>
                    <p className="font-black text-slate-950">{alert.code}</p>
                    <p className="mt-1 text-slate-600">{alert.message}</p>
                  </div>
                  <span className="font-bold text-slate-500">
                    {new Date(alert.lastSeenAt).toLocaleString("vi-VN")}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Metric
            icon={<Activity className="h-4 w-4" />}
            label="Request 24h"
            value={observability.requests24h.total}
            compact
          />
          <Metric
            icon={<Gauge className="h-4 w-4" />}
            label="P95 latency"
            value={`${observability.requests24h.p95DurationMs}ms`}
            compact
          />
          <Metric
            icon={<AlertTriangle className="h-4 w-4" />}
            label="HTTP 5xx"
            value={observability.requests24h.serverErrors}
            compact
          />
          <Metric
            icon={<Server className="h-4 w-4" />}
            label="Uptime"
            value={formatDuration(observability.uptimeSeconds)}
            compact
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-black text-slate-950">Queue</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <MetricLine label="Queued" value={observability.queue.queued} />
              <MetricLine
                label="Processing"
                value={observability.queue.processing}
              />
              <MetricLine
                label="Failed 24h"
                value={observability.queue.failed24h}
              />
              <MetricLine
                label="Dead letter"
                value={observability.queue.deadLettered}
              />
            </dl>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-black text-slate-950">Process</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <MetricLine label="Host" value={observability.process.host} />
              <MetricLine label="PID" value={observability.process.pid} />
              <MetricLine
                label="RSS"
                value={`${observability.process.memoryRssMb}MB`}
              />
              <MetricLine
                label="Heap"
                value={`${observability.process.memoryHeapUsedMb}MB`}
              />
            </dl>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 xl:col-span-2">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black">
            Provider circuits
          </div>
          <div className="divide-y divide-slate-200">
            {observability.providers.circuits.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                Chưa có circuit provider nào được ghi nhận.
              </p>
            ) : (
              observability.providers.circuits.map((provider) => (
                <div
                  key={provider.provider}
                  className="grid gap-3 p-4 text-sm md:grid-cols-[1fr_auto_auto]"
                >
                  <div>
                    <p className="font-black text-slate-950">
                      {provider.provider}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {provider.last_error_message || "Không có lỗi gần đây"}
                    </p>
                  </div>
                  <span className="rounded-md border border-slate-200 px-2 py-1 text-xs font-black">
                    {provider.state}
                  </span>
                  <span className="text-xs font-bold text-slate-500">
                    OK {provider.total_successes} / lỗi{" "}
                    {provider.total_failures}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 xl:col-span-2">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black">
            Request chậm nhất 24h
          </div>
          <div className="divide-y divide-slate-200">
            {observability.requests24h.slowest.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                Chưa có request log trong 24 giờ qua.
              </p>
            ) : (
              observability.requests24h.slowest.map((request) => (
                <div
                  key={request.requestId}
                  className="grid gap-2 p-4 text-xs md:grid-cols-[120px_1fr_auto]"
                >
                  <code className="font-black text-indigo-700">
                    {request.requestId.slice(0, 12)}
                  </code>
                  <span className="truncate font-bold text-slate-700">
                    {request.method} {request.path}
                  </span>
                  <span className="font-black text-slate-950">
                    {request.statusCode} · {request.durationMs}ms
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AdminPanel>
  );
}

function MetricLine({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="font-bold text-slate-500">{label}</dt>
      <dd className="mt-1 truncate font-black text-slate-950">{value}</dd>
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
