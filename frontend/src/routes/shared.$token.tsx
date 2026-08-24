import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Loader2, MessageSquare, Save, ShieldCheck } from "lucide-react";
import { VbeeBrandLogo } from "@/components/vbee-brand-logo";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

type SharedTranscript = {
  id: number;
  filename: string;
  text: string;
  permission: "view" | "edit";
  duration: number | null;
  source_language: string | null;
  transcript_template: string;
  tags: string[];
};

type SharedComment = {
  id: number;
  author_name: string;
  body: string;
  timestamp_ms: number | null;
  created_at: string;
};

export const Route = createFileRoute("/shared/$token")({
  head: () => ({
    meta: [
      { title: "Transcript được chia sẻ · Vbee AIVoice" },
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
  component: SharedTranscriptPage,
});

function SharedTranscriptPage() {
  const { token } = Route.useParams();
  const [transcript, setTranscript] = useState<SharedTranscript | null>(null);
  const [text, setText] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState<SharedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    void fetch(`${API_URL}/api/collaboration/share/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = (await response.json()) as { transcript?: SharedTranscript; comments?: SharedComment[]; error?: string };
        if (!response.ok || !data.transcript) throw new Error(data.error || "Không tải được nội dung");
        if (!ignore) {
          setTranscript(data.transcript);
          setText(data.transcript.text || "");
          setComments(data.comments || []);
        }
      })
      .catch((cause: unknown) => {
        if (!ignore) setError(cause instanceof Error ? cause.message : "Không tải được nội dung");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [token]);

  async function saveTranscript() {
    if (!transcript || transcript.permission !== "edit") return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`${API_URL}/api/collaboration/share/${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, authorName }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Không lưu được nội dung");
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được nội dung");
    } finally {
      setSaving(false);
    }
  }

  async function addComment() {
    if (!comment.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/collaboration/share/${encodeURIComponent(token)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment, authorName }),
      });
      const data = (await response.json()) as SharedComment & { error?: string };
      if (!response.ok) throw new Error(data.error || "Không thêm được bình luận");
      setComments((current) => [...current, data]);
      setComment("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thêm được bình luận");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#f7f7fb]"><Loader2 className="h-9 w-9 animate-spin text-primary" /></div>;

  return (
    <div className="min-h-screen bg-[#f7f7fb] text-[#21104a]">
      <header className="border-b border-border bg-[#21104a] px-4 py-3"><div className="mx-auto flex max-w-6xl items-center justify-between"><VbeeBrandLogo className="h-8 w-auto" /><span className="flex items-center gap-1.5 text-xs font-bold text-white/80"><ShieldCheck className="h-4 w-4 text-[#ffcb05]" /> Liên kết bảo mật</span></div></header>
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        {error && !transcript ? <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-8 text-center"><h1 className="text-xl font-black">Không thể mở bản chia sẻ</h1><p className="mt-2 text-sm text-red-700">{error}</p></div> : transcript && <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-primary">Transcript được chia sẻ</p><h1 className="mt-1 break-all text-xl font-black sm:text-2xl">{transcript.filename}</h1><p className="mt-1 text-xs text-muted-foreground">Quyền: {transcript.permission === "edit" ? "xem và chỉnh sửa" : "chỉ xem"}</p></div>{transcript.permission === "edit" && <button type="button" onClick={() => void saveTranscript()} disabled={saving || !authorName.trim()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#ffcb05] px-4 text-sm font-black disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />} {saved ? "Đã lưu" : "Lưu thay đổi"}</button>}</div>
          {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="rounded-xl border border-border bg-white p-4 sm:p-6"><label className="mb-2 block text-xs font-black text-muted-foreground">Tên hiển thị của bạn</label><input value={authorName} onChange={(event) => setAuthorName(event.target.value)} maxLength={100} placeholder="Nhập tên trước khi sửa hoặc bình luận" className="mb-4 h-10 w-full rounded-lg border border-border px-3 text-sm sm:max-w-sm" />{transcript.permission === "edit" ? <textarea value={text} onChange={(event) => { setText(event.target.value); setSaved(false); }} className="min-h-[60vh] w-full resize-y rounded-lg border border-border p-4 text-sm leading-7 outline-none focus:border-primary" /> : <article className="min-h-[50vh] whitespace-pre-wrap text-sm leading-7">{text}</article>}</section>
            <aside className="self-start rounded-xl border border-border bg-white p-4"><h2 className="flex items-center gap-2 font-black"><MessageSquare className="h-4 w-4" /> Bình luận ({comments.length})</h2><div className="mt-3 max-h-[52vh] space-y-2 overflow-y-auto">{comments.map((item) => <div key={item.id} className="rounded-lg bg-muted/50 p-3"><p className="text-xs font-black">{item.author_name}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5">{item.body}</p><p className="mt-1 text-[10px] text-muted-foreground">{new Date(item.created_at).toLocaleString("vi-VN")}</p></div>)}{!comments.length && <p className="text-xs text-muted-foreground">Chưa có bình luận.</p>}</div><textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} placeholder="Viết bình luận, dùng @tên để nhắc…" className="mt-3 min-h-20 w-full rounded-lg border border-border p-3 text-xs" /><button type="button" onClick={() => void addComment()} disabled={saving || !authorName.trim() || !comment.trim()} className="mt-2 h-9 w-full rounded-lg bg-primary text-xs font-black text-primary-foreground disabled:opacity-40">Gửi bình luận</button></aside>
          </div>
        </>}
      </main>
    </div>
  );
}
