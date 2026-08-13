import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Flag,
  History,
  Languages,
  Pause,
  Pencil,
  Play,
  Printer,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Undo2,
  Redo2,
  Users,
} from "lucide-react";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import { TranscriptSidebarSection } from "@/components/transcript-sidebar-section";
import { useAuth } from "@/context/AuthContext";
import { formatMediaDuration } from "@/lib/format-duration";
import { languageLabel } from "@/lib/language-options";
import {
  clampSeekTime,
  findActiveWordIndex,
  findTimedWordTextRange,
  formatPlaybackTime,
  replaceTimedWordInText,
} from "@/lib/transcript-playback";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();
const REQUEST_TIMEOUT_MS = 12_000;
const AUTO_SAVE_DELAY_MS = 1_200;
const MAX_SYNC_WORDS = 5_000;
const MAX_LOCAL_HISTORY = 80;
const LOW_CONFIDENCE_THRESHOLD = 0.75;

type SaveStatus = "saved" | "unsaved" | "saving" | "error";
type EditorMode = "sync" | "edit";
type ExportLayout = "document" | "segments";
type ExportTranslationMode = "original" | "translation" | "bilingual";

interface ExportOptions {
  includeSpeakers: boolean;
  includeTimestamps: boolean;
  layout: ExportLayout;
  translationMode: ExportTranslationMode;
}

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

interface TranscriptVersion {
  id: number;
  label: string | null;
  created_at: string;
  text_length: number;
  word_count: number;
}

interface EditorSnapshot {
  text: string;
  words: TranscriptWord[];
}

interface TranscriptSegment {
  speaker: string | number | null;
  start: number;
  end: number;
  words: IndexedWord[];
}

const EditableTimedWord = memo(function EditableTimedWord({
  word,
  active,
  onCommit,
  onSeek,
}: {
  word: IndexedWord;
  active: boolean;
  onCommit: (index: number, text: string) => void;
  onSeek: (milliseconds: number) => void;
}) {
  const [value, setValue] = useState(word.text);
  const inputRef = useRef<HTMLInputElement>(null);
  const isLowConfidence =
    typeof word.confidence === "number" &&
    word.confidence > 0 &&
    word.confidence < LOW_CONFIDENCE_THRESHOLD;

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setValue(word.text);
    }
  }, [word.text]);

  function commit() {
    const nextValue = value.trim();
    if (!nextValue) {
      setValue(word.text);
      return;
    }
    if (nextValue !== word.text) onCommit(word.index, nextValue);
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      data-word-index={word.index}
      aria-current={active ? "true" : undefined}
      aria-label={`Chỉnh sửa từ ${word.text}`}
      onChange={(event) => setValue(event.target.value)}
      onClick={() => onSeek(word.start)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setValue(word.text);
          event.currentTarget.blur();
        }
      }}
      style={{
        width: `${Math.max(1.2, Math.min(36, value.length + 0.35))}ch`,
      }}
      className={`mr-0.5 inline-block h-7 min-w-0 rounded border-0 px-px align-middle text-[15px] leading-7 outline-none transition-colors duration-150 ${
        active
          ? "bg-[#ffcb05] font-black text-[#21104a] shadow-[0_0_0_3px_rgba(255,203,5,.22)]"
          : isLowConfidence
            ? "bg-red-50 text-red-800 ring-1 ring-red-200 hover:bg-red-100 focus:bg-white focus:ring-2 focus:ring-red-300"
          : "bg-transparent text-[#342752] hover:bg-[#fff3bb] focus:bg-white focus:ring-2 focus:ring-[#ffcb05]"
      }`}
    />
  );
});

function HighlightedPlainText({
  text,
  range,
}: {
  text: string;
  range: { start: number; end: number } | null;
}) {
  if (!range) {
    return <>{text || " "}</>;
  }

  return (
    <>
      {text.slice(0, range.start)}
      <mark
        data-active-plain-word="true"
        className="rounded bg-[#ffcb05] px-0.5 font-black text-[#21104a]"
      >
        {text.slice(range.start, range.end)}
      </mark>
      {text.slice(range.end) || " "}
    </>
  );
}

export const Route = createFileRoute("/transcript/$id")({
  component: TranscriptEditorPage,
});

function normalizeWords(value: unknown): TranscriptWord[] {
  if (!Array.isArray(value)) return [];
  const words: TranscriptWord[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const word = item as Partial<TranscriptWord>;
    const text = String(word.text || "").trim();
    const start = Number(word.start);
    const end = Number(word.end);
    if (!text || !Number.isFinite(start)) return;
    words.push({
      text,
      start: Math.max(0, start),
      end: Number.isFinite(end) ? Math.max(start, end) : start,
      speaker: word.speaker ?? null,
      confidence:
        word.confidence == null || !Number.isFinite(Number(word.confidence))
          ? null
          : Number(word.confidence),
    });
  });
  return words;
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

    const segment = current!;
    segment.words.push({ ...word, index });
    segment.end = Math.max(segment.end, word.end);
  });

  return segments;
}

