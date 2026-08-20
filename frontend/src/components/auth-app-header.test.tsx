import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
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
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => string;
  }) => select({ location: { pathname: "/upload" } }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      firstName: "Hồ",
      lastName: "Mạnh",
      email: "ho@example.com",
      avatar: null,
      role: "user",
    },
    token: null,
    logout: vi.fn(),
  }),
}));

import { AuthenticatedHeader } from "./auth-app-header";

describe("AuthenticatedHeader", () => {
  it("links both workspace logos to the public home page", () => {
    const markup = renderToStaticMarkup(<AuthenticatedHeader />);
    const homeLogoLinks = markup.match(
      /<a[^>]*aria-label="Về trang chủ Vbee"[^>]*>/g,
    );

    expect(homeLogoLinks).toHaveLength(2);
    homeLogoLinks?.forEach((link) => {
      expect(link).toContain('href="/"');
    });
  });
});
