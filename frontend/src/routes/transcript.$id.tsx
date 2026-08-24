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
  ArrowRight,
  Captions,
  Check,
  Clock3,
  Copy,
  Download,
  FileAudio,
  FileText,
  Flag,
  GitCompare,
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
  Sparkles,
  Tag,
  Undo2,
  Redo2,
  Users,
} from "lucide-react";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import { TranscriptSidebarSection } from "@/components/transcript-sidebar-section";
import { TranscriptCollaborationPanel } from "@/components/transcript-collaboration-panel";
import { useAuth } from "@/context/AuthContext";
import { formatMediaDuration } from "@/lib/format-duration";
import { languageLabel } from "@/lib/language-options";
import {
  audioAccessNeedsRefresh,
  audioRecoveryMadeProgress,
  canUseSyncEditor,
  clampSeekTime,
  createAudioRecoveryPlan,
  createApproximateTimedWords,
  findActiveWordIndex,
  formatPlaybackTime,
  normalizeTimedWordBounds,
  indexTimedWordTextRanges,
  MAX_EDITABLE_TIMED_WORDS,
  nextTranscriptFollowMode,
  replaceTimedWordInText,
  type TranscriptFollowMode,
} from "@/lib/transcript-playback";
import {
  EDITABLE_TIMED_WORD_CLASS_NAME,
  TRANSCRIPT_WORD_FLOW_CLASS_NAME,
  editableTimedWordWidthCh,
} from "@/lib/transcript-typography";
import { getVirtualLayout, getVirtualWindow } from "@/lib/virtual-window";
import { buildTranscriptSavePayload } from "@/lib/transcript-save";
import { getApiBaseUrl } from "@/lib/api-base-url";
import {
  compareTranscriptText,
  type TranscriptTextComparison,
} from "@/lib/transcript-version";
import {
  applyRememberedSpeakerLabels,
  normalizeSpeakerMemory,
  renameRememberedSpeakerLabel,
} from "@/lib/speaker-memory";
import { buildTemplateFrontMatter } from "@/lib/transcript-template-export";

const API_URL = getApiBaseUrl();
const REQUEST_TIMEOUT_MS = 12_000;
const AUTO_SAVE_DELAY_MS = 1_200;
const MAX_LOCAL_HISTORY = 80;
const LOW_CONFIDENCE_THRESHOLD = 0.75;
const VIRTUAL_SEGMENT_ESTIMATED_SIZE = 176;
const VIRTUAL_SEGMENT_GAP = 24;
const VIRTUAL_SEGMENT_OVERSCAN = 3;

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
  transcript_template: TranscriptTemplate;
  insights: TranscriptInsights | null;
  insights_updated_at: string | null;
  reviewed_word_indexes: number[];
  tags: string[];
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

type TranscriptTemplate = "meeting" | "interview" | "podcast" | "lecture";

interface TranscriptInsights {
  template: TranscriptTemplate;
  summary: string;
  keyPoints: string[];
  actionItems: Array<{
    text: string;
    owner: string | null;
    deadline: string | null;
  }>;
  decisions: string[];
  chapters: Array<{
    title: string;
    startMs: number;
    endMs: number;
    summary: string;
  }>;
  keywords: string[];
  questions: string[];
  generatedAt: string;
  generator: string;
}

interface IndexedWord extends TranscriptWord {
  index: number;
}

interface TranscriptVersion {
  id: number;
  label: string | null;
  actor_name: string;
  change_source: "owner" | "shared" | "restore";
  created_at: string;
  text_length: number;
  word_count: number;
}

interface VersionComparison {
  version: Pick<
    TranscriptVersion,
    "id" | "label" | "actor_name" | "change_source" | "created_at"
  >;
  comparison: TranscriptTextComparison;
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
  const valueRef = useRef(word.text);
  const wordRef = useRef(word);
  const onCommitRef = useRef(onCommit);
  const isLowConfidence =
    typeof word.confidence === "number" &&
    word.confidence > 0 &&
    word.confidence < LOW_CONFIDENCE_THRESHOLD;

  useEffect(() => {
    wordRef.current = word;
    onCommitRef.current = onCommit;
    if (document.activeElement !== inputRef.current) {
      setValue(word.text);
      valueRef.current = word.text;
    }
  }, [onCommit, word]);

  useEffect(
    () => () => {
      const currentWord = wordRef.current;
      const nextValue = valueRef.current.trim();
      if (nextValue && nextValue !== currentWord.text) {
        onCommitRef.current(currentWord.index, nextValue);
      }
    },
    [],
  );

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
      onChange={(event) => {
        valueRef.current = event.target.value;
        setValue(event.target.value);
      }}
      onClick={() => onSeek(word.start)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          valueRef.current = word.text;
          setValue(word.text);
          event.currentTarget.blur();
        }
      }}
      style={{
        width: `${editableTimedWordWidthCh(value)}ch`,
      }}
      className={`${EDITABLE_TIMED_WORD_CLASS_NAME} ${
        active
          ? "bg-[#ffcb05] font-black text-[#21104a] shadow-[0_0_0_3px_rgba(255,203,5,.22)]"
          : isLowConfidence
            ? "bg-red-50 text-red-800 ring-1 ring-red-200 hover:bg-red-100 focus:bg-white focus:ring-2 focus:ring-red-300"
          : "bg-transparent text-[#342752] hover:bg-[#fff3bb] focus:bg-white focus:ring-2 focus:ring-[#ffcb05]"
      }`}
    />
  );
});

const VirtualTranscriptSegment = memo(function VirtualTranscriptSegment({
  segment,
  segmentIndex,
  start,
  activeWordIndex,
  onCommit,
  onSeek,
  onMeasure,
}: {
  segment: TranscriptSegment;
  segmentIndex: number;
  start: number;
  activeWordIndex: number;
  onCommit: (index: number, text: string) => void;
  onSeek: (milliseconds: number) => void;
  onMeasure: (index: number, size: number) => void;
}) {
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const measure = () =>
      onMeasure(
        segmentIndex,
        Math.ceil(article.getBoundingClientRect().height) + VIRTUAL_SEGMENT_GAP,
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(article);
    return () => observer.disconnect();
  }, [onMeasure, segmentIndex]);

  return (
    <article
      ref={articleRef}
      data-segment-index={segmentIndex}
      style={{ transform: `translateY(${start}px)` }}
      className="absolute inset-x-0 top-0 grid gap-2 sm:grid-cols-[112px_minmax(0,1fr)]"
    >
      <div className="flex items-center gap-2 sm:block">
        <button
          type="button"
          onClick={() => onSeek(segment.start)}
          className="text-xs font-black text-[#5f4c82] hover:text-[#21104a]"
        >
          {formatClock(segment.start)}
        </button>
        <p className="mt-1 truncate text-xs font-bold text-[#9a8eac]">
          {speakerLabel(segment.speaker)}
        </p>
      </div>
      <p className={TRANSCRIPT_WORD_FLOW_CLASS_NAME}>
        {segment.words.map((word) => (
          <EditableTimedWord
            key={`${word.start}-${word.index}`}
            word={word}
            active={activeWordIndex === word.index}
            onCommit={onCommit}
            onSeek={onSeek}
          />
        ))}
      </p>
    </article>
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
  validateSearch: (search: Record<string, unknown>) => {
    const at = Number(search.at);
    return {
      at: Number.isFinite(at) && at >= 0 ? at : undefined,
    };
  },
  component: TranscriptEditorPage,
});

