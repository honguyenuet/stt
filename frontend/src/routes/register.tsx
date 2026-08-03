import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent, type ChangeEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { redirectAfterAuth } from "@/lib/auth-redirect";
import { SocialAuthButtons } from "@/components/social-auth-buttons";
import vbeeLogo from "@/assets/vbee-logo.png";
import { Zap, Languages, CheckCircle2, ArrowRight, Eye, EyeOff } from "lucide-react";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

// Hạt sáng cố định (tránh SSR hydration mismatch)
const SPARKLES = [
  { top: "7%",  left: "3%",  delay: 0,    size: "h-1.5 w-1.5" },
  { top: "13%", left: "85%", delay: 0.8,  size: "h-1 w-1" },
  { top: "32%", left: "1%",  delay: 1.4,  size: "h-2 w-2" },
  { top: "40%", left: "97%", delay: 0.3,  size: "h-1 w-1" },
  { top: "58%", left: "2%",  delay: 1.9,  size: "h-1 w-1" },
  { top: "65%", left: "92%", delay: 0.6,  size: "h-1.5 w-1.5" },
  { top: "78%", left: "7%",  delay: 1.1,  size: "h-1 w-1" },
  { top: "83%", left: "88%", delay: 0.4,  size: "h-2 w-2" },
  { top: "93%", left: "40%", delay: 1.6,  size: "h-1 w-1" },
  { top: "4%",  left: "50%", delay: 0.9,  size: "h-1.5 w-1.5" },
  { top: "22%", left: "48%", delay: 1.3,  size: "h-1 w-1" },
  { top: "70%", left: "50%", delay: 0.2,  size: "h-1 w-1" },
];

const FEATURES = [
  { icon: CheckCircle2, text: "Chính xác lên đến 98%" },
  { icon: Languages,   text: "Hỗ trợ 50+ ngôn ngữ" },
  { icon: Zap,         text: "Xử lý chỉ trong ~3 giây" },
];

