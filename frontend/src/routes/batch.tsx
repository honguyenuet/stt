import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  FileAudio,
  Folder,
  Loader2,
  RotateCcw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/api-base-url";
import {
  normalizeDashboardFolders,
  type DashboardFolder,
} from "@/lib/dashboard-folders";
import { createStoredZip } from "@/lib/zip-archive";

const API_URL = getApiBaseUrl();

type BatchJob = {
  jobId: number;
  id: number;
  filename: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  text?: string;
  error_message?: string | null;
};

type BatchResponse = {
  batchId?: string;
  jobs?: BatchJob[];
  rejected?: Array<{ filename: string; error: string }>;
  error?: string;
};

export const Route = createFileRoute("/batch")({ component: BatchPage });

function BatchPage() {
  const { user, token, isLoading } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const jobsRef = useRef<BatchJob[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [folders, setFolders] = useState<DashboardFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [language, setLanguage] = useState("auto");
  const [speakerLabels, setSpeakerLabels] = useState(false);
  const [transcriptTemplate, setTranscriptTemplate] = useState("meeting");
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [rejected, setRejected] = useState<BatchResponse["rejected"]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoading && !user) {
      void navigate({
        to: "/login",
        search: { error: undefined, from: "/batch" },
      });
    }
  }, [isLoading, navigate, user]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void fetch(`${API_URL}/api/transcribe/folders`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          folders?: unknown;
        };
        if (!active || !response.ok) return;
        const next = normalizeDashboardFolders(body.folders);
        setFolders(next);
        setFolderId((current) => current || String(next[0]?.id || ""));
      })
      .catch(() => setError("Không tải được danh sách thư mục"));
    return () => {
      active = false;
    };
  }, [token]);

  const hasActiveJobs = jobs.some((job) =>
    ["queued", "processing"].includes(job.status),
  );

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    if (!token || !hasActiveJobs) return;
    let cancelled = false;
    const poll = async () => {
      const updates = await Promise.all(
        jobsRef.current.map(async (job) => {
          if (!["queued", "processing"].includes(job.status)) return job;
          try {
            const response = await fetch(
              `${API_URL}/api/transcribe/jobs/${job.jobId}`,
              { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
            );
            const body = (await response.json()) as Partial<BatchJob> & {
              transcription_id?: number;
            };
            if (!response.ok) return job;
            return {
              ...job,
              ...body,
              id: Number(body.transcription_id || body.id || job.id),
              jobId: job.jobId,
              filename: String(body.filename || job.filename),
            } as BatchJob;
          } catch {
            return job;
          }
        }),
      );
      if (!cancelled) setJobs(updates);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActiveJobs, token]);

  const completedJobs = useMemo(
    () => jobs.filter((job) => job.status === "completed" && job.text),
    [jobs],
  );

  function chooseFiles(nextFiles: FileList | null) {
    if (!nextFiles) return;
    const selected = Array.from(nextFiles).slice(0, 8);
    setFiles(selected);
    setJobs([]);
    setRejected([]);
    setError(
      selected.length < 2
        ? "Chọn ít nhất 2 file để xử lý hàng loạt."
        : nextFiles.length > 8
          ? "Mỗi batch tối đa 8 file; hệ thống đã giữ 8 file đầu tiên."
          : "",
    );
  }

  async function startBatch() {
    if (!token || files.length < 2 || submitting) return;
    setSubmitting(true);
    setError("");
    const form = new FormData();
    files.forEach((file) => form.append("audio", file));
    form.append("language", language);
    form.append("speakerLabels", String(speakerLabels));
    form.append("transcriptTemplate", transcriptTemplate);
    if (folderId) form.append("folderId", folderId);
    try {
      const response = await fetch(`${API_URL}/api/transcribe/batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = (await response.json().catch(() => ({}))) as BatchResponse;
      if (!response.ok && response.status !== 207) {
        throw new Error(body.error || "Không tạo được batch");
      }
      setJobs(Array.isArray(body.jobs) ? body.jobs : []);
      setRejected(Array.isArray(body.rejected) ? body.rejected : []);
      if (!body.jobs?.length) throw new Error("Không có file nào được xếp hàng");
    } catch (batchError) {
      setError(
        batchError instanceof Error ? batchError.message : "Không tạo được batch",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function exportZip() {
    const archive = createStoredZip(
      completedJobs.map((job) => ({
        name: `${job.filename.replace(/\.[^.]+$/, "") || `transcript-${job.id}`}.txt`,
        content: job.text || "",
      })),
    );
    const url = URL.createObjectURL(archive);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vbee-batch-${new Date().toISOString().slice(0, 10)}.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7fb]">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f7fb] text-foreground">
      <AuthenticatedHeader />
      <main className="mx-auto max-w-5xl px-3 py-4 sm:px-5 sm:py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase text-primary">Batch workflow</p>
            <h1 className="mt-1 text-2xl font-black">Xử lý nhiều file</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tải 2–8 file, theo dõi từng job và xuất các transcript hoàn tất thành ZIP.
            </p>
          </div>
          <Link to="/history" className="text-sm font-bold text-primary hover:underline">
            Mở lịch sử đầy đủ
          </Link>
        </div>

        <section className="mt-4 overflow-hidden rounded-xl border border-border bg-white">
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-[1fr_170px_150px_180px]">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex min-h-24 items-center justify-center gap-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 text-left"
            >
              <UploadCloud className="h-7 w-7 text-primary" />
              <span>
                <strong className="block text-sm">Chọn nhiều file</strong>
                <span className="text-xs text-muted-foreground">MP3, WAV, M4A, MP4, WEBM…</span>
              </span>
            </button>
            <label className="text-xs font-bold text-muted-foreground">
              <Folder className="mb-1 inline h-3.5 w-3.5" /> Thư mục
              <select
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2 font-semibold text-foreground"
              >
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-muted-foreground">
              Ngôn ngữ
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2 font-semibold text-foreground"
              >
                <option value="auto">Tự động</option>
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
                <option value="multi">Việt + English</option>
              </select>
            </label>
            <label className="text-xs font-bold text-muted-foreground">
              Mẫu transcript
              <select
                value={transcriptTemplate}
                onChange={(event) => setTranscriptTemplate(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2 font-semibold text-foreground"
              >
                <option value="meeting">Cuộc họp</option>
                <option value="interview">Phỏng vấn</option>
                <option value="podcast">Podcast</option>
                <option value="lecture">Bài giảng</option>
              </select>
            </label>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.mp4,.webm"
            className="hidden"
            onChange={(event) => chooseFiles(event.target.files)}
          />

          <div className="p-4">
            <label className="inline-flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={speakerLabels}
                onChange={(event) => setSpeakerLabels(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Tách người nói cho từng file
            </label>

            {error && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}

            {files.length > 0 && jobs.length === 0 && (
              <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}`} className="flex items-center gap-3 px-3 py-2.5">
                    <FileAudio className="h-4 w-4 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      aria-label={`Xóa ${file.name}`}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {jobs.length > 0 && (
              <div className="mt-4 space-y-2">
                {jobs.map((job) => (
                  <div key={job.jobId} className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-3">
                      {job.status === "completed" ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      ) : job.status === "failed" ? (
                        <AlertCircle className="h-5 w-5 text-destructive" />
                      ) : (
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{job.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.status === "completed"
                            ? "Đã hoàn tất"
                            : job.status === "failed"
                              ? job.error_message || "Xử lý thất bại"
                              : `${job.status === "queued" ? "Đang chờ" : "Đang xử lý"} · ${job.progress || 0}%`}
                        </p>
                      </div>
                      {job.status === "completed" && (
                        <Link
                          to="/transcript/$id"
                          params={{ id: String(job.id) }}
                          search={{ at: undefined }}
                          className="text-xs font-black text-primary hover:underline"
                        >
                          Mở
                        </Link>
                      )}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/10">
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${job.status === "completed" ? 100 : job.progress || 0}%` }}
                      />
                    </div>
                  </div>
                ))}
                {rejected?.map((item) => (
                  <p key={item.filename} className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
                    <strong>{item.filename}:</strong> {item.error}
                  </p>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void startBatch()}
                disabled={files.length < 2 || submitting || hasActiveJobs}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                Bắt đầu {files.length || ""} file
              </button>
              <button
                type="button"
                onClick={exportZip}
                disabled={!completedJobs.length}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-black disabled:opacity-40"
              >
                <Archive className="h-4 w-4" /> Xuất ZIP ({completedJobs.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setFiles([]);
                  setJobs([]);
                  setRejected([]);
                  setError("");
                }}
                className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-bold text-muted-foreground"
              >
                <RotateCcw className="h-4 w-4" /> Làm mới
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
