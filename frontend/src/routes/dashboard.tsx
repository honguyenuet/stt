import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, useRef } from "react";
import type { ComponentType } from "react";
import {
  AudioLines,
  AlertCircle,
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  Clock,
  Download,
  Eye,
  EyeOff,
  FileAudio,
  Folder,
  FolderPlus,
  Gift,
  Heart,
  Home,
  KeyRound,
  Languages,
  MessageCircle,
  Mic,
  MonitorSmartphone,
  Radio,
  RefreshCw,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  Upload,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PhilosophyQuoteCard } from "@/components/philosophy-quote-card";
import { VbeeAccountUsageCard } from "@/components/vbee-preferences-layout";
import {
  formatMediaDuration as formatDuration,
  sumMediaDurations,
} from "@/lib/format-duration";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

const SPARKLES = [
  { top: "6%", left: "18%", delay: 0, size: "h-1.5 w-1.5" },
  { top: "11%", left: "78%", delay: 0.7, size: "h-1 w-1" },
  { top: "30%", left: "94%", delay: 1.3, size: "h-1 w-1" },
  { top: "45%", left: "1%", delay: 0.4, size: "h-2 w-2" },
  { top: "60%", left: "96%", delay: 1.8, size: "h-1 w-1" },
  { top: "72%", left: "5%", delay: 0.9, size: "h-1.5 w-1.5" },
  { top: "84%", left: "88%", delay: 1.5, size: "h-1 w-1" },
  { top: "90%", left: "35%", delay: 0.2, size: "h-2 w-2" },
  { top: "3%", left: "55%", delay: 1.1, size: "h-1 w-1" },
  { top: "50%", left: "2%", delay: 0.6, size: "h-1 w-1" },
];

interface HistoryItem {
  id: number;
  filename: string;
  duration: number | null;
  text: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress?: number;
  error_message?: string | null;
  translation_error?: string | null;
  created_at: string;
}

