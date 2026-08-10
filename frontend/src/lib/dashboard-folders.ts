export interface DashboardFolder {
  id: number;
  name: string;
  item_count: number;
}

export function selectDashboardFolder(
  folders: DashboardFolder[],
  preferredId: number | null,
) {
  return folders.find((folder) => folder.id === preferredId) ?? folders[0] ?? null;
}

export function buildDashboardHistoryPath(folderId: number | null) {
  return folderId
    ? `/api/transcribe/history?folderId=${encodeURIComponent(folderId)}&paginated=1&limit=3`
    : "/api/transcribe/history?paginated=1&limit=3";
}
