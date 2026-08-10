import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, MailCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { redirectAfterAuth } from "@/lib/auth-redirect";
import vbeeLogo from "@/assets/vbee-logo.png";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

export const Route = createFileRoute("/verify-email")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: search.token as string | undefined,
    from: search.from as string | undefined,
  }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token, from } = Route.useSearch();
  const { setToken } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Đang xác thực email...");

  useEffect(() => {
    let cancelled = false;

    async function verifyEmail() {
      if (!token) {
        setStatus("error");
        setMessage("Liên kết xác thực email không hợp lệ.");
        return;
      }
      try {
        const response = await fetch(`${API_URL}/api/auth/verify-email`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await response.json()) as {
          token?: string;
          expiresIn?: number;
          user?: Parameters<typeof setToken>[1];
          message?: string;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "Không xác thực được email");
        if (data.token) setToken(data.token, data.user, data.expiresIn);
        if (!cancelled) {
          setStatus("success");
          setMessage(data.message || "Email đã được xác thực.");
          window.setTimeout(() => redirectAfterAuth(from), 900);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Không xác thực được email");
        }
      }
    }

    void verifyEmail();
    return () => {
      cancelled = true;
    };
  }, [from, setToken, token]);

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-8 text-[#21104a]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-hero" />
      <section className="relative z-10 w-full max-w-md rounded-xl border border-[#e8decc] bg-white p-6 text-center shadow-soft sm:p-7">
        <Link to="/" className="mx-auto flex w-fit items-center justify-center">
          <img src={vbeeLogo} alt="Vbee" className="h-16 w-auto object-contain" />
        </Link>
        <div className="mx-auto mt-6 grid h-14 w-14 place-items-center rounded-full bg-[#fff8d7] text-[#725a00]">
          {status === "success" ? <CheckCircle2 className="h-7 w-7" /> : <MailCheck className="h-7 w-7" />}
        </div>
        <h1 className="mt-5 text-2xl font-black">
          {status === "success" ? "Xác thực thành công" : "Xác thực email"}
        </h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#756894]">{message}</p>
        <Link
          to={status === "success" ? "/dashboard" : "/login"}
          search={status === "success" ? undefined : { error: undefined, from }}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#ffcb05] px-5 py-3 text-sm font-black text-[#21104a] transition hover:bg-[#ffdc45]"
        >
          {status === "success" ? "Vào dashboard" : "Quay lại đăng nhập"}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </main>
  );
}
