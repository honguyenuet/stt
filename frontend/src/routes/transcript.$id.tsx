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
  Eye,
  EyeOff,
  FileAudio,
  FileText,
  Folder,
  GitMerge,
  Languages,
  Pause,
  Pencil,
  Play,
  Printer,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Users,
} from "lucide-react";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import { useAuth } from "@/context/AuthContext";
import { formatMediaDuration } from "@/lib/format-duration";
import {
  TRANSLATION_LANGUAGE_OPTIONS,
  languageLabel,
} from "@/lib/language-options";
import {
  clampSeekTime,
  confidenceLevel,
  findActiveWordIndex,
  formatPlaybackTime,
  replaceTimedWordInText,
  summarizeConfidence,
} from "@/lib/transcript-playback";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();
const REQUEST_TIMEOUT_MS = 12_000;
const AUTO_SAVE_DELAY_MS = 1_200;
const MAX_SYNC_WORDS = 5_000;

type SaveStatus = "saved" | "unsaved" | "saving" | "error";
type EditorMode = "sync" | "edit";

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
  speaker_names: Record<string, string>;
  audio_filename: string | null;
  source_language: string | null;
  translated_text: string | null;
  translation_target_language: string | null;
  translation_provider: string | null;
  translation_error: string | null;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  error_message: string | null;
  folder_id: number | null;
  folder_name: string | null;
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

