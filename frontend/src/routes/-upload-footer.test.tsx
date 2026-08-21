import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();

  return {
    ...actual,
    Link: ({
      to,
      children,
      ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & {
      to: string;
      children: ReactNode;
    }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
    useNavigate: () => vi.fn(),
    useRouterState: ({
      select,
    }: {
      select: (state: { location: { pathname: string } }) => string;
    }) => select({ location: { pathname: "/upload" } }),
  };
});

import { VbeeStyleFooter } from "./upload";

describe("upload VbeeStyleFooter", () => {
  it("keeps the upload page footer in its compact original style", () => {
    const markup = renderToStaticMarkup(<VbeeStyleFooter />);

    expect(markup).toContain("mt-8 border-t border-border bg-white");
    expect(markup).toContain("© 2026 Vbee Voice. Đã đăng ký bản quyền.");
    expect(markup).toContain('href="/pricing"');
    expect(markup).toContain('href="/upload"');
    expect(markup).toContain(">Tải file</a>");
    expect(markup).toContain(
      "Được phát triển cho trải nghiệm chuyển giọng nói thành văn bản rõ ràng.",
    );
    expect(markup).not.toContain("bg-[#21104a]");
  });
});
