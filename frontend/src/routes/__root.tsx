import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useLocation,
  useNavigate,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Clock,
  Mail,
  MessageCircle,
  Phone,
  Send,
  X,
} from "lucide-react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import {
  isOnboardingProtectedPath,
  needsOnboarding,
} from "@/lib/onboarding";
import { fetchQuota, formatQuotaTime, type QuotaStatus } from "@/lib/quota";
import { VbeeSupportWidget } from "@/components/vbee-support-widget";

import appCss from "../styles.css?url";
import vbeeLogoUrl from "../assets/vbee-logo.png?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function SupportChat() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [quotaError, setQuotaError] = useState("");

  useEffect(() => {
    if (!open || !token) {
      if (!token) setQuota(null);
      return;
    }

    const authToken = token;
    let cancelled = false;
    async function loadQuota() {
      try {
        const data = await fetchQuota(authToken);
        if (!cancelled) {
          setQuota(data);
          setQuotaError("");
        }
      } catch (error) {
        if (!cancelled) {
          setQuotaError(
            error instanceof Error
              ? error.message
              : "Không tải được thời gian còn lại",
          );
        }
      }
    }

    void loadQuota();
    const timer = window.setInterval(() => void loadQuota(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, token]);

  function handleSend() {
    if (!message.trim()) return;
    setSent(true);
    setMessage("");
    setTimeout(() => setSent(false), 3500);
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-80 overflow-hidden rounded-3xl border border-border bg-card shadow-[0_20px_80px_-20px_oklch(0_0_0/0.7)]">
          {/* Header gradient */}
          <div className="bg-gradient-to-br from-[oklch(0.82_0.17_84)] to-[oklch(0.88_0.18_88)] px-5 py-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-[oklch(0.16_0.01_80)]">
                  Hỗ trợ khách hàng
                </p>
                <p className="mt-0.5 text-[10px] text-[oklch(0.16_0.01_80)]/70">
                  Chúng tôi phản hồi trong vài phút
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-[oklch(0.16_0.01_80)]/60 hover:text-[oklch(0.16_0.01_80)] transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[oklch(0.16_0.01_80)]/20 text-sm font-bold text-[oklch(0.16_0.01_80)]">
                H
              </div>
              <div>
                <p className="text-xs font-semibold text-[oklch(0.16_0.01_80)]">
                  Hỗ trợ Vbee
                </p>
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  <span className="text-[10px] text-[oklch(0.16_0.01_80)]/70">
                    Đang trực tuyến
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-3 p-4">
            {/* Greeting bubble */}
            <div className="flex items-end gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[oklch(0.82_0.17_84)]/20 text-xs font-bold text-[oklch(0.82_0.17_84)]">
                H
              </div>
              <div className="max-w-[210px] rounded-2xl rounded-bl-sm bg-[oklch(0.22_0.01_80)] px-3 py-2 text-xs text-[oklch(0.98_0.01_90)] leading-relaxed">
                Xin chào! Tôi có thể giúp gì cho bạn hôm nay? 👋
              </div>
            </div>

            <div className="rounded-2xl border border-[oklch(0.82_0.17_84)]/25 bg-[oklch(0.82_0.17_84)]/10 px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-[oklch(0.82_0.17_84)]">
                <Clock className="h-3.5 w-3.5" />
                Thời gian còn lại
              </div>
              {token ? (
                quota ? (
                  <>
                    <p className="text-xl font-black text-[oklch(0.98_0.01_90)]">
                      {formatQuotaTime(quota.remainingSeconds)} còn lại
                    </p>
                    <p className="mt-1 text-xs font-semibold text-[oklch(0.72_0.02_85)]">
                      Đã dùng {formatQuotaTime(quota.usedSeconds)} /{" "}
                      {formatQuotaTime(quota.quotaSeconds)}
                    </p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[oklch(0.14_0.01_80)]">
                      <div
                        className="h-full rounded-full bg-[oklch(0.82_0.17_84)]"
                        style={{ width: `${quota.percentUsed}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-xs font-semibold text-[oklch(0.72_0.02_85)]">
                    {quotaError || "Đang tải thời gian sử dụng..."}
                  </p>
                )
              ) : (
                <p className="text-xs font-semibold text-[oklch(0.72_0.02_85)]">
                  Đăng nhập để xem thời lượng còn lại.
                </p>
              )}
            </div>

            {/* Quick contact */}
            <div className="flex flex-col gap-2 mt-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[oklch(0.72_0.02_85)]">
                Liên hệ trực tiếp
              </p>
              <a
                href="tel:+842499993399"
                className="flex items-center gap-2.5 rounded-xl border border-[oklch(0.28_0.02_85/60%)] px-3 py-2.5 text-xs text-[oklch(0.98_0.01_90)] transition hover:border-[oklch(0.82_0.17_84)]/40 hover:bg-[oklch(0.82_0.17_84)]/5"
              >
                <Phone className="h-3.5 w-3.5 text-[oklch(0.82_0.17_84)]" />
                <span>(+84) 249 999 3399</span>
              </a>
              <a
                href="mailto:contact@vbee.ai"
                className="flex items-center gap-2.5 rounded-xl border border-[oklch(0.28_0.02_85/60%)] px-3 py-2.5 text-xs text-[oklch(0.98_0.01_90)] transition hover:border-[oklch(0.82_0.17_84)]/40 hover:bg-[oklch(0.82_0.17_84)]/5"
              >
                <Mail className="h-3.5 w-3.5 text-[oklch(0.82_0.17_84)]" />
                <span>contact@vbee.ai</span>
              </a>
            </div>

            {/* Message input */}
            {sent ? (
              <div className="flex items-center gap-2 rounded-xl border border-[oklch(0.82_0.17_84)]/20 bg-[oklch(0.82_0.17_84)]/10 px-3 py-2.5 text-xs text-[oklch(0.82_0.17_84)]">
                <Check className="h-3.5 w-3.5" /> Đã gửi! Chúng tôi sẽ liên hệ
                sớm.
              </div>
            ) : (
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  placeholder="Nhập tin nhắn..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  className="flex-1 rounded-xl border border-[oklch(0.28_0.02_85/60%)] bg-[oklch(0.14_0.01_80)] px-3 py-2 text-xs text-[oklch(0.98_0.01_90)] placeholder:text-[oklch(0.72_0.02_85)] focus:outline-none focus:ring-1 focus:ring-[oklch(0.82_0.17_84)]/40"
                />
                <button
                  onClick={handleSend}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[oklch(0.82_0.17_84)] to-[oklch(0.88_0.18_88)] text-[oklch(0.16_0.01_80)] transition hover:opacity-90"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[oklch(0.82_0.17_84)] to-[oklch(0.88_0.18_88)] shadow-[0_8px_32px_-8px_oklch(0.82_0.17_84/0.7)] transition-all hover:scale-105 hover:opacity-90"
      >
        {open ? (
          <X className="h-5 w-5 text-[oklch(0.16_0.01_80)]" />
        ) : (
          <MessageCircle className="h-6 w-6 text-[oklch(0.16_0.01_80)]" />
        )}
      </button>
    </div>
  );
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4efe4] px-4 text-[#21104a]">
      <div className="w-full max-w-md rounded-xl border border-[#e8decc] bg-white p-8 text-center shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a7100]">
          Vbee AIVoice
        </p>
        <h1 className="mt-3 text-4xl font-black text-[#21104a]">404</h1>
        <h2 className="mt-3 text-xl font-black text-[#21104a]">
          Không tìm thấy trang này
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#756894]">
          Đường dẫn có thể đã thay đổi hoặc không còn khả dụng.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-[#ffcb05] px-5 py-2.5 text-sm font-black text-[#21104a] transition hover:bg-[#ffdc45]"
          >
            Về trang chủ
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4efe4] px-4 text-[#21104a]">
      <div className="w-full max-w-md rounded-xl border border-[#e8decc] bg-white p-8 text-center shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8a7100]">
          Vbee AIVoice
        </p>
        <h1 className="mt-3 text-xl font-black tracking-tight text-[#21104a]">
          Không thể tải trang
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#756894]">
          Có lỗi tạm thời khi tải dữ liệu. Vui lòng thử lại hoặc quay về trang
          chủ.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-full bg-[#ffcb05] px-4 py-2 text-sm font-black text-[#21104a] transition hover:bg-[#ffdc45]"
          >
            Thử lại
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-[#e8decc] bg-white px-4 py-2 text-sm font-black text-[#21104a] transition hover:bg-[#fbf8ef]"
          >
            Về trang chủ
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "referrer", content: "no-referrer" },
        { title: "Vbee AIVoice" },
        {
          name: "description",
          content: "Vbee AIVoice - chuyển giọng nói thành văn bản bằng AI.",
        },
        { name: "author", content: "Vbee AIVoice" },
        { property: "og:title", content: "Vbee AIVoice" },
        {
          property: "og:description",
          content: "Nền tảng AI chuyển giọng nói thành văn bản.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:site", content: "@VbeeAIVoice" },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "icon", type: "image/png", href: vbeeLogoUrl },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossOrigin: "anonymous",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,500;1,600;1,700&family=Inter:wght@300..900&family=Lexend:wght@300..800&family=Plus+Jakarta+Sans:wght@300..800&family=Roboto:wght@300..900&display=swap",
        },
      ],
    }),
    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const location = useLocation();
  const isAdminArea = location.pathname.startsWith("/admin");

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OnboardingGate>
          <Outlet />
        </OnboardingGate>
        {!isAdminArea && <VbeeSupportWidget />}
      </AuthProvider>
    </QueryClientProvider>
  );
}

function OnboardingGate({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const shouldRedirect =
    !isLoading &&
    needsOnboarding(user) &&
    location.pathname !== "/onboarding" &&
    isOnboardingProtectedPath(location.pathname);

  useEffect(() => {
    if (!shouldRedirect) return;
    void navigate({
      to: "/onboarding",
      search: { from: location.pathname },
      replace: true,
    });
  }, [location.pathname, navigate, shouldRedirect]);

  if (shouldRedirect) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f4ec]">
        <span className="h-9 w-9 animate-spin rounded-full border-2 border-[#ffcb05] border-t-[#21104a]" />
      </div>
    );
  }

  return <>{children}</>;
}
