import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
} from "@/components/admin/admin-ui";
import { ADMIN_SUMMARY_REFRESH_MS } from "@/lib/admin/realtime";
import {
  exportReportCsv,
  fetchReportSummary,
  fetchSystemStatus,
} from "@/lib/admin/reports-service";
import type { ReportSummary, SystemStatus } from "@/lib/admin/types";

export const Route = createFileRoute("/admin/reports")({
  component: AdminReportsPage,
});

function AdminReportsPage() {
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load(showLoading = true) {
    if (showLoading) setLoading(true);
    if (showLoading) setError("");
    void Promise.all([fetchReportSummary(), fetchSystemStatus()])
      .then(([nextReport, nextStatus]) => {
        setReport(nextReport);
        setStatus(nextStatus);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Không tải được báo cáo"),
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

  async function download() {
    try {
      const file = await exportReportCsv();
      const blob = new Blob([file.content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Đã xuất báo cáo");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Không xuất được báo cáo",
      );
    }
  }

  return (
    <PageState loading={loading} error={error} empty={!report} onRetry={load}>
      {report && (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="Người dùng" value={report.users.total} />
            <Metric label="Tác vụ" value={report.jobs.total} />
            <Metric
              label="Âm thanh đã xử lý"
              value={`${report.audio.processed_minutes} phút`}
            />
            <Metric
              label="Doanh thu"
              value={`${report.revenue.total_vnd.toLocaleString("vi-VN")} VND`}
            />
            <Metric
              label="Tỷ lệ thành công"
              value={`${report.jobs.success_rate}%`}
            />
            <Metric
              label="Thời lượng đã dùng"
              value={`${report.quota.used_minutes}/${report.quota.allocated_minutes}`}
            />
            <Metric
              label="Xử lý trung bình"
              value={`${report.performance.average_processing_time}s`}
            />
            <Metric
              label="Độ trễ nhà cung cấp"
              value={`${report.performance.average_latency_ms}ms`}
            />
          </div>
          <AdminPanel>
            <AdminPanelHeader
              title="Mức sử dụng 30 ngày"
              action={
                <button
                  onClick={() => void download()}
                  className="rounded-md bg-[#21104a] px-4 py-2 text-sm font-black text-white"
                >
                  Xuất CSV
                </button>
              }
            />
            <div className="flex h-72 items-end gap-1 p-4">
              {report.daily_usage.map((point) => (
                <div
                  key={point.date}
                  className="flex flex-1 flex-col items-center gap-2"
                >
                  <div className="flex h-56 w-full items-end bg-[#fbf8ef]">
                    <div
                      className="w-full bg-[#21104a]"
                      style={{
                        height: `${Math.min(100, point.web_minutes + point.api_minutes)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px]">{point.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </AdminPanel>
          <AdminPanel>
            <AdminPanelHeader
              title="Theo dõi hệ thống"
              description="Cơ sở dữ liệu, máy chủ, trạng thái nhà cung cấp và thời điểm ghi nhận."
            />
            <pre className="overflow-auto p-4 text-xs">
              {JSON.stringify(status, null, 2)}
            </pre>
          </AdminPanel>
        </div>
      )}
    </PageState>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[#e4ddcf] bg-white p-4">
      <p className="text-sm font-bold text-[#756894]">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
