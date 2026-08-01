import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
} from "@/components/admin/admin-ui";
import { canManageSettings } from "@/lib/admin/admin-auth";
import { fetchSettings, updateSettings } from "@/lib/admin/settings-service";
import type { AdminSettings } from "@/lib/admin/types";
import { useAdminSession } from "@/lib/admin/use-admin-session";

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  const session = useAdminSession();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [formats, setFormats] = useState("");
  const [languages, setLanguages] = useState("");
  const [systemParameters, setSystemParameters] = useState("");
  const [notificationConfig, setNotificationConfig] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    setError("");
    void fetchSettings()
      .then((data) => {
        setSettings(data);
        setFormats(data.supported_formats.join(", "));
        setLanguages(data.supported_languages.join(", "));
        setSystemParameters(
          JSON.stringify(data.system_parameters || {}, null, 2),
        );
        setNotificationConfig(
          JSON.stringify(data.notification_config || {}, null, 2),
        );
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Không tải được cài đặt",
        ),
      )
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function save() {
    if (!settings) return;
    try {
      const parsedSystemParameters = JSON.parse(
        systemParameters || "{}",
      ) as Record<string, string | number | boolean>;
      const parsedNotificationConfig = JSON.parse(
        notificationConfig || "{}",
      ) as Record<string, string | number | boolean>;
      const updated = await updateSettings({
        ...settings,
        supported_formats: formats
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        supported_languages: languages
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        system_parameters: parsedSystemParameters,
        notification_config: parsedNotificationConfig,
      });
      setSettings(updated);
      toast.success("Đã lưu cài đặt");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Không lưu được cài đặt",
      );
    }
  }

  const canEdit = session ? canManageSettings(session.user.role) : false;

  return (
    <PageState loading={loading} error={error} empty={!settings} onRetry={load}>
      {settings && (
        <AdminPanel>
          <AdminPanelHeader
            title="Cài đặt"
            description="Cấu hình toàn cục được đọc và lưu qua backend admin settings API."
          />
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <Field
              label="Giới hạn dung lượng file (MB)"
              value={settings.max_file_size_mb}
              onChange={(value) =>
                setSettings({ ...settings, max_file_size_mb: value })
              }
              disabled={!canEdit}
            />
            <Field
              label="Giới hạn thời lượng file (phút)"
              value={settings.max_file_duration_minutes}
              onChange={(value) =>
                setSettings({ ...settings, max_file_duration_minutes: value })
              }
              disabled={!canEdit}
            />
            <Field
              label="Số lần chạy lại job"
              value={settings.max_retry_attempts}
              onChange={(value) =>
                setSettings({ ...settings, max_retry_attempts: value })
              }
              disabled={!canEdit}
            />
            <Field
              label="Quota mặc định cho người dùng mới (phút)"
              value={settings.default_quota_minutes}
              onChange={(value) =>
                setSettings({ ...settings, default_quota_minutes: value })
              }
              disabled={!canEdit}
            />
            <label className="block text-sm font-bold">
              Chính sách lưu trữ
              <select
                disabled={!canEdit}
                value={settings.storage_policy}
                onChange={(e) =>
                  setSettings({ ...settings, storage_policy: e.target.value })
                }
                className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 disabled:opacity-60"
              >
                <option value="keep_transcripts_and_media">
                  Giữ transcript và media
                </option>
                <option value="delete_media_keep_transcript">
                  Xóa media, giữ transcript
                </option>
                <option value="delete_all_after_retention">
                  Xóa toàn bộ sau thời gian lưu dữ liệu
                </option>
              </select>
            </label>
            <Field
              label="Thời gian lưu dữ liệu (ngày)"
              value={settings.data_retention_days}
              onChange={(value) =>
                setSettings({ ...settings, data_retention_days: value })
              }
              disabled={!canEdit}
            />
            <label className="block text-sm font-bold md:col-span-2">
              Định dạng hỗ trợ
              <input
                disabled={!canEdit}
                value={formats}
                onChange={(e) => setFormats(e.target.value)}
                className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 disabled:opacity-60"
              />
            </label>
            <label className="block text-sm font-bold md:col-span-2">
              Tham số hệ thống JSON
              <textarea
                disabled={!canEdit}
                value={systemParameters}
                onChange={(e) => setSystemParameters(e.target.value)}
                rows={6}
                className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 font-mono text-xs disabled:opacity-60"
              />
              <span className="mt-1 block text-xs font-normal text-[#756894]">
                queue_concurrency là số job xử lý đồng thời;
                queue_retention_ms là thời gian giữ bản ghi job đã kết thúc.
              </span>
            </label>
            <label className="block text-sm font-bold md:col-span-2">
              Cấu hình thông báo JSON
              <textarea
                disabled={!canEdit}
                value={notificationConfig}
                onChange={(e) => setNotificationConfig(e.target.value)}
                rows={6}
                className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 font-mono text-xs disabled:opacity-60"
              />
            </label>
            <label className="block text-sm font-bold md:col-span-2">
              Ngôn ngữ hỗ trợ
              <input
                disabled={!canEdit}
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
                className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 disabled:opacity-60"
              />
            </label>
            <div className="md:col-span-2">
              <button
                disabled={!canEdit}
                onClick={() => void save()}
                className="rounded-md bg-[#21104a] px-4 py-3 text-sm font-black text-white disabled:opacity-40"
              >
                Lưu cài đặt
              </button>
              {!canEdit && (
                <p className="mt-2 text-sm text-[#756894]">
                  Chỉ quản trị cao nhất được cập nhật cài đặt.
                </p>
              )}
            </div>
          </div>
        </AdminPanel>
      )}
    </PageState>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="block text-sm font-bold">
      {label}
      <input
        type="number"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 disabled:opacity-60"
      />
    </label>
  );
}
