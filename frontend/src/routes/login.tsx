import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Eye, EyeOff, LogIn, Mail, LockKeyhole } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { redirectAfterAuth } from "@/lib/auth-redirect";
import { SocialAuthButtons } from "@/components/social-auth-buttons";
import vbeeLogo from "@/assets/vbee-logo.png";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

const SPARKLES = [
  { top: "8%", left: "7%", delay: 0, size: "h-1.5 w-1.5" },
  { top: "15%", left: "82%", delay: 0.6, size: "h-1 w-1" },
  { top: "28%", left: "4%", delay: 1.1, size: "h-1 w-1" },
  { top: "35%", left: "93%", delay: 0.3, size: "h-2 w-2" },
  { top: "55%", left: "3%", delay: 1.7, size: "h-1 w-1" },
  { top: "62%", left: "88%", delay: 0.9, size: "h-1.5 w-1.5" },
  { top: "75%", left: "6%", delay: 0.4, size: "h-1 w-1" },
  { top: "80%", left: "90%", delay: 1.4, size: "h-2 w-2" },
  { top: "90%", left: "20%", delay: 0.8, size: "h-1 w-1" },
  { top: "92%", left: "70%", delay: 1.9, size: "h-1.5 w-1.5" },
];

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: search.error as string | undefined,
    from: search.from as string | undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const { error: urlError, from } = Route.useSearch();
  const { user, isLoading, setToken } = useAuth();

  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && user) redirectAfterAuth(from);
  }, [user, isLoading, from]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setFormError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!form.email.trim() || !form.password) {
      setFormError("Vui lòng nhập email và mật khẩu");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim(), password: form.password }),
      });
      const data = (await res.json()) as { token?: string; error?: string };

      if (!res.ok || !data.token) {
        setFormError(data.error ?? "Đăng nhập thất bại");
        return;
      }

      setToken(data.token);
      redirectAfterAuth(from);
    } catch {
      setFormError("Không kết nối được backend. Hãy kiểm tra http://localhost:3001");
    } finally {
      setIsSubmitting(false);
    }
  }

  const errorMessages: Record<string, string> = {
    google_failed: "Đăng nhập Google thất bại. Vui lòng thử lại.",
    google_email_exists: "Email này đã đăng ký bằng mật khẩu. Hãy đăng nhập bằng email để bảo vệ tài khoản.",
    google_not_configured: "Google OAuth chưa được cấu hình. Hãy dùng email/password hoặc điền GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET.",
    google_email_required: "Google chưa cung cấp email đã xác minh.",
    facebook_failed: "Đăng nhập Facebook thất bại hoặc đã bị hủy.",
    facebook_email_exists: "Email Facebook đã thuộc một tài khoản Vbee. Hãy đăng nhập bằng phương thức đã dùng trước đó.",
    facebook_email_required: "Facebook chưa cung cấp email. Hãy kiểm tra quyền email của ứng dụng Facebook.",
    facebook_not_configured: "Facebook Login chưa được cấu hình trên máy chủ.",
    apple_failed: "Đăng nhập Apple thất bại hoặc đã bị hủy.",
    apple_email_exists: "Email Apple đã thuộc một tài khoản Vbee. Hãy đăng nhập bằng phương thức đã dùng trước đó.",
    apple_email_required: "Apple chưa cung cấp email đã xác minh cho tài khoản này.",
    apple_not_configured: "Sign in with Apple chưa được cấu hình trên máy chủ.",
    account_blocked: "Tài khoản đã bị khóa. Vui lòng liên hệ bộ phận hỗ trợ.",
    server_error: "Có lỗi xảy ra. Vui lòng thử lại sau.",
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-8">
      <div className="absolute inset-0 bg-gradient-hero pointer-events-none" />
      <div className="absolute top-[15%] left-[12%] h-56 w-56 rounded-full bg-[#ffcb05]/18 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[10%] right-[8%] h-44 w-44 rounded-full bg-[#21104a]/8 blur-3xl pointer-events-none" />

      {SPARKLES.map((s, i) => (
        <span key={i} className={`absolute ${s.size} hidden rounded-full bg-primary animate-twinkle pointer-events-none`} style={{ top: s.top, left: s.left, animationDelay: `${s.delay}s` }} />
      ))}

      <div className="relative z-10 grid w-full max-w-5xl items-center gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col items-center lg:items-start text-center lg:text-left">
          <div className="relative mb-5 flex h-28 w-44 items-center justify-center">
            <img src={vbeeLogo} alt="Vbee" className="relative h-24 w-auto object-contain" />
          </div>

          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#e8decc] bg-white px-4 py-1.5 text-xs font-bold text-[#725a00]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ffcb05]" />
            Chào mừng quay trở lại
          </div>
          <h1 className="text-2xl font-black leading-tight text-foreground md:text-3xl">
            Đăng nhập vào <span className="mt-1 block text-[#21104a]">Vbee AIVoice</span>
          </h1>
          <p className="mt-4 text-sm text-muted-foreground max-w-sm">
            Đăng nhập bằng email, Google, Facebook hoặc Apple để tiếp tục vào không gian làm việc.
          </p>

          <div className="mt-6 grid w-full max-w-sm grid-cols-3 gap-2">
            <div className="rounded-lg border border-border bg-white p-3 text-center">
              <div className="text-xl font-bold text-foreground">50+</div>
              <div className="text-xs text-muted-foreground">Ngôn ngữ</div>
            </div>
            <div className="rounded-lg border border-border bg-white p-3 text-center">
              <div className="text-xl font-bold text-foreground">~3s</div>
              <div className="text-xs text-muted-foreground">Xử lý</div>
            </div>
            <div className="rounded-lg border border-border bg-white p-3 text-center">
              <div className="text-xl font-bold text-foreground">98%</div>
              <div className="text-xs text-muted-foreground">Chính xác</div>
            </div>
          </div>
        </div>

        <div className="w-full">
          <div className="rounded-lg border border-border bg-white p-5 shadow-soft md:p-6">
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-foreground">Đăng nhập</h2>
              <p className="mt-1 text-sm text-muted-foreground">Nhập tài khoản đã đăng ký để tiếp tục</p>
            </div>

            {urlError && errorMessages[urlError] && (
              <div className="mb-5 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                {errorMessages[urlError]}
              </div>
            )}
            {formError && (
              <div className="mb-5 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                {formError}
              </div>
            )}

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    maxLength={254}
                    placeholder="ban@example.com"
                    className="w-full rounded-xl border border-border bg-background px-10 py-3 text-sm text-foreground placeholder:text-muted-foreground/35 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label className="block text-xs font-medium text-muted-foreground">Mật khẩu</label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-bold text-[#725a00] transition hover:text-[#21104a] hover:underline"
                  >
                    Quên mật khẩu?
                  </Link>
                </div>
                <div className="relative">
                  <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={handleChange}
                    required
                    maxLength={128}
                    placeholder="Nhập mật khẩu"
                    className="w-full rounded-xl border border-border bg-background px-10 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground/35 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-primary/10 hover:text-foreground"
                    aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="group w-full flex items-center justify-center gap-2 rounded-full bg-gradient-primary py-3 text-sm font-black text-[#21104a] shadow-glow hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin" /> : <LogIn className="h-4 w-4" />}
                {isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}
              </button>
            </form>

            <div className="mt-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">hoặc</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="mt-5">
              <SocialAuthButtons mode="login" from={from} />
            </div>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              Chưa có tài khoản?{" "}
              <Link to="/register" search={{ from, ref: undefined }} className="text-primary font-semibold hover:underline">
                Tạo tài khoản mới
              </Link>
            </p>
          </div>

          <div className="mt-5 text-center">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition">
              ← Quay về trang chủ
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
