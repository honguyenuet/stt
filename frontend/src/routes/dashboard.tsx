import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  AudioLines,
  AlertCircle,
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  Database,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Heart,
  KeyRound,
  MessageCircle,
  Mic,
  MonitorSmartphone,
  Radio,
  RefreshCw,
  Settings,
  ShieldAlert,
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
import {
  formatMediaDuration as formatDuration,
  sumMediaDurations,
} from "@/lib/format-duration";
import { getApiBaseUrl } from "@/lib/api-base-url";
import {
  buildDashboardHistoryPath,
  normalizeDashboardFolders,
  selectDashboardFolder,
  type DashboardFolder,
} from "@/lib/dashboard-folders";

const API_URL = getApiBaseUrl();

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

interface DashboardHistoryResponse {
  items: HistoryItem[];
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

type WorkspaceRole = "owner" | "admin" | "member";

interface WorkspaceMember {
  id: number;
  userId: number;
  role: WorkspaceRole;
  status: "active" | "removed";
  name: string;
  email: string;
  avatar: string | null;
  joinedAt: string;
}

interface WorkspaceSummary {
  id: number;
  name: string;
  ownerUserId: number;
  role: WorkspaceRole;
  plan: string;
  quotaSeconds: number;
  quotaAlertSeconds: number;
  planStartedAt?: string | null;
  planExpiresAt?: string | null;
  members: WorkspaceMember[];
  pendingInvites?: Array<{
    id: number;
    email: string;
    role: Exclude<WorkspaceRole, "owner">;
    status: "pending";
    expiresAt: string;
    createdAt: string;
  }>;
  invoiceProfile?: {
    companyName: string;
    taxCode: string;
    address: string;
    invoiceEmail: string;
    billingContactEmail: string;
  };
}

interface PrivacySettings {
  mediaRetentionPolicy:
    | "keep_until_deleted"
    | "delete_after_days"
    | "delete_after_transcription";
  mediaRetentionDays: number;
  transcriptRetentionPolicy: "keep_until_deleted" | "delete_after_days";
  transcriptRetentionDays: number;
  allowProductAnalytics: boolean;
  securityPolicyAcknowledgedAt: string | null;
}

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
  const [folders, setFolders] = useState<DashboardFolder[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);

  const activeFolder = selectDashboardFolder(folders, activeFolderId);