interface AuthSession {
  id: string;
  current: boolean;
  deviceName: string;
  browserName: string;
  osName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

type ActionDialogState = {
  title: string;
  description: string;
  ctaLabel?: string;
  to?: string;
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user, isLoading, token, updateUser, logout } = useAuth();
  const navigate = useNavigate();

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyRetryKey, setHistoryRetryKey] = useState(0);

  useEffect(() => {
    if (!user || !token) return;
    let active = true;
    const loadHistory = async () => {
      try {
        const response = await fetch(`${API_URL}/api/transcribe/history`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const body = (await response.json().catch(() => [])) as
          | HistoryItem[]
          | { error?: string };
        if (!response.ok || !Array.isArray(body)) {
          throw new Error(
            !Array.isArray(body) && body.error
              ? body.error
              : "Không tải được lịch sử chuyển đổi",
          );
        }
        if (active) {
          setHistory(body.slice(0, 3));
          setHistoryError("");
        }
      } catch (error) {
        if (active) {
          setHistoryError(
            error instanceof Error
              ? error.message
              : "Không tải được lịch sử chuyển đổi",
          );
        }
      }
    };
    void loadHistory();
    const interval = window.setInterval(() => void loadHistory(), 8_000);
    window.addEventListener("focus", loadHistory);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", loadHistory);
    };
  }, [historyRetryKey, user, token]);

  // ── Edit profile state ──────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "" });
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    next: false,
    confirm: false,
  });
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [sessionActionId, setSessionActionId] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("Dự án mới");
  const [activeFolder, setActiveFolder] = useState("Dự án mới");
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      void navigate({
        to: "/login",
        search: { error: undefined, from: "/dashboard" },
      });
    }
  }, [user, isLoading, navigate]);

  useEffect(() => {
    if (user)
      setEditForm({ firstName: user.firstName, lastName: user.lastName });
  }, [user]);

  const loadSessions = useCallback(async () => {
    if (!token) return;
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const response = await fetch(`${API_URL}/api/auth/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        sessions?: AuthSession[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.sessions)) {
        throw new Error(data.error || "Không tải được danh sách thiết bị");
      }
      setSessions(data.sessions);
    } catch (error) {
      setSessionsError(
        error instanceof Error
          ? error.message
          : "Không tải được danh sách thiết bị",
      );
    } finally {
      setSessionsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!editOpen || !token) return;
    void loadSessions();
  }, [editOpen, loadSessions, token]);

  // ── Handlers ────────────────────────────────────────────────────────

  function openEdit() {
    if (user)
      setEditForm({ firstName: user.firstName, lastName: user.lastName });
    setAvatarPreview(null);
    setProfileError("");
    setProfileSuccess(false);
    setPasswordForm({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setShowPasswords({ current: false, next: false, confirm: false });
    setPasswordError("");
    setPasswordSuccess("");
    setSessionsError("");
    setSessionActionId("");
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setAvatarPreview(null);
    setProfileError("");
    setProfileSuccess(false);
    setPasswordForm({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setPasswordError("");
    setPasswordSuccess("");
    setSessionsError("");
    setSessionActionId("");
  }

  async function revokeSession(sessionId: string) {
    if (!token) return;
    setSessionActionId(sessionId);
    setSessionsError("");
    try {
      const response = await fetch(`${API_URL}/api/auth/sessions/${sessionId}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        revokedCurrent?: boolean;
      };
      if (!response.ok) throw new Error(data.error || "Không thu hồi được phiên");
      if (data.revokedCurrent) {
        logout();
        window.location.href = "/login";
        return;
      }
      await loadSessions();
    } catch (error) {
      setSessionsError(
        error instanceof Error ? error.message : "Không thu hồi được phiên",
      );
    } finally {
      setSessionActionId("");
    }
  }

  async function revokeOtherSessions() {
    if (!token) return;
    setSessionActionId("others");
    setSessionsError("");
    try {
      const response = await fetch(`${API_URL}/api/auth/sessions/revoke-others`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Không thu hồi được thiết bị khác");
      await loadSessions();
    } catch (error) {
      setSessionsError(
        error instanceof Error
          ? error.message
          : "Không thu hồi được thiết bị khác",
      );
    } finally {
      setSessionActionId("");
    }
  }

  function resizeImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const SIZE = 256;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d")!;
        const min = Math.min(img.width, img.height);
        ctx.drawImage(
          img,
          (img.width - min) / 2,
          (img.height - min) / 2,
          min,
          min,
          0,
          0,
          SIZE,
          SIZE,
        );
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function handleAvatarFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileError("Vui lòng chọn file ảnh hợp lệ");
      return;
    }
    setProfileError("");
    setIsSavingAvatar(true);
    try {
      const base64 = await resizeImage(file);
      setAvatarPreview(base64);
      const res = await fetch(`${API_URL}/api/auth/avatar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ avatar: base64 }),
      });
      const data = (await res.json()) as { avatar?: string; error?: string };
      if (!res.ok) {
        setProfileError(data.error ?? "Lỗi khi lưu ảnh");
        return;
      }
      updateUser({ avatar: data.avatar ?? null });
    } catch {
      setProfileError("Có lỗi xảy ra khi tải ảnh lên");
    } finally {
      setIsSavingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSaveProfile() {
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) {
      setProfileError("Vui lòng điền đầy đủ họ và tên");
      return;
    }
    setProfileError("");
    setProfileSuccess(false);
    setIsSavingProfile(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          firstName: editForm.firstName.trim(),
          lastName: editForm.lastName.trim(),
        }),
      });
      const data = (await res.json()) as {
        firstName?: string;
        lastName?: string;
        error?: string;
      };
      if (!res.ok) {
        setProfileError(data.error ?? "Lưu thất bại");
        return;
      }
      updateUser({ firstName: data.firstName, lastName: data.lastName });
      setProfileSuccess(true);
      setTimeout(() => {
        setProfileSuccess(false);
        closeEdit();
      }, 1200);
    } catch {
      setProfileError("Có lỗi xảy ra. Vui lòng thử lại.");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    if (!token) return;
    const { currentPassword, newPassword, confirmPassword } = passwordForm;
    setPasswordError("");
    setPasswordSuccess("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("Vui lòng nhập đầy đủ ba ô mật khẩu");
      return;
    }
    if (newPassword.length < 12) {
      setPasswordError("Mật khẩu mới phải có ít nhất 12 ký tự");
      return;
    }
    if (newPassword.length > 128) {
      setPasswordError("Mật khẩu mới không được vượt quá 128 ký tự");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Xác nhận mật khẩu mới chưa khớp");
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordError("Mật khẩu mới phải khác mật khẩu hiện tại");
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/change-password`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setPasswordError(data.error ?? "Không đổi được mật khẩu");
        return;
      }

      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setPasswordSuccess(
        data.message ?? "Đổi mật khẩu thành công. Vui lòng đăng nhập lại.",
      );
      window.setTimeout(() => {
        logout();
        window.location.href = "/login";
      }, 1400);
    } catch {
      setPasswordError("Không kết nối được máy chủ. Vui lòng thử lại.");
    } finally {
      setIsChangingPassword(false);
    }
  }

  function handleCreateFolder() {
    const name = folderName.trim();
    if (!name) return;
    setActiveFolder(name);
    setFolderOpen(false);
    setFolderName("Dự án mới");
  }

  function openFeature(label: string) {
    const normalized = label.toLowerCase();
    if (
      normalized.includes("transcription") ||
      normalized.includes("chuyển giọng nói")
    ) {
      void navigate({ to: "/transcription-settings" });
      return;
    }
    if (normalized.includes("dictionary") || normalized.includes("từ điển")) {
      void navigate({ to: "/custom-dictionary" });
      return;
    }
    if (normalized.includes("upload") || normalized.includes("tải lên")) {
      void navigate({ to: "/upload" });
      return;
    }
    if (
      normalized.includes("zoom") ||
      normalized.includes("teams") ||
      normalized.includes("zapier")
    ) {
      setActionDialog({
        title: label,
        description:
          "Phần tích hợp này sẽ dùng API key và webhook. Mở trang API để tạo key, test endpoint và chuẩn bị tích hợp giống Sonix.",
        ctaLabel: "Mở trang API",
        to: "/api",
      });
      return;
    }
    if (normalized.includes("analysis") || normalized.includes("phân tích")) {
      setActionDialog({
        title: label,
        description:
          "Phân tích AI sẽ dùng bản chép lời đã tạo để tóm tắt, trích ý chính và tìm chủ đề. Trước mắt bạn có thể mở lịch sử để chọn bản chép lời cần phân tích.",
        ctaLabel: "Mở lịch sử",
        to: "/history",
      });
      return;
    }
    if (
      normalized.includes("help") ||
      normalized.includes("video") ||
      normalized.includes("hỗ trợ")
    ) {
      setActionDialog({
        title: label,
        description:
          "Bạn có thể dùng trang ghi âm để mở bảng trợ giúp, hoặc quay lại tải file hoặc ghi âm để bắt đầu.",
        ctaLabel: "Mở ghi âm",
        to: "/record",
      });
      return;
    }
    setActionDialog({
      title: label,
      description:
        "Thiết lập này đã có điểm bấm và sẽ được nối sâu hơn khi có màn cấu hình riêng.",
    });
  }

  // ── Loading ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <span className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-muted-foreground text-sm">
            Đang xử lý đăng nhập...
          </p>
        </div>
      </div>
    );
  }
  if (!user) return null;

  const initials =
    `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background font-sans text-foreground antialiased">
      {/* ── Nền ──────────────────────────────────────────────────────── */}
      <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
      <div className="absolute top-[8%]  left-[5%]   h-80 w-80 rounded-full bg-primary/15 blur-3xl animate-float pointer-events-none" />
      <div
        className="absolute bottom-[5%] right-[4%] h-64 w-64 rounded-full bg-primary/10 blur-3xl animate-float pointer-events-none"
        style={{ animationDelay: "1.6s" }}
      />
      <div
        className="absolute top-[50%] left-[65%]  h-48 w-48 rounded-full bg-primary/20 blur-2xl animate-float pointer-events-none"
        style={{ animationDelay: "0.8s" }}
      />
      {SPARKLES.map((s, i) => (
        <span
          key={i}
          className={`absolute ${s.size} rounded-full bg-primary animate-twinkle pointer-events-none`}
          style={{ top: s.top, left: s.left, animationDelay: `${s.delay}s` }}
        />
      ))}

      <AuthenticatedHeader onEditProfile={openEdit} />

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <main className="relative z-10 mx-auto grid max-w-7xl gap-6 px-4 py-8 md:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          <div className="mb-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-black text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  Không gian làm việc sẵn sàng
                </div>
                <div className="flex items-center gap-3">
                  <Heart className="h-10 w-10 text-[#ffcb05]" />
                  <h1 className="text-2xl font-light tracking-tight text-foreground md:text-3xl">
                    Chào mừng, {user.firstName}
                  </h1>
                </div>
              </div>
              <Link
                to="/history"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-2 text-sm font-bold text-muted-foreground transition hover:border-primary/50 hover:text-primary"
              >
                Xem lịch sử
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <Link
              to="/"
              className="mb-3 flex items-center justify-center rounded-md border border-border bg-card/75 px-4 py-2 text-sm font-bold text-foreground/85 shadow-soft transition hover:border-primary/45 hover:bg-primary/5 hover:text-primary"
            >
              <Home className="mr-2 h-4 w-4 text-primary" />
              Trang chủ
            </Link>

            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Link
                to="/upload"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90"
              >
                <Upload className="h-4 w-4" />
                TẢI FILE
              </Link>
              <button
                onClick={() => setFolderOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card/70 px-5 py-3 text-sm font-black text-foreground transition hover:border-primary/50 hover:text-primary"
              >
                <FolderPlus className="h-4 w-4" />
                THƯ MỤC MỚI
              </button>
              <Link
                to="/record"
                className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-border bg-card/70 text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                title="Ghi âm nhanh"
              >
                <Mic className="h-4 w-4" />
              </Link>
              <Link
                to="/realtime"
                className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-border bg-white text-[#756894] shadow-sm transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                title="Realtime"
              >
                <Radio className="h-4 w-4" />
              </Link>
            </div>

            <CustomerJourneyPanel />
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card/75 shadow-soft">
            <div className="border-b border-border bg-background/35 px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">
                    DỰ ÁN
                  </p>
                  <div className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Folder className="h-4 w-4 text-primary" />
                    {activeFolder}
                  </div>
                </div>
                <div className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  {history.length} tệp
                </div>
              </div>
            </div>

            {historyError && (
              <div className="m-5 flex flex-col gap-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {historyError}
                </span>
                <button
                  type="button"
                  onClick={() => setHistoryRetryKey((value) => value + 1)}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-destructive/30 bg-white px-4 py-2 text-xs font-bold"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Thử lại
                </button>
              </div>
            )}

            {!historyError && history.length === 0 ? (
              <div className="m-5 rounded-2xl border border-dashed border-border bg-background/35 p-8 text-center">
                <UploadCloud className="mx-auto h-12 w-12 text-primary" />
                <h2 className="mt-4 text-xl font-black">
                  Chưa có file transcript
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  Bắt đầu giống Sonix: tải file, ghi âm trực tiếp, rồi mọi bản
                  transcript sẽ xuất hiện trong workspace này.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <Link
                    to="/upload"
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-black text-primary-foreground shadow-glow"
                  >
                    <Upload className="h-4 w-4" />
                    Tải file đầu tiên
                  </Link>
                  <Link
                    to="/record"
                    className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-3 text-sm font-black transition hover:border-primary/50 hover:text-primary"
                  >
                    <Mic className="h-4 w-4" />
                    Ghi âm ngay
                  </Link>
                </div>
              </div>
            ) : !historyError ? (
              history.map((item) => (
                <WorkspaceFileRow key={item.id} item={item} />
              ))
            ) : null}

            <div className="border-t border-border bg-background/35 px-5 py-4 text-center text-sm font-black text-primary">
              {history.length} tệp,{" "}
              {formatDuration(
                sumMediaDurations(history.map((item) => item.duration)),
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              [
                Languages,
                "54+ ngôn ngữ",
                "Chuyển giọng nói và dịch nhiều ngôn ngữ",
              ],
              [
                AudioLines,
                "Mốc thời gian từng từ",
                "Đánh dấu theo từng từ khi phát âm thanh",
              ],
              [
                Radio,
                "Chuyển giọng nói trực tiếp",
                "Nói trực tiếp và lưu bản chép lời vào lịch sử",
              ],
              [
                Download,
                "Xuất nhanh",
                "DOCX, âm thanh và bản chép lời đã chỉnh sửa",
              ],
            ].map(([Icon, title, desc]) => (
              <div
                key={String(title)}
                className="rounded-2xl border border-border bg-card/70 p-5 shadow-soft"
              >
                <Icon className="mb-3 h-5 w-5 text-primary" />
                <h3 className="font-black">{String(title)}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {String(desc)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-5 lg:pt-28">
          <VbeeAccountUsageCard
            firstName={user.firstName}
            showReferral={false}
          />

          <div className="rounded-2xl border border-border bg-card/85 p-6 shadow-soft">
            <DashboardSideSection
              title="TÙY CHỈNH"
              items={[
                [Settings, "Cài đặt chuyển giọng nói"],
                [BookOpen, "Từ điển riêng"],
                [UploadCloud, "Cài đặt tải lên"],
              ]}
              onAction={openFeature}
            />
            <DashboardSideSection
              title="PHÂN TÍCH AI"
              items={[[SlidersHorizontal, "Cài đặt phân tích AI"]]}
              onAction={openFeature}
            />
            <DashboardSideSection
              title="TÍCH HỢP"
              items={[
                [FileAudio, "Tích hợp Zoom"],
                [Mic, "Tích hợp Microsoft Teams"],
                [Zap, "Tự động hóa Zapier"],
              ]}
              onAction={openFeature}
            />
            <DashboardSideSection
              title="HỖ TRỢ"
              items={[
                [BookOpen, "Video hướng dẫn"],
                [MessageCircle, "Trung tâm hỗ trợ"],
              ]}
              onAction={openFeature}
            />

            <Link
              to="/referral"
              className="mt-5 flex w-full items-center rounded-xl border border-[#e5dfef] bg-[#fbf8ef] p-4 text-left transition hover:border-[#ffcb05] hover:bg-[#fff8d7]"
            >
              <div className="flex items-center gap-3">
                <Gift className="h-8 w-8 text-[#21104a]" />
                <p className="text-sm font-black leading-5 text-[#21104a]">
                  GIỚI THIỆU BẠN BÈ
                  <br />
                  NHẬN 100 PHÚT MIỄN PHÍ
                </p>
              </div>
            </Link>
          </div>

          <PhilosophyQuoteCard />
        </aside>
      </main>

      {/* ── Edit Profile Dialog ──────────────────────────────────────── */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleAvatarFileChange(e)}
      />

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open && !isChangingPassword) closeEdit();
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-card border-border text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">
              Chỉnh sửa thông tin
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-5 py-2">
            {/* Avatar */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative">
                {(avatarPreview ?? user.avatar) ? (
                  <img
                    src={avatarPreview ?? user.avatar!}
                    alt="avatar"
                    className="h-20 w-20 rounded-full object-cover shadow-glow ring-2 ring-primary/40"
                  />
                ) : (
                  <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-primary text-2xl font-bold text-primary-foreground shadow-glow select-none">
                    {initials}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSavingAvatar}
                  className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-card border border-border hover:bg-primary/10 transition disabled:opacity-50"
                  title="Thay ảnh đại diện"
                >
                  {isSavingAvatar ? (
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5 text-primary" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {isSavingAvatar
                  ? "Đang lưu ảnh..."
                  : "Nhấn biểu tượng camera để thay ảnh"}
              </p>
            </div>

            {profileError && (
              <div className="flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                <X className="h-4 w-4 shrink-0" />
                {profileError}
              </div>
            )}
            {profileSuccess && (
              <div className="flex items-center gap-2 rounded-xl bg-primary/10 border border-primary/20 px-3 py-2 text-sm text-primary">
                <Check className="h-4 w-4 shrink-0" />
                Đã lưu thành công!
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Tên
                </label>
                <input
                  value={editForm.firstName}
                  onChange={(e) => {
                    setEditForm((p) => ({ ...p, firstName: e.target.value }));
                    setProfileError("");
                  }}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  placeholder="Tên"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Họ
                </label>
                <input
                  value={editForm.lastName}
                  onChange={(e) => {
                    setEditForm((p) => ({ ...p, lastName: e.target.value }));
                    setProfileError("");
                  }}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  placeholder="Họ"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Email
              </label>
              <input
                value={user.email}
                disabled
                className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
              />
              <p className="text-xs text-muted-foreground/60">
                Email liên kết với tài khoản, không thể thay đổi
              </p>
            </div>

            <section className="border-t border-border pt-4">
              <div className="mb-3 flex items-start gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#fff8d7] text-[#21104a]">
                  <KeyRound className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    Đổi mật khẩu
                  </h3>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    Mật khẩu mới cần ít nhất 12 ký tự. Sau khi đổi, bạn sẽ đăng
                    nhập lại trên các thiết bị.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="current-password"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Mật khẩu hiện tại
                  </label>
                  <div className="relative">
                    <input
                      id="current-password"
                      type={showPasswords.current ? "text" : "password"}
                      autoComplete="current-password"
                      value={passwordForm.currentPassword}
                      onChange={(event) => {
                        setPasswordForm((previous) => ({
                          ...previous,
                          currentPassword: event.target.value,
                        }));
                        setPasswordError("");
                        setPasswordSuccess("");
                      }}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowPasswords((previous) => ({
                          ...previous,
                          current: !previous.current,
                        }))
                      }
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition hover:text-foreground"
                      aria-label={
                        showPasswords.current
                          ? "Ẩn mật khẩu hiện tại"
                          : "Hiện mật khẩu hiện tại"
                      }
                    >
                      {showPasswords.current ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="new-password"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Mật khẩu mới
                    </label>
                    <div className="relative">
                      <input
                        id="new-password"
                        type={showPasswords.next ? "text" : "password"}
                        autoComplete="new-password"
                        value={passwordForm.newPassword}
                        onChange={(event) => {
                          setPasswordForm((previous) => ({
                            ...previous,
                            newPassword: event.target.value,
                          }));
                          setPasswordError("");
                          setPasswordSuccess("");
                        }}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowPasswords((previous) => ({
                            ...previous,
                            next: !previous.next,
                          }))
                        }
                        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition hover:text-foreground"
                        aria-label={
                          showPasswords.next
                            ? "Ẩn mật khẩu mới"
                            : "Hiện mật khẩu mới"
                        }
                      >
                        {showPasswords.next ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="confirm-password"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Xác nhận mật khẩu
                    </label>
                    <div className="relative">
                      <input
                        id="confirm-password"
                        type={showPasswords.confirm ? "text" : "password"}
                        autoComplete="new-password"
                        value={passwordForm.confirmPassword}
                        onChange={(event) => {
                          setPasswordForm((previous) => ({
                            ...previous,
                            confirmPassword: event.target.value,
                          }));
                          setPasswordError("");
                          setPasswordSuccess("");
                        }}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowPasswords((previous) => ({
                            ...previous,
                            confirm: !previous.confirm,
                          }))
                        }
                        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition hover:text-foreground"
                        aria-label={
                          showPasswords.confirm
                            ? "Ẩn mật khẩu xác nhận"
                            : "Hiện mật khẩu xác nhận"
                        }
                      >
                        {showPasswords.confirm ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {passwordError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
                  >
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {passwordError}
                  </div>
                )}
                {passwordSuccess && (
                  <div
                    role="status"
                    className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs leading-5 text-primary"
                  >
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {passwordSuccess}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleChangePassword()}
                  disabled={isChangingPassword || Boolean(passwordSuccess)}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-[#e8decc] bg-[#fff8d7] py-2.5 text-sm font-bold text-[#21104a] transition hover:border-[#ffcb05] hover:bg-[#ffefad] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isChangingPassword ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#21104a]/25 border-t-[#21104a]" />
                      Đang đổi mật khẩu...
                    </>
                  ) : (
                    <>
                      <KeyRound className="h-4 w-4" />
                      Cập nhật mật khẩu
                    </>
                  )}
                </button>
              </div>
            </section>

            <section className="border-t border-border pt-4">
              <div className="mb-3 flex items-start gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f7f4ff] text-[#21104a]">
                  <MonitorSmartphone className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-foreground">
                    Thiết bị đăng nhập
                  </h3>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    Quản lý các phiên đang hoạt động và thu hồi thiết bị không còn dùng.
                  </p>
                </div>
              </div>

              <div className="mb-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void loadSessions()}
                  disabled={sessionsLoading || Boolean(sessionActionId)}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-bold text-foreground transition hover:bg-background disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${sessionsLoading ? "animate-spin" : ""}`} />
                  Làm mới
                </button>
                <button
                  type="button"
                  onClick={() => void revokeOtherSessions()}
                  disabled={sessionsLoading || Boolean(sessionActionId)}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[#e8decc] bg-[#fff8d7] px-3 py-2 text-xs font-bold text-[#21104a] transition hover:bg-[#ffefad] disabled:opacity-60"
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Thu hồi thiết bị khác
                </button>
              </div>

              {sessionsError && (
                <div
                  role="alert"
                  className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
                >
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {sessionsError}
                </div>
              )}

              <div className="space-y-2">
                {sessionsLoading && sessions.length === 0 ? (
                  <div className="rounded-lg border border-border bg-background px-3 py-3 text-xs font-semibold text-muted-foreground">
                    Đang tải danh sách thiết bị...
                  </div>
                ) : (
                  sessions.map((session) => (
                    <div
                      key={session.id}
                      className="rounded-lg border border-border bg-background px-3 py-3"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#21104a]">
                          <MonitorSmartphone className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-bold text-foreground">
                              {session.deviceName}
                            </p>
                            {session.current && (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-black text-green-700">
                                Hiện tại
                              </span>
                            )}
                            {session.revokedAt && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-black text-muted-foreground">
                                Đã thu hồi
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {session.browserName} trên {session.osName}
                          </p>
                          <p className="text-xs leading-5 text-muted-foreground/70">
                            Hoạt động: {formatDateTime(session.lastSeenAt)}
                          </p>
                        </div>
                        {!session.revokedAt && (
                          <button
                            type="button"
                            onClick={() => void revokeSession(session.id)}
                            disabled={Boolean(sessionActionId)}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            aria-label={
                              session.current
                                ? "Thu hồi phiên hiện tại"
                                : "Thu hồi phiên đăng nhập"
                            }
                          >
                            {sessionActionId === session.id ? (
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <div className="flex gap-3 pt-1">
              <button
                onClick={closeEdit}
                disabled={isSavingProfile || isChangingPassword}
                className="flex-1 rounded-full border border-border py-2.5 text-sm font-medium text-foreground hover:bg-card transition disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={() => void handleSaveProfile()}
                disabled={
                  isSavingProfile || isSavingAvatar || isChangingPassword
                }
                className="flex-1 flex items-center justify-center gap-2 rounded-full bg-gradient-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90 transition disabled:opacity-60"
              >
                {isSavingProfile ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin" />
                    Đang lưu...
                  </>
                ) : (
                  "Lưu thay đổi"
                )}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo folder mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Folder sẽ được hiển thị trong workspace hiện tại để bạn tổ chức
              transcript giống Sonix.
            </p>
            <input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
              placeholder="Tên folder"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setFolderOpen(false)}
                className="flex-1 rounded-full border border-border px-4 py-2.5 text-sm font-bold transition hover:bg-background"
              >
                Hủy
              </button>
              <button
                onClick={handleCreateFolder}
                className="flex-1 rounded-full bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90"
              >
                Tạo folder
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(actionDialog)}
        onOpenChange={(open) => {
          if (!open) setActionDialog(null);
        }}
      >
        <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{actionDialog?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              {actionDialog?.description}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setActionDialog(null)}
                className="flex-1 rounded-full border border-border px-4 py-2.5 text-sm font-bold transition hover:bg-background"
              >
                Đóng
              </button>
              {actionDialog?.ctaLabel && actionDialog.to && (
                <button
                  onClick={() => {
                    const to = actionDialog.to;
                    setActionDialog(null);
                    if (to) void navigate({ to });
                  }}
                  className="flex-1 rounded-full bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90"
                >
                  {actionDialog.ctaLabel}
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CustomerJourneyPanel() {
  const steps = [
    {
      icon: UploadCloud,
      step: "01",
      title: "Tạo bản chép lời",
      desc: "Tải file âm thanh, video hoặc ghi âm trực tiếp để bắt đầu.",
      cta: "Tải file",
      to: "/upload",
    },
    {
      icon: Radio,
      step: "02",
      title: "Nói trực tiếp",
      desc: "Dùng khi cần ghi nhanh cuộc họp, ý tưởng hoặc phỏng vấn đang diễn ra.",
      cta: "Mở ghi âm trực tiếp",
      to: "/realtime",
    },
    {
      icon: Languages,
      step: "03",
      title: "Sửa, dịch, xuất tệp",
      desc: "Mở bản chép lời đã tạo để sao chép, tải DOCX/TXT và xem bản dịch.",
      cta: "Xem lịch sử",
      to: "/history",
    },
    {
      icon: Clock,
      step: "04",
      title: "Theo dõi hạn mức",
      desc: "Khi gần hết thời gian sử dụng, chọn gói phù hợp để tiếp tục xử lý.",
      cta: "Xem gói cước",
      to: "/pricing",
    },
  ] as const;

  return (
    <div className="mt-5 rounded-2xl border border-border bg-card/75 p-4 shadow-soft">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">
            Luồng khách hàng
          </p>
          <h2 className="mt-1 text-xl font-black text-foreground">
            Bắt đầu, xử lý, xuất file và quay lại lịch sử trong một đường đi
          </h2>
        </div>
        <span className="w-fit rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-black text-primary">
          Luồng Vbee
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.step}
              to={item.to}
              className="group rounded-2xl border border-border bg-background/35 p-4 transition hover:-translate-y-0.5 hover:border-primary/55 hover:bg-primary/10"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-primary">
                  {item.step}
                </span>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow">
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <h3 className="mt-4 text-base font-black text-foreground">
                {item.title}
              </h3>
              <p className="mt-2 min-h-[3rem] text-sm leading-6 text-muted-foreground">
                {item.desc}
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-black text-primary">
                {item.cta}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function WorkspaceFileRow({ item }: { item: HistoryItem }) {
  const Icon = item.filename.startsWith("recording.") ? Mic : AudioLines;
  const isActive = item.status === "queued" || item.status === "processing";
  const isFailed = item.status === "failed";
  const isCancelled = item.status === "cancelled";
  const statusLabel =
    item.status === "queued"
      ? "Đang chờ"
      : item.status === "processing"
        ? "Đang xử lý"
        : isFailed
          ? "Lỗi"
          : isCancelled
            ? "Đã hủy"
            : "Đã chuyển thành văn bản";

  return (
    <Link
      to="/history"
      className="block border-t border-border px-5 py-5 transition hover:bg-primary/5"
    >
      <div className="grid gap-y-4 text-sm sm:grid-cols-[130px_minmax(0,1fr)]">
        <p className="font-black text-muted-foreground">Tên tệp</p>
        <span className="flex min-w-0 items-center gap-2 font-semibold text-primary">
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.filename}</span>
        </span>

        <p className="font-black text-muted-foreground">Trạng thái</p>
        <div>
          <span
            className={`inline-flex w-fit min-w-36 items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-black ${
              isFailed || isCancelled
                ? "bg-destructive/15 text-destructive"
                : isActive
                  ? "bg-primary/10 text-primary"
                  : "bg-emerald-500 text-white"
            }`}
          >
            {isActive ? (
              <span className="h-3.5 w-3.5 rounded-full border-2 border-primary/35 border-t-primary animate-spin" />
            ) : isFailed || isCancelled ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {statusLabel}
          </span>
          {isFailed && (
            <p className="mt-2 text-xs font-semibold leading-5 text-destructive">
              {item.error_message || "Job xử lý thất bại"}
            </p>
          )}
          {!isFailed && item.translation_error && (
            <p className="mt-2 text-xs font-semibold leading-5 text-destructive">
              Transcript đã hoàn thành nhưng bản dịch bị lỗi:{" "}
              {item.translation_error}
            </p>
          )}
        </div>

        <p className="font-black text-muted-foreground">Thời lượng</p>
        <p className="font-semibold">{formatDuration(item.duration)}</p>

        <p className="font-black text-muted-foreground">Ngày tạo</p>
        <p className="font-semibold">{formatDate(item.created_at)}</p>
      </div>
    </Link>
  );
}

function DashboardSideSection({
  title,
  items,
  onAction,
}: {
  title: string;
  items: Array<[ComponentType<{ className?: string }>, string]>;
  onAction: (label: string) => void;
}) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-sm font-black text-primary">{title}</h3>
      <div className="overflow-hidden rounded-xl border border-border">
        {items.map(([Icon, label]) => (
          <button
            key={label}
            onClick={() => onAction(label)}
            className="flex w-full items-center gap-3 border-b border-border bg-background/35 px-4 py-3 text-left text-sm font-semibold text-muted-foreground transition last:border-b-0 hover:bg-primary/10 hover:text-primary"
          >
            <Icon className="h-4 w-4 text-primary" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
