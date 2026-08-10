import { describe, expect, it } from "vitest";
import {
  buildDashboardHistoryPath,
  selectDashboardFolder,
} from "./dashboard-folders";

const folders = [
  { id: 1, name: "Dự án mới", item_count: 3 },
  { id: 2, name: "Phỏng vấn", item_count: 5 },
];

describe("dashboard folder selection", () => {
  it("restores a saved folder only when it still belongs to the server list", () => {
    expect(selectDashboardFolder(folders, 2)?.name).toBe("Phỏng vấn");
    expect(selectDashboardFolder(folders, 999)?.id).toBe(1);
  });

  it("scopes dashboard history to the selected folder", () => {
    expect(buildDashboardHistoryPath(2)).toBe(
      "/api/transcribe/history?folderId=2&paginated=1&limit=3",
    );
    expect(buildDashboardHistoryPath(null)).toBe(
      "/api/transcribe/history?paginated=1&limit=3",
    );
  });
});
