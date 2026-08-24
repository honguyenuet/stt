import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranscriptSidebarSection } from "./transcript-sidebar-section";

describe("TranscriptSidebarSection", () => {
  it("keeps secondary tools collapsed by default while exposing their summary", () => {
    const markup = renderToStaticMarkup(
      <TranscriptSidebarSection
        icon={<span aria-hidden="true">i</span>}
        title="Người nói"
        meta="8"
      >
        <label>
          Tên người nói
          <input defaultValue="Người nói 1" />
        </label>
      </TranscriptSidebarSection>,
    );

    expect(markup).toContain("<details");
    expect(markup).not.toMatch(/<details[^>]* open/);
    expect(markup).toContain("Người nói");
    expect(markup).toContain("8");
    expect(markup).toContain("Tên người nói");
  });

  it("can keep an essential section expanded initially", () => {
    const markup = renderToStaticMarkup(
      <TranscriptSidebarSection
        icon={<span aria-hidden="true">i</span>}
        title="Thông tin"
        defaultOpen
      >
        <p>Chi tiết</p>
      </TranscriptSidebarSection>,
    );

    expect(markup).toMatch(/<details[^>]* open/);
  });
});
