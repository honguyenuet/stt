import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, Mail, Send } from "lucide-react";
import vbeeLogo from "@/assets/vbee-logo.png";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    setResetUrl("");
    setSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await response.json()) as {
        message?: string;
        error?: string;
        resetUrl?: string;
      };
      if (!response.ok) throw new Error(data.error || "Không gửi được yêu cầu");
      setMessage(data.message || "Hãy kiểm tra email để đặt lại mật khẩu.");
      setResetUrl(data.resetUrl || "");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Không gửi được yêu cầu đặt lại mật khẩu",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-8 text-[#21104a]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-hero" />
      <div className="pointer-events-none absolute left-[8%] top-[12%] h-52 w-52 rounded-full bg-[#ffcb05]/15 blur-3xl" />

      <section className="relative z-10 w-full max-w-md rounded-xl border border-[#e8decc] bg-white p-6 shadow-soft sm:p-7">
        <Link to="/" className="mx-auto flex w-fit items-center justify-center">
          <img src={vbeeLogo} alt="Vbee" className="h-16 w-auto object-contain" />
        </Link>

        <div className="mt-5 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff8d7] text-[#725a00]">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">Quên mật khẩu</h1>
            <p className="mt-1 text-sm leading-6 text-[#756894]">
              Nhập email đã đăng ký. Vbee sẽ gửi liên kết tạo mật khẩu mới.
            </p>
          </div>
        </div>

        {message && (
          <div className="mt-5 rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-semibold leading-6 text-green-700">
            {message}
          </div>
        )}
        {error && (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-5 space-y-4">
          <label className="block text-xs font-bold text-[#756894]">
            Email đăng ký
            <span className="relative mt-2 block">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={254}
                autoComplete="email"
                placeholder="ban@example.com"
                className="w-full rounded-xl border border-[#e8decc] bg-[#fbf8ef] py-3 pl-10 pr-4 text-sm font-semibold text-[#21104a] outline-none transition focus:border-[#ffcb05] focus:ring-2 focus:ring-[#ffcb05]/20"
              />
            </span>
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-5 py-3 text-sm font-black text-[#21104a] transition hover:bg-[#ffdc45] disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {submitting ? "Đang gửi..." : "Gửi liên kết đặt lại"}
          </button>
        </form>

        {resetUrl && (
          <a
            href={resetUrl}
            className="mt-4 block rounded-lg border border-[#ffcb05]/50 bg-[#fff8d7] px-4 py-3 text-center text-sm font-black text-[#21104a] transition hover:bg-[#fff1a8]"
          >
            Mở liên kết đặt lại mật khẩu (chế độ local)
          </a>
        )}

        <Link
          to="/login"
          search={{ error: undefined, from: undefined }}
          className="mt-5 flex items-center justify-center gap-2 text-sm font-bold text-[#756894] transition hover:text-[#21104a]"
        >
          <ArrowLeft className="h-4 w-4" />
          Quay lại đăng nhập
        </Link>
      </section>
    </main>
  );
}
