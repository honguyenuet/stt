import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  History,
  AudioLines,
  Mic,
  Copy,
  Check,
  Download,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  HardDrive,
  Folder,
  Trash2,
  X,
  Search,
  Home,
  Upload,
  Radio,
  CircleStop,
  AlertCircle,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import {
  formatMediaDuration,
  sumMediaDurations,
} from "@/lib/format-duration";
import { languageLabel } from "@/lib/language-options";

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:3001";
const REQUEST_TIMEOUT_MS = 10_000;
const HISTORY_PAGE_SIZE = 20;

interface HistoryItem {
  id: number;
  filename: string;
  file_size: number;
  duration: number | null;
  processing_seconds: number | null;
  text: string;
  text_truncated?: boolean;
  audio_filename: string | null;
  source_language: string | null;
  translated_text: string | null;
  translation_truncated?: boolean;
  translation_target_language: string | null;
  translation_provider: string | null;
  translation_error: string | null;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  error_message: string | null;
  job_id: number | null;
  folder_id?: number | null;
  folder_name?: string | null;
  queue_position?: number;
  estimated_remaining_seconds?: number;
  created_at: string;
}

interface PaginatedHistoryResponse {
  items: HistoryItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
}

export const Route = createFileRoute("/history")({
  component: HistoryPage,
});

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const formatDuration = (seconds?: number | null) =>
  formatMediaDuration(seconds, "0 giây");

function isRecording(filename: string) {
  return filename.startsWith("recording.");
}

