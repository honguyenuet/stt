import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Captions,
  Check,
  Clock3,
  Copy,
  Download,
  FileAudio,
  FileText,
  Languages,
  Play,
  Printer,
  RefreshCw,
  Save,
  Users,
} from "lucide-react";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import { useAuth } from "@/context/AuthContext";
import { formatMediaDuration } from "@/lib/format-duration";
import { languageLabel } from "@/lib/language-options";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();
const REQUEST_TIMEOUT_MS = 12_000;
const AUTO_SAVE_DELAY_MS = 1_200;
const MAX_SYNC_WORDS = 5_000;

type SaveStatus = "saved" | "unsaved" | "saving" | "error";
type EditorMode = "sync" | "timestamp";

interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  speaker?: string | number | null;
  confidence?: number | null;
}

interface TranscriptDetail {
  id: number;
  filename: string;
  file_size: number;
  duration: number | null;
  processing_seconds: number | null;
  text: string;
  words: TranscriptWord[];
  audio_filename: string | null;
  source_language: string | null;
  translated_text: string | null;
  translation_target_language: string | null;
  translation_provider: string | null;
  translation_error: string | null;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  error_message: string | null;
  created_at: string;
}

interface IndexedWord extends TranscriptWord {
  index: number;
}

interface TranscriptSegment {
  speaker: string | number | null;
  start: number;
  end: number;
  words: IndexedWord[];
}

export const Route = createFileRoute("/transcript/$id")({
  component: TranscriptEditorPage,
});

function normalizeWords(value: unknown): TranscriptWord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const word = item as Partial<TranscriptWord>;
      const text = String(word.text || "").trim();
      const start = Number(word.start);
      const end = Number(word.end);
      if (!text || !Number.isFinite(start)) return null;
      return {
        text,
        start: Math.max(0, start),
        end: Number.isFinite(end) ? Math.max(start, end) : start,
        speaker: word.speaker ?? null,
        confidence:
          word.confidence == null || !Number.isFinite(Number(word.confidence))
            ? null
            : Number(word.confidence),
      };
    })
    .filter((word): word is TranscriptWord => Boolean(word));
}

function buildSegments(words: TranscriptWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  words.forEach((word, index) => {
    const normalizedSpeaker = word.speaker ?? null;
    const gap = current ? word.start - current.end : 0;
    const speakerChanged =
      current !== null && current.speaker !== normalizedSpeaker;
    const shouldSplit =
      !current || speakerChanged || gap > 1_800 || current.words.length >= 55;

    if (shouldSplit) {
      current = {
        speaker: normalizedSpeaker,
        start: word.start,
        end: word.end,
        words: [],
      };
      segments.push(current);
    }

    current.words.push({ ...word, index });
    current.end = Math.max(current.end, word.end);
  });

  return segments;
}

