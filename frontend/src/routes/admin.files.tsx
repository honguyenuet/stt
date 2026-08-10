import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AdminPanel,
  AdminPanelHeader,
  PageState,
  Pager,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { canMutate } from "@/lib/admin/admin-auth";
import { useAdminSession } from "@/lib/admin/use-admin-session";
import { ADMIN_SUMMARY_REFRESH_MS } from "@/lib/admin/realtime";
import {
  formatDateTime,
  formatDuration,
  formatFileSize,
} from "@/lib/admin/formatters";
import {
  getFileMedia,
  getFileJobs,
  listFiles,
  markFileDeleted,
} from "@/lib/admin/files-service";
import type {
  FileType,
  JobStatus,
  ManagedFile,
  PaginatedResponse,
  StorageStatus,
  TranscriptionJob,
} from "@/lib/admin/types";

export const Route = createFileRoute("/admin/files")({
  component: AdminFilesPage,
});

function AdminFilesPage() {
  const session = useAdminSession();
  const [rows, setRows] = useState<PaginatedResponse<ManagedFile> | null>(null);
  const [search, setSearch] = useState("");
  const [fileType, setFileType] = useState<FileType | "all">("all");
  const [storageStatus, setStorageStatus] = useState<StorageStatus | "all">(
    "all",
  );
  const [transcriptionStatus, setTranscriptionStatus] = useState<
    JobStatus | "all"
  >("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ManagedFile | null>(null);
  const [relatedJobs, setRelatedJobs] = useState<TranscriptionJob[]>([]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    (showLoading = true) => {
      if (showLoading) setLoading(true);
      if (showLoading) setError("");
      void listFiles({
        page,
        limit: 5,
        search,
        fileType,
        storageStatus,
        transcriptionStatus,
      })
        .then(setRows)
        .catch((err) =>
          setError(
            err instanceof Error ? err.message : "Không tải được danh sách tệp",
          ),
        )
        .finally(() => {
          if (showLoading) setLoading(false);
        });
    },
    [fileType, page, search, storageStatus, transcriptionStatus],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(
      () => load(false),
      ADMIN_SUMMARY_REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!selected || !rows) return;
    const nextSelected = rows.data.find(
      (file) => file.file_id === selected.file_id,
    );
    if (
      nextSelected &&
      nextSelected.transcription_status !== selected.transcription_status
    ) {
      setSelected(nextSelected);
      void getFileJobs(nextSelected.file_id).then(setRelatedJobs);
    }
  }, [rows, selected]);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    setMediaUrl("");
    setMediaError("");

    if (!selected?.has_audio_track) {
      setMediaLoading(false);
      return undefined;
    }

    setMediaLoading(true);
    void getFileMedia(selected.file_id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setMediaUrl(objectUrl);
      })
      .catch((err) => {
        if (!cancelled) {
          setMediaError(
            err instanceof Error ? err.message : "Không tải được nội dung",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setMediaLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected?.file_id, selected?.has_audio_track]);

  function openFile(file: ManagedFile) {
    setSelected(file);
    setRelatedJobs([]);
    void getFileJobs(file.file_id)
      .then(setRelatedJobs)
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Không tải được tác vụ liên quan",
        ),
      );
  }

  async function deleteFile() {
    if (
      !selected ||
      !window.confirm(
        "Xóa vĩnh viễn tệp, văn bản và tác vụ liên quan? Thời lượng đã sử dụng sẽ không được hoàn lại.",
      )
    )
      return;
    try {
      await markFileDeleted(selected.file_id);
      setSelected(null);
      toast.success("Đã xóa tệp");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không xóa được tệp");
    }
  }

  const mayMutate = session ? canMutate(session.user.role) : false;

  return (
    <div className="space-y-5">
      <AdminPanel>
        <AdminPanelHeader
          title="Quản lý tệp"
          description="Quản lý dữ liệu mô tả, xem trước nội dung và các tác vụ liên quan."
        />
        <div className="grid gap-3 p-4 md:grid-cols-5">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm tệp hoặc chủ sở hữu"
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm md:col-span-2"
          />
          <select
            value={fileType}
            onChange={(e) => setFileType(e.target.value as FileType | "all")}
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          >
            <option value="all">Tất cả loại tệp</option>
            <option value="audio">Âm thanh</option>
            <option value="video">Hình ảnh động</option>
          </select>
          <select
            value={storageStatus}
            onChange={(e) =>
              setStorageStatus(e.target.value as StorageStatus | "all")
            }
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          >
            <option value="all">Tất cả lưu trữ</option>
            <option value="available">Có sẵn</option>
            <option value="archived">Đã lưu trữ</option>
            <option value="missing">Thiếu tệp</option>
            <option value="error">Lỗi</option>
          </select>
          <select
            value={transcriptionStatus}
            onChange={(e) =>
              setTranscriptionStatus(e.target.value as JobStatus | "all")
            }
            className="rounded-md border border-[#e4ddcf] px-3 py-2 text-sm"
          >
            <option value="all">Tất cả tác vụ</option>
            <option value="completed">Hoàn tất</option>
            <option value="failed">Thất bại</option>
            <option value="queued">Đang chờ</option>
            <option value="processing">Đang xử lý</option>
          </select>
        </div>
        <PageState
          loading={loading}
          error={error}
          empty={!rows?.data.length}
          onRetry={load}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-[#fbf8ef] text-xs uppercase text-[#756894]">
                <tr>
                  {[
                    "Tệp",
                    "Chủ sở hữu",
                    "Loại",
                    "Dung lượng",
                    "Thời lượng",
                    "Lưu trữ",
                    "Chuyển giọng nói",
                    "Ngày tạo",
                    "",
                  ].map((head) => (
                    <th key={head} className="px-4 py-3">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#efe7d8]">
                {rows?.data.map((file) => (
                  <tr key={file.file_id} className="hover:bg-[#fbf8ef]">
                    <td className="px-4 py-3 font-black">
                      {file.file_name}
                      {!file.has_audio_track && (
                        <span className="ml-2 rounded bg-red-100 px-2 py-1 text-xs text-red-800">
                          Không có âm thanh
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{file.owner_email}</td>
                    <td className="px-4 py-3">{file.file_type}</td>
                    <td className="px-4 py-3">
                      {formatFileSize(file.file_size)}
                    </td>
                    <td className="px-4 py-3">
                      {formatDuration(file.duration_seconds)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={file.storage_status} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={file.transcription_status} />
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(file.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openFile(file)}
                        className="font-black underline"
                      >
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows && (
            <Pager
              page={rows.page}
              totalPages={rows.total_pages}
              onPageChange={setPage}
            />
          )}
        </PageState>
      </AdminPanel>

      {selected && (
        <AdminPanel>
          <AdminPanelHeader
            title={`Chi tiết tệp: ${selected.file_name}`}
            action={
              <button
                onClick={() => setSelected(null)}
                className="rounded-md border px-3 py-2 text-sm font-bold"
              >
                Đóng
              </button>
            }
          />
          <div className="grid gap-5 p-4 xl:grid-cols-2">
            <div className="space-y-3">
              {selected.file_type === "video" ? (
                <video
                  controls
                  src={mediaUrl || undefined}
                  className="w-full rounded-md border bg-black"
                />
              ) : (
                <audio controls src={mediaUrl || undefined} className="w-full" />
              )}
              {mediaLoading && (
                <p className="text-sm text-[#756894]">Đang tải nội dung...</p>
              )}
              {mediaError && (
                <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                  {mediaError}
                </p>
              )}
              <pre className="overflow-auto rounded-md bg-[#fbf8ef] p-3 text-xs">
                {JSON.stringify(selected.metadata, null, 2)}
              </pre>
              {!selected.has_audio_track && (
                <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                  Tệp bị lỗi hoặc không có rãnh âm thanh.
                </p>
              )}
              <button
                disabled={!mayMutate}
                onClick={() => void deleteFile()}
                className="rounded-md border border-red-200 px-3 py-2 text-sm font-black text-red-700 disabled:opacity-40"
              >
                Xóa tệp
              </button>
            </div>
            <div>
              <h3 className="mb-3 font-black">
                Tác vụ chuyển giọng nói liên quan
              </h3>
              <div className="divide-y divide-[#efe7d8] rounded-md border border-[#e4ddcf]">
                {relatedJobs.map((job) => (
                  <div
                    key={job.job_id}
                    className="flex items-center justify-between p-3 text-sm"
                  >
                    <span className="font-mono">{job.job_id}</span>
                    <StatusBadge status={job.status} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </AdminPanel>
      )}
    </div>
  );
}
