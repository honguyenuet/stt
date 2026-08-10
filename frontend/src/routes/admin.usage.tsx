import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { formatMinutes } from "@/lib/admin/formatters";
import { ADMIN_SUMMARY_REFRESH_MS } from "@/lib/admin/realtime";
import { fetchUsageSummary } from "@/lib/admin/usage-service";
import type { UsageSummary } from "@/lib/admin/types";

export const Route = createFileRoute("/admin/usage")({
  component: AdminUsagePage,
});

function AdminUsagePage() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load(showLoading = true) {
    if (showLoading) setLoading(true);
    if (showLoading) setError("");
    void fetchUsageSummary()
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Không tải được dữ liệu sử dụng"),
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
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-[#e4ddcf] bg-white p-4">
              <p className="text-sm font-bold text-[#756894]">
                Tổng thời lượng đã xử lý
              </p>
              <p className="mt-2 text-3xl font-black">
                {formatMinutes(data.total_processed_minutes)}
              </p>
            </div>
            <div className="rounded-lg border border-[#e4ddcf] bg-white p-4">
              <p className="text-sm font-bold text-[#756894]">Sử dụng web</p>
              <p className="mt-2 text-3xl font-black">
                {formatMinutes(
                  data.daily.reduce((sum, item) => sum + item.web_minutes, 0),
                )}
              </p>
            </div>
            <div className="rounded-lg border border-[#e4ddcf] bg-white p-4">
              <p className="text-sm font-bold text-[#756894]">Sử dụng API</p>
              <p className="mt-2 text-3xl font-black">
                {formatMinutes(
                  data.daily.reduce((sum, item) => sum + item.api_minutes, 0),
                )}
              </p>
            </div>
          </div>
          <AdminPanel>
            <AdminPanelHeader
              title="Mức sử dụng theo ngày"
              description="Chỉ tác vụ hoàn tất mới tính thời lượng; số liệu được tổng hợp từ lịch sử sử dụng thực tế."
            />
            <div className="flex h-72 items-end gap-2 p-4">
              {data.daily.map((point) => (
                <div
                  key={point.date}
                  className="flex flex-1 flex-col items-center gap-2"
                >
                  <div className="flex h-56 w-full items-end bg-[#fbf8ef]">
                    <div
                      className="w-full bg-[#ffcb05]"
                      style={{
                        height: `${Math.min(100, (point.web_minutes + point.api_minutes) / 2)}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs">{point.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </AdminPanel>
          <div className="grid gap-5 xl:grid-cols-2">
            <AdminPanel>
              <AdminPanelHeader title="Mức sử dụng theo người dùng" />
              <div className="divide-y divide-[#efe7d8]">
                {data.by_user.map((user) => (
                  <div
                    key={user.user_id}
                    className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_auto]"
                  >
                    <span>
                      <b>{user.name}</b>
                      <br />
                      {user.email}
                    </span>
                    <span>
                      {formatMinutes(user.used_minutes)} /{" "}
                      {formatMinutes(user.quota_minutes)}
                    </span>
                  </div>
                ))}
              </div>
            </AdminPanel>
            <AdminPanel>
              <AdminPanelHeader title="Người dùng gần hết thời lượng" />
              <div className="divide-y divide-[#efe7d8]">
                {data.low_quota_users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-4 text-sm"
                  >
                    <span>
                      <b>{user.name}</b>
                      <br />
                      Còn{" "}
                      {formatMinutes(user.quota_minutes - user.used_minutes)}
                    </span>
                    <StatusBadge status={user.status} />
                  </div>
                ))}
              </div>
            </AdminPanel>
          </div>
        </div>
      )}
    </PageState>
  );
}
