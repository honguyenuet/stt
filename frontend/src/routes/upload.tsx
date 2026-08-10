import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  ArrowRight,
  AlertCircle,
  AudioLines,
  Check,
  Clock,
  Copy,
  Download,
  FileAudio,
  FileVideo,
  Folder,
  FolderPlus,
  HardDrive,
  Heart,
  Home,
  Info,
  Layers3,
  ListChecks,
  Link2,
  Mic,
  RotateCcw,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { useAuth } from "@/context/AuthContext";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VbeePreferencesSidebar } from "@/components/vbee-preferences-layout";
import {
  formatMediaDuration as formatDuration,
  normalizeMediaDuration,
} from "@/lib/format-duration";
import {
  normalizeEstimatedRemainingSeconds,
  tickEstimatedRemainingSeconds,
} from "@/lib/job-progress";
import {
  formatPlanLabel,
  formatQuotaTime,
  type QuotaStatus,
} from "@/lib/quota";
import {
  SPEECH_LANGUAGE_OPTIONS,
  languageLabel,
  type TranslationResult,
} from "@/lib/language-options";
import { SPEAKER_COUNT_OPTIONS } from "@/lib/speaker-options";

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:3001";
const MAX_MB = 200;
const HISTORY_PREVIEW_LIMIT = 8;

const DEFAULT_UPLOAD_FORMATS = [
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "flac",
  "aac",
  "mp4",
  "webm",
];

function normalizeSupportedFormats(formats?: string[]) {
  const normalized = [
    ...new Set(
      (Array.isArray(formats) ? formats : [])
        .map((format) => String(format || "").trim().toLowerCase())
        .filter((format) => /^[a-z0-9]{2,5}$/.test(format)),
    ),
  ];
  return normalized.length ? normalized : DEFAULT_UPLOAD_FORMATS;
}

function fileAcceptValue(formats: string[]) {
  return formats.map((format) => `.${format}`).join(",");
}

function isSupportedMediaFile(file: File, formats: string[]) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return formats.includes(extension);
}
const UPLOAD_LANGUAGE_OPTIONS = SPEECH_LANGUAGE_OPTIONS.map((item) =>
  item.value === "multi"
    ? { ...item, label: "Tiếng Việt + tiếng Anh (đa ngôn ngữ)" }
    : item,
);

interface Word {
  text: string;
  start: number;
  end: number;
}

interface HistoryItem {
  id: number;
  filename: string;
  file_size?: number;
  duration: number | null;
  text: string;
  source_language?: string | null;
  translated_text?: string | null;
  translation_target_language?: string | null;
  translation_error?: string | null;
  status?: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress?: number;
  error_message?: string | null;
  job_id?: number | null;
  folder_id?: number | null;
  folder_name?: string | null;
  created_at: string;
}

interface WorkspaceFolder {
  id: number;
  name: string;
  item_count: number;
}

type UploadStatus =
  | "idle"
  | "uploading"
  | "queued"
  | "done"
  | "error"
  | "cancelled";
type UploadMode = "single" | "multi" | "multitrack" | "link";
type AudioMode = "speech" | "song";
type RemoteMediaMetadata = {
  url: string;
  videoId: string;
  title: string;
  filename: string;
  durationSeconds: number;
  approximateBytes: number | null;
  thumbnail: string | null;
  channel: string;
  platform: string;
  sourceHost: string;
};
type ActionDialogState = {
  title: string;
  description: string;
  ctaLabel?: string;
  to?: string;
};
type ActiveJobStatus = "queued" | "processing";
type JobStatusResponse = {
  status: ActiveJobStatus | "completed" | "failed" | "cancelled";
  progress?: number | null;
  queue_position?: number | null;
  estimated_remaining_seconds?: number | null;
  duration?: number | string | null;
  text?: string | null;
  words?: Word[] | null;
  source_language?: string | null;
  translated_text?: string | null;
  translation_target_language?: string | null;
  translation_provider?: string | null;
  translation_error?: string | null;
  error_message?: string | null;
  error?: string;
};

export const Route = createFileRoute("/upload")({
  component: UploadPage,
});

function formatDate(value?: string) {
  if (!value) return new Date().toLocaleDateString("vi-VN");
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getFileIcon(filename: string) {
  if (filename.startsWith("recording.")) return Mic;
  if (/\.(mp4|webm)$/i.test(filename)) return FileAudio;
  return AudioLines;
}

function readMediaDuration(file: File) {
  return new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(
      file.type.startsWith("video/") ? "video" : "audio",
    );
    const cleanup = () => URL.revokeObjectURL(url);
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 3500);
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const duration = normalizeMediaDuration(media.duration);
      cleanup();
      resolve(duration);
    };
    media.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      resolve(null);
    };
    media.src = url;
  });
}

