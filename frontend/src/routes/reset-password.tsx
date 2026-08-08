import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole } from "lucide-react";
import vbeeLogo from "@/assets/vbee-logo.png";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (token) window.history.replaceState(null, "", "/reset-password");
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (!token) {
      setError("Liên kết đặt lại mật khẩu không hợp lệ.");
      return;
    }
    if (password.length < 12) {
      setError("Mật khẩu mới phải có ít nhất 12 ký tự.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Hai mật khẩu chưa trùng khớp.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Không đặt lại được mật khẩu");
      setMessage(data.message || "Đặt lại mật khẩu thành công.");
      setPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Không đặt lại được mật khẩu",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-8 text-[#21104a]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-hero" />
      <div className="pointer-events-none absolute bottom-[10%] right-[8%] h-52 w-52 rounded-full bg-[#ffcb05]/15 blur-3xl" />

      <section className="relative z-10 w-full max-w-md rounded-xl border border-[#e8decc] bg-white p-6 shadow-soft sm:p-7">
        <Link to="/" className="mx-auto flex w-fit items-center justify-center">
          <img src={vbeeLogo} alt="Vbee" className="h-16 w-auto object-contain" />
        </Link>

        <div className="mt-5 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff8d7] text-[#725a00]">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">Tạo mật khẩu mới</h1>
            <p className="mt-1 text-sm leading-6 text-[#756894]">
              Mật khẩu cần có ít nhất 8 ký tự và chỉ bạn biết.
            </p>
          </div>
        </div>

        {message ? (
          <div className="mt-6 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
            <p className="mt-3 text-sm font-bold leading-6 text-green-700">{message}</p>
            <Link
              to="/login"
              search={{ error: undefined, from: undefined }}
              className="mt-5 inline-flex rounded-full bg-[#ffcb05] px-6 py-3 text-sm font-black text-[#21104a]"
            >
              Đăng nhập bằng mật khẩu mới
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={(event) => void handleSubmit(event)} className="mt-5 space-y-4">
              <PasswordField
                label="Mật khẩu mới"
                value={password}
                onChange={setPassword}
                visible={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
              />
              <PasswordField
                label="Nhập lại mật khẩu"
                value={confirmPassword}
                onChange={setConfirmPassword}
                visible={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
              />
              <button
                type="submit"
                disabled={submitting || !token}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-5 py-3 text-sm font-black text-[#21104a] transition hover:bg-[#ffdc45] disabled:opacity-60"
              >
                <LockKeyhole className="h-4 w-4" />
                {submitting ? "Đang cập nhật..." : "Đặt lại mật khẩu"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="block text-xs font-bold text-[#756894]">
      {label}
      <span className="relative mt-2 block">
        <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          className="w-full rounded-xl border border-[#e8decc] bg-[#fbf8ef] py-3 pl-10 pr-11 text-sm font-semibold text-[#21104a] outline-none transition focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#756894] transition hover:text-[#21104a]"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  );
}
