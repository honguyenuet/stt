import { describe, expect, it } from "vitest";
import { buildTemplateFrontMatter } from "./transcript-template-export";

const insights = {
  summary: "Tóm tắt ngắn.",
  keyPoints: ["Ý chính thứ nhất"],
  actionItems: [{ text: "Gửi báo cáo", owner: "Lan", deadline: "25/08/2026" }],
  decisions: ["Dùng webhook"],
  chapters: [{ startMs: 0, endMs: 20_000, title: "Mở đầu", summary: "Giới thiệu" }],
  keywords: ["webhook"],
  questions: ["Khi nào phát hành?"],
};

describe("template-aware transcript export", () => {
  it("creates a meeting brief with actions, owners, deadlines and decisions", () => {
    const output = buildTemplateFrontMatter("meeting", insights);
    expect(output).toContain("TÓM TẮT CUỘC HỌP");
    expect(output).toContain("Lan · 25/08/2026");
    expect(output).toContain("QUYẾT ĐỊNH");
  });

  it("uses distinct sections for interview, podcast and lecture", () => {
    expect(buildTemplateFrontMatter("interview", insights)).toContain("CÂU HỎI NỔI BẬT");
    expect(buildTemplateFrontMatter("podcast", insights)).toContain("CHƯƠNG PODCAST");
    expect(buildTemplateFrontMatter("lecture", insights)).toContain("Ý CHÍNH BÀI GIẢNG");
  });
});
