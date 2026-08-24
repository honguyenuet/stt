export type TranscriptTemplate =
  | "meeting"
  | "interview"
  | "podcast"
  | "lecture";

export interface TranscriptInsights {
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

const TRANSCRIPT_TEMPLATES = new Set<TranscriptTemplate>([
  "meeting",
  "interview",
  "podcast",
  "lecture",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTemplate(
  value: unknown,
  fallback: TranscriptTemplate,
): TranscriptTemplate {
  return typeof value === "string" &&
    TRANSCRIPT_TEMPLATES.has(value as TranscriptTemplate)
    ? (value as TranscriptTemplate)
    : fallback;
}

function normalizeStringArray(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

export function normalizeTranscriptInsights(
  value: unknown,
  fallbackTemplate: TranscriptTemplate,
): TranscriptInsights | null {
  if (!isRecord(value)) return null;

  const hasInsightContent =
    typeof value.summary === "string" ||
    typeof value.generatedAt === "string" ||
    typeof value.generator === "string" ||
    [
      value.keyPoints,
      value.actionItems,
      value.decisions,
      value.chapters,
      value.keywords,
      value.questions,
    ].some(Array.isArray);
  if (!hasInsightContent) return null;

  const actionItems = Array.isArray(value.actionItems)
    ? value.actionItems
        .filter(isRecord)
        .map((item) => ({
          text: typeof item.text === "string" ? item.text.trim() : "",
          owner: typeof item.owner === "string" ? item.owner.trim() || null : null,
          deadline:
            typeof item.deadline === "string"
              ? item.deadline.trim() || null
              : null,
        }))
        .filter((item) => item.text)
        .slice(0, 20)
    : [];
  const chapters = Array.isArray(value.chapters)
    ? value.chapters
        .filter(isRecord)
        .map((chapter) => {
          const startMs = Number(chapter.startMs);
          const endMs = Number(chapter.endMs);
          return {
            title:
              typeof chapter.title === "string" ? chapter.title.trim() : "",
            startMs: Number.isFinite(startMs) && startMs >= 0 ? startMs : 0,
            endMs: Number.isFinite(endMs) && endMs >= 0 ? endMs : 0,
            summary:
              typeof chapter.summary === "string"
                ? chapter.summary.trim()
                : "",
          };
        })
        .filter((chapter) => chapter.title)
        .slice(0, 24)
    : [];

  return {
    template: normalizeTemplate(value.template, fallbackTemplate),
    summary: typeof value.summary === "string" ? value.summary.trim() : "",
    keyPoints: normalizeStringArray(value.keyPoints, 12),
    actionItems,
    decisions: normalizeStringArray(value.decisions, 20),
    chapters,
    keywords: normalizeStringArray(value.keywords, 24),
    questions: normalizeStringArray(value.questions, 20),
    generatedAt:
      typeof value.generatedAt === "string" ? value.generatedAt : "",
    generator: typeof value.generator === "string" ? value.generator : "",
  };
}