const EditableTimedWord = memo(function EditableTimedWord({
  word,
  active,
  showConfidence,
  onCommit,
  onSeek,
}: {
  word: IndexedWord;
  active: boolean;
  showConfidence: boolean;
  onCommit: (index: number, text: string) => void;
  onSeek: (milliseconds: number) => void;
}) {
  const [value, setValue] = useState(word.text);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const confidence = confidenceLevel(word.confidence);
  const reviewClass =
    showConfidence && confidence === "low"
      ? "bg-[#ffe0dc] text-[#8f2019] shadow-[inset_0_-2px_0_#ef6a5b]"
      : showConfidence && confidence === "medium"
        ? "bg-[#fff1bd] text-[#6f5200] shadow-[inset_0_-2px_0_#e5b900]"
        : showConfidence && confidence === "high"
          ? "bg-[#e8f7ee] text-[#23633a]"
          : "bg-transparent text-[#342752] hover:bg-[#fff3bb]";

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      data-word-index={word.index}
      aria-current={active ? "true" : undefined}
      aria-label={`Chỉnh sửa từ ${word.text}`}
      title={
        word.confidence == null
          ? "Nhấn để nghe và chỉnh sửa"
          : `Độ tin cậy ${Math.round(word.confidence * 100)}%`
      }
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
          : `${reviewClass} focus:bg-white focus:ring-2 focus:ring-[#ffcb05]`
      }`}
    />
  );
});

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

function buildTextFromTimedWords(
  words: TranscriptWord[],
  speakerNames: Record<string, string> = {},
) {
  return buildSegments(words)
    .map((segment) => {
      const speakerPrefix =
        segment.speaker === null || segment.speaker === undefined
          ? ""
          : `${speakerLabel(segment.speaker, speakerNames)}: `;
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

function speakerLabel(
  value: string | number | null,
  names: Record<string, string> = {},
) {
  if (value === null || value === "") return "Nội dung";
  const raw = String(value);
  if (names[raw]) return names[raw];
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [audioDurationSeconds, setAudioDurationSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [translationRetrying, setTranslationRetrying] = useState(false);
  const [translationRetryError, setTranslationRetryError] = useState("");
  const [translationTarget, setTranslationTarget] = useState("en");
  const [showConfidence, setShowConfidence] = useState(true);

  const audioRef = useRef<HTMLAudioElement>(null);
  const syncScrollRef = useRef<HTMLDivElement>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null);
  const playWhenReadyRef = useRef(false);
  const pendingSeekMillisecondsRef = useRef<number | null>(null);
  const loadRequestRef = useRef<AbortController | null>(null);
  const saveRequestRef = useRef<AbortController | null>(null);
  const editorTextRef = useRef("");
  const savedTextRef = useRef("");
  const wordsRef = useRef<TranscriptWord[]>([]);

  const words = useMemo(() => transcript?.words ?? [], [transcript?.words]);
  const activeTranscriptId = transcript?.id ?? null;
  const syncAvailable = words.length > 0 && words.length <= MAX_SYNC_WORDS;
  const segments = useMemo(() => buildSegments(words), [words]);
  const activeWordWindow = useMemo(() => {
    if (activeWordIndex < 0) return [];
    const start = Math.max(0, activeWordIndex - 6);
    return words.slice(start, activeWordIndex + 8).map((word, index) => ({
      ...word,
      index: start + index,
    }));
  }, [activeWordIndex, words]);
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
  const confidenceSummary = useMemo(
    () => summarizeConfidence(words),
    [words],
  );

  const resizeEditorTextarea = useCallback(() => {
    const textarea = editorTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const viewportLimit = Math.max(
      320,
      Math.min(Math.round(window.innerHeight * 0.68), 760),
    );
    const nextHeight = Math.min(
      Math.max(textarea.scrollHeight, 260),
      viewportLimit,
    );
    textarea.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    if (editorMode === "edit") resizeEditorTextarea();
  }, [editorMode, editorText, resizeEditorTextarea]);

  useEffect(() => {
    window.addEventListener("resize", resizeEditorTextarea);
    return () => window.removeEventListener("resize", resizeEditorTextarea);
  }, [resizeEditorTextarea]);

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
            : "Không thể tải văn bản",
        );
      }
      const detail = body as TranscriptDetail;
      detail.words = normalizeWords(detail.words);
      detail.text = String(detail.text || "");
      detail.speaker_names =
        detail.speaker_names && typeof detail.speaker_names === "object"
          ? detail.speaker_names
          : {};
      setTranscript(detail);
      setTranslationTarget(detail.translation_target_language || "en");
      setTranslationRetryError("");
      setEditorText(detail.text);
      setSavedText(detail.text);
      setSaveStatus("saved");
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
            : "Không thể tải văn bản.",
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
        throw new Error(body.error || "Không tạo được đường dẫn âm thanh");
      }
      setAudioUrl(
        body.url.startsWith("http") ? body.url : `${API_URL}${body.url}`,
      );
    } catch (error) {
      playWhenReadyRef.current = false;
      setAudioError(
        error instanceof Error ? error.message : "Không tải được âm thanh gốc",
      );
    } finally {
      setAudioLoading(false);
    }
  }, [audioLoading, token, transcript?.audio_filename, transcript?.id]);

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
        ) ??
        buildTextFromTimedWords(nextWords, transcript?.speaker_names);

      wordsRef.current = nextWords;
      setTranscript((current) =>
        current ? { ...current, words: nextWords } : current,
      );
      setEditorText(nextTranscriptText);
      setSaveStatus("unsaved");
    },
    [transcript?.speaker_names],
  );

  const saveTranscript = useCallback(
    async (text: string, timedWords = wordsRef.current) => {
      if (!token || !activeTranscriptId) return false;
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
          previous ? { ...previous, text } : previous,
        );
        setSaveStatus(editorTextRef.current === text ? "saved" : "unsaved");
        return true;
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return false;
        setSaveStatus("error");
        setSaveError(
          timedOut
            ? "Lưu quá thời gian. Vui lòng kiểm tra kết nối và thử lại."
            : error instanceof Error
              ? error.message
              : "Không thể lưu thay đổi",
        );
        return false;
      } finally {
        window.clearTimeout(timer);
        if (saveRequestRef.current === controller) {
          saveRequestRef.current = null;
        }
      }
    },
    [activeTranscriptId, token],
  );

  async function saveSpeakerName(speaker: string) {
    if (!token || !activeTranscriptId || !transcript) return;
    const speakerNames = transcript.speaker_names || {};
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
          body: JSON.stringify({ speakerNames }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        speaker_names?: Record<string, string>;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "Không thể lưu tên người nói");
      }
      setTranscript((current) =>
        current
          ? {
              ...current,
              speaker_names: body.speaker_names || speakerNames,
            }
          : current,
      );
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(
        error instanceof Error ? error.message : "Không thể lưu tên người nói",
      );
    }
  }

  async function updateSpeakerAssignment(
    sourceSpeaker: string,
    targetSpeaker: string | null,
  ) {
    if (!token || !activeTranscriptId || !transcript) return;
    const nextWords = words.map((word) =>
      String(word.speaker) === sourceSpeaker
        ? { ...word, speaker: targetSpeaker }
        : word,
    );
    const nextNames = { ...transcript.speaker_names };
    delete nextNames[sourceSpeaker];
    const nextText = buildTextFromTimedWords(nextWords, nextNames);
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
          body: JSON.stringify({
            text: nextText,
            words: nextWords,
            speakerNames: nextNames,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "Không thể cập nhật người nói");
      }
      wordsRef.current = nextWords;
      setTranscript((current) =>
        current
          ? {
              ...current,
              words: nextWords,
              text: nextText,
              speaker_names: nextNames,
            }
          : current,
      );
      setEditorText(nextText);
      setSavedText(nextText);
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(
        error instanceof Error
          ? error.message
          : "Không thể cập nhật người nói",
      );
    }
  }

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
    [token, transcriptId],
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
        setAudioError("Không thể phát âm thanh. Vui lòng thử tải lại trang.");
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

  async function retryTranslation() {
    if (
      !token ||
      !transcript ||
      !translationTarget ||
      translationTarget === "none" ||
      translationRetrying
    ) {
      return;
    }
    setTranslationRetrying(true);
    setTranslationRetryError("");
    try {
      const saved = await saveTranscript(editorText);
      if (!saved) {
        throw new Error(
          "Chưa lưu được văn bản mới nhất nên hệ thống chưa bắt đầu dịch.",
        );
      }
      const response = await fetch(
        `${API_URL}/api/transcribe/${transcript.id}/translate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            targetLanguage: translationTarget,
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
                translationTarget,
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
          segment.speaker == null
            ? ""
            : `${speakerLabel(segment.speaker, transcript?.speaker_names)}: `;
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
            Không mở được văn bản
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
                Trình biên tập văn bản
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
                      "Không phát được âm thanh. Vui lòng tải lại trang và thử lại.",
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
                <span className="sr-only">Vị trí phát âm thanh</span>
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
              Bản ghi này không có âm thanh để nghe lại.
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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_310px] lg:items-start">
          <section className="overflow-hidden rounded-lg border border-[#e1dbea] bg-white shadow-[0_10px_30px_rgba(33,16,74,.05)]">
            <div className="flex flex-col gap-3 border-b border-[#ece7f2] px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
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
              <div className="flex flex-wrap items-center gap-2">
                {confidenceSummary.reviewedCount > 0 && (
                  <button
                    type="button"
                    aria-pressed={showConfidence}
                    onClick={() => setShowConfidence((value) => !value)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#ded5e9] bg-white px-3 py-2 text-xs font-bold text-[#5f4c82] transition hover:border-[#ffcb05]"
                  >
                    {showConfidence ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                    {showConfidence ? "Ẩn từ cần xem" : "Hiện từ cần xem"}
                  </button>
                )}
                <p className="text-xs text-[#8a7da1]">
                  {words.length > MAX_SYNC_WORDS
                    ? "Văn bản quá dài, hãy dùng chế độ chỉnh sửa để thao tác mượt hơn."
                    : syncAvailable
                      ? "Bấm vào từ để nghe đúng vị trí và chỉnh sửa."
                      : "Bản ghi chưa có mốc thời gian theo từng từ."}
                </p>
              </div>
            </div>

            {editorMode === "sync" && syncAvailable ? (
              <div
                ref={syncScrollRef}
                className="max-h-[calc(100vh-245px)] min-h-[260px] overflow-y-auto px-4 py-5 scroll-smooth md:px-7"
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
                          {speakerLabel(
                            segment.speaker,
                            transcript.speaker_names,
                          )}
                        </p>
                      </div>
                      <p className="text-[15px] leading-8 text-[#342752]">
                        {segment.words.map((word) => (
                          <EditableTimedWord
                            key={`${word.start}-${word.index}`}
                           word={word}
                           active={activeWordIndex === word.index}
                           showConfidence={showConfidence}
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
              <div className="p-4 md:p-6">
                {syncAvailable && (
                  <div className="mb-3 rounded-lg border border-[#f1d460] bg-[#fff9dd] px-4 py-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.1em] text-[#7b5e00]">
                      Theo dõi âm thanh khi chỉnh sửa
                    </p>
                    <p
                      data-typography="content"
                      data-testid="active-word-preview"
                      className="mt-1.5 min-h-7 text-sm leading-7 text-[#574875]"
                    >
                      {activeWordWindow.length > 0
                        ? activeWordWindow.map((word) => (
                            <span
                              key={`${word.start}-${word.index}`}
                              aria-current={
                                word.index === activeWordIndex
                                  ? "true"
                                  : undefined
                              }
                              className={
                                word.index === activeWordIndex
                                  ? "mx-0.5 rounded bg-[#ffcb05] px-1 font-black text-[#21104a]"
                                  : "mx-0.5"
                              }
                            >
                              {word.text}
                            </span>
                          ))
                        : "Nhấn Phát để theo dõi từ đang được đọc."}
                    </p>
                  </div>
                )}
                <textarea
                  ref={editorTextareaRef}
                  data-typography="content"
                  value={editorText}
                  onChange={(event) => setEditorText(event.target.value)}
                  aria-label="Nội dung văn bản"
                  spellCheck
                  className="min-h-[260px] max-h-[68vh] w-full resize-y overflow-y-auto rounded-lg border border-[#ded5e9] bg-[#fbfaf7] px-5 py-4 text-[15px] leading-8 text-[#342752] outline-none transition focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20"
                />
                <div className="mt-2 flex items-center justify-between text-xs text-[#8a7da1]">
                  <span>{editorText.length.toLocaleString("vi-VN")} ký tự</span>
                  <span>Tự động lưu sau 1,2 giây</span>
                </div>
              </div>
            )}
          </section>

          <aside className="self-start space-y-4 print:hidden">
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
                <div className="col-span-2">
                  <dt className="text-[#8a7da1]">Thư mục</dt>
                  <dd className="mt-1 flex items-center gap-1.5 truncate font-bold">
                    <Folder className="h-3.5 w-3.5 shrink-0" />
                    {transcript.folder_name || "Dự án mới"}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex items-center gap-2 border-t border-[#ece7f2] pt-4 text-xs text-[#756894]">
                <Clock3 className="h-3.5 w-3.5" />
                {new Date(transcript.created_at).toLocaleString("vi-VN")}
              </div>
            </section>

            {confidenceSummary.reviewedCount > 0 && (
              <section className="rounded-lg border border-[#e1dbea] bg-white p-4">
                <h2 className="flex items-center gap-2 text-sm font-black">
                  <Eye className="h-4 w-4 text-[#8067aa]" /> Chất lượng nhận dạng
                </h2>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-2xl font-black text-[#21104a]">
                      {Math.round((confidenceSummary.average || 0) * 100)}%
                    </p>
                    <p className="mt-1 text-xs text-[#8a7da1]">
                      Độ tin cậy trung bình
                    </p>
                  </div>
                  <span className="rounded-full bg-[#ffe0dc] px-2.5 py-1 text-xs font-black text-[#8f2019]">
                    {confidenceSummary.lowCount} từ cần xem
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold">
                  <span className="rounded bg-[#e8f7ee] px-2 py-1 text-[#23633a]">
                    Tốt ≥ 85%
                  </span>
                  <span className="rounded bg-[#fff1bd] px-2 py-1 text-[#6f5200]">
                    Cần xem 65–84%
                  </span>
                  <span className="rounded bg-[#ffe0dc] px-2 py-1 text-[#8f2019]">
                    Thấp &lt; 65%
                  </span>
                </div>
              </section>
            )}

            <section className="rounded-lg border border-[#e1dbea] bg-white p-4">
              <h2 className="flex items-center gap-2 text-sm font-black">
                <Download className="h-4 w-4 text-[#8067aa]" /> Xuất văn bản
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
              <div className="mt-3 space-y-2">
                {speakers.length ? (
                  speakers.map((speaker) => {
                    const fallbackLabel = speakerLabel(speaker);
                    return (
                      <label
                        key={speaker}
                        className="block rounded-md border border-[#e1dbea] bg-[#fbfaf7] px-3 py-2"
                      >
                        <span className="block text-[10px] font-black uppercase tracking-[0.08em] text-[#8a7da1]">
                          {fallbackLabel}
                        </span>
                        <input
                          value={transcript.speaker_names[speaker] || ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            setTranscript((current) =>
                              current
                                ? {
                                    ...current,
                                    speaker_names: {
                                      ...current.speaker_names,
                                      [speaker]: value,
                                    },
                                  }
                                : current,
                            );
                          }}
                          onBlur={() => void saveSpeakerName(speaker)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            }
                          }}
                          maxLength={100}
                          placeholder={fallbackLabel}
                          aria-label={`Tên hiển thị cho ${fallbackLabel}`}
                          className="mt-1 w-full bg-transparent text-xs font-bold text-[#5f4c82] outline-none placeholder:text-[#a99fba]"
                        />
                        <div className="mt-2 flex items-center gap-2 border-t border-[#ece7f2] pt-2">
                          <GitMerge className="h-3.5 w-3.5 shrink-0 text-[#8a7da1]" />
                          <select
                            defaultValue=""
                            aria-label={`Gộp hoặc xóa ${fallbackLabel}`}
                            onChange={(event) => {
                              const value = event.target.value;
                              event.currentTarget.value = "";
                              if (!value) return;
                              void updateSpeakerAssignment(
                                speaker,
                                value === "__clear" ? null : value,
                              );
                            }}
                            className="min-w-0 flex-1 bg-transparent text-[11px] font-bold text-[#5f4c82] outline-none"
                          >
                            <option value="">Gộp hoặc xóa nhãn...</option>
                            {speakers
                              .filter((target) => target !== speaker)
                              .map((target) => (
                                <option key={target} value={target}>
                                  Gộp vào {speakerLabel(target, transcript.speaker_names)}
                                </option>
                              ))}
                            <option value="__clear">Xóa nhãn người nói</option>
                          </select>
                        </div>
                      </label>
                    );
                  })
                ) : (
                  <p className="text-xs leading-5 text-[#8a7da1]">
                    Tệp này chưa bật nhận diện người nói.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-[#e1dbea] bg-white p-4">
              <h2 className="flex items-center gap-2 text-sm font-black">
                <Languages className="h-4 w-4 text-[#8067aa]" /> Bản dịch
              </h2>
              <div className="mt-3 space-y-2">
                <label className="block">
                  <span className="text-[11px] font-bold text-[#8a7da1]">
                    Ngôn ngữ đích
                  </span>
                  <select
                    value={translationTarget}
                    onChange={(event) =>
                      setTranslationTarget(event.target.value)
                    }
                    className="mt-1 w-full rounded-md border border-[#ded5e9] bg-white px-3 py-2.5 text-xs font-bold text-[#342752] outline-none focus:border-[#ffcb05]"
                  >
                    {TRANSLATION_LANGUAGE_OPTIONS.filter(
                      (option) => option.value !== "none",
                    ).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void retryTranslation()}
                  disabled={translationRetrying || !editorText.trim()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#ffcb05] px-3.5 py-2.5 text-xs font-black text-[#21104a] transition hover:bg-[#ffda45] disabled:cursor-wait disabled:opacity-65"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      translationRetrying ? "animate-spin" : ""
                    }`}
                  />
                  {translationRetrying
                    ? "Đang lưu và dịch..."
                    : transcript.translated_text
                      ? "Cập nhật bản dịch"
                      : "Tạo bản dịch"}
                </button>
                <p className="text-[11px] leading-5 text-[#8a7da1]">
                  Hệ thống lưu văn bản đã chỉnh sửa trước rồi mới dịch.
                </p>
              </div>
              {transcript.translated_text ? (
                <div className="mt-4 border-t border-[#ece7f2] pt-3">
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
                      : "Văn bản này chưa có bản dịch."}
                  </p>
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
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