function UploadPage() {
  const { user, isLoading, token } = useAuth();
  const navigate = useNavigate();

  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [transcription, setTranscription] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [copied, setCopied] = useState(false);
  const [speakerLabels, setSpeakerLabels] = useState(false);
  const [speakerCount, setSpeakerCount] = useState("auto");
  const [audioMode, setAudioMode] = useState<AudioMode>("speech");
  const [transcriptionLanguage, setTranscriptionLanguage] = useState("auto");
  const translateTo = "none";
  const [translation, setTranslation] = useState<TranslationResult | null>(
    null,
  );
  const [translationError, setTranslationError] = useState("");
  const [words, setWords] = useState<Word[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyRetryKey, setHistoryRetryKey] = useState(0);
  const [uploadMode, setUploadMode] = useState<UploadMode>("single");
  const [videoLink, setVideoLink] = useState("");
  const [remoteMetadata, setRemoteMetadata] =
    useState<RemoteMediaMetadata | null>(null);
  const [linkRightsAccepted, setLinkRightsAccepted] = useState(false);
  const [linkMetadataLoading, setLinkMetadataLoading] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("Dự án mới");
  const [folders, setFolders] = useState<WorkspaceFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [folderError, setFolderError] = useState("");
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(
    null,
  );
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [quotaRefreshKey, setQuotaRefreshKey] = useState(0);
  const supportedFormats = normalizeSupportedFormats(
    quota?.limits.supportedFormats,
  );
  const [expectedDuration, setExpectedDuration] = useState<number | null>(null);
  const [queuedJob, setQueuedJob] = useState<{
    id: number;
    status: ActiveJobStatus;
    progress: number;
    queuePosition: number;
    estimatedRemainingSeconds: number | null;
  } | null>(null);
  const [multitrackBatchId, setMultitrackBatchId] = useState<string | null>(
    null,
  );
  const queuedJobId = queuedJob?.id;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const spanRefs = useRef<HTMLSpanElement[]>([]);
  const activeIdxRef = useRef(-1);

  useEffect(() => {
    if (!isLoading && !user) {
      void navigate({
        to: "/login",
        search: { error: undefined, from: "/upload" },
      });
    }
  }, [user, isLoading, navigate]);

  useEffect(() => {
    if (!user || !token) return;
    let active = true;
    void fetch(`${API_URL}/api/transcribe/folders`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          folders?: WorkspaceFolder[];
          error?: string;
        };
        if (!response.ok || !Array.isArray(body.folders)) {
          throw new Error(body.error || "Không tải được thư mục");
        }
        if (!active) return;
        setFolders(body.folders);
        setActiveFolderId((current) => current ?? body.folders?.[0]?.id ?? null);
        setFolderError("");
      })
      .catch((error) => {
        if (active) {
          setFolderError(
            error instanceof Error ? error.message : "Không tải được thư mục",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [token, user]);

  useEffect(() => {
    if (!user || !token) return;
    let active = true;
    const loadHistory = async () => {
      try {
        const folderQuery = activeFolderId
          ? `?folderId=${encodeURIComponent(activeFolderId)}`
          : "";
        const response = await fetch(`${API_URL}/api/transcribe/history${folderQuery}`, {
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
          setHistory(body.slice(0, HISTORY_PREVIEW_LIMIT));
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
  }, [activeFolderId, historyRetryKey, user, token]);

  useEffect(() => {
    if (
      !queuedJobId ||
      !token ||
      uploadStatus !== "queued" ||
      multitrackBatchId
    )
      return;

    let active = true;
    let requestInFlight = false;
    let controller: AbortController | null = null;

    const loadJobStatus = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      controller = new AbortController();
      try {
        const response = await fetch(
          `${API_URL}/api/transcribe/jobs/${queuedJobId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const data = (await response.json().catch(() => ({}))) as
          | JobStatusResponse
          | { error?: string };
        if (!response.ok || !("status" in data)) {
          throw new Error(data.error || "Không cập nhật được trạng thái tác vụ");
        }
        if (!active) return;

        if (data.status === "queued" || data.status === "processing") {
          setQueuedJob((current) => {
            if (!current || current.id !== queuedJobId) return current;
            return {
              ...current,
              status: data.status,
              progress: Math.max(0, Math.min(99, Number(data.progress || 0))),
              queuePosition: Math.max(
                1,
                Number(data.queue_position || current.queuePosition || 1),
              ),
              estimatedRemainingSeconds:
                normalizeEstimatedRemainingSeconds(
                  data.estimated_remaining_seconds,
                ) ?? current.estimatedRemainingSeconds,
            };
          });
          setHistory((current) =>
            current.map((item) =>
              item.job_id === queuedJobId
                ? {
                    ...item,
                    status: data.status,
                    progress: Number(data.progress || 0),
                  }
                : item,
            ),
          );
          return;
        }

        setQueuedJob(null);
        setQuotaRefreshKey((key) => key + 1);
        setHistoryRetryKey((key) => key + 1);

        if (data.status === "completed") {
          setTranscription(data.text || "");
          setDuration(normalizeMediaDuration(data.duration));
          setWords(Array.isArray(data.words) ? data.words : []);
          setTranslation(
            data.translated_text
              ? {
                  text: data.translated_text,
                  sourceLanguage: data.source_language,
                  targetLanguage: data.translation_target_language,
                  provider: data.translation_provider,
                }
              : null,
          );
          setTranslationError(data.translation_error || "");
          setUploadError("");
          setUploadStatus("done");
          return;
        }

        setUploadStatus(data.status === "cancelled" ? "cancelled" : "error");
        setUploadError(
          data.error_message ||
            (data.status === "cancelled"
              ? "Tác vụ đã được hủy."
              : "Không thể xử lý tệp này."),
        );
      } catch (error) {
        if (!active || controller?.signal.aborted) return;
        setUploadError(
          error instanceof Error
            ? `${error.message}. Hệ thống sẽ tự thử lại.`
            : "Không cập nhật được tiến độ. Hệ thống sẽ tự thử lại.",
        );
      } finally {
        requestInFlight = false;
      }
    };

    void loadJobStatus();
    const pollTimer = window.setInterval(() => void loadJobStatus(), 5_000);
    const countdownTimer = window.setInterval(() => {
      setQueuedJob((current) =>
        current?.id === queuedJobId
          ? {
              ...current,
              estimatedRemainingSeconds: tickEstimatedRemainingSeconds(
                current.estimatedRemainingSeconds,
              ),
            }
          : current,
      );
    }, 1_000);

    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(pollTimer);
      window.clearInterval(countdownTimer);
    };
  }, [multitrackBatchId, queuedJobId, token, uploadStatus]);

  useEffect(() => {
    if (!multitrackBatchId || !token || uploadStatus !== "queued") return;
    let active = true;
    let requestInFlight = false;

    const loadBatchStatus = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const response = await fetch(
          `${API_URL}/api/transcribe/multitrack/${multitrackBatchId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          },
        );
        const data = (await response.json().catch(() => ({}))) as {
          status?:
            | "queued"
            | "processing"
            | "merging"
            | "completed"
            | "failed"
            | "cancelled";
          progress?: number;
          outputTranscriptionId?: number | null;
          error?: string;
        };
        if (!response.ok || !data.status) {
          throw new Error(data.error || "Không cập nhật được phiên nhiều rãnh");
        }
        if (!active) return;
        if (["queued", "processing", "merging"].includes(data.status)) {
          setQueuedJob((current) =>
            current
              ? {
                  ...current,
                  status: data.status === "queued" ? "queued" : "processing",
                  progress:
                    data.status === "merging"
                      ? 95
                      : Math.max(0, Math.min(94, Number(data.progress || 0))),
                }
              : current,
          );
          return;
        }

        setQueuedJob(null);
        setMultitrackBatchId(null);
        setQuotaRefreshKey((key) => key + 1);
        setHistoryRetryKey((key) => key + 1);
        if (data.status === "completed" && data.outputTranscriptionId) {
          setUploadStatus("done");
          void navigate({
            to: "/transcript/$id",
            params: { id: String(data.outputTranscriptionId) },
          });
          return;
        }
        setUploadStatus(data.status === "cancelled" ? "cancelled" : "error");
        setUploadError(
          data.error ||
            (data.status === "cancelled"
              ? "Phiên nhiều rãnh đã được hủy."
              : "Không thể hợp nhất các rãnh."),
        );
      } catch (error) {
        if (active) {
          setUploadError(
            error instanceof Error
              ? `${error.message}. Hệ thống sẽ tự thử lại.`
              : "Không cập nhật được phiên nhiều rãnh. Hệ thống sẽ tự thử lại.",
          );
        }
      } finally {
        requestInFlight = false;
      }
    };

    void loadBatchStatus();
    const timer = window.setInterval(() => void loadBatchStatus(), 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [multitrackBatchId, navigate, token, uploadStatus]);

  useEffect(() => {
    const div = editRef.current;
    if (!div) return;
    div.innerHTML = "";
    spanRefs.current = [];
    activeIdxRef.current = -1;
    if (words.length === 0) return;

    words.forEach((w, i) => {
      const span = document.createElement("span");
      span.className =
        "cursor-pointer rounded px-0.5 transition-colors duration-100 hover:bg-primary/15";
      span.textContent = w.text;
      span.onclick = () => {
        if (audioRef.current) {
          audioRef.current.currentTime = w.start / 1000;
          void audioRef.current.play();
        }
      };
      div.appendChild(span);
      if (i < words.length - 1) div.appendChild(document.createTextNode(" "));
      spanRefs.current.push(span);
    });
  }, [words]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalDuration = useMemo(() => {
    const historySeconds = history.reduce(
      (sum, item) => sum + (normalizeMediaDuration(item.duration) ?? 0),
      0,
    );
    return historySeconds + (normalizeMediaDuration(duration) ?? 0);
  }, [duration, history]);

  const activeFolderName =
    folders.find((folder) => folder.id === activeFolderId)?.name ?? "Dự án mới";
  const hasSelectedSource = Boolean(uploadFiles.length || remoteMetadata);
  const selectedFilename =
    uploadFiles.length > 1
      ? `${uploadFiles.length} tệp: ${uploadFiles.map((file) => file.name).join(", ")}`
      : uploadFiles[0]?.name ?? remoteMetadata?.filename ?? "van-ban";
  const selectedFileSize =
    uploadFiles.length > 0
      ? uploadFiles.reduce((total, file) => total + file.size, 0)
      : remoteMetadata?.approximateBytes ?? undefined;

  const normalizedExpectedDuration = normalizeMediaDuration(expectedDuration);
  const pendingUploadSeconds =
    hasSelectedSource &&
    uploadStatus !== "done" &&
    normalizedExpectedDuration
      ? normalizedExpectedDuration
      : 0;
  const projectedRemainingSeconds = quota
    ? Math.max(0, quota.remainingSeconds - pendingUploadSeconds)
    : null;

  function handleTimeUpdate() {
    if (!audioRef.current || spanRefs.current.length === 0) return;
    const ms = audioRef.current.currentTime * 1000;
    let newIdx = -1;
    for (let i = 0; i < words.length; i++) {
      if (words[i].start <= ms) newIdx = i;
      else break;
    }
    if (newIdx === activeIdxRef.current) return;

    const prev = spanRefs.current[activeIdxRef.current];
    if (prev) {
      prev.classList.remove(
        "bg-primary",
        "text-primary-foreground",
        "font-medium",
      );
      prev.classList.add("hover:bg-primary/15");
    }

    const cur = spanRefs.current[newIdx];
    if (cur) {
      cur.classList.add("bg-primary", "text-primary-foreground", "font-medium");
      cur.classList.remove("hover:bg-primary/15");
      cur.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    activeIdxRef.current = newIdx;
  }

  async function handleFileSelect(selected: File[]) {
    const files =
      uploadMode === "multi"
        ? selected.slice(0, 8)
        : uploadMode === "multitrack"
          ? selected.slice(0, 5)
          : selected.slice(0, 1);
    if (!files.length) return;
    if (
      files.some((file) => !isSupportedMediaFile(file, supportedFormats))
    ) {
      setUploadError(
        `Định dạng không hỗ trợ. Dùng ${supportedFormats.map((format) => format.toUpperCase()).join(", ")}.`,
      );
      return;
    }
    const maxMb = quota?.limits.maxUploadMb ?? MAX_MB;
    const oversized = files.find(
      (file) => file.size > maxMb * 1024 * 1024,
    );
    if (oversized) {
      setUploadError(
        `${oversized.name} quá lớn cho gói hiện tại (tối đa ${maxMb} MB/tệp)`,
      );
      return;
    }
    if (quota?.isLimitReached) {
      setUploadError(
        "Gói miễn phí đã hết thời lượng. Vui lòng nâng cấp gói cước.",
      );
      return;
    }
    const durations = await Promise.all(files.map(readMediaDuration));
    if (quota) {
      const overDurationIndex = durations.findIndex(
        (value) => value && value > quota.limits.maxFileSeconds,
      );
      if (overDurationIndex >= 0) {
        setUploadError(
          `${files[overDurationIndex].name} vượt giới hạn ${formatQuotaTime(quota.limits.maxFileSeconds)} của gói ${formatPlanLabel(quota.plan)}`,
        );
        return;
      }
      const totalSeconds = durations.reduce(
        (total, value) => total + (value || 0),
        0,
      );
      if (totalSeconds > quota.remainingSeconds) {
        setUploadError(
          `Thời lượng còn lại không đủ. Còn ${formatQuotaTime(quota.remainingSeconds)}, các rãnh khoảng ${formatQuotaTime(totalSeconds)}.`,
        );
        return;
      }
    }
    setUploadFiles(files);
    setRemoteMetadata(null);
    setExpectedDuration(
      durations.reduce((total, value) => total + (value || 0), 0) || null,
    );
    setUploadStatus("idle");
    setUploadError("");
    setTranscription("");
    setTranslation(null);
    setTranslationError("");
    setDuration(null);
    setWords([]);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void handleFileSelect(files);
  }

  async function handleUpload() {
    if (!uploadFiles.length && !remoteMetadata) return;
    if (
      (uploadMode === "multi" || uploadMode === "multitrack") &&
      uploadFiles.length < 2
    ) {
      setUploadError(
        uploadMode === "multitrack"
          ? "Chế độ nhiều rãnh cần ít nhất 2 tệp của cùng một phiên ghi."
          : "Chế độ nhiều tệp cần chọn ít nhất 2 tệp.",
      );
      return;
    }
    setUploadStatus("uploading");
    setUploadError("");
    try {
      let res: Response;
      if (uploadFiles.length) {
        const formData = new FormData();
        uploadFiles.forEach((file) => formData.append("audio", file));
        formData.append("speakerLabels", String(speakerLabels));
        if (speakerLabels) formData.append("speakerCount", speakerCount);
        formData.append("source", "upload");
        formData.append("audioMode", audioMode);
        formData.append("language", transcriptionLanguage);
        formData.append("translateTo", translateTo);
        if (uploadMode === "multitrack") {
          formData.append(
            "trackNames",
            JSON.stringify(
              uploadFiles.map((file) =>
                file.name.replace(/\.[^.]+$/, "").slice(0, 100),
              ),
            ),
          );
          formData.append(
            "sessionName",
            `${uploadFiles[0].name.replace(/\.[^.]+$/, "")} - Nhieu-ranh.mp3`,
          );
        }
        if (activeFolderId) {
          formData.append("folderId", String(activeFolderId));
        }
        if (normalizedExpectedDuration) {
          formData.append(
            "expectedDuration",
            String(normalizedExpectedDuration),
          );
        }
        const endpoint =
          uploadMode === "multitrack"
            ? `${API_URL}/api/transcribe/multitrack`
            : uploadFiles.length > 1
              ? `${API_URL}/api/transcribe/batch`
              : `${API_URL}/api/transcribe`;
        res = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
      } else {
        res = await fetch(`${API_URL}/api/transcribe/url`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: remoteMetadata!.url,
            rightsAccepted: linkRightsAccepted,
            speakerLabels,
            speakerCount: speakerLabels ? speakerCount : null,
            audioMode,
            language: transcriptionLanguage,
            translateTo,
            folderId: activeFolderId,
          }),
        });
      }
      const data = (await res.json()) as {
        id?: number;
        batchId?: string;
        jobId?: number;
        status?: "queued" | "processing" | "completed" | "failed";
        progress?: number;
        queuePosition?: number;
        estimatedRemainingSeconds?: number | null;
        expectedDurationSeconds?: number;
        error?: string;
        filename?: string;
        fileSize?: number;
        createdAt?: string;
        quota?: QuotaStatus;
        message?: string;
        jobs?: Array<{
          id: number;
          jobId: number;
          status: "queued" | "processing";
          progress: number;
          expectedDurationSeconds?: number;
          filename: string;
          createdAt?: string;
          folderId?: number;
          folderName?: string;
        }>;
        rejected?: Array<{ filename: string; error: string }>;
      };
      if (!res.ok) {
        if (data.quota) setQuota(data.quota);
        setUploadError(data.error ?? "Chuyển đổi thất bại");
        setUploadStatus("error");
        return;
      }
      setUploadStatus("queued");
      if (uploadMode === "multitrack" && data.batchId) {
        setMultitrackBatchId(data.batchId);
      } else {
        setMultitrackBatchId(null);
      }
      if (data.rejected?.length) {
        setUploadError(
          `${data.rejected.length} tệp chưa được xếp hàng: ${data.rejected.map((item) => item.filename).join(", ")}`,
        );
      }
      if (data.jobId) {
        setQueuedJob({
          id: data.jobId,
          status: data.status === "processing" ? "processing" : "queued",
          progress: Number(data.progress || 0),
          queuePosition: data.queuePosition || 1,
          estimatedRemainingSeconds: normalizeEstimatedRemainingSeconds(
            data.estimatedRemainingSeconds,
          ),
        });
      }
      setQuotaRefreshKey((key) => key + 1);
      if (data.quota) setQuota(data.quota);
      const acceptedJobs = data.jobs?.length
        ? data.jobs
        : data.id
          ? [
              {
                id: data.id,
                jobId: data.jobId ?? 0,
                status: data.status === "processing" ? "processing" : "queued",
                progress: data.progress ?? 0,
                expectedDurationSeconds: data.expectedDurationSeconds,
                filename: data.filename ?? selectedFilename,
                createdAt: data.createdAt ?? new Date().toISOString(),
              },
            ]
          : [];
      if (
        uploadMode === "multitrack" &&
        acceptedJobs[0] &&
        !data.jobId
      ) {
        setQueuedJob({
          id: acceptedJobs[0].jobId,
          status: "queued",
          progress: 0,
          queuePosition: 1,
          estimatedRemainingSeconds: normalizedExpectedDuration,
        });
      }
      if (acceptedJobs.length && uploadMode !== "multitrack") {
        setHistory((prev) =>
          [
            ...acceptedJobs.map((job) => ({
              id: job.id,
              filename: job.filename,
              file_size:
                acceptedJobs.length === 1 ? selectedFileSize : undefined,
              duration:
                normalizeMediaDuration(job.expectedDurationSeconds) ??
                (acceptedJobs.length === 1
                  ? normalizedExpectedDuration
                  : null),
              text: "",
              status: job.status,
              progress: job.progress,
              job_id: job.jobId || null,
              folder_id: job.folderId ?? activeFolderId,
              folder_name: job.folderName ?? activeFolderName,
              created_at: job.createdAt ?? new Date().toISOString(),
            })),
            ...prev.filter(
              (item) => !acceptedJobs.some((job) => job.id === item.id),
            ),
          ].slice(0, HISTORY_PREVIEW_LIMIT),
        );
      }
    } catch {
      setUploadError("Không thể kết nối đến máy chủ");
      setUploadStatus("error");
    }
  }

  async function handleCancelQueuedJob() {
    if (!queuedJob || !token) return;
    try {
      const response = await fetch(
        multitrackBatchId
          ? `${API_URL}/api/transcribe/multitrack/${multitrackBatchId}`
          : `${API_URL}/api/transcribe/jobs/${queuedJob.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Không hủy được tác vụ");
      setQueuedJob(null);
      setMultitrackBatchId(null);
      setUploadStatus("idle");
      setUploadError("");
      setQuotaRefreshKey((key) => key + 1);
    } catch (cancelError) {
      setUploadError(
        cancelError instanceof Error
          ? cancelError.message
          : "Không hủy được tác vụ xử lý.",
      );
    }
  }

  async function handleCopy() {
    const text = editRef.current?.textContent ?? transcription;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDownload() {
    const text = editRef.current?.textContent ?? transcription;
    const translated = translation?.text?.trim();
    const translationTargetLanguage = translation?.targetLanguage ?? "auto";
    const lines = translated
      ? [
          "Văn bản gốc",
          "",
          text,
          "",
          `Bản dịch (${languageLabel(translationTargetLanguage)})`,
          "",
          translated,
        ]
      : text.split("\n");
    const baseName = selectedFilename.replace(/\.[^.]+$/, "") || "van-ban";
    const doc = new Document({
      sections: [
        {
          children: lines.map(
            (line) =>
              new Paragraph({
                children: [new TextRun(line)],
              }),
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

  function handleDownloadTxt() {
    const text = editRef.current?.textContent ?? transcription;
    const translated = translation?.text?.trim();
    const translationTargetLanguage = translation?.targetLanguage ?? "auto";
    const content = translated
      ? [
          "Văn bản gốc",
          "",
          text,
          "",
          `Bản dịch (${languageLabel(translationTargetLanguage)})`,
          "",
          translated,
        ].join("\n")
      : text;
    const baseName = selectedFilename.replace(/\.[^.]+$/, "") || "van-ban";
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setWords([]);
    setUploadFiles([]);
    setRemoteMetadata(null);
    setVideoLink("");
    setLinkRightsAccepted(false);
    setLinkMetadataLoading(false);
    setUploadStatus("idle");
    setTranscription("");
    setTranslation(null);
    setTranslationError("");
    setUploadError("");
    setDuration(null);
    setExpectedDuration(null);
    setQueuedJob(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleCreateFolder() {
    const name = folderName.trim();
    if (!name || !token) return;
    setFolderError("");
    try {
      const response = await fetch(`${API_URL}/api/transcribe/folders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        folder?: WorkspaceFolder;
        error?: string;
      };
      if (!response.ok || !body.folder) {
        throw new Error(body.error || "Không tạo được thư mục");
      }
      setFolders((current) => [...current, body.folder!]);
      setActiveFolderId(body.folder.id);
      setFolderOpen(false);
      setFolderName("Dự án mới");
    } catch (error) {
      setFolderError(
        error instanceof Error ? error.message : "Không tạo được thư mục",
      );
    }
  }

  async function handleMediaLink() {
    if (!videoLink.trim()) {
      setUploadError(
        "Hãy dán liên kết âm thanh hoặc nội dung nghe nhìn công khai trước khi tiếp tục.",
      );
      return;
    }
    if (!linkRightsAccepted) {
      setUploadError(
        "Hãy xác nhận bạn sở hữu nội dung nghe nhìn hoặc được phép sử dụng nội dung này.",
      );
      return;
    }
    if (quota?.isLimitReached) {
      setUploadError(
        "Tài khoản đã hết thời lượng. Vui lòng nâng cấp gói cước.",
      );
      return;
    }

    setLinkMetadataLoading(true);
    setUploadError("");
    try {
      const response = await fetch(`${API_URL}/api/transcribe/url/metadata`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: videoLink.trim(),
          rightsAccepted: linkRightsAccepted,
        }),
      });
      const data = (await response.json()) as {
        metadata?: RemoteMediaMetadata;
        quota?: QuotaStatus;
        error?: string;
      };
      if (!response.ok || !data.metadata) {
        if (data.quota) setQuota(data.quota);
        throw new Error(
          data.error || "Không đọc được nội dung từ liên kết này.",
        );
      }
      setRemoteMetadata(data.metadata);
      setVideoLink(data.metadata.url);
      setExpectedDuration(data.metadata.durationSeconds);
      setUploadStatus("idle");
      setTranscription("");
      setTranslation(null);
      setTranslationError("");
      setDuration(null);
      setWords([]);
      if (data.quota) setQuota(data.quota);
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Không đọc được nội dung từ liên kết này.",
      );
    } finally {
      setLinkMetadataLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AuthenticatedHeader />

      <input
        ref={fileInputRef}
        type="file"
        multiple={uploadMode === "multi" || uploadMode === "multitrack"}
        accept={fileAcceptValue(supportedFormats)}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void handleFileSelect(files);
        }}
      />

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-6 md:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          <div className="mb-5">
            <div className="mb-4 flex items-center gap-3">
              <Heart className="h-8 w-8 text-[#ffcb05]" />
              <h1 className="text-2xl font-light tracking-tight text-foreground md:text-3xl">
                Chào mừng, {user.firstName}
              </h1>
            </div>

            <Link
              to="/dashboard"
              className="mb-3 flex items-center justify-center rounded-md border border-border bg-card/75 px-4 py-2 text-sm font-bold text-foreground/85 shadow-soft transition hover:border-primary/45 hover:bg-primary/5 hover:text-primary"
            >
              <Home className="mr-2 h-4 w-4 text-primary" />
              Không gian làm việc
            </Link>

            <div className="grid grid-cols-[1fr_1fr_44px] gap-2 sm:flex">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90"
              >
                <Upload className="h-4 w-4" />
                TẢI TỆP
              </button>
              <button
                onClick={() => setFolderOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-white px-4 py-2.5 text-sm font-black text-foreground transition hover:border-primary/50 hover:text-primary"
              >
                <FolderPlus className="h-4 w-4" />
                THƯ MỤC MỚI
              </button>
              <button
                onClick={() => {
                  if (transcription) {
                    void handleDownload();
                    return;
                  }
                  setActionDialog({
                    title: "Tải văn bản",
                    description:
                      "Bạn cần tải tệp lên và chuyển thành văn bản xong trước khi tải tệp .docx.",
                    ctaLabel: "Chọn tệp",
                    to: "choose-file",
                  });
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                title="Tải văn bản"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>

            <UploadWorkflowSteps
              hasFile={hasSelectedSource}
              status={uploadStatus}
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-white shadow-soft">
            <div className="border-b border-border bg-[#fbf8ef] px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">
                    Dự án mới
                  </p>
                  <label className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Folder className="h-4 w-4 text-primary" />
                    <span className="sr-only">Chọn thư mục</span>
                    <select
                      value={activeFolderId ?? ""}
                      onChange={(event) =>
                        setActiveFolderId(Number(event.target.value) || null)
                      }
                      className="max-w-64 bg-transparent font-semibold outline-none"
                    >
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  {history.length + (hasSelectedSource ? 1 : 0)} items
                </div>
              </div>
            </div>

            {historyError && (
              <div className="m-4 flex flex-col gap-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
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

            {!hasSelectedSource && (
              <div className="m-4 space-y-4">
                <section className="rounded-xl border border-border bg-[#fbf8ef] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-foreground">
                        1. Chọn nguồn cần chuyển đổi
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Chọn một tệp, nhiều tệp độc lập hoặc liên kết âm thanh/nội dung nghe nhìn
                        công khai.
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-primary">
                      <ListChecks className="h-3.5 w-3.5" />
                      Bước đầu tiên
                    </span>
                  </div>
                  <div className="mt-4">
                    <UploadModeSelector
                      mode={uploadMode}
                      setMode={setUploadMode}
                    />
                  </div>
                </section>

                {uploadMode === "link" ? (
                  <MediaLinkPanel
                    videoLink={videoLink}
                    setVideoLink={setVideoLink}
                    rightsAccepted={linkRightsAccepted}
                    setRightsAccepted={setLinkRightsAccepted}
                    loading={linkMetadataLoading}
                    error={uploadError}
                    onSubmit={handleMediaLink}
                    onChooseFile={() => fileInputRef.current?.click()}
                  />
                ) : (
                  <FileDropzone
                    isDragging={isDragging}
                    mode={uploadMode}
                    formats={supportedFormats}
                    onChooseFile={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                  />
                )}

                <UploadRequirements
                  mode={uploadMode}
                  maxUploadMb={quota?.limits.maxUploadMb ?? MAX_MB}
                  maxFileSeconds={quota?.limits.maxFileSeconds ?? null}
                />
              </div>
            )}

            {hasSelectedSource && (
              <VbeeFileCard
                filename={selectedFilename}
                fileSize={selectedFileSize}
                status={uploadStatus}
                duration={duration ?? expectedDuration}
                date={new Date().toISOString()}
                error={uploadError}
                onClear={reset}
              >
                {uploadStatus !== "done" && (
                  <UploadTimeEstimatePanel
                    audioMode={audioMode}
                    expectedDuration={expectedDuration}
                    pendingUploadSeconds={pendingUploadSeconds}
                    projectedRemainingSeconds={projectedRemainingSeconds}
                    quota={quota}
                    uploadStatus={uploadStatus}
                  />
                )}

                {uploadStatus === "idle" && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border bg-background/45 p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <SlidersHorizontal className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-black">
                            2. Thiết lập chuyển đổi
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Chọn ngôn ngữ và cách tạo văn bản trước khi gửi tệp
                            lên máy chủ.
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {[
                          {
                            value: "speech" as const,
                            title: "Lời nói rõ",
                            description: "Họp, podcast, phỏng vấn, bài giảng.",
                          },
                          {
                            value: "song" as const,
                            title: "Bài hát / nhạc nền",
                            description:
                              "Ưu tiên tách giọng hát bằng Demucs trước khi tạo văn bản.",
                          },
                        ].map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => {
                              setAudioMode(item.value);
                              if (
                                item.value === "song" &&
                                speakerLabels &&
                                speakerCount === "auto"
                              ) {
                                setSpeakerCount("2");
                              }
                            }}
                            className={`rounded-lg border px-3 py-3 text-left transition ${
                              audioMode === item.value
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background/40 hover:border-primary/40"
                            }`}
                          >
                            <span className="block text-xs font-black">
                              {item.title}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                              {item.description}
                            </span>
                          </button>
                        ))}
                      </div>
                      {audioMode === "song" && (
                        <p className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5 text-primary">
                          Máy chủ tách phần giọng hát bằng Demucs; nếu Demucs không
                          khả dụng, hệ thống tự dùng ffmpeg để làm rõ giọng hát.
                        </p>
                      )}
                    </div>

                    <label className="flex items-center justify-between rounded-xl border border-border bg-background/45 px-4 py-3">
                      <div>
                        <p className="text-sm font-bold">Gắn nhãn người nói</p>
                        <p className="text-xs text-muted-foreground">
                          {audioMode === "song"
                            ? "Phân biệt ca sĩ/giọng hát sau khi tách giọng; độ chính xác phụ thuộc chất lượng bản nhạc"
                            : "Phân biệt và đánh dấu từng người trong đoạn ghi âm"}
                        </p>
                      </div>
                      <span
                        className={`relative h-6 w-11 rounded-full transition-colors ${
                          speakerLabels ? "bg-primary" : "bg-muted"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                            speakerLabels ? "translate-x-5" : "translate-x-0.5"
                          }`}
                        />
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={speakerLabels}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSpeakerLabels(checked);
                            if (
                              checked &&
                              audioMode === "song" &&
                              speakerCount === "auto"
                            ) {
                              setSpeakerCount("2");
                            }
                          }}
                        />
                      </span>
                    </label>
                    {speakerLabels && (
                      <label className="rounded-xl border border-border bg-background/45 px-4 py-3 text-left">
                        <span className="text-sm font-bold">
                          Số người/giọng dự kiến
                        </span>
                        <select
                          value={speakerCount}
                          onChange={(event) =>
                            setSpeakerCount(event.target.value)
                          }
                          className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold outline-none focus:border-primary"
                        >
                          {SPEAKER_COUNT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                          Nếu biết chính xác có bao nhiêu người hoặc ca sĩ, hãy
                          chọn số đó để tránh một giọng bị tách thành nhiều nhãn.
                        </span>
                      </label>
                    )}
                    <div className="grid gap-3">
                      <label className="rounded-xl border border-border bg-background/45 px-4 py-3 text-left">
                        <span className="text-sm font-bold">
                          Ngôn ngữ âm thanh
                        </span>
                        <select
                          value={transcriptionLanguage}
                          onChange={(e) =>
                            setTranscriptionLanguage(e.target.value)
                          }
                          className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold outline-none focus:border-primary"
                        >
                          {UPLOAD_LANGUAGE_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                        <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                          {transcriptionLanguage === "multi"
                            ? "Giữ nguyên tiếng Việt và tiếng Anh theo từng đoạn, không dịch hoặc ép toàn bộ bài sang một ngôn ngữ."
                            : "Chọn đúng ngôn ngữ chính để tăng độ chính xác; chỉ dùng tự nhận diện khi chưa biết ngôn ngữ của tệp."}
                        </span>
                      </label>
                    </div>
                    <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5 text-muted-foreground">
                      Hệ thống tạo văn bản gốc trước. Sau khi nghe lại và
                      sửa nội dung, bạn có thể chọn ngôn ngữ dịch trong trình
                      biên tập để bản dịch chính xác hơn.
                    </p>
                    <button
                      onClick={() => void handleUpload()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90"
                    >
                      <Zap className="h-4 w-4" />
                      Bắt đầu chuyển đổi
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {uploadStatus === "uploading" && (
                  <ProcessingPanel translateTo={translateTo} />
                )}

                {uploadStatus === "queued" && (
                  <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-primary/35 border-t-primary animate-spin" />
                      <div>
                        <p className="text-sm font-black text-primary">
                          {queuedJob?.status === "processing"
                            ? "Vbee đang chuyển đổi tệp"
                            : "Tệp đã được đưa vào hàng đợi xử lý"}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Bạn có thể rời trang hoặc tiếp tục tải tệp khác. Vbee
                          sẽ xử lý nền và cập nhật văn bản trong Lịch sử.
                        </p>
                        <p className="mt-2 text-xs font-bold text-primary">
                          {queuedJob?.status === "processing"
                            ? `Tiến độ: ${queuedJob.progress || 10}%.`
                            : `Vị trí hàng đợi: ${queuedJob?.queuePosition || 1}.`}
                          {queuedJob?.estimatedRemainingSeconds
                            ? ` Dự kiến còn ${formatQuotaTime(queuedJob.estimatedRemainingSeconds)}.`
                            : " Đang tính thời gian chờ."}
                        </p>
                      </div>
                    </div>
                    <Link
                      to="/history"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90"
                    >
                      Xem tiến độ trong Lịch sử
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleCancelQueuedJob()}
                      className="inline-flex w-full items-center justify-center rounded-xl border border-primary/25 px-4 py-2.5 text-xs font-black text-primary transition hover:bg-primary/10"
                    >
                      Hủy xử lý
                    </button>
                  </div>
                )}

                {uploadStatus === "error" && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
                      {uploadError}
                    </div>
                    <button
                      onClick={reset}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-bold transition hover:bg-card"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Thử lại
                    </button>
                  </div>
                )}

                {uploadStatus === "done" && (
                  <div className="space-y-4">
                    {audioUrl && (
                      <div className="rounded-xl border border-border bg-background/45 p-4">
                        <p className="mb-3 text-xs font-semibold text-muted-foreground">
                          Nghe lại - từ đang phát sẽ được highlight, nhấn vào từ
                          để tua
                        </p>
                        <audio
                          ref={audioRef}
                          src={audioUrl}
                          controls
                          onTimeUpdate={handleTimeUpdate}
                          className="w-full"
                        />
                      </div>
                    )}

                    {words.length > 0 ? (
                      <div className="rounded-xl border border-border bg-background/45 px-5 py-4">
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">
                          Văn bản - có thể chỉnh sửa trực tiếp
                        </p>
                        <div
                          ref={editRef}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={() => {
                            if (editRef.current) {
                              setTranscription(
                                editRef.current.textContent ?? "",
                              );
                            }
                          }}
                          className="max-h-64 min-h-24 overflow-y-auto whitespace-pre-wrap text-sm leading-[2.2] text-foreground outline-none"
                        />
                      </div>
                    ) : (
                      <textarea
                        value={transcription}
                        rows={8}
                        onChange={(e) => setTranscription(e.target.value)}
                        className="w-full resize-y rounded-xl border border-border bg-background/45 px-5 py-4 text-sm leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    )}

                    {translation?.text && (
                      <div className="rounded-xl border border-primary/30 bg-primary/10 px-5 py-4">
                        <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-primary">
                          Bản dịch {languageLabel(translation.targetLanguage)}
                        </p>
                        <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                          {translation.text}
                        </p>
                      </div>
                    )}

                    {translationError && (
                      <div className="rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
                        Văn bản gốc đã tạo xong, nhưng chưa dịch được:{" "}
                        {translationError}
                      </div>
                    )}

                    <div className="grid gap-2 sm:grid-cols-3">
                      <button
                        onClick={() => void handleCopy()}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-bold transition hover:border-primary/50 hover:text-primary"
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                        {copied ? "Đã sao chép" : "Sao chép"}
                      </button>
                      <button
                        onClick={handleDownloadTxt}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-black text-primary transition hover:bg-primary/20"
                      >
                        <Download className="h-4 w-4" />
                        Tải .txt
                      </button>
                      <button
                        onClick={() => void handleDownload()}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90"
                      >
                        <Download className="h-4 w-4" />
                        Tải xuống .docx
                      </button>
                    </div>
                  </div>
                )}
              </VbeeFileCard>
            )}

            {history.map((item) => (
              <VbeeFileCard
                key={item.id}
                filename={item.filename}
                fileSize={item.file_size}
                status={
                  item.status === "completed" || !item.status
                    ? "done"
                    : item.status === "processing"
                      ? "uploading"
                      : item.status === "failed"
                        ? "error"
                        : item.status
                }
                duration={item.duration}
                date={item.created_at}
                error={
                  item.error_message || item.translation_error || undefined
                }
                compact
              />
            ))}

            <div className="border-t border-border bg-[#fbf8ef] px-5 py-3 text-center text-sm font-black text-primary">
              {history.length + (hasSelectedSource ? 1 : 0)} items,{" "}
              {formatDuration(totalDuration)}
            </div>
          </div>
        </section>

        <VbeePreferencesSidebar
          firstName={user.firstName}
          refreshKey={quotaRefreshKey}
          onQuotaChange={setQuota}
        />
      </main>

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo thư mục mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Thư mục mới sẽ được chọn cho không gian tải tệp hiện tại.
            </p>
            <input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
              placeholder="Tên thư mục"
            />
            {folderError && (
              <p className="text-sm text-destructive">{folderError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setFolderOpen(false)}
                className="flex-1 rounded-full border border-border px-4 py-2.5 text-sm font-bold transition hover:bg-background"
              >
                Hủy
              </button>
              <button
                onClick={() => void handleCreateFolder()}
                className="flex-1 rounded-full bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90"
              >
                Tạo thư mục
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
                    if (to === "choose-file") {
                      fileInputRef.current?.click();
                    } else if (to) {
                      void navigate({ to });
                    }
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

      <VbeeStyleFooter />
    </div>
  );
}

function FileDropzone({
  isDragging,
  mode,
  formats,
  onChooseFile,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  isDragging: boolean;
  mode: Exclude<UploadMode, "link">;
  formats: string[];
  onChooseFile: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  const multitrack = mode === "multitrack";
  const multipleFiles = mode === "multi" || multitrack;

  return (
    <div
      onClick={onChooseFile}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${
        isDragging
          ? "border-primary bg-primary/15"
          : "border-border bg-white hover:border-primary/50 hover:bg-primary/5"
      }`}
    >
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {multipleFiles ? (
          <AudioLines className="h-6 w-6" />
        ) : (
          <UploadCloud className="h-6 w-6" />
        )}
      </span>
      <p className="mt-3 text-base font-black text-foreground">
        {multitrack
          ? "Chọn từ 2 đến 5 rãnh"
          : multipleFiles
            ? "Chọn từ 2 đến 8 tệp"
            : "Kéo thả tệp vào đây"}
      </p>
      <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
        {multitrack
          ? "Mỗi rãnh phải là một micrô/người nói của cùng phiên và bắt đầu cùng thời điểm."
          : multipleFiles
            ? "Mỗi tệp sẽ tạo một văn bản riêng và cùng được lưu trong thư mục đã chọn."
          : "Hoặc nhấn để chọn một tệp âm thanh hoặc nội dung nghe nhìn từ máy tính."}
      </p>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onChooseFile();
        }}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-black text-primary-foreground shadow-glow transition hover:opacity-90"
      >
        <Upload className="h-3.5 w-3.5" />
        Chọn tệp
      </button>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {formats.map((format) => (
          <span
            key={format}
            className="rounded-full border border-border bg-[#fbf8ef] px-2.5 py-1 text-[11px] font-bold text-muted-foreground"
          >
            {format.toUpperCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

function MediaLinkPanel({
  videoLink,
  setVideoLink,
  rightsAccepted,
  setRightsAccepted,
  loading,
  error,
  onSubmit,
  onChooseFile,
}: {
  videoLink: string;
  setVideoLink: (value: string) => void;
  rightsAccepted: boolean;
  setRightsAccepted: (value: boolean) => void;
  loading: boolean;
  error: string;
  onSubmit: () => void;
  onChooseFile: () => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Link2 className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-black">
            Liên kết âm thanh hoặc nội dung nghe nhìn công khai
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Hỗ trợ từng nội dung từ YouTube, SoundCloud, TikTok, Facebook,
            Instagram, Vimeo và podcast công khai. Không hỗ trợ playlist,
            livestream, nội dung cần đăng nhập hoặc DRM.
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Khả năng nhập phụ thuộc quyền công khai và phản hồi của từng nền
            tảng tại thời điểm xử lý.
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Liên kết Spotify không chứa luồng âm thanh công khai; hãy tải lên tệp bạn
            sở hữu hoặc được phép sử dụng.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={videoLink}
          onChange={(event) => setVideoLink(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-[#fbf8ef] px-3 py-2.5 text-sm outline-none transition focus:border-primary"
          placeholder="Dán liên kết YouTube, SoundCloud, TikTok, Vimeo..."
          disabled={loading}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90 disabled:cursor-wait disabled:opacity-65"
        >
          {loading ? (
            <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin" />
          ) : (
            <FileVideo className="h-4 w-4" />
          )}
          {loading ? "Đang kiểm tra" : "Dùng liên kết"}
        </button>
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-[#fbf8ef] px-3 py-3">
        <input
          type="checkbox"
          checked={rightsAccepted}
          onChange={(event) => setRightsAccepted(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span className="text-xs leading-5 text-muted-foreground">
          Tôi sở hữu nội dung này hoặc đã được chủ sở hữu cho phép sử dụng để
          tạo văn bản.
        </span>
      </label>
      {error && (
        <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-xs leading-5 text-destructive">
          {error}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
        <p className="inline-flex items-center gap-2 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
          Liên kết được kiểm tra thời lượng, thời lượng sử dụng và đưa vào hàng đợi như tệp tải
          lên.
        </p>
        <button
          type="button"
          onClick={onChooseFile}
          className="text-xs font-black text-primary underline underline-offset-4"
        >
          Chọn tệp từ máy
        </button>
      </div>
    </section>
  );
}

function UploadRequirements({
  mode,
  maxUploadMb,
  maxFileSeconds,
}: {
  mode: UploadMode;
  maxUploadMb: number;
  maxFileSeconds: number | null;
}) {
  const multitrack = mode === "multitrack";
  const multipleFiles = mode === "multi";
  const linkMode = mode === "link";

  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 text-primary" />
        <p className="text-sm font-black">Điều kiện trước khi tải</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <p className="text-xs font-black text-foreground">Định dạng</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Âm thanh và nội dung nghe nhìn có trong danh sách hiển thị phía trên.
          </p>
        </div>
        <div>
          <p className="text-xs font-black text-foreground">Giới hạn gói</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Tối đa {maxUploadMb} MB
            {maxFileSeconds
              ? `, ${formatQuotaTime(maxFileSeconds)}/tệp`
              : " mỗi tệp"}
            .
          </p>
        </div>
        <div>
          <p className="text-xs font-black text-foreground">Đa ngôn ngữ</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Chọn “Tự nhận diện nhiều ngôn ngữ” tại bước thiết lập.
          </p>
        </div>
        <div>
          <p className="text-xs font-black text-foreground">
            {linkMode
              ? "Liên kết"
              : multitrack
                ? "Nhiều rãnh"
                : multipleFiles
                  ? "Nhiều tệp"
                  : "Bản dịch"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {linkMode
              ? "Chỉ dùng liên kết công khai, không cần đăng nhập."
              : multitrack
                ? "Từ 2–5 rãnh đồng bộ sẽ được ghép thành một văn bản với tên người nói riêng."
                : multipleFiles
                ? "Tối đa 8 tệp mỗi lần; mỗi tệp tạo một văn bản riêng trong cùng thư mục."
                : "Bản dịch được tạo trong trình biên tập sau khi bạn kiểm tra văn bản gốc."}
          </p>
        </div>
      </div>
    </section>
  );
}

function ProcessingPanel({ translateTo }: { translateTo: string }) {
  const phases = [
    ["Đang gửi tệp", "Tải tệp an toàn lên máy chủ Vbee."],
    [
      "Đang phân tích âm thanh gốc",
      "Nhận diện lời nói, lời hát, thời lượng và người nói từ bản mix ban đầu.",
    ],
    [
      "Đang tạo văn bản",
      translateTo === "none"
        ? "Văn bản sẽ sẵn sàng để nghe lại và biên tập."
        : "Sau văn bản gốc, hệ thống sẽ tạo thêm bản dịch đã chọn.",
    ],
  ];

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/10 p-4">
      <div className="flex items-center gap-3">
        <span className="block h-7 w-7 shrink-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <div>
          <p className="text-sm font-black text-primary">
            Vbee đang chuyển đổi tệp
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Không đóng trang này cho đến khi trạng thái hoàn tất.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {phases.map(([title, description], index) => (
          <div
            key={title}
            className="rounded-lg border border-primary/15 bg-white/80 px-3 py-2.5"
          >
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${index === 0 ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}
            >
              {index === 0 ? (
                <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
              ) : (
                index + 1
              )}
            </span>
            <p className="mt-2 text-xs font-black text-foreground">{title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function UploadTimeEstimatePanel({
  audioMode,
  expectedDuration,
  pendingUploadSeconds,
  projectedRemainingSeconds,
  quota,
  uploadStatus,
}: {
  audioMode: AudioMode;
  expectedDuration: number | null;
  pendingUploadSeconds: number;
  projectedRemainingSeconds: number | null;
  quota: QuotaStatus | null;
  uploadStatus: UploadStatus;
}) {
  const durationLabel =
    expectedDuration !== null
      ? formatQuotaTime(Math.ceil(expectedDuration))
      : "Chưa đọc được";
  const remainingLabel = quota
    ? formatQuotaTime(quota.remainingSeconds)
    : "Đang tải";
  const projectedLabel =
    projectedRemainingSeconds !== null
      ? formatQuotaTime(projectedRemainingSeconds)
      : "Chưa tính được";
  const quotaPercent =
    quota && pendingUploadSeconds > 0
      ? Math.min(
          100,
          Math.round(
            (pendingUploadSeconds / Math.max(1, quota.remainingSeconds)) * 100,
          ),
        )
      : 0;
  const processingMinutes =
    expectedDuration === null
      ? null
      : Math.max(1, Math.ceil(expectedDuration / 75));

  return (
    <div className="mb-4 rounded-lg border border-border bg-[#fbf8ef] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-black text-primary">
          <Clock className="h-4 w-4" />
          Tính thời gian tải lên
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-primary">
          {uploadStatus === "uploading"
            ? "Đang gửi tệp"
            : uploadStatus === "queued"
              ? "Đã xếp hàng"
              : "Ước tính trước"}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <div className="rounded-md bg-white px-3 py-2.5">
          <p className="text-xs font-bold text-muted-foreground">
            Thời lượng tệp
          </p>
          <p className="mt-1 text-lg font-black text-foreground">
            {durationLabel}
          </p>
        </div>
        <div className="rounded-md bg-white px-3 py-2.5">
          <p className="text-xs font-bold text-muted-foreground">
            Xử lý dự kiến
          </p>
          <p className="mt-1 text-lg font-black text-foreground">
            {processingMinutes === null
              ? "Đang đọc"
              : `~${processingMinutes} phút`}
          </p>
        </div>
        <div className="rounded-md bg-white px-3 py-2.5">
          <p className="text-xs font-bold text-muted-foreground">Gói còn lại</p>
          <p className="mt-1 text-lg font-black text-foreground">
            {remainingLabel}
          </p>
        </div>
        <div className="rounded-md bg-white px-3 py-2.5">
          <p className="text-xs font-bold text-muted-foreground">
            Sau khi xử lý
          </p>
          <p className="mt-1 text-lg font-black text-primary">
            {projectedLabel}
          </p>
        </div>
      </div>

      {pendingUploadSeconds > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 text-xs font-bold text-muted-foreground">
            <span>Thời lượng dự kiến dùng</span>
            <span>{formatQuotaTime(pendingUploadSeconds)}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-card">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${quotaPercent}%` }}
            />
          </div>
        </div>
      )}

      <p className="mt-3 text-xs font-semibold leading-5 text-muted-foreground">
        {audioMode === "song"
          ? "Tệp nhạc có thể lâu hơn vì máy chủ cần tách giọng hát trước khi chuyển thành văn bản."
          : "Đây là ước tính theo thời lượng tệp; thời gian thực tế phụ thuộc kích thước tệp và tải máy chủ."}
      </p>
    </div>
  );
}

function VbeeFileCard({
  filename,
  fileSize,
  status,
  duration,
  date,
  error,
  compact = false,
  children,
  onClear,
}: {
  filename: string;
  fileSize?: number;
  status: UploadStatus;
  duration?: number | null;
  date: string;
  error?: string;
  compact?: boolean;
  children?: ReactNode;
  onClear?: () => void;
}) {
  const Icon = getFileIcon(filename);
  const statusLabel =
    status === "done"
      ? "Đã chuyển đổi"
      : status === "uploading"
        ? "Đang xử lý"
        : status === "queued"
          ? "Đang chờ"
          : status === "error"
            ? "Lỗi"
            : status === "cancelled"
              ? "Đã hủy"
              : "Sẵn sàng";

  return (
    <div className="border-t border-border px-4 py-4">
      <div className="grid gap-y-3 text-sm sm:grid-cols-[120px_minmax(0,1fr)]">
        <p className="font-black text-muted-foreground">Tên tệp</p>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 font-semibold text-primary">
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{filename}</span>
          </span>
          {onClear && (
            <button
              onClick={onClear}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <p className="font-black text-muted-foreground">Trạng thái</p>
        <div>
          <span
            className={`inline-flex min-w-36 items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-black ${
              status === "error" || status === "cancelled"
                ? "bg-destructive/15 text-destructive"
                : status === "idle"
                  ? "bg-primary/10 text-primary"
                  : status === "queued" || status === "uploading"
                    ? "bg-primary/10 text-primary"
                    : "bg-emerald-500 text-white"
            }`}
          >
            {status === "uploading" || status === "queued" ? (
              <span className="h-3 w-3 rounded-full border-2 border-primary/35 border-t-primary animate-spin" />
            ) : status === "error" || status === "cancelled" ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {statusLabel}
          </span>
          {error && (
            <p className="mt-2 text-xs font-semibold text-destructive">
              {error}
            </p>
          )}
        </div>

        <p className="font-black text-muted-foreground">Thời lượng</p>
        <div className="flex flex-wrap items-center gap-3 font-semibold">
          <span>{formatDuration(duration)}</span>
          {fileSize ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <HardDrive className="h-3.5 w-3.5" />
              {formatBytes(fileSize)}
            </span>
          ) : null}
        </div>

        <p className="font-black text-muted-foreground">Ngày tạo</p>
        <p className="font-semibold">{formatDate(date)}</p>
      </div>

      {!compact && children && <div className="mt-4">{children}</div>}
    </div>
  );
}

function UploadWorkflowSteps({
  hasFile,
  status,
}: {
  hasFile: boolean;
  status: UploadStatus;
}) {
  const steps = [
    ["1", "Nguồn", "Chọn một tệp, nhiều tệp hoặc liên kết âm thanh/nội dung nghe nhìn"],
    ["2", "Cài đặt", "Ngôn ngữ, người nói và thư mục"],
    ["3", "Chuyển đổi", "AI xử lý và tạo văn bản"],
    ["4", "Biên tập", "Nghe lại, sửa, sao chép và xuất tệp"],
  ];
  const activeIndex =
    status === "done"
      ? 3
      : status === "uploading" || status === "queued"
        ? 2
        : hasFile
          ? 1
          : 0;

  return (
    <div className="mt-4 grid gap-2 md:grid-cols-4">
      {steps.map(([number, title, desc], index) => {
        const active = index <= activeIndex;
        return (
          <div
            key={title}
            className={`rounded-lg border px-3 py-2.5 transition ${
              active
                ? "border-primary/30 bg-primary/5"
                : "border-border bg-white"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {index < activeIndex ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  number
                )}
              </span>
              <p className="text-sm font-black">{title}</p>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {desc}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function UploadModeSelector({
  mode,
  setMode,
}: {
  mode: UploadMode;
  setMode: (mode: UploadMode) => void;
}) {
  const modes: Array<{
    value: UploadMode;
    title: string;
    desc: string;
    icon: ComponentType<{ className?: string }>;
  }> = [
    {
      value: "single",
      title: "Một tệp",
      desc: "Một tệp âm thanh hoặc nội dung nghe nhìn chính",
      icon: FileAudio,
    },
    {
      value: "multi",
      title: "Nhiều tệp",
      desc: "Tạo văn bản riêng cho từng tệp",
      icon: Mic,
    },
    {
      value: "multitrack",
      title: "Nhiều rãnh",
      desc: "Ghép nhiều micrô thành một văn bản",
      icon: Layers3,
    },
    {
      value: "link",
      title: "Liên kết âm thanh/nội dung nghe nhìn",
      desc: "YouTube, SoundCloud, TikTok, Vimeo...",
      icon: Link2,
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {modes.map((item) => {
        const Icon = item.icon;
        const active = mode === item.value;
        return (
          <button
            key={item.value}
            onClick={() => setMode(item.value)}
            className={`rounded-lg border p-3 text-left transition ${
              active
                ? "border-primary/40 bg-primary/5 text-foreground"
                : "border-border bg-white text-muted-foreground hover:border-primary/40"
            }`}
          >
            <Icon className="mb-3 h-5 w-5 text-primary" />
            <p className="font-black">{item.title}</p>
            <p className="mt-1 text-xs leading-5">{item.desc}</p>
          </button>
        );
      })}
    </div>
  );
}

function VbeeStyleFooter() {
  return (
    <footer className="mt-8 border-t border-border bg-white px-4 py-6 text-center text-sm text-muted-foreground">
      <p>© 2026 Vbee Voice. Đã đăng ký bản quyền.</p>
      <div className="mt-3 flex flex-wrap justify-center gap-x-6 gap-y-2 font-semibold text-primary">
        <Link to="/">Vbee</Link>
        <Link to="/pricing">Bảng giá</Link>
        <Link to="/upload">Tải tệp</Link>
        <Link to="/api">API</Link>
      </div>
      <p className="mt-5 inline-flex items-center justify-center gap-2">
        Được phát triển cho trải nghiệm chuyển giọng nói thành văn bản rõ ràng.
      </p>
    </footer>
  );
}
