import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTH_REDIRECT,
  getSafeAuthRedirect,
} from "./auth-redirect";

describe("getSafeAuthRedirect", () => {
  it("returns to a numeric transcript after authentication", () => {
    expect(getSafeAuthRedirect("/transcript/156")).toBe("/transcript/156");
  });

  it("preserves a safe query string on a transcript route", () => {
    expect(getSafeAuthRedirect("/transcript/156?panel=translation")).toBe(
      "/transcript/156?panel=translation",
    );
  });

  it("rejects malformed transcript and external redirects", () => {
    expect(getSafeAuthRedirect("/transcript/not-a-number")).toBe(
      DEFAULT_AUTH_REDIRECT,
    );
    expect(getSafeAuthRedirect("//example.com/transcript/156")).toBe(
      DEFAULT_AUTH_REDIRECT,
    );
  });
});
