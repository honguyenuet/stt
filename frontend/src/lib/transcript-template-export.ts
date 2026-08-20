export type TranscriptTemplate = "meeting" | "interview" | "podcast" | "lecture";

type TemplateInsights = {
  summary?: string;
  keyPoints?: string[];
  actionItems?: Array<{
    text: string;
    owner?: string | null;
    deadline?: string | null;
  }>;
  decisions?: string[];
  chapters?: Array<{
    startMs: number;
    title: string;
    summary?: string;
  }>;
  keywords?: string[];
  questions?: string[];
} | null;

function section(title: string, items: string[]) {
  const cleanItems = items.map((item) => item.trim()).filter(Boolean);
  return cleanItems.length
    ? [title, ...cleanItems.map((item) => `- ${item}`)].join("\n")
    : "";
}

function formatChapterTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function buildTemplateFrontMatter(
  template: TranscriptTemplate,
  insights: TemplateInsights | null,
) {
  if (!insights) return "";
  const summary = String(insights.summary || "").trim();
  const keyPoints = Array.isArray(insights.keyPoints) ? insights.keyPoints : [];
  const actions = Array.isArray(insights.actionItems)
    ? insights.actionItems.map((item) => {
        const metadata = [item.owner, item.deadline].filter(Boolean).join(" · ");
        return metadata ? `${item.text} (${metadata})` : item.text;
      })
    : [];
  const decisions = Array.isArray(insights.decisions) ? insights.decisions : [];
  const chapters = Array.isArray(insights.chapters)
    ? insights.chapters.map(
        (chapter) =>
          `[${formatChapterTime(chapter.startMs)}] ${chapter.title}${
            chapter.summary ? ` — ${chapter.summary}` : ""
          }`,
      )
    : [];
  const questions = Array.isArray(insights.questions) ? insights.questions : [];
  const keywords = Array.isArray(insights.keywords) ? insights.keywords : [];

  const commonSummary = summary ? [summary] : keyPoints.slice(0, 3);
  const sections =
    template === "interview"
      ? [
          section("TÓM TẮT PHỎNG VẤN", commonSummary),
          section("CÂU HỎI NỔI BẬT", questions),
          section("Ý CHÍNH", keyPoints),
        ]
      : template === "podcast"
        ? [
            section("TÓM TẮT PODCAST", commonSummary),
            section("CHƯƠNG PODCAST", chapters),
            section("TỪ KHÓA", keywords),
          ]
        : template === "lecture"
          ? [
              section("TÓM TẮT BÀI GIẢNG", commonSummary),
              section("Ý CHÍNH BÀI GIẢNG", keyPoints),
              section("CHƯƠNG BÀI GIẢNG", chapters),
            ]
          : [
              section("TÓM TẮT CUỘC HỌP", commonSummary),
              section("VIỆC CẦN LÀM", actions),
              section("QUYẾT ĐỊNH", decisions),
              section("Ý CHÍNH", keyPoints),
            ];
  return sections.filter(Boolean).join("\n\n");
}
