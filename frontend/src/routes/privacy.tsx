import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Loader2, Save, ShieldCheck, Trash2 } from "lucide-react";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

type PrivacySettings = {
  mediaRetentionPolicy:
    | "keep_until_deleted"
    | "delete_after_days"
    | "delete_after_transcription";
  mediaRetentionDays: number;
  transcriptRetentionPolicy: "keep_until_deleted" | "delete_after_days";
  transcriptRetentionDays: number;
  allowProductAnalytics: boolean;
  securityPolicyAcknowledgedAt: string | null;
};

const DEFAULT_SETTINGS: PrivacySettings = {
  mediaRetentionPolicy: "keep_until_deleted",
  mediaRetentionDays: 365,
  transcriptRetentionPolicy: "keep_until_deleted",
  transcriptRetentionDays: 365,
  allowProductAnalytics: false,
  securityPolicyAcknowledgedAt: null,
};

export const Route = createFileRoute("/privacy")({ component: PrivacyPage });

function PrivacyPage() {
  const { user, token, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [mediaConfirmation, setMediaConfirmation] = useState("");
  const [accountConfirmation, setAccountConfirmation] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!isLoading && !user) {
      void navigate({ to: "/login", search: { from: "/privacy", error: undefined } });
    }
  }, [isLoading, navigate, user]);

  useEffect(() => {
    if (!token) return;
    let ignore = false;
    void fetch(`${API_URL}/api/settings/privacy`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          privacy?: PrivacySettings;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "Không tải được cài đặt");
        if (!ignore) setSettings(data.privacy || DEFAULT_SETTINGS);
      })
      .catch((cause: unknown) => {
        if (!ignore) setError(cause instanceof Error ? cause.message : "Không tải được cài đặt");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [token]);

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    const data = (await response.json()) as { error?: string; deletedFiles?: number };
    if (!response.ok) throw new Error(data.error || "Yêu cầu thất bại");
    return data;
  }

  async function saveSettings() {
    setBusy("save");
    setError("");
    setMessage("");
    try {
      await request("/api/settings/privacy", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      setMessage("Đã lưu lựa chọn quyền riêng tư");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được cài đặt");
    } finally {
      setBusy("");
    }
  }

  async function exportData() {
    setBusy("export");
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/settings/privacy/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Không thể xuất dữ liệu");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `vbee-data-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Đã tạo bản xuất dữ liệu");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể xuất dữ liệu");
    } finally {
      setBusy("");
    }
  }

  async function deleteMedia() {
    setBusy("media");
    setError("");
    try {
      const result = await request("/api/settings/privacy/media", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: mediaConfirmation }),
      });
      setMediaConfirmation("");
      setMessage(`Đã xóa ${result.deletedFiles || 0} tệp âm thanh; văn bản vẫn được giữ lại`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể xóa âm thanh");
    } finally {
      setBusy("");
    }
  }

  async function deleteAccount() {
    setBusy("account");
    setError("");
    try {
      await request("/api/settings/privacy/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: accountConfirmation, password }),
      });
      logout();
      void navigate({ to: "/", replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể xóa tài khoản");
      setBusy("");
    }
  }

  if (isLoading || loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#f7f7fb] text-[#21104a]">
      <AuthenticatedHeader />
      <main className="mx-auto max-w-4xl px-3 py-5 sm:px-6 sm:py-8">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#ffcb05]"><ShieldCheck className="h-6 w-6" /></span>
          <div><h1 className="text-2xl font-black">Trung tâm quyền riêng tư</h1><p className="text-sm text-muted-foreground">Kiểm soát lưu trữ, tải xuống và xóa dữ liệu của bạn.</p></div>
        </div>

        {(message || error) && <p className={`mb-4 rounded-lg border px-4 py-3 text-sm font-bold ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || message}</p>}

        <section className="space-y-5 rounded-xl border border-border bg-white p-4 sm:p-6">
          <div>
            <label htmlFor="retention" className="text-sm font-black">Thời gian giữ tệp âm thanh</label>
            <p className="mb-2 text-xs text-muted-foreground">Văn bản không bị xóa khi tệp âm thanh hết hạn.</p>
            <select id="retention" value={settings.mediaRetentionPolicy === "keep_until_deleted" ? -1 : settings.mediaRetentionPolicy === "delete_after_transcription" ? 0 : settings.mediaRetentionDays} onChange={(event) => { const days = Number(event.target.value); setSettings((current) => ({ ...current, mediaRetentionPolicy: days < 0 ? "keep_until_deleted" : days === 0 ? "delete_after_transcription" : "delete_after_days", mediaRetentionDays: days > 0 ? days : current.mediaRetentionDays })); }} className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm sm:max-w-xs">
              <option value={-1}>Giữ đến khi tôi tự xóa</option><option value={0}>Xóa ngay sau khi xử lý</option><option value={7}>7 ngày</option><option value={30}>30 ngày</option><option value={90}>90 ngày</option><option value={365}>1 năm</option>
            </select>
          </div>
          <div>
            <label htmlFor="transcript-retention" className="text-sm font-black">Thời gian giữ transcript</label>
            <p className="mb-2 text-xs text-muted-foreground">Chọn thời điểm tự động xóa văn bản đã chuyển đổi.</p>
            <select id="transcript-retention" value={settings.transcriptRetentionPolicy === "keep_until_deleted" ? -1 : settings.transcriptRetentionDays} onChange={(event) => { const days = Number(event.target.value); setSettings((current) => ({ ...current, transcriptRetentionPolicy: days < 0 ? "keep_until_deleted" : "delete_after_days", transcriptRetentionDays: days > 0 ? days : current.transcriptRetentionDays })); }} className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm sm:max-w-xs">
              <option value={-1}>Giữ đến khi tôi tự xóa</option><option value={7}>7 ngày</option><option value={30}>30 ngày</option><option value={90}>90 ngày</option><option value={365}>1 năm</option>
            </select>
          </div>
          <label className="flex items-start gap-3"><input type="checkbox" checked={settings.allowProductAnalytics} onChange={(event) => setSettings((current) => ({ ...current, allowProductAnalytics: event.target.checked }))} className="mt-1 h-4 w-4 accent-[#ffcb05]" /><span><strong className="block text-sm">Cho phép phân tích cải thiện sản phẩm</strong><span className="text-xs text-muted-foreground">Không bao gồm nội dung âm thanh hoặc văn bản.</span></span></label>
          <button type="button" onClick={() => void saveSettings()} disabled={Boolean(busy)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#ffcb05] px-4 text-sm font-black disabled:opacity-50">{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu lựa chọn</button>
        </section>

        <section className="mt-4 rounded-xl border border-border bg-white p-4 sm:p-6">
          <h2 className="font-black">Tải dữ liệu cá nhân</h2><p className="mt-1 text-sm text-muted-foreground">Nhận tệp ZIP gồm cài đặt, thư mục, lịch sử bảo mật và toàn bộ transcript.</p>
          <button type="button" onClick={() => void exportData()} disabled={Boolean(busy)} className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-black"><Download className="h-4 w-4" /> Xuất dữ liệu</button>
        </section>

        <section className="mt-4 rounded-xl border border-red-200 bg-white p-4 sm:p-6">
          <h2 className="font-black text-red-700">Vùng nguy hiểm</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg bg-red-50 p-4"><h3 className="text-sm font-black">Xóa toàn bộ âm thanh</h3><p className="mt-1 text-xs text-red-700">Không thể khôi phục. Transcript vẫn còn.</p><input value={mediaConfirmation} onChange={(event) => setMediaConfirmation(event.target.value)} placeholder="Nhập XOA AM THANH" className="mt-3 h-10 w-full rounded-lg border border-red-200 bg-white px-3 text-sm" /><button type="button" onClick={() => void deleteMedia()} disabled={busy !== "" || mediaConfirmation !== "XOA AM THANH"} className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-xs font-black text-white disabled:opacity-40"><Trash2 className="h-4 w-4" /> Xóa âm thanh</button></div>
            <div className="rounded-lg bg-red-50 p-4"><h3 className="text-sm font-black">Xóa tài khoản</h3><p className="mt-1 text-xs text-red-700">Xóa vĩnh viễn tài khoản, transcript, khóa API và phiên đăng nhập.</p><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mật khẩu (nếu tài khoản có mật khẩu)" className="mt-3 h-10 w-full rounded-lg border border-red-200 bg-white px-3 text-sm" /><input value={accountConfirmation} onChange={(event) => setAccountConfirmation(event.target.value)} placeholder="Nhập XOA TAI KHOAN" className="mt-2 h-10 w-full rounded-lg border border-red-200 bg-white px-3 text-sm" /><button type="button" onClick={() => void deleteAccount()} disabled={busy !== "" || accountConfirmation !== "XOA TAI KHOAN"} className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-xs font-black text-white disabled:opacity-40"><Trash2 className="h-4 w-4" /> Xóa tài khoản</button></div>
          </div>
        </section>
      </main>
    </div>
  );
}
