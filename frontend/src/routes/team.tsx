import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Crown,
  FileText,
  Loader2,
  Plus,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

type TeamMember = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  avatar: string | null;
  role: "owner" | "admin" | "member";
  joined_at: string;
};

type Invoice = {
  id: string;
  product_code: string | null;
  plan: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  paid_at: string | null;
};

type TeamPayload = {
  workspace: {
    id: number;
    name: string;
    owner_user_id: number;
    role: TeamMember["role"];
    plan?: string;
    invoiceProfile?: InvoiceProfile;
  };
  members: TeamMember[];
  seatLimit: number;
  quota: { usedSeconds: number; quotaSeconds: number; remainingSeconds: number; plan: string };
  error?: string;
};

type InvoiceProfile = {
  companyName: string;
  taxCode: string;
  address: string;
  invoiceEmail: string;
  billingContactEmail: string;
};

export const Route = createFileRoute("/team")({ component: TeamPage });

function TeamPage() {
  const { user, token, isLoading } = useAuth();
  const navigate = useNavigate();
  const [team, setTeam] = useState<TeamPayload | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [invoiceProfile, setInvoiceProfile] = useState<InvoiceProfile>({
    companyName: "",
    taxCode: "",
    address: "",
    invoiceEmail: "",
    billingContactEmail: "",
  });

  useEffect(() => {
    if (!isLoading && !user) void navigate({ to: "/login", search: { from: "/team", error: undefined } });
  }, [isLoading, navigate, user]);

  const headers = useCallback((json = false) => ({ ...(json ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const [teamResponse, invoiceResponse] = await Promise.all([
        fetch(`${API_URL}/api/team`, { headers: headers() }),
        fetch(`${API_URL}/api/team/invoices`, { headers: headers() }),
      ]);
      const teamData = (await teamResponse.json()) as TeamPayload;
      const invoiceData = (await invoiceResponse.json()) as { invoices?: Invoice[]; error?: string };
      if (!teamResponse.ok) throw new Error(teamData.error || "Không tải được nhóm");
      if (!invoiceResponse.ok) throw new Error(invoiceData.error || "Không tải được hóa đơn");
      setTeam(teamData);
      setName(teamData.workspace.name);
      setInvoiceProfile(
        teamData.workspace.invoiceProfile || {
          companyName: "",
          taxCode: "",
          address: "",
          invoiceEmail: "",
          billingContactEmail: "",
        },
      );
      setInvoices(invoiceData.invoices || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được nhóm");
    }
  }, [headers, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function api(path: string, options: RequestInit) {
    const response = await fetch(`${API_URL}${path}`, { ...options, headers: { ...headers(Boolean(options.body)), ...options.headers } });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(data.error || "Yêu cầu thất bại");
    return data;
  }

  async function rename() {
    setBusy("rename"); setError(""); setMessage("");
    try { await api("/api/team", { method: "PATCH", body: JSON.stringify({ name }) }); setMessage("Đã đổi tên nhóm"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không đổi được tên nhóm"); }
    finally { setBusy(""); }
  }

  async function addMember() {
    setBusy("invite"); setError(""); setMessage("");
    try { await api("/api/team/members", { method: "POST", body: JSON.stringify({ email, role }) }); setEmail(""); setMessage("Đã thêm thành viên vào nhóm"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thêm được thành viên"); }
    finally { setBusy(""); }
  }

  async function saveInvoiceProfile() {
    setBusy("invoice");
    setError("");
    setMessage("");
    try {
      await api("/api/workspace/invoice-profile", {
        method: "PATCH",
        body: JSON.stringify({ invoiceProfile }),
      });
      setMessage("Đã lưu thông tin billing");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Không lưu được thông tin billing",
      );
    } finally {
      setBusy("");
    }
  }

  async function updateRole(memberId: number, nextRole: "admin" | "member") {
    setBusy(`role-${memberId}`); setError("");
    try { await api(`/api/team/members/${memberId}`, { method: "PATCH", body: JSON.stringify({ role: nextRole }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không đổi được vai trò"); }
    finally { setBusy(""); }
  }

  async function removeMember(memberId: number) {
    setBusy(`remove-${memberId}`); setError("");
    try { await api(`/api/team/members/${memberId}`, { method: "DELETE" }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không xóa được thành viên"); }
    finally { setBusy(""); }
  }

  const requesterRole = useMemo(() => team?.members.find((member) => member.id === user?.id)?.role || "member", [team, user?.id]);
  const canManage = requesterRole === "owner" || requesterRole === "admin";
  const usedPercent = team ? Math.min(100, Math.round((team.quota.usedSeconds / Math.max(1, team.quota.quotaSeconds)) * 100)) : 0;

  if (isLoading || (!team && !error)) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!user) return null;

  return <div className="min-h-screen bg-[#f7f7fb] text-[#21104a]">
    <AuthenticatedHeader />
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#ffcb05]"><Users className="h-6 w-6" /></span><div><h1 className="text-2xl font-black">Nhóm làm việc</h1><p className="text-sm text-muted-foreground">Vai trò, hạn mức dùng chung và hóa đơn của nhóm.</p></div></div>
      {(error || message) && <p className={`mb-4 rounded-lg border px-4 py-3 text-sm font-bold ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || message}</p>}
      {team && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-white p-4 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="flex-1 text-xs font-black">Tên nhóm<input value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage} maxLength={160} className="mt-1 h-10 w-full rounded-lg border border-border px-3 text-sm font-semibold disabled:bg-muted" /></label>{canManage && <button type="button" onClick={() => void rename()} disabled={busy !== "" || !name.trim()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-black text-primary-foreground disabled:opacity-40"><Save className="h-4 w-4" /> Lưu</button>}</div></section>
          {canManage && <section className="rounded-xl border border-border bg-white p-4 sm:p-6"><h2 className="font-black">Thêm thành viên đã có tài khoản</h2><p className="mt-1 text-xs text-muted-foreground">Thành viên dùng chung quota của chủ nhóm. Gói hiện tại có {team.seatLimit} chỗ.</p><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_130px_auto]"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@congty.vn" className="h-10 rounded-lg border border-border px-3 text-sm" /><select value={role} onChange={(event) => setRole(event.target.value as "admin" | "member")} className="h-10 rounded-lg border border-border bg-white px-3 text-sm"><option value="member">Thành viên</option><option value="admin">Quản trị</option></select><button type="button" onClick={() => void addMember()} disabled={busy !== "" || !email.trim() || team.members.length >= team.seatLimit} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#ffcb05] px-4 text-sm font-black disabled:opacity-40"><Plus className="h-4 w-4" /> Thêm</button></div></section>}
          <section className="rounded-xl border border-border bg-white p-4 sm:p-6"><div className="flex items-center justify-between"><h2 className="font-black">Thành viên</h2><span className="text-xs font-bold text-muted-foreground">{team.members.length}/{team.seatLimit}</span></div><div className="mt-3 divide-y divide-border">{team.members.map((member) => <div key={member.id} className="flex items-center gap-3 py-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-black">{`${member.first_name?.[0] || ""}${member.last_name?.[0] || ""}`.toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{member.first_name} {member.last_name}</p><p className="truncate text-xs text-muted-foreground">{member.email}</p></div>{member.role === "owner" ? <span className="flex items-center gap-1 rounded-full bg-[#fff4bf] px-2 py-1 text-[11px] font-black"><Crown className="h-3 w-3" /> Chủ nhóm</span> : requesterRole === "owner" ? <select value={member.role} disabled={busy !== ""} onChange={(event) => void updateRole(member.id, event.target.value as "admin" | "member")} className="h-8 rounded-md border border-border bg-white px-2 text-xs"><option value="member">Thành viên</option><option value="admin">Quản trị</option></select> : <span className="text-xs font-bold">{member.role === "admin" ? "Quản trị" : "Thành viên"}</span>}{canManage && member.role !== "owner" && <button type="button" onClick={() => void removeMember(member.id)} disabled={busy !== "" || (requesterRole === "admin" && member.role === "admin")} className="text-destructive disabled:opacity-30" aria-label="Xóa thành viên"><Trash2 className="h-4 w-4" /></button>}</div>)}</div></section>
        </div>
        <aside className="space-y-4 self-start">
          <section className="rounded-xl border border-border bg-white p-5"><h2 className="font-black">Quota dùng chung</h2><p className="mt-1 text-xs text-muted-foreground">Mọi tác vụ của {team.members.length} thành viên cùng trừ vào hạn mức này.</p><p className="mt-4 text-2xl font-black">{Math.floor(team.quota.remainingSeconds / 60).toLocaleString("vi-VN")} phút còn lại</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-primary/10"><div className="h-full rounded-full bg-[#ffcb05]" style={{ width: `${usedPercent}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">Đã dùng {Math.floor(team.quota.usedSeconds / 60).toLocaleString("vi-VN")} / {Math.floor(team.quota.quotaSeconds / 60).toLocaleString("vi-VN")} phút · gói {team.quota.plan}</p></section>
          <section className="rounded-xl border border-border bg-white p-5">
            <h2 className="flex items-center gap-2 font-black">
              <Building2 className="h-4 w-4" /> Thông tin billing
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Gói {team.quota.plan} quyết định quota và chính sách lưu trữ media.
            </p>
            <div className="mt-3 space-y-2">
              {[
                ["companyName", "Tên công ty"],
                ["taxCode", "Mã số thuế"],
                ["invoiceEmail", "Email nhận hóa đơn"],
                ["billingContactEmail", "Email phụ trách billing"],
              ].map(([key, label]) => (
                <input
                  key={key}
                  value={invoiceProfile[key as keyof InvoiceProfile]}
                  onChange={(event) =>
                    setInvoiceProfile((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  disabled={!canManage || busy !== ""}
                  placeholder={label}
                  className="h-9 w-full rounded-lg border border-border px-3 text-xs font-semibold disabled:bg-muted"
                />
              ))}
              <textarea
                value={invoiceProfile.address}
                onChange={(event) =>
                  setInvoiceProfile((current) => ({
                    ...current,
                    address: event.target.value,
                  }))
                }
                disabled={!canManage || busy !== ""}
                placeholder="Địa chỉ xuất hóa đơn"
                rows={2}
                className="w-full rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:bg-muted"
              />
              {canManage && (
                <button
                  type="button"
                  onClick={() => void saveInvoiceProfile()}
                  disabled={busy !== ""}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-black text-primary-foreground disabled:opacity-40"
                >
                  {busy === "invoice" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Lưu thông tin billing
                </button>
              )}
            </div>
          </section>
          <section className="rounded-xl border border-border bg-white p-5"><h2 className="flex items-center gap-2 font-black"><FileText className="h-4 w-4" /> Hóa đơn nhóm</h2><div className="mt-3 space-y-2">{invoices.slice(0, 10).map((invoice) => <div key={invoice.id} className="rounded-lg bg-muted/50 p-3"><div className="flex justify-between gap-2 text-xs font-black"><span>{invoice.product_code || invoice.plan}</span><span>{Number(invoice.amount).toLocaleString("vi-VN")} {invoice.currency}</span></div><p className="mt-1 text-[11px] text-muted-foreground">{new Date(invoice.created_at).toLocaleDateString("vi-VN")} · {invoice.status}</p></div>)}{!invoices.length && <p className="text-xs text-muted-foreground">Chưa có hóa đơn.</p>}</div></section>
        </aside>
      </div>}
    </main>
  </div>;
}
