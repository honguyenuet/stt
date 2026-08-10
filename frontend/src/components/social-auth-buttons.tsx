import { useEffect, useState } from "react";
import { siApple, siFacebook, siGoogle } from "simple-icons";
import type { SimpleIcon } from "simple-icons";

import { BrandIcon } from "@/components/ui/app-icon";

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
  icon: SimpleIcon;
}> = [
  { id: "google", name: "Google", icon: siGoogle },
  { id: "facebook", name: "Facebook", icon: siFacebook },
  { id: "apple", name: "Apple", icon: siApple },
];

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
              <BrandIcon icon={provider.icon} size="md" tone="brand" />
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