  const loadFolders = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}/api/transcribe/folders`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as {
        folders?: unknown;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "Không tải được danh sách thư mục");
      }
      const nextFolders = normalizeDashboardFolders(body.folders);
      setFolders(nextFolders);
      setActiveFolderId((current) =>
        selectDashboardFolder(nextFolders, current)?.id ?? null,
      );
      setFolderError("");
    } catch (error) {
      setFolderError(
        error instanceof Error
          ? error.message
          : "Không tải được danh sách thư mục",
      );
    } finally {
      setFoldersLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    if (user && token) void loadFolders();
  }, [loadFolders, token, user]);

  useEffect(() => {
    if (!user || !token || !foldersLoaded) return;
    let active = true;
    const loadHistory = async () => {
      try {
        const response = await fetch(
          `${API_URL}${buildDashboardHistoryPath(activeFolder?.id ?? null)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          },
        );
        const body = (await response.json().catch(() => ({}))) as
          | DashboardHistoryResponse
          | { error?: string };
        if (!response.ok || !("items" in body) || !Array.isArray(body.items)) {
          throw new Error(
            "error" in body && body.error
              ? body.error
              : "Không tải được lịch sử chuyển đổi",
          );
        }
        if (active) {
          setHistory(body.items.slice(0, 3));
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
  }, [activeFolder?.id, foldersLoaded, historyRetryKey, user, token]);

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
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<WorkspaceRole>("member");
  const [invoiceProfile, setInvoiceProfile] = useState({
    companyName: "",
    taxCode: "",
    address: "",
    invoiceEmail: "",
    billingContactEmail: "",
  });
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyError, setPrivacyError] = useState("");
  const [privacyMessage, setPrivacyMessage] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("Dự án mới");
  const [folderVisibility, setFolderVisibility] = useState<"private" | "team">("private");
  const [folderTeamPermission, setFolderTeamPermission] = useState<
    "view" | "edit"
  >("edit");
  const [folderSettingsOpen, setFolderSettingsOpen] = useState(false);
  const [folderSettingsName, setFolderSettingsName] = useState("");
  const [folderSettingsVisibility, setFolderSettingsVisibility] = useState<
    "private" | "team"
  >("private");
  const [folderSettingsPermission, setFolderSettingsPermission] = useState<
    "view" | "edit"
  >("edit");
  const [savingFolderSettings, setSavingFolderSettings] = useState(false);
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

  const loadWorkspace = useCallback(async () => {
    if (!token) return;
    setWorkspaceLoading(true);
    setWorkspaceError("");
    try {
      const response = await fetch(`${API_URL}/api/workspace`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        workspace?: WorkspaceSummary;
        error?: string;
      };
      if (!response.ok || !data.workspace) {
        throw new Error(data.error || "Không tải được workspace");
      }
      setWorkspace(data.workspace);
      setWorkspaceName(data.workspace.name);
      setInvoiceProfile({
        companyName: data.workspace.invoiceProfile?.companyName || "",
        taxCode: data.workspace.invoiceProfile?.taxCode || "",
        address: data.workspace.invoiceProfile?.address || "",
        invoiceEmail: data.workspace.invoiceProfile?.invoiceEmail || "",
        billingContactEmail:
          data.workspace.invoiceProfile?.billingContactEmail || "",
      });
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Không tải được workspace",
      );
    } finally {
      setWorkspaceLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void loadWorkspace();
  }, [loadWorkspace, token]);

  const loadPrivacy = useCallback(async () => {
    if (!token) return;
    setPrivacyLoading(true);
    setPrivacyError("");
    try {
      const response = await fetch(`${API_URL}/api/settings/privacy`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        privacy?: PrivacySettings;
        error?: string;
      };
      if (!response.ok || !data.privacy) {
        throw new Error(data.error || "Không tải được privacy center");
      }
      setPrivacy(data.privacy);
    } catch (error) {
      setPrivacyError(
        error instanceof Error ? error.message : "Không tải được privacy center",
      );
    } finally {
      setPrivacyLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void loadPrivacy();
  }, [loadPrivacy, token]);

  async function savePrivacy() {
    if (!token || !privacy) return;
    setPrivacySaving(true);
    setPrivacyError("");
    setPrivacyMessage("");
    try {
      const response = await fetch(`${API_URL}/api/settings/privacy`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(privacy),
      });
      const data = (await response.json().catch(() => ({}))) as {
        privacy?: PrivacySettings;
        error?: string;
      };
      if (!response.ok || !data.privacy) {
        throw new Error(data.error || "Không lưu được privacy center");
      }
      setPrivacy(data.privacy);
      setPrivacyMessage("Đã lưu chính sách dữ liệu.");
    } catch (error) {
      setPrivacyError(
        error instanceof Error ? error.message : "Không lưu được privacy center",
      );
    } finally {
      setPrivacySaving(false);
    }
  }

  async function exportPrivacyData() {
    if (!token) return;
    setPrivacyError("");
    try {
      const response = await fetch(`${API_URL}/api/settings/privacy/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || "Không export được dữ liệu");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `vbee-data-export-${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPrivacyMessage("Đã tạo file export dữ liệu.");
    } catch (error) {
      setPrivacyError(
        error instanceof Error ? error.message : "Không export được dữ liệu",
      );
    }
  }

  async function deletePrivacyMedia() {
    if (!token) return;
    if (!window.confirm("Xóa toàn bộ file media/audio đã lưu? Transcript vẫn được giữ lại.")) {
      return;
    }
    setPrivacySaving(true);
    setPrivacyError("");
    setPrivacyMessage("");
    try {
      const response = await fetch(`${API_URL}/api/settings/privacy/media`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json().catch(() => ({}))) as {
        affectedRecords?: number;
        deletedFiles?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Không xóa được media");
      setPrivacyMessage(
        `Đã xóa media khỏi ${data.affectedRecords || 0} transcript.`,
      );
    } catch (error) {
      setPrivacyError(
        error instanceof Error ? error.message : "Không xóa được media",
      );
    } finally {
      setPrivacySaving(false);
    }
  }

  async function deletePrivacyTranscripts() {
    if (!token) return;
    if (
      window.prompt(
        "Nhập DELETE để xóa vĩnh viễn toàn bộ transcript và media của bạn.",
      ) !== "DELETE"
    ) {
      return;
    }
    setPrivacySaving(true);
    setPrivacyError("");
    setPrivacyMessage("");
    try {
      const response = await fetch(`${API_URL}/api/settings/privacy/transcripts`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirmation: "DELETE" }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        deletedTranscripts?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Không xóa được dữ liệu");
      }
      setPrivacyMessage(
        `Đã xóa ${data.deletedTranscripts || 0} transcript vĩnh viễn.`,
      );
      setHistoryRetryKey((value) => value + 1);
    } catch (error) {
      setPrivacyError(
        error instanceof Error ? error.message : "Không xóa được dữ liệu",
      );
    } finally {
      setPrivacySaving(false);
    }
  }

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

  async function saveWorkspaceName() {
    if (!token || !workspace || !workspaceName.trim()) return;
    setWorkspaceSaving(true);
    setWorkspaceError("");
    try {
      const response = await fetch(`${API_URL}/api/workspace`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: workspaceName.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        workspace?: WorkspaceSummary;
        error?: string;
      };
      if (!response.ok || !data.workspace) {
        throw new Error(data.error || "Không lưu được workspace");
      }
      setWorkspace(data.workspace);
      setWorkspaceName(data.workspace.name);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Không lưu được workspace",
      );
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function addMember() {
    if (!token || !memberEmail.trim()) return;
    setWorkspaceSaving(true);
    setWorkspaceError("");
    try {
      const response = await fetch(`${API_URL}/api/workspace/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: memberEmail.trim(), role: memberRole }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        workspace?: WorkspaceSummary;
        error?: string;
      };
      if (!response.ok || !data.workspace) {
        throw new Error(data.error || "Không thêm được thành viên");
      }
      setWorkspace(data.workspace);
      setMemberEmail("");
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Không thêm được thành viên",
      );
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function updateMember(memberId: number, role: WorkspaceRole) {
    if (!token) return;
    setWorkspaceSaving(true);
    setWorkspaceError("");
    try {
      const response = await fetch(`${API_URL}/api/workspace/members/${memberId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        workspace?: WorkspaceSummary;
        error?: string;
      };
      if (!response.ok || !data.workspace) {
        throw new Error(data.error || "Không cập nhật được thành viên");
      }
      setWorkspace(data.workspace);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error
          ? error.message
          : "Không cập nhật được thành viên",
      );
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function transferOwner(memberId: number) {
    if (!token) return;
    if (!window.confirm("Chuyển owner workspace cho thành viên này? Bạn sẽ trở thành admin.")) {
      return;
    }
    setWorkspaceSaving(true);
    setWorkspaceError("");
    try {
      const response = await fetch(
        `${API_URL}/api/workspace/members/${memberId}/transfer-owner`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        workspace?: WorkspaceSummary;
        error?: string;
      };
      if (!response.ok || !data.workspace) {
        throw new Error(data.error || "Không chuyển owner được");
      }
      setWorkspace(data.workspace);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Không chuyển owner được",
      );
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function saveInvoiceProfile() {
    if (!token) return;
    setWorkspaceSaving(true);
    setWorkspaceError("");
    try {
      const response = await fetch(`${API_URL}/api/workspace/invoice-profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ invoiceProfile }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        workspace?: WorkspaceSummary;
        error?: string;
      };
      if (!response.ok || !data.workspace) {
        throw new Error(data.error || "Không lưu được thông tin hóa đơn");
      }
      setWorkspace(data.workspace);
      setInvoiceProfile({
        companyName: data.workspace.invoiceProfile?.companyName || "",
        taxCode: data.workspace.invoiceProfile?.taxCode || "",
        address: data.workspace.invoiceProfile?.address || "",
        invoiceEmail: data.workspace.invoiceProfile?.invoiceEmail || "",
        billingContactEmail:
          data.workspace.invoiceProfile?.billingContactEmail || "",
      });
    } catch (error) {
      setWorkspaceError(
        error instanceof Error
          ? error.message
          : "Không lưu được thông tin hóa đơn",
      );
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function removeMember(memberId: number) {
    if (!token) return;
    setWorkspaceSaving(true);
    setWorkspaceError("");
    try {
      const response = await fetch(`${API_URL}/api/workspace/members/${memberId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json().catch(() => ({}))) as {
        workspace?: WorkspaceSummary;
        error?: string;
      };
      if (!response.ok || !data.workspace) {
        throw new Error(data.error || "Không gỡ được thành viên");
      }
      setWorkspace(data.workspace);
    } catch (error) {
      setWorkspaceError(
        error instanceof Error ? error.message : "Không gỡ được thành viên",
      );
    } finally {
      setWorkspaceSaving(false);
    }
  }

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

  async function handleCreateFolder() {
    const name = folderName.trim();
    if (!name || !token || creatingFolder) return;
    setCreatingFolder(true);
    setFolderError("");
    try {
      const response = await fetch(`${API_URL}/api/transcribe/folders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          visibility: folderVisibility,
          teamPermission: folderTeamPermission,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        folder?: unknown;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "Không tạo được thư mục");
      }
      const created = normalizeDashboardFolders(
        body.folder ? [body.folder] : [],
      )[0];
      if (!created) throw new Error("Dữ liệu thư mục trả về không hợp lệ");
      setFolders((current) => [...current, created]);
      setActiveFolderId(created.id);
      setFolderOpen(false);
      setFolderName("Dự án mới");
      setFolderVisibility("private");
      setFolderTeamPermission("edit");
    } catch (error) {
      setFolderError(
        error instanceof Error ? error.message : "Không tạo được thư mục",
      );
    } finally {
      setCreatingFolder(false);
    }
  }

  function openFolderSettings() {
    if (!activeFolder) return;
    setFolderSettingsName(activeFolder.name);
    setFolderSettingsVisibility(activeFolder.visibility);
    setFolderSettingsPermission(activeFolder.team_permission);
    setFolderSettingsOpen(true);
  }

  async function saveFolderSettings() {
    if (!activeFolder || !token || savingFolderSettings) return;
    const name = folderSettingsName.trim();
    if (!name) return;
    setSavingFolderSettings(true);
    setFolderError("");
    try {
      const response = await fetch(
        `${API_URL}/api/transcribe/folders/${activeFolder.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name,
            visibility: folderSettingsVisibility,
            teamPermission: folderSettingsPermission,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        folder?: unknown;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "Không cập nhật được thư mục");
      }
      const updated = normalizeDashboardFolders(body.folder ? [body.folder] : [])[0];
      if (!updated) throw new Error("Dữ liệu thư mục trả về không hợp lệ");
      setFolders((current) =>
        current.map((folder) =>
          folder.id === updated.id
            ? { ...updated, item_count: folder.item_count }
            : folder,
        ),
      );
      setFolderSettingsOpen(false);
    } catch (error) {
      setFolderError(
        error instanceof Error ? error.message : "Không cập nhật được thư mục",
      );
    } finally {
      setSavingFolderSettings(false);
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
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
    <div className="relative min-h-screen overflow-x-hidden bg-[#f7f7fb] font-sans text-foreground antialiased">
      <AuthenticatedHeader onEditProfile={openEdit} />

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <main className="relative z-10 mx-auto max-w-6xl px-3 py-4 sm:px-5 sm:py-5">
        <section className="min-w-0">
          <div className="mb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="hidden items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-black text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  Không gian làm việc sẵn sàng
                </div>
                <div className="flex items-center gap-3">
                  <Heart className="h-6 w-6 text-[#e4b600]" />
                  <h1 className="text-xl font-black tracking-tight text-foreground sm:text-2xl">
                    Chào mừng, {user.firstName}
                  </h1>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Bắt đầu chuyển giọng nói hoặc tiếp tục từ tệp gần đây.
                </p>
              </div>
              <Link
                to="/history"
                className="hidden items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-bold text-muted-foreground transition hover:border-primary/50 hover:text-primary sm:inline-flex"
              >
                Xem lịch sử
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:flex">
              <Link
                to="/upload"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-black text-primary-foreground transition hover:bg-[#32166f]"
              >
                <Upload className="h-4 w-4" />
                Tải tệp
              </Link>
              <button
                onClick={() => setFolderOpen(true)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-foreground transition hover:border-primary/50 hover:text-primary"
              >
                <FolderPlus className="h-4 w-4" />
                Thư mục mới
              </button>
              <Link
                to="/record"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                title="Ghi âm nhanh"
              >
                <Mic className="h-4 w-4" />
                <span>Ghi âm</span>
              </Link>
              <Link
                to="/realtime"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-[#756894] transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                title="Realtime"
              >
                <Radio className="h-4 w-4" />
                <span>Trực tiếp</span>
              </Link>
            </div>

            <nav
              className="mt-3 flex flex-wrap gap-2"
              aria-label="Thiết lập nhanh"
            >
              <Link
                to="/transcription-settings"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition hover:bg-white hover:text-primary"
              >
                <Settings className="h-3.5 w-3.5" />
                Cài đặt chuyển đổi
              </Link>
              <Link
                to="/custom-dictionary"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition hover:bg-white hover:text-primary"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Từ điển riêng
              </Link>
              <Link
                to="/api"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition hover:bg-white hover:text-primary"
              >
                <Zap className="h-3.5 w-3.5" />
                API
              </Link>
              <Link
                to="/support"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition hover:bg-white hover:text-primary"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Hỗ trợ
              </Link>
            </nav>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-white">
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase text-primary">
                    Tệp gần đây
                  </p>
                  <div className="mt-1 flex items-center gap-1">
                  <label className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Folder className="h-4 w-4 text-primary" />
                    <span className="sr-only">Thư mục đang xem</span>
                    <select
                      value={activeFolder?.id ?? ""}
                      onChange={(event) =>
                        setActiveFolderId(Number(event.target.value) || null)
                      }
                      disabled={!folders.length}
                      className="max-w-56 rounded-md border-0 bg-transparent py-1 pr-7 font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {!folders.length && <option value="">Đang tải thư mục...</option>}
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name} ({folder.item_count})
                          {folder.visibility === "team" ? " · Nhóm" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {activeFolder &&
                    Number(activeFolder.owner_user_id) === Number(user?.id) && (
                      <button
                        type="button"
                        onClick={openFolderSettings}
                        aria-label="Cài đặt thư mục"
                        title="Cài đặt tên và quyền thư mục"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-primary/5 hover:text-primary"
                      >
                        <Settings className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-[#f7f7fb] px-2.5 py-1 text-xs font-bold text-muted-foreground">
                  {history.length} tệp
                </div>
              </div>
            </div>

            {folderError && (
              <div className="m-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:m-5">
                <span>{folderError}</span>
                <button
                  type="button"
                  onClick={() => void loadFolders()}
                  className="shrink-0 rounded-md border border-destructive/30 bg-white px-3 py-1.5 text-xs font-bold"
                >
                  Tải lại
                </button>
              </div>
            )}

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
              <div className="m-4 rounded-lg border border-dashed border-border bg-[#fafafe] p-6 text-center sm:m-5">
                <UploadCloud className="mx-auto h-9 w-9 text-primary" />
                <h2 className="mt-3 text-lg font-black">
                  Chưa có file transcript
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  Tải tệp hoặc ghi âm; bản chép lời sẽ xuất hiện tại đây.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Link
                    to="/upload"
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-black text-primary-foreground"
                  >
                    <Upload className="h-4 w-4" />
                    Tải file đầu tiên
                  </Link>
                  <Link
                    to="/record"
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold transition hover:border-primary/50 hover:text-primary"
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

            <div className="flex items-center justify-between border-t border-border bg-[#fafafe] px-4 py-3 text-xs font-bold text-muted-foreground sm:px-5">
              <span>Tổng thời lượng</span>
              <span>
                {history.length} tệp,{" "}
                {formatDuration(
                  sumMediaDurations(history.map((item) => item.duration)),
                )}
              </span>
            </div>
          </div>
        </section>
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
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-white border-border text-foreground sm:max-w-md">
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
                    className="h-20 w-20 rounded-full object-cover ring-2 ring-primary/40"
                  />
                ) : (
                  <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground select-none">
                    {initials}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSavingAvatar}
                  className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-white border border-border hover:border-primary/50 transition disabled:opacity-50"
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
              <div className="flex items-center gap-2 rounded-xl bg-white border border-primary/20 px-3 py-2 text-sm text-primary">
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
                  className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
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
                  className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
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
                className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
              />
              <p className="text-xs text-muted-foreground/60">
                Email liên kết với tài khoản, không thể thay đổi
              </p>
            </div>

            <section className="border-t border-border pt-4">
              <div className="mb-3 flex items-start gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-[#21104a]">
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
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 pr-10 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
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
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 pr-10 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
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
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 pr-10 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
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
                    className="flex items-start gap-2 rounded-lg border border-primary/20 bg-white px-3 py-2 text-xs leading-5 text-primary"
                  >
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {passwordSuccess}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleChangePassword()}
                  disabled={isChangingPassword || Boolean(passwordSuccess)}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-white py-2.5 text-sm font-bold text-[#21104a] transition hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
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
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-[#21104a]">
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
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-border bg-white px-3 py-2 text-xs font-bold text-foreground transition hover:border-primary/50 disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${sessionsLoading ? "animate-spin" : ""}`} />
                  Làm mới
                </button>
                <button
                  type="button"
                  onClick={() => void revokeOtherSessions()}
                  disabled={sessionsLoading || Boolean(sessionActionId)}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-border bg-white px-3 py-2 text-xs font-bold text-[#21104a] transition hover:border-primary/50 disabled:opacity-60"
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
                  <div className="rounded-lg border border-border bg-white px-3 py-3 text-xs font-semibold text-muted-foreground">
                    Đang tải danh sách thiết bị...
                  </div>
                ) : (
                  sessions.map((session) => (
                    <div
                      key={session.id}
                      className="rounded-lg border border-border bg-white px-3 py-3"
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
                className="flex-1 rounded-full border border-border bg-white py-2.5 text-sm font-medium text-foreground transition hover:border-primary/50 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={() => void handleSaveProfile()}
                disabled={
                  isSavingProfile || isSavingAvatar || isChangingPassword
                }
                className="flex-1 flex items-center justify-center gap-2 rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-60"
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
        <DialogContent className="border-border bg-white text-foreground sm:max-w-md">
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
              className="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm outline-none focus:border-primary"
              placeholder="Tên folder"
            />
            <label className="block text-sm font-bold">
              Quyền truy cập
              <select
                value={folderVisibility}
                onChange={(event) => setFolderVisibility(event.target.value as "private" | "team")}
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-4 text-sm"
              >
                <option value="private">Riêng tư · chỉ mình bạn</option>
                <option value="team">Nhóm · chia sẻ với thành viên</option>
              </select>
            </label>
            {folderVisibility === "team" && (
              <label className="block text-sm font-bold">
                Quyền của thành viên
                <select
                  value={folderTeamPermission}
                  onChange={(event) =>
                    setFolderTeamPermission(event.target.value as "view" | "edit")
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-4 text-sm"
                >
                  <option value="view">Chỉ xem transcript</option>
                  <option value="edit">Được tải tệp và chỉnh sửa</option>
                </select>
              </label>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setFolderOpen(false)}
                className="flex-1 rounded-full border border-border bg-white px-4 py-2.5 text-sm font-bold transition hover:border-primary/50"
              >
                Hủy
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!folderName.trim() || creatingFolder}
                className="flex-1 rounded-full bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingFolder ? "Đang tạo..." : "Tạo folder"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={folderSettingsOpen} onOpenChange={setFolderSettingsOpen}>
        <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cài đặt thư mục</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block text-sm font-bold">
              Tên dự án hoặc khách hàng
              <input
                value={folderSettingsName}
                onChange={(event) => setFolderSettingsName(event.target.value)}
                maxLength={160}
                className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block text-sm font-bold">
              Phạm vi truy cập
              <select
                value={folderSettingsVisibility}
                onChange={(event) =>
                  setFolderSettingsVisibility(event.target.value as "private" | "team")
                }
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-4 text-sm"
              >
                <option value="private">Riêng tư · chỉ chủ sở hữu</option>
                <option value="team">Chia sẻ với workspace</option>
              </select>
            </label>
            {folderSettingsVisibility === "team" && (
              <label className="block text-sm font-bold">
                Quyền thành viên
                <select
                  value={folderSettingsPermission}
                  onChange={(event) =>
                    setFolderSettingsPermission(event.target.value as "view" | "edit")
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-4 text-sm"
                >
                  <option value="view">Chỉ xem</option>
                  <option value="edit">Xem, tải tệp và chỉnh sửa</option>
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={() => void saveFolderSettings()}
              disabled={!folderSettingsName.trim() || savingFolderSettings}
              className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground disabled:opacity-50"
            >
              {savingFolderSettings ? "Đang lưu…" : "Lưu cài đặt thư mục"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function WorkspaceBillingPanel({
  workspace,
  loading,
  error,
  name,
  memberEmail,
  memberRole,
  invoiceProfile,
  saving,
  onNameChange,
  onMemberEmailChange,
  onMemberRoleChange,
  onInvoiceProfileChange,
  onSaveName,
  onAddMember,
  onUpdateMember,
  onTransferOwner,
  onSaveInvoiceProfile,
  onRemoveMember,
  onRetry,
}: {
  workspace: WorkspaceSummary | null;
  loading: boolean;
  error: string;
  name: string;
  memberEmail: string;
  memberRole: WorkspaceRole;
  invoiceProfile: NonNullable<WorkspaceSummary["invoiceProfile"]>;
  saving: boolean;
  onNameChange: (value: string) => void;
  onMemberEmailChange: (value: string) => void;
  onMemberRoleChange: (value: WorkspaceRole) => void;
  onInvoiceProfileChange: (value: NonNullable<WorkspaceSummary["invoiceProfile"]>) => void;
  onSaveName: () => void;
  onAddMember: () => void;
  onUpdateMember: (memberId: number, role: WorkspaceRole) => void;
  onTransferOwner: (memberId: number) => void;
  onSaveInvoiceProfile: () => void;
  onRemoveMember: (memberId: number) => void;
  onRetry: () => void;
}) {
  const canManage = workspace?.role === "owner" || workspace?.role === "admin";
  const roleLabel: Record<WorkspaceRole, string> = {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
  };

  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">
            Workspace billing
          </p>
          <h2 className="mt-1 text-lg font-black text-foreground">
            Team dùng chung quota
          </h2>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-border bg-white p-2 text-muted-foreground transition hover:border-primary/50 hover:text-primary"
          title="Tải lại workspace"
          aria-label="Tải lại workspace"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </p>
      )}

      {!workspace ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {loading ? "Đang tải workspace..." : "Chưa có dữ liệu workspace."}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-border bg-white p-3">
            <label className="text-xs font-black text-muted-foreground">
              Tên workspace
            </label>
            <div className="mt-2 flex gap-2">
              <input
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                disabled={!canManage || saving}
                className="min-w-0 flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm font-bold outline-none focus:border-primary disabled:opacity-60"
              />
              <button
                type="button"
                onClick={onSaveName}
                disabled={!canManage || saving || !name.trim()}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-black text-primary-foreground disabled:opacity-50"
              >
                Lưu
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-[#fbf8ef] p-2">
                <p className="font-bold text-muted-foreground">Gói</p>
                <p className="mt-1 font-black text-foreground">
                  {workspace.plan}
                </p>
              </div>
              <div className="rounded-lg bg-[#fbf8ef] p-2">
                <p className="font-bold text-muted-foreground">Quota team</p>
                <p className="mt-1 font-black text-foreground">
                  {formatDuration(workspace.quotaSeconds)}
                </p>
              </div>
            </div>
          </div>

          {canManage && (
            <div className="rounded-xl border border-border bg-white p-3">
              <label className="text-xs font-black text-muted-foreground">
                Thêm hoặc mời thành viên
              </label>
              <input
                value={memberEmail}
                onChange={(event) => onMemberEmailChange(event.target.value)}
                placeholder="email@company.com"
                className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <div className="mt-2 flex gap-2">
                <select
                  value={memberRole}
                  onChange={(event) =>
                    onMemberRoleChange(event.target.value as WorkspaceRole)
                  }
                  className="min-w-0 flex-1 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold outline-none focus:border-primary"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="button"
                  onClick={onAddMember}
                  disabled={saving || !memberEmail.trim()}
                  className="rounded-lg bg-[#21104a] px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Thêm
                </button>
              </div>
            </div>
          )}

          {canManage && (
            <div className="rounded-xl border border-border bg-white p-3">
              <p className="text-xs font-black text-muted-foreground">
                Thông tin hóa đơn workspace
              </p>
              <div className="mt-2 grid gap-2">
                {[
                  ["companyName", "Tên công ty"],
                  ["taxCode", "Mã số thuế"],
                  ["invoiceEmail", "Email nhận hóa đơn"],
                  ["billingContactEmail", "Email phụ trách billing"],
                ].map(([key, label]) => (
                  <input
                    key={key}
                    value={invoiceProfile[key as keyof typeof invoiceProfile]}
                    onChange={(event) =>
                      onInvoiceProfileChange({
                        ...invoiceProfile,
                        [key]: event.target.value,
                      })
                    }
                    placeholder={label}
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold outline-none focus:border-primary"
                  />
                ))}
                <textarea
                  value={invoiceProfile.address}
                  onChange={(event) =>
                    onInvoiceProfileChange({
                      ...invoiceProfile,
                      address: event.target.value,
                    })
                  }
                  placeholder="Địa chỉ xuất hóa đơn"
                  rows={2}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={onSaveInvoiceProfile}
                  disabled={saving}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-black text-primary-foreground disabled:opacity-50"
                >
                  Lưu thông tin hóa đơn
                </button>
              </div>
            </div>
          )}

          {!!workspace.pendingInvites?.length && (
            <div className="rounded-xl border border-border bg-white p-3">
              <p className="text-xs font-black text-muted-foreground">
                Lời mời đang chờ
              </p>
              <div className="mt-2 space-y-2">
                {workspace.pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="rounded-lg bg-[#fbf8ef] p-2 text-xs"
                  >
                    <p className="font-black text-foreground">
                      {invite.email}
                    </p>
                    <p className="mt-1 font-semibold text-muted-foreground">
                      {roleLabel[invite.role]} · hết hạn{" "}
                      {formatDate(invite.expiresAt)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {workspace.members.map((member) => (
              <div
                key={member.id}
                className="rounded-xl border border-border bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{member.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.email}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md bg-[#fbf8ef] px-2 py-1 text-[11px] font-black text-primary">
                    {roleLabel[member.role]}
                  </span>
                </div>
                {canManage && member.role !== "owner" && (
                  <div className="mt-3 flex gap-2">
                    <select
                      value={member.role}
                      onChange={(event) =>
                        onUpdateMember(
                          member.id,
                          event.target.value as WorkspaceRole,
                        )
                      }
                      disabled={saving}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-white px-2 py-1.5 text-xs font-bold outline-none focus:border-primary"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => onRemoveMember(member.id)}
                      disabled={saving}
                      className="rounded-lg border border-destructive/25 bg-white px-2 py-1.5 text-xs font-black text-destructive disabled:opacity-50"
                    >
                      Gỡ
                    </button>
                    {workspace.role === "owner" && (
                      <button
                        type="button"
                        onClick={() => onTransferOwner(member.id)}
                        disabled={saving}
                        className="rounded-lg border border-primary/25 bg-white px-2 py-1.5 text-xs font-black text-primary disabled:opacity-50"
                      >
                        Chuyển owner
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PrivacyCenterPanel({
  privacy,
  loading,
  saving,
  error,
  message,
  onChange,
  onSave,
  onExport,
  onDeleteMedia,
  onDeleteTranscripts,
  onRetry,
}: {
  privacy: PrivacySettings | null;
  loading: boolean;
  saving: boolean;
  error: string;
  message: string;
  onChange: (value: PrivacySettings) => void;
  onSave: () => void;
  onExport: () => void;
  onDeleteMedia: () => void;
  onDeleteTranscripts: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">
            Privacy center
          </p>
          <h2 className="mt-1 text-lg font-black text-foreground">
            Giữ, xóa, export dữ liệu
          </h2>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-border bg-white p-2 text-muted-foreground transition hover:border-primary/50 hover:text-primary"
          title="Tải lại privacy center"
          aria-label="Tải lại privacy center"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
          {message}
        </p>
      )}

      {!privacy ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {loading ? "Đang tải privacy center..." : "Chưa có dữ liệu privacy."}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block rounded-xl border border-border bg-white p-3">
            <span className="text-xs font-black text-muted-foreground">
              Media/audio
            </span>
            <select
              value={privacy.mediaRetentionPolicy}
              onChange={(event) =>
                onChange({
                  ...privacy,
                  mediaRetentionPolicy: event.target
                    .value as PrivacySettings["mediaRetentionPolicy"],
                })
              }
              className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold outline-none focus:border-primary"
            >
              <option value="keep_until_deleted">Giữ đến khi tự xóa</option>
              <option value="delete_after_days">Tự xóa sau số ngày</option>
              <option value="delete_after_transcription">
                Xóa sau khi transcribe xong
              </option>
            </select>
            {privacy.mediaRetentionPolicy === "delete_after_days" && (
              <input
                type="number"
                min={1}
                max={3650}
                value={privacy.mediaRetentionDays}
                onChange={(event) =>
                  onChange({
                    ...privacy,
                    mediaRetentionDays: Number(event.target.value),
                  })
                }
                className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold outline-none focus:border-primary"
              />
            )}
          </label>

          <label className="block rounded-xl border border-border bg-white p-3">
            <span className="text-xs font-black text-muted-foreground">
              Transcript
            </span>
            <select
              value={privacy.transcriptRetentionPolicy}
              onChange={(event) =>
                onChange({
                  ...privacy,
                  transcriptRetentionPolicy: event.target
                    .value as PrivacySettings["transcriptRetentionPolicy"],
                })
              }
              className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold outline-none focus:border-primary"
            >
              <option value="keep_until_deleted">Giữ đến khi tự xóa</option>
              <option value="delete_after_days">Tự xóa sau số ngày</option>
            </select>
            {privacy.transcriptRetentionPolicy === "delete_after_days" && (
              <input
                type="number"
                min={1}
                max={3650}
                value={privacy.transcriptRetentionDays}
                onChange={(event) =>
                  onChange({
                    ...privacy,
                    transcriptRetentionDays: Number(event.target.value),
                  })
                }
                className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold outline-none focus:border-primary"
              />
            )}
          </label>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white p-3">
            <span className="text-xs font-black text-muted-foreground">
              Product analytics
            </span>
            <input
              type="checkbox"
              checked={privacy.allowProductAnalytics}
              onChange={(event) =>
                onChange({
                  ...privacy,
                  allowProductAnalytics: event.target.checked,
                })
              }
              className="h-4 w-4 accent-primary"
            />
          </label>

          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground disabled:opacity-50"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Lưu chính sách dữ liệu
          </button>
          <button
            type="button"
            onClick={onExport}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-xs font-black text-foreground transition hover:border-primary/50"
          >
            <Database className="h-3.5 w-3.5" />
            Export data .zip
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onDeleteMedia}
              disabled={saving}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900 disabled:opacity-50"
            >
              Xóa media
            </button>
            <button
              type="button"
              onClick={onDeleteTranscripts}
              disabled={saving}
              className="rounded-xl border border-destructive/25 bg-white px-3 py-2 text-xs font-black text-destructive disabled:opacity-50"
            >
              Xóa vĩnh viễn
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkspaceFileRow({ item }: { item: HistoryItem }) {
  const Icon = item.filename.startsWith("recording.") ? Mic : AudioLines;
  const isActive = item.status === "queued" || item.status === "processing";
  const isFailed = item.status === "failed";
  const isCancelled = item.status === "cancelled";
  const isCompleted = item.status === "completed";
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
      to={isCompleted ? "/transcript/$id" : "/history"}
      params={isCompleted ? { id: String(item.id) } : undefined}
      className="block border-t border-border px-5 py-5 transition hover:bg-white"
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
                  ? "bg-white text-primary"
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
