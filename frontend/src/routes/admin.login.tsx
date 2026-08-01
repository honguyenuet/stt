import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  exchangeAdminSession,
  loginAdmin,
  readAdminSession,
  validateAdminSession,
} from "@/lib/admin/admin-auth";

export const Route = createFileRoute("/admin/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    from: search.from as string | undefined,
  }),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const { from } = Route.useSearch();
  const { user, token, isLoading: authLoading } = useAuth();
  const exchangeAttempted = useRef("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      const current = readAdminSession();
      if (current) {
        try {
          await validateAdminSession();
          if (active) void navigate({ to: from || "/admin" });
          return;
        } catch {
          // The API client clears an invalid or expired CMS session.
        }
      }
      if (authLoading) return;
      if (!token || exchangeAttempted.current === token) {
        if (active) setCheckingSession(false);
        return;
      }
      exchangeAttempted.current = token;
      try {
        await exchangeAdminSession(token);
        if (active) void navigate({ to: from || "/admin" });
      } catch (err) {
        if (active && user) {
          setError(
            err instanceof Error
              ? err.message
              : "Tài khoản chưa được cấp quyền truy cập CMS",
          );
        }
      } finally {
        if (active) setCheckingSession(false);
      }
    }
    void restoreSession();
    return () => {
      active = false;
    };
  }, [authLoading, from, navigate, token, user]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await loginAdmin(email, password);
      void navigate({ to: from || "/admin" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập admin thất bại");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#f7f4ec] px-4 text-[#21104a]">
      <div className="w-full max-w-md rounded-lg border border-[#e4ddcf] bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-[#ffcb05]">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-[#8a7100]">
              Vbee CMS
            </p>
            <h1 className="text-2xl font-black">Đăng nhập quản trị</h1>
          </div>
        </div>
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="space-y-4"
        >
          <label className="block text-sm font-bold">
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 outline-none focus:border-[#21104a]"
            />
          </label>
          <label className="block text-sm font-bold">
            Mật khẩu
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              className="mt-1 w-full rounded-md border border-[#e4ddcf] px-3 py-2 outline-none focus:border-[#21104a]"
            />
          </label>
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
          <button
            disabled={loading}
            className="w-full rounded-md bg-[#21104a] px-4 py-3 text-sm font-black text-white disabled:opacity-60"
          >
            {loading ? "Đang đăng nhập..." : "Đăng nhập admin"}
          </button>
        </form>
        <div className="mt-5 rounded-md bg-[#fbf8ef] p-3 text-xs leading-5 text-[#756894]">
          {checkingSession
            ? "Đang kiểm tra phiên đăng nhập Vbee..."
            : user
              ? `Đang đăng nhập Vbee bằng ${user.email}. CMS chỉ mở khi tài khoản này đã được cấp quyền quản trị.`
              : "Dùng tài khoản Vbee đã được cấp quyền quản trị. Bạn cũng có thể đăng nhập Vbee trước rồi mở lại CMS."}
        </div>
        {!authLoading && !user && (
          <a
            href={`/login?from=${encodeURIComponent(from || "/admin")}`}
            className="mt-3 inline-flex text-sm font-bold text-[#21104a] underline underline-offset-4"
          >
            Đăng nhập tài khoản Vbee
          </a>
        )}
      </div>
    </div>
  );
}
