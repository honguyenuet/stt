export interface DashboardFolder {
  id: number;
  name: string;
  item_count: number;
  visibility: "private" | "team";
  team_permission: "view" | "edit";
  owner_user_id: number | null;
}

export function normalizeDashboardFolders(value: unknown): DashboardFolder[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = Number(row.id);
    const name = String(row.name || "").trim();
    const itemCount = Number(row.item_count);
    if (!Number.isSafeInteger(id) || id <= 0 || !name) return [];
    return [
      {
        id,
        name: name.slice(0, 160),
        item_count:
          Number.isSafeInteger(itemCount) && itemCount >= 0 ? itemCount : 0,
        visibility: row.visibility === "team" ? "team" : "private",
        team_permission: row.team_permission === "view" ? "view" : "edit",
        owner_user_id: Number.isSafeInteger(Number(row.owner_user_id))
          ? Number(row.owner_user_id)
          : null,
      },
    ];
  });
}

export function selectDashboardFolder(
  folders: DashboardFolder[],
  preferredId: number | null,
) {
  return (
    folders.find((folder) => folder.id === preferredId) ?? folders[0] ?? null
  );
}

export function buildDashboardHistoryPath(folderId: number | null, limit = 3) {
  const pageSize = Number.isSafeInteger(limit)
    ? Math.max(1, Math.min(50, limit))
    : 3;
  return folderId
    ? `/api/transcribe/history?folderId=${encodeURIComponent(folderId)}&paginated=1&limit=${pageSize}`
    : `/api/transcribe/history?paginated=1&limit=${pageSize}`;
}
