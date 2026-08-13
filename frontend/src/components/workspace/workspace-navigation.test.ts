import { describe, expect, it } from "vitest";

import {
  DESKTOP_WORKSPACE_NAV_ITEMS,
  MOBILE_MORE_NAV_ITEMS,
  PRIMARY_MOBILE_NAV_ITEMS,
  getActiveWorkspaceNavItem,
} from "./workspace-navigation";

describe("workspace navigation", () => {
  it("keeps the desktop rail complete and the mobile navigation compact", () => {
    expect(DESKTOP_WORKSPACE_NAV_ITEMS.map((item) => item.to)).toEqual([
      "/dashboard",
      "/upload",
      "/record",
      "/realtime",
      "/history",
      "/api",
    ]);
    expect(PRIMARY_MOBILE_NAV_ITEMS).toHaveLength(4);
    expect(PRIMARY_MOBILE_NAV_ITEMS.map((item) => item.to)).toEqual([
      "/dashboard",
      "/upload",
      "/record",
      "/history",
    ]);
    expect(MOBILE_MORE_NAV_ITEMS.map((item) => item.to)).toEqual([
      "/realtime",
      "/api",
    ]);
  });

  it("maps transcript detail pages back to the history destination", () => {
    expect(getActiveWorkspaceNavItem("/transcript/job-123")?.to).toBe(
      "/history",
    );
  });

  it("matches nested workspace paths without activating similar prefixes", () => {
    expect(getActiveWorkspaceNavItem("/upload/from-drive")?.to).toBe(
      "/upload",
    );
    expect(getActiveWorkspaceNavItem("/uploader")).toBeUndefined();
  });
});