function formatCaptionTime(milliseconds: number, separator: "," | ".") {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return "Không có";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function speakerLabel(value: string | number | null) {
  if (value === null || value === "") return "Nội dung";
  const raw = String(value);
  const numberMatch = raw.match(/\d+/);
  if (/speaker/i.test(raw) && numberMatch) {
    return `Người nói ${Number(numberMatch[0]) + 1}`;
  }
  return /^\d+$/.test(raw) ? `Người nói ${Number(raw) + 1}` : raw;
}

function joinWords(words: Array<Pick<TranscriptWord, "text">>) {
  return words
    .map((word) => word.text)
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function findActiveWord(words: TranscriptWord[], milliseconds: number) {
  let low = 0;
  let high = words.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (words[middle].start <= milliseconds) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return candidate;
}

function formatClock(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getEditorWordRanges(text: string, words: TranscriptWord[]) {
  const ranges: Array<{ start: number; end: number } | null> = [];
  const tokens = Array.from(text.matchAll(/\S+/g));
  let cursor = 0;
  const lowerText = text.toLowerCase();

  words.forEach((word, index) => {
    const exact = String(word.text || "").trim().toLowerCase();
    if (exact) {
      const found = lowerText.indexOf(exact, cursor);
      if (found >= 0) {
        ranges[index] = { start: found, end: found + exact.length };
        cursor = found + exact.length;
        return;
      }
    }

    const fallback = tokens[index];
    ranges[index] =
      fallback && fallback.index !== undefined
        ? { start: fallback.index, end: fallback.index + fallback[0].length }
        : null;
  });

  return ranges;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function SyncedTranscriptEditor({
  value,
  onChange,
  activeRange,
  wordRanges,
  onWordClick,
}: {
  value: string;
  onChange: (value: string) => void;
  activeRange: { start: number; end: number } | null;
  wordRanges: Array<{ start: number; end: number } | null>;
  onWordClick: (wordIndex: number) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLElement>(null);

  const before = activeRange ? value.slice(0, activeRange.start) : value;
  const active = activeRange ? value.slice(activeRange.start, activeRange.end) : "";
  const after = activeRange ? value.slice(activeRange.end) : "";

  function syncScroll() {
    if (!textareaRef.current || !overlayRef.current) return;
    overlayRef.current.scrollTop = textareaRef.current.scrollTop;
    overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
  }

  function handleClick() {
    const position = textareaRef.current?.selectionStart;
    if (position === undefined) return;
    const wordIndex = wordRanges.findIndex(
      (range) =>
        range !== null && position >= range.start && position <= range.end,
    );
    if (wordIndex >= 0) onWordClick(wordIndex);
  }

  useEffect(() => {
    if (!activeRef.current || !overlayRef.current || !textareaRef.current) {
      return;
    }
    activeRef.current.scrollIntoView({ block: "center", inline: "nearest" });
    textareaRef.current.scrollTop = overlayRef.current.scrollTop;
  }, [activeRange?.start, activeRange?.end]);

  return (
    <div className="relative min-h-[560px] rounded-lg border border-[#ded5e9] bg-[#fbfaf7] focus-within:border-[#ffcb05] focus-within:ring-2 focus-within:ring-[#ffcb05]/20">
      <div
        ref={overlayRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words px-5 py-4 text-[15px] leading-8 text-[#342752]"
      >
        {before}
        {activeRange && (
          <mark
            ref={activeRef}
            className="rounded bg-[#ffcb05] px-0.5 text-[#21104a]"
          >
            {active || " "}
          </mark>
        )}
        {after}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onClick={handleClick}
        onScroll={syncScroll}
        aria-label="Nội dung transcript"
        spellCheck
        className="relative z-10 min-h-[560px] w-full resize-y rounded-lg bg-transparent px-5 py-4 text-[15px] leading-8 text-transparent caret-[#21104a] outline-none selection:bg-[#ffcb05]/35"
      />
    </div>
  );
}

function TranscriptEditorPage() {
  const { id } = Route.useParams();
  const transcriptId = Number.parseInt(id, 10);
  const { user, token, isLoading } = useAuth();
  const navigate = useNavigate();
  const [transcript, setTranscript] = useState<TranscriptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState("");
  const [audioLoading, setAudioLoading] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("sync");
  const [editorText, setEditorText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState("");
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [copied, setCopied] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const loadRequestRef = useRef<AbortController | null>(null);
  const saveRequestRef = useRef<AbortController | null>(null);
  const editorTextRef = useRef("");
  const savedTextRef = useRef("");
  const timestampSegmentRefs = useRef<Array<HTMLElement | null>>([]);

  const words = useMemo(() => transcript?.words ?? [], [transcript?.words]);
  const syncAvailable = words.length > 0 && words.length <= MAX_SYNC_WORDS;
  const segments = useMemo(() => buildSegments(words), [words]);
  const activeSegmentIndex = useMemo(
    () =>
      activeWordIndex < 0
        ? -1
        : segments.findIndex((segment) =>
            segment.words.some((word) => word.index === activeWordIndex),
          ),
    [activeWordIndex, segments],
  );
  const editorWordRanges = useMemo(
    () => getEditorWordRanges(editorText, words),
    [editorText, words],
  );
  const activeEditorRange =
    activeWordIndex >= 0 ? editorWordRanges[activeWordIndex] || null : null;
  const speakers = useMemo(
    () =>
      Array.from(
        new Set(
          words
            .map((word) => word.speaker)
            .filter((speaker) => speaker !== null && speaker !== undefined)
            .map((speaker) => String(speaker)),
        ),
      ),
    [words],
  );

  useEffect(() => {
    if (!isLoading && !user) {
      void navigate({
        to: "/login",
        search: { error: undefined, from: `/transcript/${id}` },
      });
    }
  }, [id, isLoading, navigate, user]);

  useEffect(() => {
    editorTextRef.current = editorText;
  }, [editorText]);

  useEffect(() => {
    savedTextRef.current = savedText;
  }, [savedText]);

  const loadTranscript = useCallback(async () => {
    if (!token || !Number.isFinite(transcriptId)) return;
    loadRequestRef.current?.abort();
    const controller = new AbortController();
    loadRequestRef.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    setLoading(true);
    setLoadError("");

    try {
      const response = await fetch(
        `${API_URL}/api/transcribe/history/${transcriptId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const body = (await response.json().catch(() => ({}))) as
        | TranscriptDetail
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "Không thể tải transcript",
        );
      }
      const detail = body as TranscriptDetail;
      detail.words = normalizeWords(detail.words);
      detail.text = String(detail.text || "");
      setTranscript(detail);
      setEditorText(detail.text);
      setSavedText(detail.text);
      setSaveStatus("saved");
      setEditorMode(
        detail.words.length > 0 && detail.words.length <= MAX_SYNC_WORDS
          ? "sync"
          : "timestamp",
      );
    } catch (error) {
      if (controller.signal.aborted && !timedOut) return;
      setLoadError(
        timedOut
          ? "Máy chủ phản hồi quá lâu. Vui lòng thử lại."
          : error instanceof Error
            ? error.message
            : "Không thể tải transcript.",
      );
    } finally {
      window.clearTimeout(timer);
      if (loadRequestRef.current === controller) {
        loadRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [token, transcriptId]);

  useEffect(() => {
    void loadTranscript();
    return () => loadRequestRef.current?.abort();
  }, [loadTranscript, retryKey]);

  useEffect(() => {
    setAudioUrl(null);
    setAudioError("");
    setAudioLoading(false);
  }, [transcript?.audio_filename, transcript?.id]);

  const loadAudio = useCallback(async () => {
    if (!token || !transcript?.audio_filename || audioLoading) return;
    setAudioLoading(true);
    setAudioError("");
    try {
      const response = await fetch(
        `${API_URL}/api/transcribe/${transcript.id}/audio-access`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !body.url) {
        throw new Error(body.error || "Không tạo được đường dẫn audio");
      }
      setAudioUrl(
        body.url.startsWith("http") ? body.url : `${API_URL}${body.url}`,
      );
    } catch (error) {
      setAudioError(
        error instanceof Error ? error.message : "Không tải được audio gốc",
      );
    } finally {
      setAudioLoading(false);
    }
  }, [audioLoading, token, transcript?.audio_filename, transcript?.id]);

  const saveTranscript = useCallback(
    async (text: string) => {
      if (!token || !transcript) return;
      saveRequestRef.current?.abort();
      const controller = new AbortController();
      saveRequestRef.current = controller;
      let timedOut = false;
      const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
      setSaveStatus("saving");
      setSaveError("");
      try {
        const response = await fetch(
          `${API_URL}/api/transcribe/${transcript.id}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text }),
            signal: controller.signal,
          },
        );
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error || "Không thể lưu thay đổi");
        }
        setSavedText(text);
        setTranscript((previous) =>
          previous ? { ...previous, text } : previous,
        );
        setSaveStatus(editorTextRef.current === text ? "saved" : "unsaved");
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return;
        setSaveStatus("error");
        setSaveError(
          timedOut
            ? "Lưu quá thời gian. Vui lòng kiểm tra kết nối và thử lại."
            : error instanceof Error
              ? error.message
              : "Không thể lưu thay đổi",
        );
      } finally {
        window.clearTimeout(timer);
        if (saveRequestRef.current === controller) {
          saveRequestRef.current = null;
        }
      }
    },
    [token, transcript],
  );

  useEffect(() => {
    if (!transcript || editorText === savedText) return;
    setSaveStatus("unsaved");
    const timer = window.setTimeout(
      () => void saveTranscript(editorText),
      AUTO_SAVE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [editorText, saveTranscript, savedText, transcript]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (editorTextRef.current === savedText) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [savedText]);

  useEffect(
    () => () => {
      loadRequestRef.current?.abort();
      const pendingText = editorTextRef.current;
      if (
        token &&
        Number.isFinite(transcriptId) &&
        pendingText !== savedTextRef.current
      ) {
        const payload = JSON.stringify({ text: pendingText });
        void fetch(`${API_URL}/api/transcribe/${transcriptId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: payload,
          keepalive: payload.length < 60_000,
        }).catch(() => {});
      }
    },
    [token, transcriptId],
  );

  function handleTimeUpdate() {
    const milliseconds = (audioRef.current?.currentTime || 0) * 1000;
    setActiveWordIndex(findActiveWord(words, milliseconds));
  }

  useEffect(() => {
    if (editorMode !== "timestamp" || activeSegmentIndex < 0) return;
    timestampSegmentRefs.current[activeSegmentIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeSegmentIndex, editorMode]);

  function seekTo(milliseconds: number) {
    if (!audioRef.current || !audioUrl) return;
    audioRef.current.currentTime = milliseconds / 1000;
    void audioRef.current.play();
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(editorText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function baseFilename() {
    return transcript?.filename.replace(/\.[^.]+$/, "") || "transcript";
  }

  function exportText() {
    const content = transcript?.translated_text
      ? `${editorText}\n\nBản dịch (${languageLabel(transcript.translation_target_language)})\n\n${transcript.translated_text}`
      : editorText;
    downloadBlob(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
      `${baseFilename()}.txt`,
    );
  }

  async function exportDocx() {
    const paragraphs = [
      new Paragraph({ children: [new TextRun({ text: editorText })] }),
    ];
    if (transcript?.translated_text) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Bản dịch (${languageLabel(transcript.translation_target_language)})`,
              bold: true,
            }),
          ],
        }),
        new Paragraph({
          children: [new TextRun({ text: transcript.translated_text })],
        }),
      );
    }
    const documentFile = new Document({ sections: [{ children: paragraphs }] });
    downloadBlob(await Packer.toBlob(documentFile), `${baseFilename()}.docx`);
  }

  function exportCaptions(format: "srt" | "vtt") {
    const captionSegments = segments.length
      ? segments
      : [
          {
            start: 0,
            end: Math.max(1_000, Number(transcript?.duration || 1) * 1000),
            speaker: null,
            words: [{ text: editorText, start: 0, end: 1_000, index: 0 }],
          },
        ];
    const separator = format === "srt" ? "," : ".";
    const body = captionSegments
      .map((segment, index) => {
        const timing = `${formatCaptionTime(segment.start, separator)} --> ${formatCaptionTime(segment.end, separator)}`;
        const label =
          segment.speaker == null ? "" : `${speakerLabel(segment.speaker)}: `;
        return `${format === "srt" ? `${index + 1}\n` : ""}${timing}\n${label}${joinWords(segment.words)}`;
      })
      .join("\n\n");
    const content = format === "vtt" ? `WEBVTT\n\n${body}\n` : `${body}\n`;
    downloadBlob(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
      `${baseFilename()}.${format}`,
    );
  }

  if (isLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbfaf7]">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-[#21104a]/25 border-t-[#21104a]" />
      </div>
    );
  }

  if (!user) return null;

  if (loadError || !transcript) {
    return (
      <div className="min-h-screen bg-[#fbfaf7]">
        <AuthenticatedHeader />
        <main className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-xl font-black text-[#21104a]">
            Không mở được transcript
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#756894]">{loadError}</p>
          <div className="mt-6 flex gap-2">
            <Link
              to="/history"
              className="rounded-full border border-[#ded5e9] bg-white px-5 py-2.5 text-sm font-bold text-[#21104a]"
            >
              Về lịch sử
            </Link>
            <button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
              className="inline-flex items-center gap-2 rounded-full bg-[#ffcb05] px-5 py-2.5 text-sm font-black text-[#21104a]"
            >
              <RefreshCw className="h-4 w-4" /> Thử lại
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f7fb] text-[#21104a] print:bg-white">
      <AuthenticatedHeader />

      <main className="mx-auto max-w-7xl px-4 py-5 md:px-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/history"
              aria-label="Về lịch sử"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#ded5e9] bg-white transition hover:border-[#ffcb05]"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a7da1]">
                Trình biên tập transcript
              </p>
              <h1 className="truncate text-lg font-black md:text-xl">
                {transcript.filename}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${
                saveStatus === "error"
                  ? "bg-destructive/10 text-destructive"
                  : saveStatus === "saved"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-[#fff7d6] text-[#7b5e00]"
              }`}
            >
              {saveStatus === "saving" ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current/25 border-t-current" />
              ) : saveStatus === "saved" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {saveStatus === "saving"
                ? "Đang lưu"
                : saveStatus === "saved"
                  ? "Đã tự động lưu"
                  : saveStatus === "error"
                    ? "Lưu thất bại"
                    : "Chưa lưu"}
            </span>
            <button
              type="button"
              onClick={() => void saveTranscript(editorText)}
              disabled={saveStatus === "saving" || editorText === savedText}
              className="rounded-full bg-[#21104a] px-4 py-2 text-white transition hover:bg-[#321b67] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Lưu ngay
            </button>
          </div>
        </div>

        <section className="sticky top-[61px] z-30 mb-4 overflow-hidden rounded-lg border border-[#3b2868] bg-[#21104a] p-4 text-white shadow-[0_14px_32px_rgba(33,16,74,.16)] print:hidden">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <FileAudio className="h-4 w-4 shrink-0 text-[#ffcb05]" />
              <span className="truncate text-sm font-bold">
                {transcript.filename}
              </span>
            </div>
            <span className="shrink-0 text-xs text-white/65">
              {formatMediaDuration(transcript.duration, "Chưa xác định")}
            </span>
          </div>
          {audioUrl ? (
            <audio
              ref={audioRef}
              src={audioUrl}
              controls
              onTimeUpdate={handleTimeUpdate}
              className="h-10 w-full"
            />
          ) : transcript.audio_filename ? (
            <button
              type="button"
              onClick={() => void loadAudio()}
              disabled={audioLoading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white/10 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-60"
            >
              {audioLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {audioLoading ? "Đang chuẩn bị audio..." : "Phát audio"}
            </button>
          ) : (
            <p className="rounded-md bg-white/8 px-3 py-2 text-xs text-white/70">
              Bản ghi này không có audio để nghe lại.
            </p>
          )}
          {audioError && (
            <p className="mt-2 text-xs font-semibold text-[#ffd6d6]">
              {audioError}
            </p>
          )}
        </section>

        {saveError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /> {saveError}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
          <section className="overflow-hidden rounded-lg border border-[#e1dbea] bg-white shadow-[0_10px_30px_rgba(33,16,74,.05)]">
            <div className="flex flex-col gap-3 border-b border-[#ece7f2] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex w-fit rounded-md bg-[#f3f0f7] p-1">
                <button
                  type="button"
                  onClick={() => setEditorMode("sync")}
                  disabled={!syncAvailable}
                  className={`inline-flex items-center gap-2 rounded px-3 py-2 text-xs font-black transition ${
                    editorMode === "sync"
                      ? "bg-white text-[#21104a] shadow-sm"
                      : "text-[#756894] hover:text-[#21104a]"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <Captions className="h-3.5 w-3.5" /> Đồng bộ audio
                </button>
                <button
                  type="button"
                  onClick={() => setEditorMode("timestamp")}
                  disabled={!syncAvailable}
                  className={`inline-flex items-center gap-2 rounded px-3 py-2 text-xs font-black transition ${
                    editorMode === "timestamp"
                      ? "bg-white text-[#21104a] shadow-sm"
                      : "text-[#756894] hover:text-[#21104a]"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <Clock3 className="h-3.5 w-3.5" /> Timestamp
                </button>
              </div>
              <p className="text-xs text-[#8a7da1]">
                {words.length > MAX_SYNC_WORDS
                  ? "Transcript quá dài, dùng vùng chỉnh sửa thường để đảm bảo mượt."
                  : syncAvailable
                    ? editorMode === "timestamp"
                      ? "Đoạn timestamp đang phát sẽ được tô nổi bật."
                      : "Nghe audio và sửa trực tiếp tại vùng chữ đang được tô."
                    : "Bản ghi chưa có timestamp theo từng từ."}
              </p>
            </div>

            {editorMode === "timestamp" && syncAvailable ? (
              <div className="max-h-[calc(100vh-245px)] min-h-[520px] overflow-y-auto px-4 py-5 md:px-7">
                <div className="mx-auto max-w-3xl space-y-4">
                  {segments.map((segment, segmentIndex) => {
                    const active = activeSegmentIndex === segmentIndex;
                    return (
                      <article
                        key={`${segment.start}-${segmentIndex}`}
                        ref={(element) => {
                          timestampSegmentRefs.current[segmentIndex] = element;
                        }}
                        onClick={() => seekTo(segment.start)}
                        className={`grid cursor-pointer gap-2 rounded-lg border px-3 py-3 transition sm:grid-cols-[112px_minmax(0,1fr)] ${
                          active
                            ? "border-[#ffcb05] bg-[#fff7cf] shadow-sm"
                            : "border-transparent hover:border-[#ece7f2] hover:bg-[#fbfaf7]"
                        }`}
                      >
                        <div className="flex items-center gap-2 sm:block">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              seekTo(segment.start);
                            }}
                            className="text-xs font-black text-[#5f4c82] hover:text-[#21104a]"
                          >
                            {formatClock(segment.start)}
                          </button>
                          <p className="mt-1 truncate text-xs font-bold text-[#9a8eac]">
                            {speakerLabel(segment.speaker)}
                          </p>
                        </div>
                        <p className="text-[15px] leading-8 text-[#342752]">
                          {joinWords(segment.words)}
                        </p>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : syncAvailable ? (
              <div className="p-4 md:p-6">
                <SyncedTranscriptEditor
                  value={editorText}
                  onChange={setEditorText}
                  activeRange={activeEditorRange}
                  wordRanges={editorWordRanges}
                  onWordClick={(wordIndex) => seekTo(words[wordIndex].start)}
                />
                <div className="mt-2 flex items-center justify-between text-xs text-[#8a7da1]">
                  <span>{editorText.length.toLocaleString("vi-VN")} ký tự</span>
                  <span>Từ đang phát được tô ngay trong vùng chỉnh sửa</span>
                </div>
              </div>
            ) : (
              <div className="p-4 md:p-6">
                <textarea
                  value={editorText}
                  onChange={(event) => setEditorText(event.target.value)}
                  aria-label="Nội dung transcript"
                  spellCheck
                  className="min-h-[560px] w-full resize-y rounded-lg border border-[#ded5e9] bg-[#fbfaf7] px-5 py-4 text-[15px] leading-8 text-[#342752] outline-none transition focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20"
                />
                <div className="mt-2 flex items-center justify-between text-xs text-[#8a7da1]">
                  <span>{editorText.length.toLocaleString("vi-VN")} ký tự</span>
                  <span>Tự động lưu sau 1,2 giây</span>
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-4 print:hidden">
            <section className="rounded-lg border border-[#e1dbea] bg-white p-4">
              <h2 className="flex items-center gap-2 text-sm font-black">
                <FileText className="h-4 w-4 text-[#8067aa]" /> Thông tin
              </h2>
              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 text-xs">
                <div>
                  <dt className="text-[#8a7da1]">Thời lượng</dt>
                  <dd className="mt-1 font-bold">
                    {formatMediaDuration(
                      transcript.duration,
                      "Chưa xác định",
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#8a7da1]">Dung lượng</dt>
                  <dd className="mt-1 font-bold">
                    {formatBytes(transcript.file_size)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#8a7da1]">Ngôn ngữ</dt>
                  <dd className="mt-1 font-bold">
                    {languageLabel(transcript.source_language)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#8a7da1]">Người nói</dt>
                  <dd className="mt-1 font-bold">
                    {speakers.length || "Chưa tách"}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex items-center gap-2 border-t border-[#ece7f2] pt-4 text-xs text-[#756894]">
                <Clock3 className="h-3.5 w-3.5" />
                {new Date(transcript.created_at).toLocaleString("vi-VN")}
              </div>
            </section>

            <section className="rounded-lg border border-[#e1dbea] bg-white p-4">
              <h2 className="flex items-center gap-2 text-sm font-black">
                <Download className="h-4 w-4 text-[#8067aa]" /> Xuất transcript
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-[#ded5e9] px-3 py-2.5 text-xs font-bold hover:border-[#ffcb05]"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Đã chép" : "Sao chép"}
                </button>
                <button
                  type="button"
                  onClick={exportText}
                  className="rounded-md border border-[#ded5e9] px-3 py-2.5 text-xs font-bold hover:border-[#ffcb05]"
                >
                  TXT
                </button>
                <button
                  type="button"
                  onClick={() => void exportDocx()}
                  className="rounded-md border border-[#ded5e9] px-3 py-2.5 text-xs font-bold hover:border-[#ffcb05]"
                >
                  DOCX
                </button>
                <button
                  type="button"
                  onClick={() => exportCaptions("srt")}
                  className="rounded-md border border-[#ded5e9] px-3 py-2.5 text-xs font-bold hover:border-[#ffcb05]"
                >
                  SRT
                </button>
                <button
                  type="button"
                  onClick={() => exportCaptions("vtt")}
                  className="rounded-md border border-[#ded5e9] px-3 py-2.5 text-xs font-bold hover:border-[#ffcb05]"
                >
                  VTT
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-[#ded5e9] px-3 py-2.5 text-xs font-bold hover:border-[#ffcb05]"
                >
                  <Printer className="h-3.5 w-3.5" /> PDF
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-[#e1dbea] bg-white p-4">
              <h2 className="flex items-center gap-2 text-sm font-black">
                <Users className="h-4 w-4 text-[#8067aa]" /> Người nói
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {speakers.length ? (
                  speakers.map((speaker) => (
                    <span
                      key={speaker}
                      className="rounded-full bg-[#f3f0f7] px-3 py-1.5 text-xs font-bold text-[#5f4c82]"
                    >
                      {speakerLabel(speaker)}
                    </span>
                  ))
                ) : (
                  <p className="text-xs leading-5 text-[#8a7da1]">
                    File này chưa bật nhận diện người nói.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-[#e1dbea] bg-white p-4">
              <h2 className="flex items-center gap-2 text-sm font-black">
                <Languages className="h-4 w-4 text-[#8067aa]" /> Bản dịch
              </h2>
              {transcript.translated_text ? (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-bold text-[#8a7da1]">
                    {languageLabel(transcript.translation_target_language)}
                  </p>
                  <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-[#4e4168]">
                    {transcript.translated_text}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-[#8a7da1]">
                  {transcript.translation_error ||
                    "Transcript này chưa có bản dịch."}
                </p>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
