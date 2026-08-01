import { adminBlobRequest, adminRequest, buildQuery } from "./api-client";
import type {
  ListFilesParams,
  ManagedFile,
  PaginatedResponse,
  TranscriptionJob,
} from "./types";

export function listFiles(params: ListFilesParams) {
  return adminRequest<PaginatedResponse<ManagedFile>>(
    `/api/admin/files${buildQuery({
      page: params.page,
      limit: params.limit,
      search: params.search,
      fileType: params.fileType,
      storageStatus: params.storageStatus,
      transcriptionStatus: params.transcriptionStatus,
    })}`,
  );
}

export function getFileJobs(fileId: string) {
  return adminRequest<TranscriptionJob[]>(`/api/admin/files/${fileId}/jobs`);
}

export function getFileMedia(fileId: string) {
  return adminBlobRequest(`/api/admin/files/${fileId}/media`);
}

export function markFileDeleted(fileId: string) {
  return adminRequest<{ success: boolean }>(`/api/admin/files/${fileId}`, {
    method: "DELETE",
  });
}
