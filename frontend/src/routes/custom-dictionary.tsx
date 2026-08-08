import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, HelpCircle, X } from "lucide-react";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import {
  VbeePreferencesFooter,
  VbeePreferencesSidebar,
} from "@/components/vbee-preferences-layout";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/api-base-url";

const API_URL = getApiBaseUrl();

interface SettingsPayload {
  customDictionary: string;
  entriesCount?: number;
  error?: string;
}

export const Route = createFileRoute("/custom-dictionary")({
  component: CustomDictionaryPage,
});

function countEntries(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function CustomDictionaryPage() {
  const { user, isLoading, token } = useAuth();
  const navigate = useNavigate();
  const [dictionary, setDictionary] = useState("");
  const [savedDictionary, setSavedDictionary] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoading && !user) {
      void navigate({
        to: "/login",
        search: { error: undefined, from: "/custom-dictionary" },
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
        if (!res.ok) throw new Error(data.error || "Không tải được settings");
        if (ignore) return;
        setDictionary(data.customDictionary || "");
        setSavedDictionary(data.customDictionary || "");
      })
      .catch((loadError: unknown) => {
        if (ignore) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Không tải được custom dictionary",
        );
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [token]);

  const entryCount = useMemo(() => countEntries(dictionary), [dictionary]);
  const lineCount = Math.max(1, dictionary.split(/\r?\n/).length);
  const isOverLimit = entryCount > 400;

  async function handleSave() {
    if (!token || isOverLimit) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/settings/dictionary`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ customDictionary: dictionary }),
      });
      const data = (await res.json()) as SettingsPayload;
      if (!res.ok) throw new Error(data.error || "Không lưu được dictionary");
      setDictionary(data.customDictionary || "");
      setSavedDictionary(data.customDictionary || "");
      setMessage(`Đã lưu ${data.entriesCount ?? entryCount} mục dictionary`);
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Không lưu được custom dictionary",
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

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-6 md:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          <div className="mb-5 border-b-2 border-[#ffcb05] pb-4">
            <h1 className="text-2xl font-light tracking-tight md:text-3xl">
              Từ điển riêng
            </h1>
          </div>

          <div className="max-w-3xl">
            <p className="text-sm leading-7 text-muted-foreground">
              Thêm các từ hoặc cụm từ thường xuất hiện trong file của bạn.
              Vbee sẽ ưu tiên nhận diện các tên riêng, thuật ngữ chuyên ngành,
              cụm từ hiếm và cách viết đặc biệt khi chuyển giọng nói thành văn bản.
            </p>

            <div className="mt-6">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-black uppercase tracking-[0.08em]">
                    Từ điển chính
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-muted-foreground">
                    Mỗi dòng một từ hoặc cụm từ. Áp dụng cho mọi ngôn ngữ.
                    Tối đa 400 mục.
                  </p>
                </div>
                <span
                  className={`text-sm font-black ${
                    isOverLimit ? "text-destructive" : "text-primary"
                  }`}
                >
                  {entryCount}/400
                </span>
              </div>

              <div className="overflow-hidden rounded-t-lg border border-border bg-white">
                <div className="grid min-h-[300px] grid-cols-[48px_1fr]">
                  <div className="select-none border-r border-border bg-[#fbf8ef] px-3 py-4 text-right font-mono text-xs leading-6 text-muted-foreground/70">
                    {Array.from({ length: lineCount }, (_, index) => (
                      <div key={index}>{index + 1}</div>
                    ))}
                  </div>
                  <textarea
                    value={dictionary}
                    onChange={(event) => setDictionary(event.target.value)}
                    placeholder="Mỗi dòng một từ hoặc cụm từ"
                    className="min-h-[300px] w-full resize-y bg-transparent px-4 py-4 font-mono text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/50"
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="rounded-b-lg border-x border-b border-border bg-[#fbf8ef] px-4 py-3">
                <div className="flex gap-3 text-sm leading-6">
                  <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <p className="text-muted-foreground">
                    <span className="font-black text-foreground">
                      Thêm từ mới vào từ điển nhanh hơn:
                    </span>{" "}
                    khi biên tập transcript, hãy lưu các từ quan trọng vào đây
                    để Vbee ưu tiên nhận diện trong các lần xử lý sau.
                  </p>
                </div>
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
              {isOverLimit && (
                <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
                  Dictionary vượt 400 mục. Hãy rút gọn trước khi lưu.
                </div>
              )}

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => void handleSave()}
                  disabled={saving || isOverLimit}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-black text-primary-foreground shadow-glow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Check className="h-4 w-4" />
                  {saving ? "ĐANG LƯU..." : "LƯU TỪ ĐIỂN RIÊNG"}
                </button>
                <button
                  onClick={() => {
                    setDictionary(savedDictionary);
                    setMessage("");
                    setError("");
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-white px-5 py-3 text-sm font-black text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                >
                  <X className="h-4 w-4" />
                  HỦY
                </button>
              </div>
            </div>
          </div>
        </section>

        <VbeePreferencesSidebar firstName={user.firstName} />
      </main>

      <VbeePreferencesFooter />
    </div>
  );
}
