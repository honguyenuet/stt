import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

type ShareItem = {
  id: number;
  token_prefix: string;
  permission: "view" | "edit";
  expires_at: string;
  revoked_at: string | null;
};

type CommentItem = {
  id: number;
  author_name: string;
  body: string;
  timestamp_ms: number | null;
  created_at: string;
};

export function TranscriptCollaborationPanel({
  transcriptId,
  token,
  playbackMilliseconds,
}: {
  transcriptId: number;
  token: string;
  playbackMilliseconds: number;
}) {
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [createdUrl, setCreatedUrl] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const headers = useCallback(
    (json = false) => ({
      ...(json ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
    }),
    [token],
  );

  const load = useCallback(async () => {
    try {
      const [sharesResponse, commentsResponse] = await Promise.all([
        fetch(`${API_URL}/api/collaboration/transcripts/${transcriptId}/shares`, { headers: headers() }),
        fetch(`${API_URL}/api/collaboration/transcripts/${transcriptId}/comments`, { headers: headers() }),
      ]);
      const shareData = (await sharesResponse.json()) as { shares?: ShareItem[]; error?: string };
      const commentData = (await commentsResponse.json()) as { comments?: CommentItem[]; error?: string };
      if (!sharesResponse.ok) throw new Error(shareData.error || "Không tải được liên kết");
      if (!commentsResponse.ok) throw new Error(commentData.error || "Không tải được bình luận");
      setShares(shareData.shares || []);
      setComments(commentData.comments || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được cộng tác");
    }
  }, [headers, transcriptId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createShare() {
    setBusy("share");
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/collaboration/transcripts/${transcriptId}/shares`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ permission, expiresInDays }),
      });
      const data = (await response.json()) as ShareItem & { token?: string; error?: string };
      if (!response.ok || !data.token) throw new Error(data.error || "Không tạo được liên kết");
      const url = `${window.location.origin}/shared/${data.token}`;
      setCreatedUrl(url);
      await navigator.clipboard?.writeText(url).catch(() => {});
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tạo được liên kết");
    } finally {
      setBusy("");
    }
  }

  async function revokeShare(shareId: number) {
    setBusy(`revoke-${shareId}`);
    try {
      const response = await fetch(`${API_URL}/api/collaboration/transcripts/${transcriptId}/shares/${shareId}`, {
        method: "DELETE",
        headers: headers(),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Không thu hồi được liên kết");
      if (createdUrl) setCreatedUrl("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thu hồi được liên kết");
    } finally {
      setBusy("");
    }
  }

  async function addComment() {
    if (!comment.trim()) return;
    setBusy("comment");
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/collaboration/transcripts/${transcriptId}/comments`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ body: comment, timestampMs: playbackMilliseconds }),
      });
      const data = (await response.json()) as CommentItem & { error?: string };
      if (!response.ok) throw new Error(data.error || "Không thêm được bình luận");
      setComments((current) => [...current, data]);
      setComment("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thêm được bình luận");
    } finally {
      setBusy("");
    }
  }

  const activeShares = shares.filter((share) => !share.revoked_at && new Date(share.expires_at) > new Date());

  return (
    <div className="space-y-4 text-sm">
      {error && <p className="rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">{error}</p>}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2 font-black"><Link2 className="h-4 w-4" /> Chia sẻ bảo mật</div>
        <div className="grid grid-cols-2 gap-2">
          <select value={permission} onChange={(event) => setPermission(event.target.value as "view" | "edit")} className="h-9 rounded-lg border border-border bg-white px-2 text-xs"><option value="view">Chỉ xem</option><option value="edit">Được sửa</option></select>
          <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} className="h-9 rounded-lg border border-border bg-white px-2 text-xs"><option value={1}>1 ngày</option><option value={7}>7 ngày</option><option value={30}>30 ngày</option><option value={90}>90 ngày</option></select>
        </div>
        <button type="button" onClick={() => void createShare()} disabled={Boolean(busy)} className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-black text-primary-foreground disabled:opacity-50">{busy === "share" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Tạo và sao chép liên kết</button>
        {createdUrl && <button type="button" onClick={() => void navigator.clipboard.writeText(createdUrl)} className="mt-2 flex w-full items-center gap-2 rounded-lg bg-primary/10 p-2 text-left text-xs font-bold text-primary"><Copy className="h-4 w-4 shrink-0" /><span className="truncate">{createdUrl}</span></button>}
        <div className="mt-2 space-y-1">
          {activeShares.map((share) => <div key={share.id} className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs"><span className="min-w-0 flex-1 truncate">{share.token_prefix}… · {share.permission === "edit" ? "Sửa" : "Xem"} · đến {new Date(share.expires_at).toLocaleDateString("vi-VN")}</span><button type="button" aria-label="Thu hồi liên kết" onClick={() => void revokeShare(share.id)} disabled={Boolean(busy)} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div>)}
          {!activeShares.length && <p className="text-xs text-muted-foreground">Chưa có liên kết đang hoạt động.</p>}
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2 font-black"><MessageSquare className="h-4 w-4" /> Bình luận ({comments.length})</div>
        <div className="max-h-52 space-y-2 overflow-y-auto">
          {comments.map((item) => <div key={item.id} className="rounded-lg bg-muted/40 p-2"><div className="flex justify-between gap-2 text-[11px] font-bold"><span>{item.author_name}</span>{item.timestamp_ms !== null && <span className="text-muted-foreground">{Math.floor(item.timestamp_ms / 60000)}:{String(Math.floor((item.timestamp_ms % 60000) / 1000)).padStart(2, "0")}</span>}</div><p className="mt-1 whitespace-pre-wrap text-xs leading-5">{item.body}</p></div>)}
          {!comments.length && <p className="text-xs text-muted-foreground">Dùng @tên để nhắc người liên quan.</p>}
        </div>
        <div className="mt-2 flex gap-2"><input value={comment} maxLength={2000} onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addComment(); }} placeholder="Bình luận tại vị trí đang phát…" className="h-9 min-w-0 flex-1 rounded-lg border border-border px-2 text-xs" /><button type="button" onClick={() => void addComment()} disabled={!comment.trim() || Boolean(busy)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"><Send className="h-4 w-4" /></button></div>
      </div>
    </div>
  );
}