function buildTextFromTimedWords(words: TranscriptWord[]) {
  return buildSegments(words)
    .map((segment) => {
      const speakerPrefix =
        segment.speaker === null || segment.speaker === undefined
          ? ""
          : `Người nói ${segment.speaker}: `;
      return `${speakerPrefix}${segment.words
        .map((word) => word.text)
        .join(" ")}`;
    })
    .join("\n\n");
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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function splitTranslationIntoSegments(
  translatedText: string | null | undefined,
  count: number,
) {
  const cleanText = String(translatedText || "").trim();
  if (!cleanText || count <= 0) return [];
  const paragraphs = cleanText
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (paragraphs.length === count) return paragraphs;
  const sentences = cleanText
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const units = sentences.length >= count ? sentences : cleanText.split(/\s+/);
  const groups: string[] = [];
  const unitCount = Math.max(1, Math.ceil(units.length / count));
  for (let index = 0; index < count; index += 1) {
    groups.push(units.slice(index * unitCount, (index + 1) * unitCount).join(" "));
  }
  return groups.map((item) => item.trim()).filter(Boolean);
}

function formatExportTimestamp(start: number, end: number) {
  return `[${formatClock(start)} - ${formatClock(end)}]`;
}

function exportSegmentLabel(
  segment: TranscriptSegment,
  options: ExportOptions,
) {
  const parts = [];
  if (options.includeTimestamps) {
    parts.push(formatExportTimestamp(segment.start, segment.end));
  }
  if (options.includeSpeakers && segment.speaker != null) {
    parts.push(speakerLabel(segment.speaker));
  }
  return parts.join(" ");
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
  const [dirtyRevision, setDirtyRevision] = useState(0);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [audioDurationSeconds, setAudioDurationSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [translationRetrying, setTranslationRetrying] = useState(false);
  const [translationRetryError, setTranslationRetryError] = useState("");
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(-1);
  const [versions, setVersions] = useState<TranscriptVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionError, setVersionError] = useState("");
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    includeSpeakers: true,
    includeTimestamps: true,
    layout: "segments",
    translationMode: "bilingual",
  });

  const audioRef = useRef<HTMLAudioElement>(null);
  const syncScrollRef = useRef<HTMLDivElement>(null);
  const plainTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const plainTextMirrorRef = useRef<HTMLDivElement>(null);
  const playWhenReadyRef = useRef(false);
  const pendingSeekMillisecondsRef = useRef<number | null>(null);
  const loadRequestRef = useRef<AbortController | null>(null);
  const saveRequestRef = useRef<AbortController | null>(null);
  const editorTextRef = useRef("");
  const savedTextRef = useRef("");
  const wordsRef = useRef<TranscriptWord[]>([]);
  const historyPushRef = useRef(0);

  const words = useMemo(() => transcript?.words ?? [], [transcript?.words]);
  const activeTranscriptId = transcript?.id ?? null;
  const syncAvailable = words.length > 0 && words.length <= MAX_SYNC_WORDS;
  const segments = useMemo(() => buildSegments(words), [words]);
  const translationSegments = useMemo(
    () => splitTranslationIntoSegments(transcript?.translated_text, segments.length),
    [segments.length, transcript?.translated_text],
  );
  const plainTextActiveRange = useMemo(
    () =>
      syncAvailable && activeWordIndex >= 0
        ? findTimedWordTextRange(editorText, words, activeWordIndex)
        : null,
    [activeWordIndex, editorText, syncAvailable, words],
  );
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
  const lowConfidenceWords = useMemo(
    () =>
      words
        .map((word, index) => ({ ...word, index }))
        .filter(
          (word) =>
            typeof word.confidence === "number" &&
            word.confidence > 0 &&
            word.confidence < LOW_CONFIDENCE_THRESHOLD,
        )
        .slice(0, 30),
    [words],
  );
  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    const source = editorText.toLowerCase();
    const matches: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    while (matches.length < 200) {
      const start = source.indexOf(query, cursor);
      if (start === -1) break;
      matches.push({ start, end: start + query.length });
      cursor = start + Math.max(1, query.length);
    }
    return matches;
  }, [editorText, searchQuery]);

  useEffect(() => {
    if (searchIndex >= searchMatches.length) setSearchIndex(-1);
  }, [searchIndex, searchMatches.length]);

  useEffect(() => {
    if (transcript?.translated_text) return;
    setExportOptions((current) =>
      current.translationMode === "original"
        ? current
        : { ...current, translationMode: "original" },
    );
  }, [transcript?.translated_text]);

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

  useEffect(() => {
    wordsRef.current = words;
  }, [words]);

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
      setTranslationRetryError("");
      setEditorText(detail.text);
      setSavedText(detail.text);
      setSaveStatus("saved");
      setDirtyRevision(0);
      setUndoStack([]);
      setRedoStack([]);
      setSearchQuery("");
      setSearchIndex(-1);
      setEditorMode(
        detail.words.length > 0 && detail.words.length <= MAX_SYNC_WORDS
          ? "sync"
          : "edit",
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

  const loadVersions = useCallback(async () => {
    if (!token || !activeTranscriptId) return;
    setVersionsLoading(true);
    setVersionError("");
    try {
      const response = await fetch(
        `${API_URL}/api/transcribe/${activeTranscriptId}/versions`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        versions?: TranscriptVersion[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "Không tải được lịch sử phiên bản");
      }
      setVersions(Array.isArray(body.versions) ? body.versions : []);
    } catch (error) {
      setVersionError(
        error instanceof Error
          ? error.message
          : "Không tải được lịch sử phiên bản",
      );
    } finally {
      setVersionsLoading(false);
    }
  }, [activeTranscriptId, token]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    audioRef.current?.pause();
    setAudioUrl(null);
    setAudioError("");
    setAudioLoading(false);
    setIsPlaying(false);
    setPlaybackSeconds(0);
    setAudioDurationSeconds(0);
    setActiveWordIndex(-1);
    playWhenReadyRef.current = false;
    pendingSeekMillisecondsRef.current = null;
  }, [transcript?.audio_filename, transcript?.id]);

  useEffect(() => {
    if (editorMode !== "sync" || activeWordIndex < 0) return;
    const container = syncScrollRef.current;
    const activeWord = container?.querySelector<HTMLElement>(
      `[data-word-index="${activeWordIndex}"]`,
    );
    if (!container || !activeWord) return;
    const containerRect = container.getBoundingClientRect();
    const wordRect = activeWord.getBoundingClientRect();
    const isOutsideViewport =
      wordRect.top < containerRect.top + 64 ||
      wordRect.bottom > containerRect.bottom - 64;
    if (isOutsideViewport) {
      activeWord.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeWordIndex, editorMode]);

  useEffect(() => {
    if (editorMode !== "edit" || !plainTextActiveRange) return;
    const textarea = plainTextAreaRef.current;
    const mirror = plainTextMirrorRef.current;
    const activeWord = mirror?.querySelector<HTMLElement>(
      '[data-active-plain-word="true"]',
    );
    if (!textarea || !mirror || !activeWord) return;

    const wordTop = activeWord.offsetTop;
    const wordBottom = wordTop + activeWord.offsetHeight;
    const visibleTop = textarea.scrollTop + 64;
    const visibleBottom = textarea.scrollTop + textarea.clientHeight - 64;

    if (wordTop < visibleTop || wordBottom > visibleBottom) {
      const nextScrollTop = Math.max(
        0,
        wordTop - Math.round(textarea.clientHeight / 2),
      );
      textarea.scrollTop = nextScrollTop;
      mirror.style.transform = `translateY(-${nextScrollTop}px)`;
    }
  }, [editorMode, plainTextActiveRange]);

  const loadAudio = useCallback(async (playWhenReady = false) => {
    if (!token || !transcript?.audio_filename || audioLoading) return;
    playWhenReadyRef.current = playWhenReady;
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
      playWhenReadyRef.current = false;
      setAudioError(
        error instanceof Error ? error.message : "Không tải được audio gốc",
      );
    } finally {
      setAudioLoading(false);
    }
  }, [audioLoading, token, transcript?.audio_filename, transcript?.id]);

  const pushUndoSnapshot = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - historyPushRef.current < 700) return;
    historyPushRef.current = now;
    const snapshot = {
      text: editorTextRef.current,
      words: wordsRef.current.map((word) => ({ ...word })),
    };
    setUndoStack((current) => {
      const last = current[current.length - 1];
      if (
        last &&
        last.text === snapshot.text &&
        JSON.stringify(last.words) === JSON.stringify(snapshot.words)
      ) {
        return current;
      }
      return [...current, snapshot].slice(-MAX_LOCAL_HISTORY);
    });
    setRedoStack([]);
  }, []);

  const applyEditorSnapshot = useCallback((snapshot: EditorSnapshot) => {
    wordsRef.current = snapshot.words.map((word) => ({ ...word }));
    editorTextRef.current = snapshot.text;
    setEditorText(snapshot.text);
    setTranscript((current) =>
      current
        ? {
            ...current,
            text: snapshot.text,
            words: snapshot.words.map((word) => ({ ...word })),
          }
        : current,
    );
    setDirtyRevision((value) => value + 1);
    setSaveStatus("unsaved");
  }, []);

  const applyEditorChange = useCallback(
    (text: string, nextWords = wordsRef.current, trackHistory = true) => {
      if (trackHistory) pushUndoSnapshot();
      const cleanWords = nextWords.map((word) => ({ ...word }));
      wordsRef.current = cleanWords;
      editorTextRef.current = text;
      setEditorText(text);
      setTranscript((current) =>
        current ? { ...current, text, words: cleanWords } : current,
      );
      setDirtyRevision((value) => value + 1);
      setSaveStatus("unsaved");
    },
    [pushUndoSnapshot],
  );

  const commitTimedWord = useCallback(
    (wordIndex: number, nextText: string) => {
      const currentWords = wordsRef.current;
      const currentWord = currentWords[wordIndex];
      if (!currentWord || currentWord.text === nextText) return;

      const nextWords = currentWords.map((word, index) =>
        index === wordIndex ? { ...word, text: nextText } : word,
      );
      const nextTranscriptText =
        replaceTimedWordInText(
          editorTextRef.current,
          currentWords,
          wordIndex,
          nextText,
        ) ?? buildTextFromTimedWords(nextWords);

      applyEditorChange(nextTranscriptText, nextWords, true);
    },
    [applyEditorChange],
  );

  const saveTranscript = useCallback(
    async (text: string, timedWords = wordsRef.current) => {
      if (!token || !activeTranscriptId) return;
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
          `${API_URL}/api/transcribe/${activeTranscriptId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text, words: timedWords }),
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
          previous ? { ...previous, text, words: timedWords } : previous,
        );
        setDirtyRevision(0);
        setSaveStatus(editorTextRef.current === text ? "saved" : "unsaved");
        void loadVersions();
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
    [activeTranscriptId, loadVersions, token],
  );

  useEffect(() => {
    if (!transcript || (editorText === savedText && dirtyRevision === 0)) return;
    setSaveStatus("unsaved");
    const timer = window.setTimeout(
      () => void saveTranscript(editorText),
      AUTO_SAVE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [dirtyRevision, editorText, saveTranscript, savedText, transcript]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (editorTextRef.current === savedText && dirtyRevision === 0) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyRevision, savedText]);

  useEffect(
    () => () => {
      loadRequestRef.current?.abort();
      const pendingText = editorTextRef.current;
      if (
        token &&
        Number.isFinite(transcriptId) &&
        (pendingText !== savedTextRef.current || dirtyRevision > 0)
      ) {
        const payload = JSON.stringify({
          text: pendingText,
          words: wordsRef.current,
        });
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
    [dirtyRevision, token, transcriptId],
  );

  function handleTimeUpdate() {
    const currentSeconds = audioRef.current?.currentTime || 0;
    setPlaybackSeconds(currentSeconds);
    setActiveWordIndex(findActiveWordIndex(words, currentSeconds * 1000));
  }

  function handleAudioReady() {
    const audio = audioRef.current;
    if (!audio) return;
    const duration = Number.isFinite(audio.duration)
      ? audio.duration
      : Number(transcript?.duration || 0);
    setAudioDurationSeconds(Math.max(0, duration));
    if (pendingSeekMillisecondsRef.current !== null) {
      const nextSeconds = pendingSeekMillisecondsRef.current / 1000;
      pendingSeekMillisecondsRef.current = null;
      audio.currentTime = nextSeconds;
      setPlaybackSeconds(nextSeconds);
      setActiveWordIndex(findActiveWordIndex(words, nextSeconds * 1000));
    }
    if (playWhenReadyRef.current) {
      playWhenReadyRef.current = false;
      void audio.play().catch(() => {
        setIsPlaying(false);
        setAudioError("Trình duyệt đã chặn tự phát. Hãy nhấn Phát.");
      });
    }
  }

  function handlePlayPause() {
    const audio = audioRef.current;
    if (!audioUrl || !audio) {
      void loadAudio(true);
      return;
    }
    if (audio.paused) {
      if (
        Number.isFinite(audio.duration) &&
        audio.currentTime >= audio.duration - 0.1
      ) {
        audio.currentTime = 0;
        setPlaybackSeconds(0);
      }
      void audio.play().catch(() => {
        setAudioError("Không thể phát audio. Vui lòng thử tải lại trang.");
      });
    } else {
      audio.pause();
    }
  }

  function seekBy(deltaSeconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const duration =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : audioDurationSeconds;
    const nextTime = clampSeekTime(
      audio.currentTime,
      deltaSeconds,
      duration,
    );
    audio.currentTime = nextTime;
    setPlaybackSeconds(nextTime);
    setActiveWordIndex(findActiveWordIndex(words, nextTime * 1000));
  }

  function seekFromProgress(nextSeconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = nextSeconds;
    setPlaybackSeconds(nextSeconds);
    setActiveWordIndex(findActiveWordIndex(words, nextSeconds * 1000));
  }

  const seekTo = useCallback(
    (milliseconds: number) => {
      if (!audioRef.current || !audioUrl) {
        pendingSeekMillisecondsRef.current = milliseconds;
        void loadAudio(true);
        return;
      }
      audioRef.current.currentTime = milliseconds / 1000;
      void audioRef.current.play();
    },
    [audioUrl, loadAudio],
  );

  function undoEdit() {
    setUndoStack((current) => {
      const previous = current[current.length - 1];
      if (!previous) return current;
      setRedoStack((redo) =>
        [
          ...redo,
          {
            text: editorTextRef.current,
            words: wordsRef.current.map((word) => ({ ...word })),
          },
        ].slice(-MAX_LOCAL_HISTORY),
      );
      applyEditorSnapshot(previous);
      return current.slice(0, -1);
    });
  }

  function redoEdit() {
    setRedoStack((current) => {
      const next = current[current.length - 1];
      if (!next) return current;
      setUndoStack((undo) =>
        [
          ...undo,
          {
            text: editorTextRef.current,
            words: wordsRef.current.map((word) => ({ ...word })),
          },
        ].slice(-MAX_LOCAL_HISTORY),
      );
      applyEditorSnapshot(next);
      return current.slice(0, -1);
    });
  }

  function selectSearchMatch(nextIndex: number) {
    if (!searchMatches.length) return;
    const boundedIndex =
      (nextIndex + searchMatches.length) % searchMatches.length;
    setSearchIndex(boundedIndex);
    const match = searchMatches[boundedIndex];
    setEditorMode("edit");
    window.requestAnimationFrame(() => {
      const textarea = plainTextAreaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(match.start, match.end);
    });
  }

  function updateSpeakerName(previousSpeaker: string, nextSpeaker: string) {
    const cleanSpeaker = nextSpeaker.trim().slice(0, 100);
    if (!cleanSpeaker || cleanSpeaker === previousSpeaker) return;
    const currentWords = wordsRef.current;
    const nextWords = currentWords.map((word) =>
      String(word.speaker ?? "") === previousSpeaker
        ? { ...word, speaker: cleanSpeaker }
        : word,
    );
    applyEditorChange(buildTextFromTimedWords(nextWords), nextWords, true);
  }

  function markLowConfidenceReviewed(wordIndex: number) {
    const currentWords = wordsRef.current;
    const currentWord = currentWords[wordIndex];
    if (!currentWord) return;
    const nextWords = currentWords.map((word, index) =>
      index === wordIndex ? { ...word, confidence: 1 } : word,
    );
    applyEditorChange(editorTextRef.current, nextWords, true);
  }

  async function restoreVersion(versionId: number) {
    if (!token || !activeTranscriptId) return;
    pushUndoSnapshot(true);
    setVersionError("");
    try {
      const response = await fetch(
        `${API_URL}/api/transcribe/${activeTranscriptId}/versions/${versionId}/restore`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const body = (await response.json().catch(() => ({}))) as
        | { text: string; words: TranscriptWord[] }
        | { error?: string };
      if (!response.ok || !("text" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "Không khôi phục được phiên bản",
        );
      }
      const restoredWords = normalizeWords(body.words);
      wordsRef.current = restoredWords;
      editorTextRef.current = String(body.text || "");
      setEditorText(String(body.text || ""));
      setSavedText(String(body.text || ""));
      setDirtyRevision(0);
      setTranscript((current) =>
        current
          ? { ...current, text: String(body.text || ""), words: restoredWords }
          : current,
      );
      setSaveStatus("saved");
      setRedoStack([]);
      await loadVersions();
    } catch (error) {
      setVersionError(
        error instanceof Error
          ? error.message
          : "Không khôi phục được phiên bản",
      );
    }
  }

  async function retryTranslation() {
    if (
      !token ||
      !transcript ||
      !transcript.translation_target_language ||
      translationRetrying
    ) {
      return;
    }
    setTranslationRetrying(true);
    setTranslationRetryError("");
    try {
      const response = await fetch(
        `${API_URL}/api/transcribe/${transcript.id}/translate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            targetLanguage: transcript.translation_target_language,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        translation?: {
          text: string;
          targetLanguage: string;
          provider: string;
        };
      };
      if (!response.ok || !body.translation?.text) {
        throw new Error(body.error || "Không tạo được bản dịch mới.");
      }
      setTranscript((current) =>
        current
          ? {
              ...current,
              translated_text: body.translation!.text,
              translation_target_language:
                body.translation!.targetLanguage ||
                current.translation_target_language,
              translation_provider:
                body.translation!.provider || current.translation_provider,
              translation_error: null,
            }
          : current,
      );
    } catch (error) {
      setTranslationRetryError(
        error instanceof Error
          ? error.message
          : "Không tạo được bản dịch mới.",
      );
    } finally {
      setTranslationRetrying(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(editorText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function baseFilename() {
    return transcript?.filename.replace(/\.[^.]+$/, "") || "transcript";
  }

  function effectiveExportOptions(): ExportOptions {
    return {
      ...exportOptions,
      translationMode: transcript?.translated_text
        ? exportOptions.translationMode
        : "original",
    };
  }

  function exportMetadataLines() {
    return [
      "Vbee AI Speech Workspace",
      `Tệp: ${transcript?.filename || baseFilename()}`,
      `Ngày tạo transcript: ${
        transcript?.created_at
          ? new Date(transcript.created_at).toLocaleString("vi-VN")
          : "Chưa có"
      }`,
      `Thời lượng: ${formatMediaDuration(transcript?.duration, "Chưa xác định")}`,
      `Ngôn ngữ gốc: ${languageLabel(transcript?.source_language)}`,
      transcript?.translated_text
        ? `Bản dịch: ${languageLabel(transcript.translation_target_language)}`
        : "Bản dịch: Chưa có",
    ];
  }

  function buildExportSegmentLines(options: ExportOptions) {
    if (!segments.length) {
      return [editorText.trim()].filter(Boolean);
    }
    return segments.flatMap((segment, index) => {
      const label = exportSegmentLabel(segment, options);
      const original = joinWords(segment.words);
      const translated = translationSegments[index] || "";
      const lines = [];
      if (label) lines.push(label);
      if (options.translationMode !== "translation") lines.push(original);
      if (
        options.translationMode === "translation" ||
        options.translationMode === "bilingual"
      ) {
        if (translated) {
          lines.push(
            options.translationMode === "bilingual"
              ? `Bản dịch: ${translated}`
              : translated,
          );
        }
      }
      return [lines.join("\n")];
    });
  }

  function buildExportTextContent() {
    const options = effectiveExportOptions();
    const title =
      options.translationMode === "translation"
        ? "BẢN DỊCH"
        : options.translationMode === "bilingual"
          ? "TRANSCRIPT SONG NGỮ"
          : "TRANSCRIPT";
    const body =
      options.layout === "segments"
        ? buildExportSegmentLines(options).join("\n\n")
        : options.translationMode === "translation"
          ? String(transcript?.translated_text || "").trim()
          : options.translationMode === "bilingual"
            ? [
                "Transcript gốc",
                editorText.trim(),
                `Bản dịch (${languageLabel(transcript?.translation_target_language)})`,
                String(transcript?.translated_text || "").trim(),
              ]
                .filter(Boolean)
                .join("\n\n")
            : editorText.trim();
    return [title, ...exportMetadataLines(), "", body].join("\n");
  }

  function exportText() {
    downloadBlob(
      new Blob([buildExportTextContent()], { type: "text/plain;charset=utf-8" }),
      `${baseFilename()}.txt`,
    );
  }

  async function exportDocx() {
    const options = effectiveExportOptions();
    const paragraphs: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text:
              options.translationMode === "translation"
                ? "Bản dịch transcript"
                : options.translationMode === "bilingual"
                  ? "Transcript song ngữ"
                  : "Transcript",
            bold: true,
            size: 34,
          }),
        ],
      }),
      ...exportMetadataLines().map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ text: line, size: 20, color: "5F4C82" })],
          }),
      ),
      new Paragraph({ children: [new TextRun({ text: "" })] }),
    ];

    if (options.layout === "segments") {
      buildExportSegmentLines(options).forEach((segmentBlock, index) => {
        const [firstLine, ...bodyLines] = segmentBlock.split("\n");
        if (firstLine && (firstLine.startsWith("[") || firstLine.includes("Người nói"))) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: firstLine,
                  bold: true,
                  color: "21104A",
                }),
              ],
            }),
          );
        } else if (firstLine) {
          bodyLines.unshift(firstLine);
        }
        bodyLines.forEach((line) => {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: line, size: 22 })],
            }),
          );
        });
        if (index < segments.length - 1) {
          paragraphs.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
        }
      });
    } else {
      buildExportTextContent()
        .split("\n")
        .slice(exportMetadataLines().length + 2)
        .forEach((line) => {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: line, size: 22 })],
            }),
          );
        });
    }

    const documentFile = new Document({ sections: [{ children: paragraphs }] });
    downloadBlob(await Packer.toBlob(documentFile), `${baseFilename()}.docx`);
  }

  function exportCaptions(format: "srt" | "vtt") {
    const options = effectiveExportOptions();
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
          options.includeSpeakers && segment.speaker != null
            ? `${speakerLabel(segment.speaker)}: `
            : "";
        const original = `${label}${joinWords(segment.words)}`;
        const translated = translationSegments[index] || "";
        const captionText =
          options.translationMode === "translation" && translated
            ? translated
            : options.translationMode === "bilingual" && translated
              ? `${original}\n${translated}`
              : original;
        return `${format === "srt" ? `${index + 1}\n` : ""}${timing}\n${captionText}`;
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

  const effectiveAudioDuration =
    audioDurationSeconds || Number(transcript.duration || 0);
  const progressMaximum = Math.max(
    effectiveAudioDuration,
    playbackSeconds,
    0.1,
  );

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
              disabled={
                saveStatus === "saving" ||
                (editorText === savedText && dirtyRevision === 0)
              }
              className="rounded-full bg-[#21104a] px-4 py-2 text-white transition hover:bg-[#321b67] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Lưu ngay
            </button>
          </div>
        </div>

        <section
          data-testid="transcript-audio-player"
          className="sticky top-[61px] z-30 mb-4 overflow-hidden rounded-lg border border-[#3b2868] bg-[#21104a] p-4 text-white shadow-[0_14px_32px_rgba(33,16,74,.16)] print:hidden"
        >
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
          {transcript.audio_filename ? (
            <>
              {audioUrl && (
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  preload="metadata"
                  onLoadedMetadata={handleAudioReady}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => {
                    setIsPlaying(false);
                    setActiveWordIndex(-1);
                  }}
                  onError={() => {
                    setIsPlaying(false);
                    setAudioError(
                      "Không phát được audio. Vui lòng tải lại trang và thử lại.",
                    );
                  }}
                  className="hidden"
                />
              )}

              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <button
                  type="button"
                  data-testid="audio-seek-back"
                  onClick={() => seekBy(-10)}
                  disabled={!audioUrl}
                  title="Tua lùi 10 giây"
                  aria-label="Tua lùi 10 giây"
                  className="inline-flex h-10 items-center gap-1.5 rounded-full border border-white/20 bg-white/8 px-3 text-xs font-black transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <RotateCcw className="h-4 w-4" /> 10 giây
                </button>
                <button
                  type="button"
                  data-testid="audio-play-pause"
                  aria-pressed={isPlaying}
                  onClick={handlePlayPause}
                  disabled={audioLoading}
                  className="inline-flex h-11 min-w-32 items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-5 text-sm font-black text-[#21104a] transition hover:bg-[#ffda45] disabled:cursor-wait disabled:opacity-70"
                >
                  {audioLoading ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#21104a]/25 border-t-[#21104a]" />
                  ) : isPlaying ? (
                    <Pause className="h-4 w-4 fill-current" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                  {audioLoading
                    ? "Đang tải..."
                    : isPlaying
                      ? "Dừng"
                      : effectiveAudioDuration > 0 &&
                          playbackSeconds >= effectiveAudioDuration - 0.1
                        ? "Phát lại"
                        : "Phát"}
                </button>
                <button
                  type="button"
                  data-testid="audio-seek-forward"
                  onClick={() => seekBy(10)}
                  disabled={!audioUrl}
                  title="Tua tới 10 giây"
                  aria-label="Tua tới 10 giây"
                  className="inline-flex h-10 items-center gap-1.5 rounded-full border border-white/20 bg-white/8 px-3 text-xs font-black transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  10 giây <RotateCw className="h-4 w-4" />
                </button>
                <span
                  data-testid="audio-time"
                  className="min-w-28 text-center font-mono text-xs font-bold text-white/80 sm:ml-auto sm:text-right"
                >
                  {formatPlaybackTime(playbackSeconds)} /{" "}
                  {formatPlaybackTime(effectiveAudioDuration)}
                </span>
              </div>

              <label className="mt-3 block">
                <span className="sr-only">Vị trí phát audio</span>
                <input
                  type="range"
                  min={0}
                  max={progressMaximum}
                  step={0.1}
                  value={Math.min(playbackSeconds, progressMaximum)}
                  disabled={!audioUrl}
                  onChange={(event) =>
                    seekFromProgress(Number(event.target.value))
                  }
                  className="h-1.5 w-full cursor-pointer accent-[#ffcb05] disabled:cursor-not-allowed disabled:opacity-40"
                />
              </label>
            </>
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

        <div
          className={`grid gap-4 lg:min-h-[360px] lg:grid-cols-[minmax(0,1fr)_310px] ${
            transcript.audio_filename
              ? "lg:h-[calc(100dvh-345px)]"
              : "lg:h-[calc(100dvh-290px)]"
          }`}
        >
          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#e1dbea] bg-white shadow-[0_10px_30px_rgba(33,16,74,.05)]">
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
                  <Captions className="h-3.5 w-3.5" /> Đồng bộ & chỉnh sửa
                </button>
                <button
                  type="button"
                  data-testid="editor-mode-edit"
                  onClick={() => setEditorMode("edit")}
                  className={`inline-flex items-center gap-2 rounded px-3 py-2 text-xs font-black transition ${
                    editorMode === "edit"
                      ? "bg-white text-[#21104a] shadow-sm"
                      : "text-[#756894] hover:text-[#21104a]"
                  }`}
                >
                  <Pencil className="h-3.5 w-3.5" /> Văn bản thuần
                </button>
              </div>
              <p className="text-xs text-[#8a7da1]">
                {words.length > MAX_SYNC_WORDS
                  ? "Transcript quá dài, dùng chế độ chỉnh sửa để đảm bảo mượt."
                  : syncAvailable
                    ? "Sửa trực tiếp từng từ; bấm mốc thời gian để nghe đúng vị trí."
                    : "Bản ghi chưa có timestamp theo từng từ."}
              </p>
            </div>
            <div className="flex flex-col gap-3 border-b border-[#ece7f2] bg-[#fbfaf7] px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={undoEdit}
                  disabled={!undoStack.length}
                  title="Hoàn tác"
                  aria-label="Hoàn tác"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[#ded5e9] bg-white px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Undo2 className="h-3.5 w-3.5" /> Undo
                </button>
                <button
                  type="button"
                  onClick={redoEdit}
                  disabled={!redoStack.length}
                  title="Làm lại"
                  aria-label="Làm lại"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[#ded5e9] bg-white px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Redo2 className="h-3.5 w-3.5" /> Redo
                </button>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2 md:max-w-md">
                <Search className="h-4 w-4 shrink-0 text-[#8067aa]" />
                <input
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSearchIndex(-1);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      selectSearchMatch(searchIndex + (event.shiftKey ? -1 : 1));
                    }
                  }}
                  placeholder="Tìm trong transcript"
                  className="h-9 min-w-0 flex-1 rounded-md border border-[#ded5e9] bg-white px-3 text-sm outline-none focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20"
                />
                <span className="min-w-16 text-center text-xs font-bold text-[#756894]">
                  {searchMatches.length && searchIndex >= 0
                    ? `${searchIndex + 1}/${searchMatches.length}`
                    : `0/${searchMatches.length}`}
                </span>
                <button
                  type="button"
                  onClick={() => selectSearchMatch(searchIndex - 1)}
                  disabled={!searchMatches.length}
                  className="h-9 rounded-md border border-[#ded5e9] bg-white px-2 text-xs font-black disabled:opacity-40"
                >
                  Trước
                </button>
                <button
                  type="button"
                  onClick={() => selectSearchMatch(searchIndex + 1)}
                  disabled={!searchMatches.length}
                  className="h-9 rounded-md border border-[#ded5e9] bg-white px-2 text-xs font-black disabled:opacity-40"
                >
                  Sau
                </button>
              </div>
            </div>

            {editorMode === "sync" && syncAvailable ? (
              <div
                ref={syncScrollRef}
                className="max-h-[calc(100dvh-245px)] min-h-[520px] overflow-y-auto px-4 py-5 scroll-smooth md:px-7 lg:min-h-0 lg:max-h-none lg:flex-1"
              >
                <div className="mx-auto max-w-3xl space-y-6">
                  {segments.map((segment, segmentIndex) => (
                    <article
                      key={`${segment.start}-${segmentIndex}`}
                      className="grid gap-2 sm:grid-cols-[112px_minmax(0,1fr)]"
                    >
                      <div className="flex items-center gap-2 sm:block">
                        <button
                          type="button"
                          onClick={() => seekTo(segment.start)}
                          className="text-xs font-black text-[#5f4c82] hover:text-[#21104a]"
                        >
                          {formatClock(segment.start)}
                        </button>
                        <p className="mt-1 truncate text-xs font-bold text-[#9a8eac]">
                          {speakerLabel(segment.speaker)}
                        </p>
                      </div>
                      <p className="text-[15px] leading-8 text-[#342752]">
                        {segment.words.map((word) => (
                          <EditableTimedWord
                            key={`${word.start}-${word.index}`}
                            word={word}
                            active={activeWordIndex === word.index}
                            onCommit={commitTimedWord}
                            onSeek={seekTo}
                          />
                        ))}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[620px] flex-col p-4 md:p-6 lg:min-h-0 lg:flex-1">
                <div className="relative min-h-[560px] lg:min-h-0 lg:flex-1">
                  {syncAvailable && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent bg-[#fbfaf7] px-5 py-4 text-[15px] leading-8 break-words whitespace-pre-wrap text-[#342752]"
                    >
                      <div ref={plainTextMirrorRef}>
                        <HighlightedPlainText
                          text={editorText}
                          range={plainTextActiveRange}
                        />
                      </div>
                    </div>
                  )}
                  <textarea
                    ref={plainTextAreaRef}
                    value={editorText}
                    onChange={(event) =>
                      applyEditorChange(event.target.value, wordsRef.current, true)
                    }
                    onScroll={(event) => {
                      if (plainTextMirrorRef.current) {
                        plainTextMirrorRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
                      }
                    }}
                    aria-label="Nội dung transcript"
                    spellCheck
                    className={`relative h-full min-h-[560px] w-full resize-y rounded-lg border border-[#ded5e9] px-5 py-4 text-[15px] leading-8 outline-none transition focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20 lg:min-h-0 lg:resize-none ${
                      syncAvailable
                        ? "bg-transparent text-transparent caret-[#21104a] selection:bg-[#8067aa]/20"
                        : "bg-[#fbfaf7] text-[#342752]"
                    }`}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-[#8a7da1]">
                  <span>{editorText.length.toLocaleString("vi-VN")} ký tự</span>
                  <span>Tự động lưu sau 1,2 giây</span>
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-2 print:hidden lg:h-full lg:overflow-y-auto lg:pr-1">
            <TranscriptSidebarSection
              icon={<FileText className="h-4 w-4" />}
              title="Thông tin"
              defaultOpen
            >
              <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
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
              <div className="mt-3 flex items-center gap-2 border-t border-[#ece7f2] pt-3 text-xs text-[#756894]">
                <Clock3 className="h-3.5 w-3.5" />
                {new Date(transcript.created_at).toLocaleString("vi-VN")}
              </div>
            </TranscriptSidebarSection>

            <TranscriptSidebarSection
              icon={<Download className="h-4 w-4" />}
              title="Xuất transcript"
              meta="6 tùy chọn"
            >
              <div className="space-y-3">
                <div className="grid gap-2">
                  <label className="text-xs font-bold text-[#5f4c82]">
                    Mẫu xuất
                    <select
                      value={exportOptions.layout}
                      onChange={(event) =>
                        setExportOptions((current) => ({
                          ...current,
                          layout: event.target.value as ExportLayout,
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-[#ded5e9] bg-white px-2 py-2 text-xs font-bold text-[#21104a]"
                    >
                      <option value="segments">Theo từng đoạn</option>
                      <option value="document">Tài liệu liền mạch</option>
                    </select>
                  </label>
                  <label className="text-xs font-bold text-[#5f4c82]">
                    Nội dung
                    <select
                      value={exportOptions.translationMode}
                      onChange={(event) =>
                        setExportOptions((current) => ({
                          ...current,
                          translationMode:
                            event.target.value as ExportTranslationMode,
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-[#ded5e9] bg-white px-2 py-2 text-xs font-bold text-[#21104a]"
                    >
                      <option value="original">Transcript gốc</option>
                      <option
                        value="translation"
                        disabled={!transcript.translated_text}
                      >
                        Chỉ bản dịch
                      </option>
                      <option
                        value="bilingual"
                        disabled={!transcript.translated_text}
                      >
                        Song ngữ
                      </option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 rounded-md border border-[#ece7f2] px-2 py-2 text-xs font-bold text-[#5f4c82]">
                    <input
                      type="checkbox"
                      checked={exportOptions.includeSpeakers}
                      onChange={(event) =>
                        setExportOptions((current) => ({
                          ...current,
                          includeSpeakers: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 accent-[#21104a]"
                    />
                    Speaker
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-[#ece7f2] px-2 py-2 text-xs font-bold text-[#5f4c82]">
                    <input
                      type="checkbox"
                      checked={exportOptions.includeTimestamps}
                      onChange={(event) =>
                        setExportOptions((current) => ({
                          ...current,
                          includeTimestamps: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 accent-[#21104a]"
                    />
                    Timestamp
                  </label>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#ded5e9] px-2 py-2 text-[11px] font-bold hover:border-[#ffcb05]"
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
                  className="rounded-md border border-[#ded5e9] px-2 py-2 text-[11px] font-bold hover:border-[#ffcb05]"
                >
                  TXT
                </button>
                <button
                  type="button"
                  onClick={() => void exportDocx()}
                  className="rounded-md border border-[#ded5e9] px-2 py-2 text-[11px] font-bold hover:border-[#ffcb05]"
                >
                  DOCX
                </button>
                <button
                  type="button"
                  onClick={() => exportCaptions("srt")}
                  className="rounded-md border border-[#ded5e9] px-2 py-2 text-[11px] font-bold hover:border-[#ffcb05]"
                >
                  SRT
                </button>
                <button
                  type="button"
                  onClick={() => exportCaptions("vtt")}
                  className="rounded-md border border-[#ded5e9] px-2 py-2 text-[11px] font-bold hover:border-[#ffcb05]"
                >
                  VTT
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#ded5e9] px-2 py-2 text-[11px] font-bold hover:border-[#ffcb05]"
                >
                  <Printer className="h-3.5 w-3.5" /> PDF
                </button>
              </div>
            </TranscriptSidebarSection>

            <TranscriptSidebarSection
              icon={<Users className="h-4 w-4" />}
              title="Người nói"
              meta={speakers.length ? `${speakers.length}` : "Chưa tách"}
            >
              <div className="grid grid-cols-2 gap-2">
                {speakers.length ? (
                  speakers.map((speaker) => (
                    <label
                      key={speaker}
                      className="block rounded-md border border-[#ece7f2] bg-[#fbfaf7] p-2"
                    >
                      <span className="text-[11px] font-bold text-[#8a7da1]">
                        {speakerLabel(speaker)}
                      </span>
                      <input
                        defaultValue={speakerLabel(speaker)}
                        onBlur={(event) =>
                          updateSpeakerName(speaker, event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        className="mt-1 w-full rounded border border-[#ded5e9] bg-white px-2 py-1.5 text-xs font-bold outline-none focus:border-[#ffcb05]"
                      />
                    </label>
                  ))
                ) : (
                  <p className="text-xs leading-5 text-[#8a7da1]">
                    File này chưa bật nhận diện người nói.
                  </p>
                )}
              </div>
            </TranscriptSidebarSection>

            <TranscriptSidebarSection
              icon={<Flag className="h-4 w-4" />}
              title="Từ cần review"
              meta={`${lowConfidenceWords.length} từ`}
            >
              <p className="text-xs leading-5 text-[#8a7da1]">
                Confidence thấp hơn {Math.round(LOW_CONFIDENCE_THRESHOLD * 100)}%.
              </p>
              <div className="mt-3 max-h-72 space-y-2 overflow-auto">
                {lowConfidenceWords.length ? (
                  lowConfidenceWords.map((word) => (
                    <div
                      key={`${word.index}-${word.start}`}
                      className="rounded-md border border-red-100 bg-red-50 p-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditorMode("sync");
                            setActiveWordIndex(word.index);
                            seekTo(word.start);
                          }}
                          className="truncate text-left text-xs font-black text-red-800 underline"
                        >
                          {word.text}
                        </button>
                        <span className="shrink-0 text-[11px] font-bold text-red-700">
                          {Math.round(Number(word.confidence || 0) * 100)}%
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => markLowConfidenceReviewed(word.index)}
                        className="mt-2 w-full rounded-md bg-white px-2 py-1.5 text-[11px] font-black text-red-800"
                      >
                        Đánh dấu đã xem
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-xs leading-5 text-[#8a7da1]">
                    Không còn từ confidence thấp cần xử lý.
                  </p>
                )}
              </div>
            </TranscriptSidebarSection>

            <TranscriptSidebarSection
              icon={<History className="h-4 w-4" />}
              title="Phiên bản"
              meta={`${versions.length}`}
            >
              <button
                type="button"
                onClick={() => void loadVersions()}
                className="ml-auto block rounded-md border border-[#ded5e9] px-2 py-1 text-[11px] font-black"
              >
                Tải lại
              </button>
              {versionError && (
                <p className="mt-2 rounded-md bg-red-50 p-2 text-xs font-semibold text-red-800">
                  {versionError}
                </p>
              )}
              <div className="mt-3 max-h-80 space-y-2 overflow-auto">
                {versionsLoading ? (
                  <p className="text-xs text-[#8a7da1]">Đang tải phiên bản...</p>
                ) : versions.length ? (
                  versions.map((version) => (
                    <div
                      key={version.id}
                      className="rounded-md border border-[#ece7f2] bg-[#fbfaf7] p-2"
                    >
                      <p className="text-xs font-black">
                        {version.label || "Phiên bản"}
                      </p>
                      <p className="mt-1 text-[11px] text-[#8a7da1]">
                        {new Date(version.created_at).toLocaleString("vi-VN")} -{" "}
                        {version.text_length.toLocaleString("vi-VN")} ký tự,{" "}
                        {version.word_count.toLocaleString("vi-VN")} từ
                      </p>
                      <button
                        type="button"
                        onClick={() => void restoreVersion(version.id)}
                        className="mt-2 w-full rounded-md border border-[#ded5e9] bg-white px-2 py-1.5 text-[11px] font-black hover:border-[#ffcb05]"
                      >
                        Khôi phục
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-xs leading-5 text-[#8a7da1]">
                    Chưa có phiên bản tự động nào.
                  </p>
                )}
              </div>
            </TranscriptSidebarSection>

            <TranscriptSidebarSection
              icon={<Languages className="h-4 w-4" />}
              title="Bản dịch"
              meta={transcript.translated_text ? "Sẵn sàng" : "Chưa có"}
            >
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
                <div className="mt-3">
                  <p className="text-xs leading-5 text-[#8a7da1]">
                    {transcript.translation_error
                      ? "Bản dịch chưa hoàn tất. Hệ thống đã thử các nhà cung cấp dự phòng nhưng chưa nhận được kết quả."
                      : "Transcript này chưa có bản dịch."}
                  </p>
                  {transcript.translation_target_language && (
                    <button
                      type="button"
                      onClick={() => void retryTranslation()}
                      disabled={translationRetrying}
                      className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#ffcb05] px-3.5 py-2 text-xs font-black text-[#21104a] transition hover:bg-[#ffda45] disabled:cursor-wait disabled:opacity-65"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${
                          translationRetrying ? "animate-spin" : ""
                        }`}
                      />
                      {translationRetrying
                        ? "Đang dịch lại..."
                        : `Dịch lại sang ${languageLabel(
                            transcript.translation_target_language,
                          )}`}
                    </button>
                  )}
                  {translationRetryError && (
                    <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-700">
                      Dịch lại chưa thành công. Vui lòng thử lại sau.
                    </p>
                  )}
                  {(translationRetryError ||
                    transcript.translation_error) && (
                    <details className="mt-3 text-[11px] text-[#8a7da1]">
                      <summary className="cursor-pointer font-bold text-[#5f4c82]">
                        Chi tiết kỹ thuật
                      </summary>
                      <p className="mt-2 break-words leading-5">
                        {translationRetryError ||
                          transcript.translation_error}
                      </p>
                    </details>
                  )}
                </div>
              )}
            </TranscriptSidebarSection>
          </aside>
        </div>
      </main>
    </div>
  );
}