export const Route = createFileRoute("/register")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: search.error as string | undefined,
    from: search.from as string | undefined,
    ref: typeof search.ref === "string" ? search.ref.slice(0, 32) : undefined,
    provider: search.provider as string | undefined,
    email: search.email as string | undefined,
    firstName: search.firstName as string | undefined,
    lastName: search.lastName as string | undefined,
    oauthToken: search.oauthToken as string | undefined,
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const {
    error: urlError,
    from,
    ref,
    provider,
    email,
    firstName,
    lastName,
    oauthToken,
  } = Route.useSearch();
  const { user, isLoading, setToken } = useAuth();

  const [form, setForm] = useState({
    firstName: firstName || "",
    lastName: lastName || "",
    email: email || "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword]       = useState(false);
  const [showConfirm, setShowConfirm]         = useState(false);
  const [error, setError]                     = useState("");
  const [isSubmitting, setIsSubmitting]       = useState(false);

  useEffect(() => {
    if (!isLoading && user) redirectAfterAuth(from);
  }, [user, isLoading, from]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
    setError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirmPassword) { setError("Mật khẩu xác nhận không khớp"); return; }
    if (form.password.length < 12) { setError("Mật khẩu phải có ít nhất 12 ký tự"); return; }

    setIsSubmitting(true);
    try {
      const res  = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName, lastName: form.lastName,
          email: form.email,        password: form.password,
          referralCode: ref,
          oauthToken,
        }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok) { setError(data.error ?? "Đăng ký thất bại"); return; }
      if (data.token) {
        setToken(data.token);
        redirectAfterAuth(from);
      }
    } catch {
      setError("Có lỗi xảy ra. Vui lòng thử lại.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const oauthErrors: Record<string, string> = {
    google_failed: "Đăng ký Google thất bại hoặc đã bị hủy.",
    google_email_exists: "Email này đã có tài khoản Vbee. Hãy đăng nhập bằng phương thức đã dùng trước đó.",
    google_email_required: "Google chưa cung cấp email đã xác minh.",
    google_not_configured: "Google OAuth chưa được cấu hình trên máy chủ.",
    facebook_failed: "Đăng ký Facebook thất bại hoặc đã bị hủy.",
    facebook_email_exists: "Email Facebook đã có tài khoản Vbee. Hãy đăng nhập bằng phương thức đã dùng trước đó.",
    facebook_email_required: "Facebook chưa cung cấp email đã xác minh.",
    facebook_not_configured: "Facebook Login chưa được cấu hình trên máy chủ.",
    apple_failed: "Đăng ký Apple thất bại hoặc đã bị hủy.",
    apple_email_exists: "Email Apple đã có tài khoản Vbee. Hãy đăng nhập bằng phương thức đã dùng trước đó.",
    apple_email_required: "Apple chưa cung cấp email đã xác minh.",
    apple_not_configured: "Sign in with Apple chưa được cấu hình trên máy chủ.",
    account_blocked: "Tài khoản đã bị khóa. Vui lòng liên hệ bộ phận hỗ trợ.",
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-8">

      {/* ── Nền động ──────────────────────────────────────────────────── */}
      <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
      <div className="absolute top-[10%] left-[8%] h-56 w-56 rounded-full bg-[#ffcb05]/18 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[8%] right-[6%] h-44 w-44 rounded-full bg-[#21104a]/8 blur-3xl pointer-events-none" />

      {SPARKLES.map((s, i) => (
        <span key={i}
          className={`absolute ${s.size} hidden rounded-full bg-primary animate-twinkle pointer-events-none`}
          style={{ top: s.top, left: s.left, animationDelay: `${s.delay}s` }}
        />
      ))}

      {/* ── Layout 2 cột ─────────────────────────────────────────────── */}
      <div className="relative z-10 grid w-full max-w-5xl items-center gap-8 lg:grid-cols-2">

        {/* ══ CỘT TRÁI — Branding ══════════════════════════════════════ */}
        <div className="flex flex-col items-center lg:items-start text-center lg:text-left">

          {/* Logo + vòng pulse */}
          <div className="relative mb-5 flex h-28 w-44 items-center justify-center">
            <img
              src={vbeeLogo}
              alt="Vbee"
              className="relative h-24 w-auto object-contain"
            />
          </div>

          {/* Badge + Tiêu đề */}
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#e8decc] bg-white px-4 py-1.5 text-xs font-bold text-[#725a00]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ffcb05]" />
            Chào mừng đến với Vbee
          </div>

          <h1 className="text-2xl font-black leading-tight text-foreground md:text-3xl">
            Bắt đầu hành trình{" "}
            <span className="mt-1 block text-[#21104a]">
              cùng Vbee!
            </span>
          </h1>

          <p className="mt-4 text-muted-foreground text-base max-w-sm">
            Tạo tài khoản miễn phí và trải nghiệm công nghệ chuyển giọng nói
            thành văn bản chính xác hàng đầu Việt Nam.
          </p>

          {/* Feature list */}
          <ul className="mt-6 space-y-2.5">
            {FEATURES.map((f) => (
              <li key={f.text} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#e8decc] bg-white">
                  <f.icon className="h-3.5 w-3.5 text-primary" />
                </span>
                <span className="text-sm text-muted-foreground">{f.text}</span>
              </li>
            ))}
          </ul>

          {/* Transcript preview card */}
          <div className="mt-6 hidden w-full max-w-sm rounded-lg border border-border bg-white p-4 lg:block">
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#fff2a3] text-[#21104a]">
                <Zap className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold text-foreground">Kết quả chuyển đổi</span>
              <div className="ml-auto flex items-end gap-[3px] h-5">
                {[0.6, 1, 0.7, 0.9, 0.5, 0.8, 0.6].map((_, i) => (
                  <span key={i} className="w-[3px] rounded-full bg-primary/60 animate-wave"
                    style={{ height: "100%", animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
            </div>
            <p className="text-xs text-foreground/80 leading-relaxed">
              "Vbee chuyển giọng nói của bạn thành văn bản{" "}
              <span className="bg-primary/20 text-primary px-1 rounded">chính xác</span>{" "}
              trong tích tắc."
            </p>
          </div>

          <Link to="/" className="mt-6 text-sm text-muted-foreground hover:text-foreground transition hidden lg:inline-flex items-center gap-1">
            ← Quay về trang chủ
          </Link>
        </div>

        {/* ══ CỘT PHẢI — Form ══════════════════════════════════════════ */}
        <div className="w-full">
          <div className="rounded-lg border border-border bg-white p-5 shadow-soft md:p-6">

            {/* Header form */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground">Tạo tài khoản</h2>
              <p className="mt-1 text-sm text-muted-foreground">Đăng ký bằng email và mật khẩu an toàn</p>
            </div>

            {ref && (
              <div className="mb-5 rounded-xl border border-[#f0d66a] bg-[#fff9d7] px-4 py-3 text-sm text-[#4a356e]">
                Bạn đang đăng ký bằng mã giới thiệu <strong>{ref}</strong>. Người
                mời sẽ nhận 100 phút sau transcript đầu tiên của bạn.
              </div>
            )}
            {provider === "google" && email && (
              <div className="mb-5 rounded-xl border border-[#d8cde9] bg-[#f7f4ff] px-4 py-3 text-sm text-[#4a356e]">
                Email Google này chưa có tài khoản Vbee. Vui lòng bổ sung thông
                tin và tạo mật khẩu để hoàn tất đăng ký.
              </div>
            )}

            {/* Lỗi */}
            {urlError && oauthErrors[urlError] && (
              <div className="mb-5 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                {oauthErrors[urlError]}
              </div>
            )}
            {error && (
              <div className="mb-5 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">

              {/* First + Last name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Tên <span className="text-destructive">*</span>
                  </label>
                  <input
                    name="firstName" value={form.firstName} onChange={handleChange} required maxLength={100}
                    placeholder="Văn A"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/25 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Họ <span className="text-destructive">*</span>
                  </label>
                  <input
                    name="lastName" value={form.lastName} onChange={handleChange} required maxLength={100}
                    placeholder="Nguyễn"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/25 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Địa chỉ email <span className="text-destructive">*</span>
                </label>
                <input
                  name="email" type="email" value={form.email} onChange={handleChange} required maxLength={254}
                  placeholder="ban@example.com"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/25 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Mật khẩu <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <input
                    name="password" type={showPassword ? "text" : "password"}
                    value={form.password} onChange={handleChange} required
                    minLength={12} maxLength={128}
                    placeholder="Ít nhất 12 ký tự"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/25 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition"
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Xác nhận mật khẩu <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <input
                    name="confirmPassword" type={showConfirm ? "text" : "password"}
                    value={form.confirmPassword} onChange={handleChange} required
                    minLength={12} maxLength={128}
                    placeholder="Nhập lại mật khẩu"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/25 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition"
                  />
                  <button type="button" onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit" disabled={isSubmitting}
                className="group mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-primary py-3 text-sm font-black text-[#21104a] shadow-glow hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin" />
                ) : (
                  <>
                    Tạo tài khoản
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-4">
              <SocialAuthButtons mode="register" referralCode={ref} />
            </div>

            {/* Divider trang trí */}
            <div className="mt-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <div className="flex items-end gap-[3px] px-1">
                {[0.5, 0.9, 0.6, 1, 0.7, 0.8, 0.5].map((_, i) => (
                  <span key={i} className="w-[3px] h-3 rounded-full bg-primary/40 animate-wave"
                    style={{ animationDelay: `${i * 0.14}s` }} />
                ))}
              </div>
              <div className="h-px flex-1 bg-border" />
            </div>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              Đã có tài khoản?{" "}
              <Link to="/login" search={{ error: undefined, from }}
                className="text-primary font-semibold hover:underline"
              >
                Đăng nhập ngay
              </Link>
            </p>
          </div>

          {/* Mobile: back link */}
          <div className="mt-5 text-center lg:hidden">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition">
              ← Quay về trang chủ
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