function HistoryPage() {
  const { user, isLoading, token } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<HistoryItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRetryKey, setDetailRetryKey] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [localChanged, setLocalChanged] = useState(false);
  const [editorText, setEditorText] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState("");

  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrlRef = useRef<string | null>(null);
  const historyRequestRef = useRef<AbortController | null>(null);
  const historyInFlightRef = useRef(false);
  const detailRequestRef = useRef<AbortController | null>(null);
  const audioRequestRef = useRef<AbortController | null>(null);
  const expandedSummary =
    expanded === null ? null : items.find((item) => item.id === expanded);
  const expandedItemStatus = expandedSummary?.status ?? null;
  const expandedItemAudioFilename = expandedSummary?.audio_filename ?? null;

  const filtered = items;
  const completedCount = items.filter(
    (item) => item.status === "completed",
  ).length;
  const hasActiveJobs = items.some(
    (item) => item.status === "queued" || item.status === "processing",
  );

  const loadHistory = useCallback(
    async (showLoading = false) => {
      if (!user || !token) {
        if (showLoading) setLoading(false);
        return;
      }

      if (historyInFlightRef.current) {
        if (!showLoading) return;
        historyRequestRef.current?.abort();
        historyRequestRef.current = null;
        historyInFlightRef.current = false;
      }

      const controller = new AbortController();
      historyRequestRef.current = controller;
      historyInFlightRef.current = true;
      let timedOut = false;
      const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
      if (showLoading) setLoading(true);
      try {
        const query = new URLSearchParams({
          paginated: "1",
          page: String(page),
          limit: String(HISTORY_PAGE_SIZE),
        });
        if (debouncedSearch) query.set("q", debouncedSearch);
        const res = await fetch(
          `${API_URL}/api/transcribe/history?${query.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error || "Không thể tải lịch sử");
        }
        const data = (await res.json()) as PaginatedHistoryResponse;
        setItems(
          data.items.map((item) => ({
            ...item,
            text: String(item.text || ""),
          })),
        );
        setTotalItems(data.pagination.total);
        setTotalPages(data.pagination.totalPages);
        if (page > data.pagination.totalPages) {
          setPage(data.pagination.totalPages);
        }
        setHistoryError("");
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return;
        setHistoryError(
          timedOut
            ? "Máy chủ phản hồi quá lâu. Vui lòng thử tải lại lịch sử."
            : error instanceof Error
              ? error.message
              : "Không thể tải lịch sử lúc này.",
        );
      } finally {
        window.clearTimeout(timer);
        if (historyRequestRef.current === controller) {
          historyRequestRef.current = null;
          historyInFlightRef.current = false;
          if (showLoading) setLoading(false);
        }
      }
    },
    [debouncedSearch, page, token, user],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setDebouncedSearch(search.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!isLoading && !user)
      void navigate({
        to: "/login",
        search: { error: undefined, from: "/history" },
      });
  }, [user, isLoading, navigate]);

  useEffect(() => {
    void loadHistory(true);
    return () => historyRequestRef.current?.abort();
  }, [loadHistory]);

  useEffect(() => {
    if (!hasActiveJobs) return;
    let cancelled = false;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") await loadHistory();
        if (!cancelled) schedule();
      }, 3500);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadHistory();
    };
    schedule();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [hasActiveJobs, loadHistory]);

  useEffect(() => {
    detailRequestRef.current?.abort();
    setDetail(null);
    setDetailError("");
    if (expanded === null || expandedItemStatus !== "completed" || !token) {
      setDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    detailRequestRef.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    setDetailLoading(true);

    void fetch(`${API_URL}/api/transcribe/history/${expanded}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as
          | HistoryItem
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            "error" in body && body.error
              ? body.error
              : "Không thể tải nội dung bản ghi",
          );
        }
        if (!controller.signal.aborted) setDetail(body as HistoryItem);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted && !timedOut) return;
        setDetailError(
          timedOut
            ? "Nội dung bản ghi tải quá lâu. Vui lòng thử lại."
            : error instanceof Error
              ? error.message
              : "Không thể tải nội dung bản ghi.",
        );
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (detailRequestRef.current === controller) {
          detailRequestRef.current = null;
          setDetailLoading(false);
        }
      });

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [detailRetryKey, expanded, expandedItemStatus, token]);

  // Keep the editor controlled by React so polling and rerenders cannot clear it.
  useEffect(() => {
    setLocalChanged(false);
    setEditorText(
      expandedItemStatus === "completed" && detail?.id === expanded
        ? String(detail.text || "")
        : "",
    );
  }, [detail, expanded, expandedItemStatus]);

  const clearAudioUrl = useCallback(() => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setAudioUrl(null);
  }, []);

  // Chỉ giữ Blob URL của bản ghi đang mở để không tăng bộ nhớ sau nhiều lần nghe.
  useEffect(() => {
    audioRequestRef.current?.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    clearAudioUrl();
    setAudioError("");
    if (expanded === null || !expandedItemAudioFilename || !token) {
      setAudioLoading(false);
      return;
    }

    const controller = new AbortController();
    audioRequestRef.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    setAudioLoading(true);

    void fetch(`${API_URL}/api/transcribe/${expanded}/audio`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Không thể tải audio");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        audioUrlRef.current = url;
        setAudioUrl(url);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted && !timedOut) return;
        setAudioError(
          timedOut
            ? "Audio tải quá lâu. Vui lòng đóng và mở lại bản ghi."
            : error instanceof Error
              ? error.message
              : "Không thể tải audio.",
        );
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (audioRequestRef.current === controller) {
          audioRequestRef.current = null;
          setAudioLoading(false);
        }
      });

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [clearAudioUrl, expanded, expandedItemAudioFilename, token]);

  useEffect(
    () => () => {
      historyRequestRef.current?.abort();
      detailRequestRef.current?.abort();
      audioRequestRef.current?.abort();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    [],
  );

  function resetEdit() {
    if (!detail || detail.id !== expanded) return;
    setEditorText(String(detail.text || ""));
    setLocalChanged(false);
  }

  async function handleSaveEdit(id: number) {
    const text = editorText;
    setIsSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/transcribe/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Không thể lưu nội dung");
      setDetail((prev) => (prev?.id === id ? { ...prev, text } : prev));
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                text: text.slice(0, 500),
                text_truncated: text.length > 500,
              }
            : item,
        ),
      );
      setDetailError("");
      setLocalChanged(false);
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Không thể lưu nội dung.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopy(item: HistoryItem) {
    const text = expanded === item.id ? editorText : item.text;
    await navigator.clipboard.writeText(text);
    setCopied(item.id);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try {
      const res = await fetch(`${API_URL}/api/transcribe/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        setTotalItems((current) => Math.max(0, current - 1));
        if (expanded === id) {
          setExpanded(null);
          setDetail(null);
          clearAudioUrl();
        }
      }
    } finally {
      setDeleting(null);
    }
  }

  async function handleCancel(item: HistoryItem) {
    if (!item.job_id || !token) return;
    setCancelling(item.id);
    try {
      const response = await fetch(
        `${API_URL}/api/transcribe/jobs/${item.job_id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (response.ok) await loadHistory();
    } finally {
      setCancelling(null);
    }
  }

  async function handleDownload(item: HistoryItem) {
    const text = expanded === item.id ? editorText : item.text;
    const baseName = item.filename.replace(/\.[^.]+$/, "");
    const lines = item.translated_text
      ? [
          "Transcript gốc",
          "",
          text,
          "",
          `Bản dịch (${languageLabel(item.translation_target_language)})`,
          "",
          item.translated_text,
        ]
      : text.split("\n");
    const doc = new Document({
      sections: [
        {
          children: lines.map(
            (line) => new Paragraph({ children: [new TextRun(line)] }),
          ),
        },
      ],
    });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadTxt(item: HistoryItem) {
    const text = expanded === item.id ? editorText : item.text;
    const baseName = item.filename.replace(/\.[^.]+$/, "");
    const content = item.translated_text
      ? [
          "Transcript gốc",
          "",
          text,
          "",
          `Bản dịch (${languageLabel(item.translation_target_language)})`,
          "",
          item.translated_text,
        ].join("\n")
      : text;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading)
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <span className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  if (!user) return null;

  const totalDuration = sumMediaDurations(
    filtered.map((item) => item.duration),
  );
  const recordingCount = filtered.filter((item) =>
    isRecording(item.filename),
  ).length;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background">
      <div className="absolute inset-0 bg-gradient-hero opacity-45 pointer-events-none" />
      <div className="absolute top-[8%] left-[4%] hidden h-80 w-80 rounded-full bg-primary/15 blur-3xl animate-float pointer-events-none" />
      <div
        className="absolute bottom-[6%] right-[4%] hidden h-64 w-64 rounded-full bg-primary/10 blur-3xl animate-float pointer-events-none"
        style={{ animationDelay: "1.5s" }}
      />

      <AuthenticatedHeader />

      <main className="relative z-10 mx-auto max-w-5xl px-4 py-6 md:px-6">
        {/* Heading */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary mb-4">
            <History className="h-3 w-3" /> Lịch sử chuyển đổi
          </div>
          <h1 className="text-2xl font-bold text-foreground md:text-3xl">
            Lịch sử <span className="font-display text-primary">của bạn</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            Tất cả bản chuyển đổi gần đây — nhấn để xem, chỉnh sửa hoặc nghe
            lại.
          </p>

          {/* Search */}
          <div className="relative mt-5 max-w-lg">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm theo tên file hoặc nội dung..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-full border border-border bg-white py-2.5 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {search && !loading && (
            <p className="mt-2 text-xs text-muted-foreground">
              Tìm thấy{" "}
              <span className="font-medium text-foreground">{totalItems}</span>{" "}
              kết quả cho &quot;{search}&quot;
            </p>
          )}
        </div>

        <Link
          to="/dashboard"
          className="mb-3 flex items-center justify-center rounded-md border border-border bg-white px-4 py-2 text-sm font-bold text-foreground/85 shadow-soft transition hover:border-primary/45 hover:bg-primary/5 hover:text-primary"
        >
          <Home className="mr-2 h-4 w-4 text-primary" />
          Không gian làm việc
        </Link>

        <div className="mb-5 grid grid-cols-[1fr_1fr_44px] gap-2 sm:flex">
          <Link
            to="/upload"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90"
          >
            <Upload className="h-4 w-4" />
            TẢI FILE
          </Link>
          <Link
            to="/record"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-white px-4 py-2.5 text-sm font-black text-foreground transition hover:border-primary/50 hover:text-primary"
          >
            <Mic className="h-4 w-4" />
            GHI ÂM
          </Link>
          <Link
            to="/realtime"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-muted-foreground transition hover:border-primary/50 hover:text-primary"
            title="Realtime"
          >
            <Radio className="h-4 w-4" />
          </Link>
        </div>

        <div className="mb-6 grid gap-3 md:grid-cols-4">
          {[
            ["Tổng số tệp", String(totalItems)],
            ["Đã chuyển đổi", String(completedCount)],
            ["Bản ghi âm", String(recordingCount)],
            ["Thời lượng", formatDuration(totalDuration)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-white px-4 py-3 shadow-soft"
            >
              <p className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 text-lg font-black text-primary">{value}</p>
            </div>
          ))}
        </div>

        {historyError && (
          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{historyError}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadHistory(true)}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-destructive/30 bg-white px-4 py-2 text-xs font-bold transition hover:bg-destructive/5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Thử lại
            </button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <span className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
              <History className="h-10 w-10 text-primary/50" />
            </div>
            <p className="text-lg font-semibold text-foreground">
              {search ? "Không tìm thấy kết quả" : "Chưa có lịch sử"}
            </p>
            <p className="text-muted-foreground text-sm">
              {search
                ? `Không có bản ghi nào khớp với "${search}"`
                : "Hãy thử tải file hoặc ghi âm để bắt đầu!"}
            </p>
            {!search && (
              <div className="flex gap-3 mt-2">
                <Link
                  to="/upload"
                  className="rounded-full border border-primary/40 bg-primary/10 px-5 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition"
                >
                  Tải file lên
                </Link>
                <Link
                  to="/record"
                  className="rounded-full bg-gradient-primary px-5 py-2 text-sm font-semibold text-[#21104a] shadow-glow hover:opacity-90 transition"
                >
                  Ghi âm
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((item) => {
              const isOpen = expanded === item.id;
              const isCompleted = item.status === "completed";
              const isActive =
                item.status === "queued" || item.status === "processing";
              const statusLabel =
                item.status === "queued"
                  ? "Đang chờ"
                  : item.status === "processing"
                    ? "Đang xử lý"
                    : item.status === "failed"
                      ? "Lỗi"
                      : item.status === "cancelled"
                        ? "Đã hủy"
                        : "Đã chuyển đổi";
              const fullItem =
                isOpen && detail?.id === item.id
                  ? { ...item, ...detail }
                  : null;

              return (
                <div
                  key={item.id}
                  className={`relative overflow-hidden rounded-lg border bg-white transition-all duration-200
                    ${isOpen ? "border-primary/40 shadow-glow" : "border-border hover:border-primary/30"}`}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/3 via-transparent to-transparent pointer-events-none" />

                  {/* Row header */}
                  <div className="relative flex items-center gap-3 px-4 py-3">
                    <button
                      onClick={() =>
                        isCompleted
                          ? void navigate({
                              to: "/transcript/$id",
                              params: { id: String(item.id) },
                            })
                          : setExpanded(isOpen ? null : item.id)
                      }
                      className="flex flex-1 items-center gap-4 text-left min-w-0"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 border border-primary/20">
                        {isRecording(item.filename) ? (
                          <Mic className="h-5 w-5 text-primary" />
                        ) : (
                          <AudioLines className="h-5 w-5 text-primary" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium text-foreground text-sm">
                          {item.filename}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(item.created_at)}
                          </span>
                          {item.folder_name && (
                            <span className="flex min-w-0 items-center gap-1">
                              <Folder className="h-3 w-3 shrink-0" />
                              <span className="max-w-32 truncate">
                                {item.folder_name}
                              </span>
                            </span>
                          )}
                          {item.file_size > 0 && (
                            <span className="flex items-center gap-1">
                              <HardDrive className="h-3 w-3" />
                              {formatBytes(item.file_size)}
                            </span>
                          )}
                          {item.duration && (
                            <span>{Math.round(item.duration)}s âm thanh</span>
                          )}
                          {item.processing_seconds && (
                            <span>
                              process {Math.round(item.processing_seconds)}s
                            </span>
                          )}
                        </div>
                      </div>
                      {!isOpen && (
                        <p className="hidden md:block text-xs text-muted-foreground truncate max-w-xs">
                          {isCompleted
                            ? item.translation_error
                              ? `Bản dịch bị lỗi: ${item.translation_error}`
                              : item.translated_text ||
                                item.text ||
                                "Không có văn bản"
                            : item.status === "failed"
                              ? item.error_message || "Job xử lý thất bại"
                              : `${statusLabel}${item.progress ? ` ${item.progress}%` : ""}`}
                        </p>
                      )}
                    </button>

                    <span
                      className={`hidden min-w-32 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-black sm:inline-flex ${
                        item.status === "failed" || item.status === "cancelled"
                          ? "bg-destructive/15 text-destructive"
                          : isActive
                            ? "bg-primary/10 text-primary"
                            : "bg-emerald-500 text-white"
                      }`}
                    >
                      {isActive ? (
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-primary/35 border-t-primary animate-spin" />
                      ) : item.status === "failed" ||
                        item.status === "cancelled" ? (
                        <X className="h-3.5 w-3.5" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      {statusLabel}
                    </span>

                    <div className="flex items-center gap-1 shrink-0">
                      {isActive ? (
                        <button
                          onClick={() => void handleCancel(item)}
                          disabled={cancelling === item.id}
                          title="Hủy xử lý"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        >
                          {cancelling === item.id ? (
                            <span className="h-3.5 w-3.5 rounded-full border-2 border-destructive/40 border-t-destructive animate-spin" />
                          ) : (
                            <CircleStop className="h-3.5 w-3.5" />
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => void handleDelete(item.id)}
                          disabled={deleting === item.id}
                          title="Xóa bản ghi"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition disabled:opacity-50"
                        >
                          {deleting === item.id ? (
                            <span className="h-3.5 w-3.5 rounded-full border-2 border-destructive/40 border-t-destructive animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() =>
                          isCompleted
                            ? void navigate({
                                to: "/transcript/$id",
                                params: { id: String(item.id) },
                              })
                            : setExpanded(isOpen ? null : item.id)
                        }
                        title={
                          isCompleted ? "Mở trình biên tập" : "Xem trạng thái"
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-card transition"
                      >
                        {isCompleted ? (
                          <ArrowRight className="h-4 w-4" />
                        ) : isOpen ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded content */}
                  {isOpen && !isCompleted && (
                    <div className="flex items-center gap-3 border-t border-border/50 px-5 py-4">
                      {isActive ? (
                        <span className="h-5 w-5 shrink-0 rounded-full border-2 border-primary/35 border-t-primary animate-spin" />
                      ) : (
                        <X className="h-5 w-5 shrink-0 text-destructive" />
                      )}
                      <div>
                        <p className="text-sm font-black text-foreground">
                          {isActive
                            ? `${statusLabel}. Bạn có thể rời trang, lịch sử sẽ tự cập nhật.`
                            : "Job chưa hoàn tất."}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {item.status === "failed"
                            ? item.error_message || "Không thể xử lý file này."
                            : item.status === "cancelled"
                              ? "Job đã được hủy và không trừ quota."
                              : item.status === "processing"
                                ? `Tiến độ hiện tại: ${item.progress || 10}%. Dự kiến còn ${formatDuration(item.estimated_remaining_seconds)}.`
                                : `Vị trí hàng đợi: ${item.queue_position || 1}. Dự kiến còn ${formatDuration(item.estimated_remaining_seconds)}.`}
                        </p>
                      </div>
                    </div>
                  )}

                  {isOpen && isCompleted && (
                    <div className="px-5 pb-5 flex flex-col gap-3 border-t border-border/50 pt-4">
                      {detailLoading ? (
                        <div className="flex items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
                          <span className="h-5 w-5 rounded-full border-2 border-primary/35 border-t-primary animate-spin" />
                          Đang tải nội dung bản ghi...
                        </div>
                      ) : detailError ? (
                        <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive">
                          <AlertCircle className="h-5 w-5" />
                          <span>{detailError}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setDetailRetryKey((value) => value + 1)
                            }
                            className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-white px-4 py-2 text-xs font-bold transition hover:bg-destructive/5"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Tải lại nội dung
                          </button>
                        </div>
                      ) : fullItem ? (
                        <>
                          {fullItem.translation_error && (
                            <div className="rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm font-semibold leading-6 text-destructive">
                              Transcript gốc đã hoàn thành nhưng bản dịch bị
                              lỗi: {fullItem.translation_error}
                            </div>
                          )}

                          {fullItem.audio_filename && (
                            <div>
                              {audioLoading && !audioUrl ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="h-3.5 w-3.5 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
                                  Đang tải audio...
                                </div>
                              ) : audioUrl ? (
                                <div className="flex flex-col gap-1.5">
                                  <p className="text-xs text-muted-foreground">
                                    Nghe lại bản ghi
                                  </p>
                                  <audio
                                    ref={audioRef}
                                    src={audioUrl}
                                    controls
                                    className="h-10 w-full rounded-xl"
                                  />
                                </div>
                              ) : null}
                              {audioError && (
                                <p className="mt-2 text-xs font-semibold text-destructive">
                                  {audioError}
                                </p>
                              )}
                            </div>
                          )}

                          <div className="rounded-lg border border-border bg-[#fbf8ef] px-4 py-3">
                            <p className="mb-2 text-xs text-muted-foreground">
                              Văn bản — có thể chỉnh sửa trực tiếp
                            </p>
                            <textarea
                              data-typography="content"
                              value={editorText}
                              onChange={(event) => {
                                const nextText = event.target.value;
                                setEditorText(nextText);
                                setLocalChanged(
                                  nextText !== String(fullItem.text || ""),
                                );
                              }}
                              className="min-h-40 max-h-80 w-full resize-y overflow-y-auto bg-transparent text-sm leading-7 text-foreground outline-none"
                            />
                          </div>

                          {fullItem.translated_text && (
                            <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3">
                              <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-primary">
                                Bản dịch{" "}
                                {languageLabel(
                                  fullItem.translation_target_language,
                                )}
                              </p>
                              <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                                {fullItem.translated_text}
                              </p>
                            </div>
                          )}

                          <div className="flex flex-wrap gap-2 pt-1">
                            {localChanged && (
                              <>
                                <button
                                  onClick={resetEdit}
                                  className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-medium transition hover:bg-card"
                                >
                                  <X className="h-3 w-3" /> Hủy
                                </button>
                                <button
                                  onClick={() => void handleSaveEdit(item.id)}
                                  disabled={isSaving}
                                  className="flex items-center gap-1.5 rounded-full bg-gradient-primary px-4 py-2 text-xs font-semibold text-[#21104a] shadow-glow transition hover:opacity-90 disabled:opacity-60"
                                >
                                  {isSaving ? (
                                    <span className="h-3 w-3 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin" />
                                  ) : (
                                    <Check className="h-3 w-3" />
                                  )}
                                  Lưu
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => void handleCopy(fullItem)}
                              className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-medium transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                            >
                              {copied === item.id ? (
                                <>
                                  <Check className="h-3 w-3 text-primary" />
                                  Đã sao chép
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  Sao chép
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => handleDownloadTxt(fullItem)}
                              className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary transition hover:bg-primary/20"
                            >
                              <Download className="h-3 w-3" /> Tải .txt
                            </button>
                            <button
                              onClick={() => void handleDownload(fullItem)}
                              className="flex items-center gap-1.5 rounded-full bg-gradient-primary px-4 py-2 text-xs font-semibold text-[#21104a] shadow-glow transition hover:opacity-90"
                            >
                              <Download className="h-3 w-3" /> Tải .docx
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && totalPages > 1 && (
          <nav
            aria-label="Phân trang lịch sử"
            className="mt-6 flex items-center justify-center gap-3"
          >
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-white px-4 text-sm font-bold text-foreground transition hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Trang trước
            </button>
            <span className="text-sm font-bold text-muted-foreground">
              Trang {page}/{totalPages}
            </span>
            <button
              type="button"
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
              disabled={page >= totalPages}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-white px-4 text-sm font-bold text-foreground transition hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Trang sau
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        )}
      </main>
    </div>
  );
}
