import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Check, Languages, X } from "lucide-react";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import {
  VbeePreferencesFooter,
  VbeePreferencesSidebar,
} from "@/components/vbee-preferences-layout";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

type TimecodeOffset = "yes" | "no";
type SpellingPreference = "american" | "australian" | "british";
type BinarySetting = "yes" | "no";

interface TranscriptionSettings {
  timecodeOffset: TimecodeOffset;
  spellingPreference: SpellingPreference;
  fillerWords: BinarySetting;
  profanityFilter: BinarySetting;
}

interface SettingsPayload {
  transcriptionSettings: TranscriptionSettings;
  error?: string;
}

const DEFAULT_SETTINGS: TranscriptionSettings = {
  timecodeOffset: "no",
  spellingPreference: "american",
  fillerWords: "yes",
  profanityFilter: "no",
};

export const Route = createFileRoute("/transcription-settings")({
  component: TranscriptionSettingsPage,
});

function SettingBlock({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border py-7 last:border-b-0">
      {eyebrow && (
        <p className="mb-2 text-sm font-semibold text-muted-foreground">
          {eyebrow}
        </p>
      )}
      <h2 className="text-lg font-black uppercase tracking-[0.08em]">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
        {description}
      </p>
      <div className="mt-3 max-w-2xl">{children}</div>
    </div>
  );
}

function TranscriptionSettingsPage() {
  const { user, isLoading, token } = useAuth();
  const navigate = useNavigate();
  const [settings, setSettings] =
    useState<TranscriptionSettings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] =
    useState<TranscriptionSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoading && !user) {
      void navigate({
        to: "/login",
        search: { error: undefined, from: "/transcription-settings" },
      });
    }
  }, [user, isLoading, navigate]);

  useEffect(() => {
    if (!token) return;
    let ignore = false;
    setLoading(true);
    setError("");
    void fetch(`${API_URL}/api/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = (await res.json()) as SettingsPayload;
        if (!res.ok) throw new Error(data.error || "Không tải được cài đặt");
        if (ignore) return;
        const next = data.transcriptionSettings || DEFAULT_SETTINGS;
        setSettings(next);
        setSavedSettings(next);
      })
      .catch((loadError: unknown) => {
        if (ignore) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Không tải được cài đặt văn bản",
        );
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [token]);

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/settings/transcription`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ transcriptionSettings: settings }),
      });
      const data = (await res.json()) as SettingsPayload;
      if (!res.ok) throw new Error(data.error || "Không lưu được cài đặt");
      const next = data.transcriptionSettings || settings;
      setSettings(next);
      setSavedSettings(next);
      setMessage("Đã lưu cài đặt văn bản");
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Không lưu được cài đặt văn bản",
      );
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AuthenticatedHeader />

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-6 md:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <section className="min-w-0">
          <div className="mb-5 border-b-2 border-[#ffcb05] pb-4">
            <h1 className="text-2xl font-light tracking-tight md:text-3xl">
              Cài đặt văn bản
            </h1>
          </div>

          <div className="max-w-3xl rounded-lg border border-border bg-white px-5 shadow-soft sm:px-6">
            <SettingBlock
              title="Tự động điều chỉnh mốc thời gian từ dữ liệu mô tả"
              description="Mốc thời gian ảnh hưởng đến thời điểm bắt đầu của tệp và toàn bộ thời điểm theo từng từ. Bạn có thể để văn bản bắt đầu từ 00:00:00.000 hoặc dùng dữ liệu mô tả của tệp."
            >
              <select
                value={settings.timecodeOffset}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    timecodeOffset: event.target.value as TimecodeOffset,
                  }))
                }
                className="w-full rounded-md border border-border bg-[#fbf8ef] px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-primary"
              >
                <option value="yes">
                  CÓ: Tự động điều chỉnh mốc thời gian
                </option>
                <option value="no">
                  KHÔNG: Bắt đầu từ 00:00:00.000 (mặc định)
                </option>
              </select>
            </SettingBlock>

            <SettingBlock
              eyebrow="🇺🇸 🇬🇧 🇦🇺 Chỉ áp dụng cho văn bản tiếng Anh"
              title="Kiểu chính tả tiếng Anh"
              description="Từ điển riêng luôn được ưu tiên. Chọn kiểu chính tả mong muốn khi tạo văn bản tiếng Anh."
            >
              <select
                value={settings.spellingPreference}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    spellingPreference: event.target
                      .value as SpellingPreference,
                  }))
                }
                className="w-full rounded-md border border-border bg-[#fbf8ef] px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-primary"
              >
                <option value="american">Chính tả Mỹ</option>
                <option value="australian">Chính tả Úc</option>
                <option value="british">Chính tả Anh</option>
              </select>
            </SettingBlock>

            <SettingBlock
              eyebrow="🇺🇸 🇬🇧 🇦🇺 Chỉ áp dụng cho văn bản tiếng Anh"
              title="Từ đệm khi nói"
              description='Các âm ngập ngừng như "ưm", "à" và "ừm" có thể được giữ lại hoặc bỏ qua trong văn bản.'
            >
              <select
                value={settings.fillerWords}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    fillerWords: event.target.value as BinarySetting,
                  }))
                }
                className="w-full rounded-md border border-border bg-[#fbf8ef] px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-primary"
              >
                <option value="yes">
                  CÓ: Giữ từ đệm trong văn bản (mặc định)
                </option>
                <option value="no">KHÔNG: Bỏ qua từ đệm</option>
              </select>
            </SettingBlock>

            <SettingBlock
              eyebrow="🇺🇸 🇬🇧 🇪🇸 🇲🇽 🇮🇹 Áp dụng cho tiếng Anh, Tây Ban Nha và Ý"
              title="Bộ lọc từ nhạy cảm"
              description="Ẩn từ nhạy cảm bằng cách chỉ hiển thị chữ cái đầu và các dấu sao, giúp văn bản phù hợp hơn khi chia sẻ."
            >
              <select
                value={settings.profanityFilter}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    profanityFilter: event.target.value as BinarySetting,
                  }))
                }
                className="w-full rounded-md border border-border bg-[#fbf8ef] px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-primary"
              >
                <option value="no">
                  KHÔNG: Giữ nguyên từ nhạy cảm (mặc định)
                </option>
                <option value="yes">CÓ: Ẩn từ nhạy cảm</option>
              </select>
            </SettingBlock>
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-[#fbf8ef] px-4 py-3 text-sm text-muted-foreground">
            <Languages className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Các lựa chọn được lưu theo từng tài khoản và áp dụng cho những
              văn bản mới. Một số cài đặt có thể phụ thuộc vào nhà cung cấp
              nhận dạng giọng nói mà doanh nghiệp đang sử dụng.
            </p>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
              {error}
            </div>
          )}
          {message && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
              {message}
            </div>
          )}

          <div className="mt-5 grid max-w-3xl gap-3 sm:grid-cols-2">
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Check className="h-4 w-4" />
              {saving ? "ĐANG LƯU..." : "LƯU CÀI ĐẶT VĂN BẢN"}
            </button>
            <button
              onClick={() => {
                setSettings(savedSettings);
                setMessage("");
                setError("");
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-white px-5 py-3 text-sm font-black text-muted-foreground transition hover:border-primary/50 hover:text-primary"
            >
              <X className="h-4 w-4" />
              HỦY
            </button>
          </div>
        </section>

        <VbeePreferencesSidebar firstName={user.firstName} />
      </main>

      <VbeePreferencesFooter />
    </div>
  );
}
