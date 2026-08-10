import { useEffect, useState } from "react";

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:3001";

type SocialProvider = "google" | "facebook" | "apple";
type ProviderAvailability = Partial<Record<SocialProvider, boolean>>;

interface SocialAuthButtonsProps {
  mode: "login" | "register";
  referralCode?: string;
}

const PROVIDERS: Array<{
  id: SocialProvider;
  name: string;
  icon: "google" | "facebook" | "apple";
}> = [
  { id: "google", name: "Google", icon: "google" },
  { id: "facebook", name: "Facebook", icon: "facebook" },
  { id: "apple", name: "Apple", icon: "apple" },
];

function ProviderIcon({
  icon,
}: {
  icon: "google" | "facebook" | "apple";
}) {
  if (icon === "facebook") {
    return (
      <svg
        className="h-5 w-5 shrink-0"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="11" fill="#1877F2" />
        <path
          fill="#FFFFFF"
          d="M13.55 21v-8h2.7l.4-3h-3.1V8.08c0-.87.24-1.46 1.55-1.46h1.66V3.94c-.29-.04-1.27-.12-2.42-.12-2.39 0-4.03 1.46-4.03 4.14V10H7.6v3h2.71v8h3.24Z"
        />
      </svg>
    );
  }
  if (icon === "apple") {
    return (
      <svg
        className="h-5 w-5 shrink-0 fill-[#111111]"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.33 3.51 7.8 9.05 7.52c1.35.07 2.29.74 3.08.79 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 3.88ZM12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25Z" />
      </svg>
    );
  }
  return (
    <svg
      className="h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09A6.97 6.97 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A10.98 10.98 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l2.85-2.22.81-.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z"
      />
    </svg>
  );
}

export function SocialAuthButtons({
  mode,
  referralCode,
}: SocialAuthButtonsProps) {
  const [redirecting, setRedirecting] = useState<SocialProvider | null>(null);
  const [availability, setAvailability] = useState<ProviderAvailability>({});

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_URL}/api/auth/providers`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Không đọc được cấu hình OAuth");
        return (await response.json()) as ProviderAvailability;
      })
      .then(setAvailability)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // This status check is optional; a transient failure must not block OAuth.
      });

    return () => controller.abort();
  }, []);

  function startOAuth(provider: SocialProvider) {
    if (availability[provider] === false) return;
    setRedirecting(provider);
    const query = referralCode
      ? `?ref=${encodeURIComponent(referralCode)}`
      : "";
    window.location.href = `${API_URL}/api/auth/${provider}${query}`;
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {PROVIDERS.map((provider) => {
        const isCurrent = redirecting === provider.id;
        const isUnavailable = availability[provider.id] === false;
        const actionLabel = mode === "login" ? "Đăng nhập" : "Đăng ký";
        return (
          <button
            key={provider.id}
            type="button"
            onClick={() => startOAuth(provider.id)}
            disabled={redirecting !== null || isUnavailable}
            className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-border bg-white px-3 py-2.5 text-xs font-bold text-foreground transition hover:border-[#d8c984] hover:bg-[#fffdf5] disabled:cursor-not-allowed disabled:opacity-55"
            aria-label={`${actionLabel} bằng ${provider.name}${isUnavailable ? " - chưa được cấu hình" : ""}`}
            title={isUnavailable ? `${provider.name} chưa được cấu hình` : undefined}
          >
            {isCurrent ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#d9cfeb] border-t-[#21104a]" />
            ) : (
              <ProviderIcon icon={provider.icon} />
            )}
            <span>
              {isCurrent
                ? "Đang mở..."
                : isUnavailable
                  ? `${provider.name} (chưa cấu hình)`
                  : provider.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