function normalizeWords(
  value: unknown,
  durationSeconds?: number | null,
): TranscriptWord[] {
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
  return normalizeTimedWordBounds(words, durationSeconds);
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

function findSegmentIndexForWord(
  segments: TranscriptSegment[],
  wordIndex: number,
) {
  if (wordIndex < 0) return -1;
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segmentWords = segments[middle].words;
    const firstWordIndex = segmentWords[0]?.index ?? -1;
    const lastWordIndex = segmentWords.at(-1)?.index ?? -1;
    if (wordIndex < firstWordIndex) high = middle - 1;
    else if (wordIndex > lastWordIndex) low = middle + 1;
    else return middle;
  }
  return -1;
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

function plainTextTokens(text: string) {
  const matches = String(text || "").match(/\S+/g);
  return matches || [];
}

function compareToken(value: string) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function interpolateWordTiming(
  index: number,
  total: number,
  baseWords: TranscriptWord[],
  matchedBaseIndex: number | null,
) {
  if (matchedBaseIndex !== null && baseWords[matchedBaseIndex]) {
    const base = baseWords[matchedBaseIndex];
    return { start: base.start, end: base.end };
  }

  const firstStart = baseWords[0]?.start ?? 0;
  const lastEnd = baseWords[baseWords.length - 1]?.end ?? firstStart + total * 450;
  const span = Math.max(total * 120, lastEnd - firstStart);
  const slot = span / Math.max(1, total);
  const start = Math.round(firstStart + slot * index);
  return { start, end: Math.round(start + Math.max(120, slot * 0.82)) };
}

function alignTokensToBaseWords(tokens: string[], baseWords: TranscriptWord[]) {
  if (tokens.length === baseWords.length) {
    return tokens.map((_, index) => index);
  }
  if (tokens.length > 800 || baseWords.length > 800) {
    return tokens.map((_, index) =>
      Math.min(
        baseWords.length - 1,
        Math.max(0, Math.round((index / Math.max(1, tokens.length - 1)) * (baseWords.length - 1))),
      ),
    );
  }

  const tokenKeys = tokens.map(compareToken);
  const baseKeys = baseWords.map((word) => compareToken(word.text));
  const dp = Array.from({ length: tokens.length + 1 }, () =>
    Array(baseWords.length + 1).fill(0),
  );
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    for (let j = baseWords.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        tokenKeys[i] && tokenKeys[i] === baseKeys[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const aligned = Array<number | null>(tokens.length).fill(null);
  let i = 0;
  let j = 0;
  while (i < tokens.length && j < baseWords.length) {
    if (tokenKeys[i] && tokenKeys[i] === baseKeys[j]) {
      aligned[i] = j;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return aligned;
}

function deriveTimedWordsFromPlainText(
  text: string,
  baseWords: TranscriptWord[],
  durationSeconds?: number | null,
) {
  const tokens = plainTextTokens(text);
  if (!tokens.length) return [];
  if (!baseWords.length) {
    return normalizeTimedWordBounds(
      tokens.map((token, index) => ({
        text: token,
        start: index * 450,
        end: index * 450 + 360,
        speaker: null,
        confidence: null,
      })),
      durationSeconds,
    );
  }

  const aligned = alignTokensToBaseWords(tokens, baseWords);
  const nextWords = tokens.map((token, index) => {
    const baseIndex = aligned[index];
    const timing = interpolateWordTiming(index, tokens.length, baseWords, baseIndex);
    const base =
      baseIndex !== null && baseWords[baseIndex] ? baseWords[baseIndex] : null;
    return {
      text: token,
      start: timing.start,
      end: Math.max(timing.start, timing.end),
      speaker: base?.speaker ?? null,
      confidence: base?.confidence ?? null,
    };
  });
  return normalizeTimedWordBounds(nextWords, durationSeconds);
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
  const { at: requestedStartMs } = Route.useSearch();
  const transcriptId = Number(id);
  const { user, token, isLoading } = useAuth();
  const navigate = useNavigate();
  const [transcript, setTranscript] = useState<TranscriptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioAccessExpiresAt, setAudioAccessExpiresAt] = useState<
    number | null
  >(null);
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
  const [versionComparingId, setVersionComparingId] = useState<number | null>(
    null,
  );
  const [versionComparison, setVersionComparison] =
    useState<VersionComparison | null>(null);
  const [insightsGenerating, setInsightsGenerating] = useState(false);
  const [insightsError, setInsightsError] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [speakerMergeSource, setSpeakerMergeSource] = useState("");
  const [speakerMergeTarget, setSpeakerMergeTarget] = useState("");
  const [rememberSpeakerLabels, setRememberSpeakerLabels] = useState(true);
  const [timelineIsEstimated, setTimelineIsEstimated] = useState(false);
  const [timelineIsTooLarge, setTimelineIsTooLarge] = useState(false);
  const [syncScrollOffset, setSyncScrollOffset] = useState(0);
  const [syncViewportSize, setSyncViewportSize] = useState(600);
  const [transcriptFollowMode, setTranscriptFollowMode] =
    useState<TranscriptFollowMode>("following");
  const [segmentSizes, setSegmentSizes] = useState(
    () => new Map<number, number>(),
  );
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
  const playbackRequestedRef = useRef(false);
  const pendingSeekMillisecondsRef = useRef<number | null>(null);
  const audioLoadingRef = useRef(false);
  const audioRecoveryAttemptsRef = useRef(0);
  const audioRecoveryCheckpointRef = useRef<number | null>(null);
  const loadRequestRef = useRef<AbortController | null>(null);
  const saveRequestRef = useRef<AbortController | null>(null);
  const editorTextRef = useRef("");
  const savedTextRef = useRef("");
  const wordsRef = useRef<TranscriptWord[]>([]);
  const savedWordsRef = useRef<TranscriptWord[]>([]);
  const timelineNeedsInitializationRef = useRef(false);
  const historyPushRef = useRef(0);
  const syncScrollFrameRef = useRef<number | null>(null);

  const words = useMemo(() => transcript?.words ?? [], [transcript?.words]);
  const activeTranscriptId = transcript?.id ?? null;
  const syncAvailable = canUseSyncEditor(words.length);
  const segments = useMemo(() => buildSegments(words), [words]);
  const activeSegmentIndex = useMemo(
    () => findSegmentIndexForWord(segments, activeWordIndex),
    [activeWordIndex, segments],
  );
  const virtualSegmentLayout = useMemo(
    () =>
      getVirtualLayout({
        itemCount: segments.length,
        estimatedItemSize: VIRTUAL_SEGMENT_ESTIMATED_SIZE,
        measuredItemSizes: segmentSizes,
      }),
    [segmentSizes, segments.length],
  );
  const virtualSegments = useMemo(
    () =>
      getVirtualWindow({
        layout: virtualSegmentLayout,
        scrollOffset: syncScrollOffset,
        viewportSize: syncViewportSize,
        overscan: VIRTUAL_SEGMENT_OVERSCAN,
      }),
    [syncScrollOffset, syncViewportSize, virtualSegmentLayout],
  );
  const firstVirtualSegment = virtualSegments.items[0]?.index ?? -1;
  const lastVirtualSegment = virtualSegments.items.at(-1)?.index ?? -1;
  const activeSegmentStart =
    activeSegmentIndex >= 0
      ? (virtualSegments.offsets[activeSegmentIndex] ?? 0)
      : 0;
  const activeSegmentSize =
    activeSegmentIndex >= 0
      ? (segmentSizes.get(activeSegmentIndex) ??
        VIRTUAL_SEGMENT_ESTIMATED_SIZE)
      : 0;
  const translationSegments = useMemo(
    () => splitTranslationIntoSegments(transcript?.translated_text, segments.length),
    [segments.length, transcript?.translated_text],
  );
  const plainTextWordRanges = useMemo(
    () =>
      editorMode === "edit" && syncAvailable
        ? indexTimedWordTextRanges(editorText, words)
        : [],
    [editorMode, editorText, syncAvailable, words],
  );
  const plainTextActiveRange =
    activeWordIndex >= 0
      ? (plainTextWordRanges[activeWordIndex] ?? null)
      : null;
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
            word.confidence < LOW_CONFIDENCE_THRESHOLD &&
            !transcript?.reviewed_word_indexes?.includes(word.index),
        )
        .sort((a, b) => a.start - b.start)
        .slice(0, 30),
    [transcript?.reviewed_word_indexes, words],
  );
  const lowConfidenceReviewIndex = useMemo(
    () => lowConfidenceWords.findIndex((word) => word.index === activeWordIndex),
    [activeWordIndex, lowConfidenceWords],
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

  const handleSegmentMeasure = useCallback((index: number, size: number) => {
    setSegmentSizes((current) => {
      const previousSize = current.get(index);
      if (previousSize !== undefined && Math.abs(previousSize - size) < 1) {
        return current;
      }
      const next = new Map(current);
      next.set(index, size);
      return next;
    });
  }, []);

  const handleSyncScroll = useCallback((scrollOffset: number) => {
    if (syncScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(syncScrollFrameRef.current);
    }
    syncScrollFrameRef.current = window.requestAnimationFrame(() => {
      syncScrollFrameRef.current = null;
      setSyncScrollOffset(scrollOffset);
    });
  }, []);

  useEffect(
    () => () => {
      if (syncScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(syncScrollFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setSegmentSizes(new Map());
    setSyncScrollOffset(0);
    if (syncScrollRef.current) syncScrollRef.current.scrollTop = 0;
  }, [activeTranscriptId]);

  useEffect(() => {
    if (editorMode !== "sync" || !syncAvailable) return;
    const container = syncScrollRef.current;
    if (!container) return;
    const updateViewport = () => {
      setSyncViewportSize(Math.max(1, container.clientHeight));
      setSyncScrollOffset(container.scrollTop);
    };
    updateViewport();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewport);
      return () => window.removeEventListener("resize", updateViewport);
    }
    const observer = new ResizeObserver(updateViewport);
    observer.observe(container);
    return () => observer.disconnect();
  }, [editorMode, segments.length, syncAvailable]);

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
    if (!Number.isSafeInteger(transcriptId) || transcriptId < 1) {
      setLoading(false);
      setLoadError("ID transcript không hợp lệ.");
      return;
    }
    if (!token) {
      if (!isLoading) {
        setLoading(false);
        setLoadError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      }
      return;
    }
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
      const providerWords = normalizeWords(detail.words, detail.duration);
      const estimatedWords = providerWords.length
        ? []
        : createApproximateTimedWords(
            detail.text,
            detail.duration,
            MAX_EDITABLE_TIMED_WORDS,
          );
      detail.words = providerWords.length
        ? providerWords
        : estimatedWords;
      savedWordsRef.current = providerWords.map((word) => ({ ...word }));
      timelineNeedsInitializationRef.current =
        !providerWords.length && estimatedWords.length > 0;
      setTimelineIsEstimated(!providerWords.length && detail.words.length > 0);
      setTimelineIsTooLarge(
        !providerWords.length &&
          Boolean(String(detail.text || "").trim()) &&
          !estimatedWords.length,
      );
      try {
        const remembered = normalizeSpeakerMemory(
          JSON.parse(window.localStorage.getItem("vbee-speaker-labels") || "{}"),
        );
        detail.words = applyRememberedSpeakerLabels(detail.words, remembered);
      } catch {
        // Bộ nhớ trình duyệt có thể bị chặn; transcript vẫn hoạt động bình thường.
      }
      detail.text = String(detail.text || "");
      detail.transcript_template = [
        "meeting",
        "interview",
        "podcast",
        "lecture",
      ].includes(detail.transcript_template)
        ? detail.transcript_template
        : "meeting";
      detail.insights =
        detail.insights && typeof detail.insights === "object"
          ? detail.insights
          : null;
      detail.reviewed_word_indexes = Array.isArray(
        detail.reviewed_word_indexes,
      )
        ? detail.reviewed_word_indexes.filter(
            (value) => Number.isSafeInteger(value) && value >= 0,
          )
        : [];
      detail.tags = Array.isArray(detail.tags)
        ? detail.tags.map((tag) => String(tag)).filter(Boolean)
        : [];
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
      setInsightsError("");
      setTagDraft(detail.tags.join(", "));
      setEditorMode(
        canUseSyncEditor(detail.words.length)
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
  }, [isLoading, token, transcriptId]);

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
    setAudioAccessExpiresAt(null);
    setAudioError("");
    setAudioLoading(false);
    setIsPlaying(false);
    setPlaybackSeconds(0);
    setAudioDurationSeconds(0);
    setActiveWordIndex(-1);
    playWhenReadyRef.current = false;
    playbackRequestedRef.current = false;
    audioLoadingRef.current = false;
    audioRecoveryAttemptsRef.current = 0;
    audioRecoveryCheckpointRef.current = null;
    setTranscriptFollowMode("following");
    pendingSeekMillisecondsRef.current = requestedStartMs ?? null;
    if (requestedStartMs !== undefined) {
      setPlaybackSeconds(requestedStartMs / 1000);
      setActiveWordIndex(
        findActiveWordIndex(wordsRef.current, requestedStartMs),
      );
    }
  }, [requestedStartMs, transcript?.audio_filename, transcript?.id]);

  useEffect(() => {
    if (
      editorMode !== "sync" ||
      transcriptFollowMode !== "following" ||
      activeWordIndex < 0 ||
      activeSegmentIndex < 0
    ) {
      return;
    }
    const container = syncScrollRef.current;
    if (!container) return;
    const segmentIsRendered =
      activeSegmentIndex >= firstVirtualSegment &&
      activeSegmentIndex <= lastVirtualSegment;
    if (!segmentIsRendered) {
      const nextScrollTop = Math.max(
        0,
        activeSegmentStart -
          Math.max(0, container.clientHeight - activeSegmentSize) / 2,
      );
      container.scrollTop = nextScrollTop;
      setSyncScrollOffset(nextScrollTop);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const activeWord = container.querySelector<HTMLElement>(
        `[data-word-index="${activeWordIndex}"]`,
      );
      if (!activeWord) return;
      const containerRect = container.getBoundingClientRect();
      const wordRect = activeWord.getBoundingClientRect();
      const isOutsideViewport =
        wordRect.top < containerRect.top + 64 ||
        wordRect.bottom > containerRect.bottom - 64;
      if (isOutsideViewport) {
        activeWord.scrollIntoView({ block: "center", behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeSegmentIndex,
    activeSegmentSize,
    activeSegmentStart,
    activeWordIndex,
    editorMode,
    firstVirtualSegment,
    lastVirtualSegment,
    transcriptFollowMode,
  ]);

  useEffect(() => {
    if (
      editorMode !== "edit" ||
      transcriptFollowMode !== "following" ||
      !plainTextActiveRange
    ) {
      return;
    }
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
  }, [editorMode, plainTextActiveRange, transcriptFollowMode]);

  const loadAudio = useCallback(
    async (playWhenReady = false, seekMilliseconds: number | null = null) => {
      if (
        !token ||
        !transcript?.audio_filename ||
        audioLoadingRef.current
      ) {
        return;
      }
      if (seekMilliseconds !== null) {
        pendingSeekMillisecondsRef.current = Math.max(0, seekMilliseconds);
      }
      playWhenReadyRef.current = playWhenReady;
      playbackRequestedRef.current = playWhenReady;
      audioLoadingRef.current = true;
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
          expiresAt?: string;
          error?: string;
        };
        if (!response.ok || !body.url) {
          throw new Error(body.error || "Không tạo được đường dẫn audio");
        }
        const expiresAt = body.expiresAt ? Date.parse(body.expiresAt) : NaN;
        setAudioAccessExpiresAt(
          Number.isFinite(expiresAt) ? expiresAt : null,
        );
        const resolvedUrl = body.url.startsWith("http")
          ? body.url
          : `${API_URL}${body.url}`;
        const separator = resolvedUrl.includes("?") ? "&" : "?";
        setAudioUrl(`${resolvedUrl}${separator}refresh=${Date.now()}`);
      } catch (error) {
        playWhenReadyRef.current = false;
        playbackRequestedRef.current = false;
        setAudioError(
          error instanceof Error ? error.message : "Không tải được audio gốc",
        );
      } finally {
        audioLoadingRef.current = false;
        setAudioLoading(false);
      }
    },
    [token, transcript?.audio_filename, transcript?.id],
  );

  const pushUndoSnapshot = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - historyPushRef.current < 700) return;
    historyPushRef.current = now;
    // Word arrays are replaced, never mutated, so long-text snapshots can share
    // the immutable timeline instead of cloning thousands of objects per keypress.
    const snapshot = {
      text: editorTextRef.current,
      words: wordsRef.current,
    };
    setUndoStack((current) => {
      const last = current[current.length - 1];
      if (
        last &&
        last.text === snapshot.text &&
        last.words === snapshot.words
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
      const wordsChanged = nextWords !== wordsRef.current;
      wordsRef.current = nextWords;
      editorTextRef.current = text;
      setEditorText(text);
      setTranscript((current) =>
        current
          ? wordsChanged
            ? { ...current, text, words: nextWords }
            : { ...current, text }
          : current,
      );
      setDirtyRevision((value) => value + 1);
      setSaveStatus("unsaved");
    },
    [pushUndoSnapshot],
  );

  const applyPlainTextChange = useCallback(
    (text: string) => {
      const nextWords = deriveTimedWordsFromPlainText(
        text,
        wordsRef.current,
        transcript?.duration,
      );
      applyEditorChange(text, nextWords, true);
    },
    [applyEditorChange, transcript?.duration],
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
      const payload = buildTranscriptSavePayload(
        text,
        timedWords,
        savedWordsRef.current,
        {
          initializeWordTimeline: timelineNeedsInitializationRef.current,
        },
      );
      try {
        const response = await fetch(
          `${API_URL}/api/transcribe/${activeTranscriptId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          words?: unknown;
        };
        if (!response.ok) {
          throw new Error(body.error || "Không thể lưu thay đổi");
        }
        const returnedWords = Array.isArray(body.words)
          ? normalizeWords(body.words)
          : null;
        const persistedWords = returnedWords ?? timedWords;
        const saveIsCurrent =
          editorTextRef.current === text && wordsRef.current === timedWords;
        setSavedText(text);
        savedWordsRef.current = persistedWords.map((word) => ({ ...word }));
        timelineNeedsInitializationRef.current = false;
        if (saveIsCurrent) {
          wordsRef.current = persistedWords;
          setTranscript((previous) =>
            previous ? { ...previous, text, words: persistedWords } : previous,
          );
          setDirtyRevision(0);
        }
        setSaveStatus(saveIsCurrent ? "saved" : "unsaved");
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
        const payload = JSON.stringify(
          buildTranscriptSavePayload(
            pendingText,
            wordsRef.current,
            savedWordsRef.current,
            {
              initializeWordTimeline: timelineNeedsInitializationRef.current,
            },
          ),
        );
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
    if (
      audioRecoveryMadeProgress(
        audioRecoveryCheckpointRef.current,
        currentSeconds,
      )
    ) {
      audioRecoveryAttemptsRef.current = 0;
      audioRecoveryCheckpointRef.current = null;
    }
    setPlaybackSeconds(currentSeconds);
    setActiveWordIndex(findActiveWordIndex(words, currentSeconds * 1000));
  }

  const pauseTranscriptFollow = useCallback(() => {
    setTranscriptFollowMode((current) =>
      nextTranscriptFollowMode(current, "user-scroll"),
    );
  }, []);

  const resumeTranscriptFollow = useCallback(() => {
    setTranscriptFollowMode((current) =>
      nextTranscriptFollowMode(current, "resume"),
    );
  }, []);

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
        playbackRequestedRef.current = false;
        setIsPlaying(false);
        setAudioError("Trình duyệt đã chặn tự phát. Hãy nhấn Phát.");
      });
    }
  }

  function handleAudioPlaying() {
    playbackRequestedRef.current = true;
    setIsPlaying(true);
    setAudioError("");
  }

  function handleAudioEnded() {
    playbackRequestedRef.current = false;
    audioRecoveryAttemptsRef.current = 0;
    audioRecoveryCheckpointRef.current = null;
    setIsPlaying(false);
    setActiveWordIndex(-1);
  }

  function handleAudioError() {
    const currentSeconds =
      audioRef.current?.currentTime || playbackSeconds || 0;
    const recovery = createAudioRecoveryPlan(
      currentSeconds,
      playbackRequestedRef.current,
      audioRecoveryAttemptsRef.current,
    );
    setIsPlaying(false);
    if (!recovery) {
      playbackRequestedRef.current = false;
      audioRecoveryCheckpointRef.current = null;
      setAudioError(
        "Không thể phát audio. Hãy nhấn Phát để kết nối lại và nghe tiếp.",
      );
      return;
    }
    audioRecoveryAttemptsRef.current += 1;
    audioRecoveryCheckpointRef.current = currentSeconds;
    setAudioError("Đang kết nối lại audio...");
    void loadAudio(recovery.playWhenReady, recovery.seekMilliseconds);
  }

  function handlePlayPause() {
    const audio = audioRef.current;
    if (
      !audioUrl ||
      !audio ||
      audioError ||
      audioAccessNeedsRefresh(audioAccessExpiresAt)
    ) {
      audioRecoveryAttemptsRef.current = 0;
      audioRecoveryCheckpointRef.current = null;
      void loadAudio(true, Math.round(playbackSeconds * 1_000));
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
      playbackRequestedRef.current = true;
      void audio.play().catch(() => {
        playbackRequestedRef.current = false;
        setAudioError("Không thể phát audio. Vui lòng thử tải lại trang.");
      });
    } else {
      playbackRequestedRef.current = false;
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
    if (audioAccessNeedsRefresh(audioAccessExpiresAt)) {
      void loadAudio(
        playbackRequestedRef.current,
        Math.round(nextTime * 1_000),
      );
      return;
    }
    audio.currentTime = nextTime;
    setPlaybackSeconds(nextTime);
    setActiveWordIndex(findActiveWordIndex(words, nextTime * 1000));
  }

  function seekFromProgress(nextSeconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioAccessNeedsRefresh(audioAccessExpiresAt)) {
      void loadAudio(
        playbackRequestedRef.current,
        Math.round(nextSeconds * 1_000),
      );
      return;
    }
    audio.currentTime = nextSeconds;
    setPlaybackSeconds(nextSeconds);
    setActiveWordIndex(findActiveWordIndex(words, nextSeconds * 1000));
  }

  const seekTo = useCallback(
    (milliseconds: number) => {
      resumeTranscriptFollow();
      if (
        !audioRef.current ||
        !audioUrl ||
        audioAccessNeedsRefresh(audioAccessExpiresAt)
      ) {
        pendingSeekMillisecondsRef.current = milliseconds;
        void loadAudio(true, milliseconds);
        return;
      }
      playbackRequestedRef.current = true;
      audioRef.current.currentTime = milliseconds / 1000;
      void audioRef.current.play().catch(() => {
        playbackRequestedRef.current = false;
        setAudioError("Không thể phát audio. Hãy nhấn Phát để thử lại.");
      });
    },
    [audioAccessExpiresAt, audioUrl, loadAudio, resumeTranscriptFollow],
  );

  const jumpToLowConfidenceWord = useCallback(
    (word: IndexedWord | undefined) => {
      if (!word) return;
      setEditorMode("sync");
      setActiveWordIndex(word.index);
      seekTo(word.start);
    },
    [seekTo],
  );

  const selectLowConfidenceByOffset = useCallback(
    (offset: number) => {
      if (!lowConfidenceWords.length) return;
      const currentIndex =
        lowConfidenceReviewIndex >= 0
          ? lowConfidenceReviewIndex
          : lowConfidenceWords.findIndex((word) => word.index > activeWordIndex);
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        (baseIndex + offset + lowConfidenceWords.length) %
        lowConfidenceWords.length;
      jumpToLowConfidenceWord(lowConfidenceWords[nextIndex]);
    },
    [
      activeWordIndex,
      jumpToLowConfidenceWord,
      lowConfidenceReviewIndex,
      lowConfidenceWords,
    ],
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
    if (rememberSpeakerLabels) {
      try {
        const remembered = renameRememberedSpeakerLabel(
          JSON.parse(window.localStorage.getItem("vbee-speaker-labels") || "{}"),
          previousSpeaker,
          cleanSpeaker,
        );
        window.localStorage.setItem(
          "vbee-speaker-labels",
          JSON.stringify(remembered),
        );
      } catch {
        // Không chặn thao tác đổi tên nếu bộ nhớ trình duyệt không khả dụng.
      }
    }
  }

  const saveWorkflowRef = useRef(saveWorkflow);
  saveWorkflowRef.current = saveWorkflow;

  const markLowConfidenceReviewed = useCallback((wordIndex: number, advance = false) => {
    const currentWords = wordsRef.current;
    const currentWord = currentWords[wordIndex];
    if (!currentWord) return;
    const currentReviewIndex = lowConfidenceWords.findIndex(
      (word) => word.index === wordIndex,
    );
    const nextReviewWord =
      advance && lowConfidenceWords.length > 1
        ? lowConfidenceWords[
            (Math.max(0, currentReviewIndex) + 1) % lowConfidenceWords.length
          ]
        : null;
    const nextWords = currentWords.map((word, index) =>
      index === wordIndex ? { ...word, confidence: 1 } : word,
    );
    applyEditorChange(editorTextRef.current, nextWords, true);
    if (transcript && !transcript.reviewed_word_indexes.includes(wordIndex)) {
      void saveWorkflowRef.current({
        reviewedWordIndexes: [...transcript.reviewed_word_indexes, wordIndex].sort(
          (left, right) => left - right,
        ),
      });
    }
    if (nextReviewWord && nextReviewWord.index !== wordIndex) {
      window.requestAnimationFrame(() => jumpToLowConfidenceWord(nextReviewWord));
    }
  }, [
    applyEditorChange,
    jumpToLowConfidenceWord,
    lowConfidenceWords,
    transcript,
  ]);

  useEffect(() => {
    function handleReviewShortcut(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === "input" || tagName === "textarea" || target?.isContentEditable) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        selectLowConfidenceByOffset(1);
      } else if (key === "p") {
        event.preventDefault();
        selectLowConfidenceByOffset(-1);
      } else if (key === "m" && lowConfidenceReviewIndex >= 0) {
        event.preventDefault();
        markLowConfidenceReviewed(activeWordIndex, true);
      }
    }
    window.addEventListener("keydown", handleReviewShortcut);
    return () => window.removeEventListener("keydown", handleReviewShortcut);
  }, [
    activeWordIndex,
    lowConfidenceReviewIndex,
    markLowConfidenceReviewed,
    selectLowConfidenceByOffset,
  ]);

  function mergeSpeakers() {
    if (!speakerMergeSource || !speakerMergeTarget || speakerMergeSource === speakerMergeTarget) return;
    const nextWords = wordsRef.current.map((word) =>
      String(word.speaker ?? "") === speakerMergeSource
        ? { ...word, speaker: speakerMergeTarget }
        : word,
    );
    applyEditorChange(buildTextFromTimedWords(nextWords), nextWords, true);
    setSpeakerMergeSource("");
  }

  function splitSpeakerAtActiveWord() {
    if (activeWordIndex < 0 || activeWordIndex >= wordsRef.current.length) return;
    const currentSpeaker = String(wordsRef.current[activeWordIndex].speaker ?? "");
    if (!currentSpeaker) return;
    const nextSpeaker = `${speakerLabel(currentSpeaker)} (phần 2)`;
    let segmentEnd = activeWordIndex + 1;
    while (
      segmentEnd < wordsRef.current.length &&
      String(wordsRef.current[segmentEnd].speaker ?? "") === currentSpeaker
    ) {
      segmentEnd += 1;
    }
    const nextWords = wordsRef.current.map((word, index) => {
      return index >= activeWordIndex && index < segmentEnd
        ? { ...word, speaker: nextSpeaker }
        : word;
    });
    applyEditorChange(buildTextFromTimedWords(nextWords), nextWords, true);
  }

  async function saveWorkflow(values: {
    template?: TranscriptTemplate;
    tags?: string[];
    reviewedWordIndexes?: number[];
  }) {
    if (!token || !activeTranscriptId) return;
    const response = await fetch(
      `${API_URL}/api/transcribe/${activeTranscriptId}/workflow`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(values),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      template?: TranscriptTemplate;
      tags?: string[];
      reviewedWordIndexes?: number[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(body.error || "Không lưu được thiết lập transcript");
    }
    setTranscript((current) =>
      current
        ? {
            ...current,
            transcript_template: body.template ?? current.transcript_template,
            tags: body.tags ?? current.tags,
            reviewed_word_indexes:
              body.reviewedWordIndexes ?? current.reviewed_word_indexes,
          }
        : current,
    );
  }

  async function generateInsights(template: TranscriptTemplate) {
    if (!token || !activeTranscriptId) return;
    setInsightsGenerating(true);
    setInsightsError("");
    try {
      const response = await fetch(
        `${API_URL}/api/transcribe/${activeTranscriptId}/insights`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ template }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as
        | { insights: TranscriptInsights; template: TranscriptTemplate }
        | { error?: string };
      if (!response.ok || !("insights" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "Không tạo được phân tích transcript",
        );
      }
      setTranscript((current) =>
        current
          ? {
              ...current,
              transcript_template: body.template,
              insights: body.insights,
              insights_updated_at: body.insights.generatedAt,
            }
          : current,
      );
    } catch (error) {
      setInsightsError(
        error instanceof Error
          ? error.message
          : "Không tạo được phân tích transcript",
      );
    } finally {
      setInsightsGenerating(false);
    }
  }

  async function saveTags() {
    const tags = [
      ...new Set(
        tagDraft
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ].slice(0, 30);
    setInsightsError("");
    try {
      await saveWorkflow({ tags });
      setTagDraft(tags.join(", "));
    } catch (error) {
      setInsightsError(
        error instanceof Error ? error.message : "Không lưu được tag",
      );
    }
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
      const normalizedRestoredWords = normalizeWords(body.words, transcript?.duration);
      const estimatedRestoredWords = normalizedRestoredWords.length
        ? []
        : createApproximateTimedWords(
            body.text,
            transcript?.duration,
            MAX_EDITABLE_TIMED_WORDS,
          );
      const restoredWords = normalizedRestoredWords.length
        ? normalizedRestoredWords
        : estimatedRestoredWords;
      setTimelineIsEstimated(
        !normalizedRestoredWords.length && restoredWords.length > 0,
      );
      setTimelineIsTooLarge(
        !normalizedRestoredWords.length &&
          Boolean(String(body.text || "").trim()) &&
          !estimatedRestoredWords.length,
      );
      savedWordsRef.current = normalizedRestoredWords.map((word) => ({
        ...word,
      }));
      timelineNeedsInitializationRef.current =
        !normalizedRestoredWords.length && estimatedRestoredWords.length > 0;
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
      setVersionComparison(null);
    } catch (error) {
      setVersionError(
        error instanceof Error
          ? error.message
          : "Không khôi phục được phiên bản",
      );
    }
  }

  async function compareVersion(versionId: number) {
    if (!token || !activeTranscriptId) return;
    setVersionComparingId(versionId);
    setVersionError("");
    try {
      const response = await fetch(
        `${API_URL}/api/transcribe/${activeTranscriptId}/versions/${versionId}/compare`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        version?: VersionComparison["version"] & { text: string };
        current?: { text?: string };
        error?: string;
      };
      if (!response.ok || !body.version) {
        throw new Error(body.error || "Không so sánh được phiên bản");
      }
      setVersionComparison({
        version: body.version,
        comparison: compareTranscriptText(
          body.version.text,
          body.current?.text || "",
        ),
      });
    } catch (error) {
      setVersionError(
        error instanceof Error ? error.message : "Không so sánh được phiên bản",
      );
    } finally {
      setVersionComparingId(null);
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

  function buildExportBodyContent(options: ExportOptions) {
    return (
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
            : editorText.trim()
    );
  }

  function buildExportTextContent() {
    const options = effectiveExportOptions();
    const title =
      options.translationMode === "translation"
        ? "BẢN DỊCH"
        : options.translationMode === "bilingual"
          ? "TRANSCRIPT SONG NGỮ"
          : "TRANSCRIPT";
    const frontMatter = buildTemplateFrontMatter(
      transcript?.transcript_template || "meeting",
      transcript?.insights ?? null,
    );
    return [
      title,
      ...exportMetadataLines(),
      "",
      ...(frontMatter
        ? [frontMatter, "", "NỘI DUNG TRANSCRIPT", ""]
        : []),
      buildExportBodyContent(options),
    ].join("\n");
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

    const frontMatter = buildTemplateFrontMatter(
      transcript?.transcript_template || "meeting",
      transcript?.insights ?? null,
    );
    if (frontMatter) {
      frontMatter.split("\n").forEach((line) => {
        const isHeading = line && line === line.toLocaleUpperCase("vi-VN");
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: line,
                bold: Boolean(isHeading),
                size: isHeading ? 24 : 21,
                color: isHeading ? "21104A" : "4E4168",
              }),
            ],
          }),
        );
      });
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: "NỘI DUNG TRANSCRIPT", bold: true, size: 24 }),
          ],
        }),
      );
    }

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
      buildExportBodyContent(options)
        .split("\n")
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

      <main className="mx-auto max-w-7xl px-3 py-3 sm:px-4 sm:py-4 md:px-6 md:py-5">
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
          className="sticky top-14 z-30 mb-3 overflow-hidden rounded-lg border border-[#3b2868] bg-[#21104a] p-3 text-white shadow-[0_14px_32px_rgba(33,16,74,.16)] sm:top-[61px] sm:mb-4 sm:p-4 print:hidden"
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
                  onPlaying={handleAudioPlaying}
                  onPause={() => setIsPlaying(false)}
                  onEnded={handleAudioEnded}
                  onError={handleAudioError}
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
              <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-[#8a7da1]">
                <p>
                  {timelineIsTooLarge || words.length > MAX_EDITABLE_TIMED_WORDS
                    ? "Transcript vượt giới hạn 100.000 từ có timestamp; bạn vẫn có thể dùng chế độ văn bản thuần."
                    : timelineIsEstimated
                      ? "Mốc thời gian gần đúng được tạo từ văn bản; bạn vẫn có thể nghe và chỉnh sửa từng từ."
                      : syncAvailable
                        ? "Sửa trực tiếp từng từ; bấm mốc thời gian để nghe đúng vị trí."
                        : "Bản ghi chưa có timestamp theo từng từ."}
                </p>
                {transcriptFollowMode === "manual" && activeWordIndex >= 0 && (
                  <button
                    type="button"
                    onClick={resumeTranscriptFollow}
                    className="rounded-full border border-[#d9c96a] bg-[#fff9d8] px-3 py-1.5 font-black text-[#4b3b00] transition hover:bg-[#fff2a8]"
                  >
                    Theo dõi vị trí đang đọc
                  </button>
                )}
              </div>
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
              <div className="flex w-full min-w-0 flex-1 flex-wrap items-center gap-2 md:max-w-md md:flex-nowrap">
                <Search className="h-4 w-4 shrink-0 text-[#8067aa]" />
                <input
                  aria-label="Tìm trong transcript"
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
                  className="h-9 min-w-0 basis-40 flex-1 rounded-md border border-[#ded5e9] bg-white px-3 text-sm outline-none focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20"
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
                tabIndex={0}
                aria-label="Nội dung transcript đồng bộ"
                onWheel={pauseTranscriptFollow}
                onTouchStart={pauseTranscriptFollow}
                onPointerDown={pauseTranscriptFollow}
                onKeyDown={(event) => {
                  if (
                    [
                      "ArrowDown",
                      "ArrowUp",
                      "End",
                      "Home",
                      "PageDown",
                      "PageUp",
                      " ",
                    ].includes(event.key)
                  ) {
                    pauseTranscriptFollow();
                  }
                }}
                onScroll={(event) =>
                  handleSyncScroll(event.currentTarget.scrollTop)
                }
                data-testid="virtual-transcript-scroll"
                data-segment-count={segments.length}
                data-rendered-segment-count={virtualSegments.items.length}
                className="max-h-[55dvh] min-h-[320px] overflow-y-auto px-3 py-4 sm:min-h-[420px] sm:px-4 sm:py-5 md:px-7 lg:min-h-0 lg:max-h-none lg:flex-1"
              >
                <div
                  className="relative mx-auto max-w-3xl"
                  style={{ height: `${virtualSegments.totalSize}px` }}
                >
                  {virtualSegments.items.map((virtualSegment) => {
                    const segment = segments[virtualSegment.index];
                    if (!segment) return null;
                    return (
                      <VirtualTranscriptSegment
                        key={`${segment.start}-${virtualSegment.index}`}
                        segment={segment}
                        segmentIndex={virtualSegment.index}
                        start={virtualSegment.start}
                        activeWordIndex={activeWordIndex}
                        onCommit={commitTimedWord}
                        onSeek={seekTo}
                        onMeasure={handleSegmentMeasure}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[420px] flex-col p-3 sm:min-h-[520px] sm:p-4 md:p-6 lg:min-h-0 lg:flex-1">
                <div className="relative min-h-[360px] sm:min-h-[460px] lg:min-h-0 lg:flex-1">
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
                    onWheel={pauseTranscriptFollow}
                    onTouchStart={pauseTranscriptFollow}
                    onPointerDown={pauseTranscriptFollow}
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
                    className={`relative h-full min-h-[360px] w-full resize-y rounded-lg border border-[#ded5e9] px-4 py-3 text-[15px] leading-7 outline-none transition focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20 sm:min-h-[460px] sm:px-5 sm:py-4 sm:leading-8 lg:min-h-0 lg:resize-none ${
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

            {token && (
              <TranscriptSidebarSection
                icon={<Users className="h-4 w-4" />}
                title="Chia sẻ và cộng tác"
                meta="Bảo mật"
              >
                <TranscriptCollaborationPanel
                  transcriptId={transcript.id}
                  token={token}
                  playbackMilliseconds={Math.round(playbackSeconds * 1000)}
                />
              </TranscriptSidebarSection>
            )}

            <TranscriptSidebarSection
              icon={<Sparkles className="h-4 w-4" />}
              title="Phân tích nội dung"
              meta={transcript.insights ? "Đã tạo" : "Chưa tạo"}
              defaultOpen
            >
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="text-[11px] font-bold text-[#5f4c82]">
                  Mẫu transcript
                  <select
                    value={transcript.transcript_template}
                    onChange={(event) => {
                      const template = event.target.value as TranscriptTemplate;
                      setTranscript((current) =>
                        current
                          ? { ...current, transcript_template: template }
                          : current,
                      );
                    }}
                    className="mt-1 w-full rounded-md border border-[#ded5e9] bg-white px-2 py-2 text-xs font-bold text-[#21104a]"
                  >
                    <option value="meeting">Cuộc họp</option>
                    <option value="interview">Phỏng vấn</option>
                    <option value="podcast">Podcast</option>
                    <option value="lecture">Bài giảng</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void generateInsights(transcript.transcript_template)
                  }
                  disabled={insightsGenerating}
                  className="mt-[18px] inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#ffcb05] px-3 text-xs font-black text-[#21104a] disabled:cursor-wait disabled:opacity-60"
                >
                  <Sparkles
                    className={`h-3.5 w-3.5 ${insightsGenerating ? "animate-pulse" : ""}`}
                  />
                  {insightsGenerating ? "Đang tạo" : "Tạo lại"}
                </button>
              </div>

              <label className="mt-3 block text-[11px] font-bold text-[#5f4c82]">
                Tag, phân cách bằng dấu phẩy
                <div className="mt-1 flex gap-2">
                  <input
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveTags();
                      }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-[#ded5e9] bg-white px-2 py-2 text-xs font-semibold outline-none focus:border-[#ffcb05]"
                    placeholder="khách hàng, sprint 8"
                  />
                  <button
                    type="button"
                    onClick={() => void saveTags()}
                    className="rounded-md border border-[#ded5e9] bg-white px-2.5 text-xs font-black"
                    aria-label="Lưu tag"
                  >
                    <Tag className="h-3.5 w-3.5" />
                  </button>
                </div>
              </label>

              {insightsError && (
                <p className="mt-3 rounded-md bg-red-50 p-2 text-xs font-semibold text-red-800">
                  {insightsError}
                </p>
              )}

              {transcript.insights ? (
                <div className="mt-3 space-y-3 text-xs leading-5 text-[#4e4168]">
                  <div>
                    <p className="font-black text-[#21104a]">Tóm tắt</p>
                    <p className="mt-1">{transcript.insights.summary}</p>
                  </div>
                  {transcript.insights.keyPoints.length > 0 && (
                    <div>
                      <p className="font-black text-[#21104a]">Ý chính</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {transcript.insights.keyPoints.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {transcript.insights.actionItems.length > 0 && (
                    <div>
                      <p className="font-black text-[#21104a]">Việc cần làm</p>
                      <ul className="mt-1 space-y-1.5">
                        {transcript.insights.actionItems.map((item, index) => (
                          <li
                            key={`${item.text}-${index}`}
                            className="rounded-md bg-[#fbfaf7] p-2"
                          >
                            <span className="font-bold">{item.text}</span>
                            {(item.owner || item.deadline) && (
                              <span className="mt-1 block text-[11px] text-[#8a7da1]">
                                {item.owner
                                  ? `Phụ trách: ${item.owner}`
                                  : "Chưa rõ người phụ trách"}
                                {item.deadline ? ` · Hạn: ${item.deadline}` : ""}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {transcript.insights.decisions.length > 0 && (
                    <div>
                      <p className="font-black text-[#21104a]">Quyết định</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {transcript.insights.decisions.map((decision) => (
                          <li key={decision}>{decision}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {transcript.insights.chapters.length > 0 && (
                    <div>
                      <p className="font-black text-[#21104a]">Chapters</p>
                      <div className="mt-1 space-y-1">
                        {transcript.insights.chapters.map((chapter, index) => (
                          <button
                            key={`${chapter.startMs}-${index}`}
                            type="button"
                            onClick={() => seekTo(chapter.startMs)}
                            className="flex w-full items-start gap-2 rounded-md border border-[#ece7f2] bg-white p-2 text-left hover:border-[#ffcb05]"
                          >
                            <span className="shrink-0 font-black text-[#8067aa]">
                              {formatPlaybackTime(chapter.startMs / 1000)}
                            </span>
                            <span className="line-clamp-2 font-bold text-[#342752]">
                              {chapter.title}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {transcript.insights.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {transcript.insights.keywords.map((keyword) => (
                        <span
                          key={keyword}
                          className="rounded-full border border-[#ded5e9] bg-white px-2 py-0.5 text-[11px] font-bold"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>
                  )}
                  {transcript.insights.questions.length > 0 && (
                    <details>
                      <summary className="cursor-pointer font-black text-[#21104a]">
                        Câu hỏi trong transcript ({transcript.insights.questions.length})
                      </summary>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {transcript.insights.questions.map((question) => (
                          <li key={question}>{question}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-[#8a7da1]">
                  Tạo tóm tắt, ý chính, action items, quyết định, chapter,
                  keyword và câu hỏi từ transcript này.
                </p>
              )}
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
              {speakers.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-[#ece7f2] pt-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-[#5f4c82]">
                    <input
                      type="checkbox"
                      checked={rememberSpeakerLabels}
                      onChange={(event) => setRememberSpeakerLabels(event.target.checked)}
                      className="h-4 w-4 accent-[#21104a]"
                    />
                    Nhớ tên cho transcript sau trên thiết bị này
                  </label>
                  {speakers.length > 1 && (
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={speakerMergeSource}
                        onChange={(event) => setSpeakerMergeSource(event.target.value)}
                        className="h-8 rounded-md border border-[#ded5e9] bg-white px-2 text-[11px] font-bold"
                      >
                        <option value="">Gộp người…</option>
                        {speakers.map((speaker) => <option key={speaker} value={speaker}>{speakerLabel(speaker)}</option>)}
                      </select>
                      <select
                        value={speakerMergeTarget}
                        onChange={(event) => setSpeakerMergeTarget(event.target.value)}
                        className="h-8 rounded-md border border-[#ded5e9] bg-white px-2 text-[11px] font-bold"
                      >
                        <option value="">vào người…</option>
                        {speakers.map((speaker) => <option key={speaker} value={speaker}>{speakerLabel(speaker)}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={mergeSpeakers}
                        disabled={!speakerMergeSource || !speakerMergeTarget || speakerMergeSource === speakerMergeTarget}
                        className="col-span-2 rounded-md border border-[#ded5e9] px-2 py-1.5 text-[11px] font-black disabled:opacity-40"
                      >
                        Gộp hai người nói
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={splitSpeakerAtActiveWord}
                    disabled={activeWordIndex < 0}
                    className="w-full rounded-md border border-[#ded5e9] px-2 py-1.5 text-[11px] font-black disabled:opacity-40"
                  >
                    Tách đoạn tại từ đang chọn
                  </button>
                </div>
              )}
            </TranscriptSidebarSection>

            <section className="rounded-lg border border-[#e1dbea] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-black">
                    <Flag className="h-4 w-4 text-[#8067aa]" /> Từ cần review
                  </h2>
                  <p className="mt-2 text-xs leading-5 text-[#8a7da1]">
                    Confidence thấp hơn{" "}
                    {Math.round(LOW_CONFIDENCE_THRESHOLD * 100)}%.
                  </p>
                </div>
                <span className="shrink-0 rounded-md bg-[#f3f0f7] px-2 py-1 text-[11px] font-black text-[#5f4c82]">
                  {lowConfidenceWords.length}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => selectLowConfidenceByOffset(-1)}
                  disabled={!lowConfidenceWords.length}
                  title="Từ nghi ngờ trước"
                  aria-label="Từ nghi ngờ trước"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#ded5e9] bg-white px-2 text-[11px] font-black text-[#5f4c82] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Trước
                </button>
                <button
                  type="button"
                  onClick={() => selectLowConfidenceByOffset(1)}
                  disabled={!lowConfidenceWords.length}
                  title="Từ nghi ngờ sau"
                  aria-label="Từ nghi ngờ sau"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#ded5e9] bg-white px-2 text-[11px] font-black text-[#5f4c82] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Sau <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-3 max-h-72 space-y-2 overflow-auto">
                {lowConfidenceWords.length ? (
                  lowConfidenceWords.map((word) => (
                    <div
                      key={`${word.index}-${word.start}`}
                      className={`rounded-md border p-2 transition ${
                        activeWordIndex === word.index
                          ? "border-[#ffcb05] bg-[#fff7cf] shadow-[0_0_0_3px_rgba(255,203,5,.18)]"
                          : "border-red-100 bg-red-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            jumpToLowConfidenceWord(word);
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
                        onClick={() => markLowConfidenceReviewed(word.index, true)}
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
            </section>

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
              {versionComparison && (
                <div className="mt-3 rounded-lg border border-[#d8d0e7] bg-white p-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-black text-[#21104a]">
                        So sánh với bản hiện tại
                      </p>
                      <p className="mt-1 text-[11px] text-[#756894]">
                        {versionComparison.version.actor_name} ·{" "}
                        {new Date(
                          versionComparison.version.created_at,
                        ).toLocaleString("vi-VN")}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Đóng so sánh phiên bản"
                      onClick={() => setVersionComparison(null)}
                      className="rounded-md px-2 py-1 font-black text-[#756894] hover:bg-[#f3f0f8]"
                    >
                      Đóng
                    </button>
                  </div>
                  {versionComparison.comparison.hasChanges ? (
                    <div className="mt-3 space-y-2 break-words leading-5">
                      {versionComparison.comparison.prefix && (
                        <p className="text-[#756894]">
                          …{versionComparison.comparison.prefix.slice(-140)}
                        </p>
                      )}
                      {versionComparison.comparison.removed && (
                        <p className="rounded-md bg-red-50 p-2 text-red-800 line-through">
                          − {versionComparison.comparison.removed}
                        </p>
                      )}
                      {versionComparison.comparison.added && (
                        <p className="rounded-md bg-emerald-50 p-2 text-emerald-800">
                          + {versionComparison.comparison.added}
                        </p>
                      )}
                      {versionComparison.comparison.suffix && (
                        <p className="text-[#756894]">
                          {versionComparison.comparison.suffix.slice(0, 140)}…
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-md bg-emerald-50 p-2 font-bold text-emerald-800">
                      Phiên bản này giống nội dung hiện tại.
                    </p>
                  )}
                </div>
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
                      <p className="mt-1 text-[11px] font-bold text-[#5f4c82]">
                        {version.actor_name || "Người dùng"}
                        {version.change_source === "shared"
                          ? " · Liên kết chia sẻ"
                          : version.change_source === "restore"
                            ? " · Khôi phục"
                            : " · Trình chỉnh sửa"}
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => void compareVersion(version.id)}
                          disabled={versionComparingId !== null}
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-[#ded5e9] bg-white px-2 py-1.5 text-[11px] font-black hover:border-[#ffcb05] disabled:opacity-50"
                        >
                          <GitCompare className="h-3.5 w-3.5" />
                          {versionComparingId === version.id
                            ? "Đang so sánh"
                            : "So sánh"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void restoreVersion(version.id)}
                          className="rounded-md border border-[#ded5e9] bg-white px-2 py-1.5 text-[11px] font-black hover:border-[#ffcb05]"
                        >
                          Khôi phục
                        </button>
                      </div>
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
