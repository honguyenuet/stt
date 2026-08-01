import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Clipboard,
  Code2,
  Copy,
  FileAudio,
  KeyRound,
  Loader2,
  LockKeyhole,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { AuthenticatedHeader } from "@/components/auth-app-header";
import {
  SPEECH_LANGUAGE_OPTIONS,
  TRANSLATION_LANGUAGE_OPTIONS,
  type TranslationResult,
} from "@/lib/language-options";

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:3001";

type ApiKeyItem = {
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
};

type ApiKeyResponse = ApiKeyItem & { key: string };

type ApiResult = {
  id?: number;
  provider?: string;
  providerId?: string;
  filename?: string;
  duration?: number | null;
  text?: string;
  sourceLanguage?: string;
  translation?: TranslationResult | null;
  translationError?: string;
  error?: string;
};

export const Route = createFileRoute("/api")({
  head: () => ({
    meta: [
      { title: "Vbee API — Tích hợp chuyển giọng nói thành văn bản vào hệ thống" },
      {
        name: "description",
        content:
          "Trang quản lý Vbee API key, tài liệu endpoint và khu vực test API chuyển âm thanh thành văn bản.",
      },
    ],
  }),
  component: ApiPage,
});

function formatDate(value: string | null) {
  if (!value) return "Chưa dùng";
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function ApiPage() {
  const { user, isLoading, token } = useAuth();
  const navigate = useNavigate();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [keyName, setKeyName] = useState("Ứng dụng chính");
  const [createdKey, setCreatedKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  const [testKey, setTestKey] = useState("");
  const [testFile, setTestFile] = useState<File | null>(null);
  const [speakerLabels, setSpeakerLabels] = useState(false);
  const [testLanguage, setTestLanguage] = useState("auto");
  const [testTranslateTo, setTestTranslateTo] = useState("none");
  const [testing, setTesting] = useState(false);
  const [apiResult, setApiResult] = useState<ApiResult | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      void navigate({
        to: "/login",
        search: { error: undefined, from: "/api" },
      });
    }
  }, [isLoading, user, navigate]);

  async function loadKeys() {
    if (!token) return;
    setLoadingKeys(true);
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/api/keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as ApiKeyItem[] | { error?: string };
      if (!res.ok || !Array.isArray(data)) {
        setMessage(
          (data as { error?: string }).error ?? "Không tải được API key",
        );
        return;
      }
      setKeys(data);
    } catch {
      setMessage("Không kết nối được backend API");
    } finally {
      setLoadingKeys(false);
    }
  }

  useEffect(() => {
    if (user && token) void loadKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, token]);

  async function createKey() {
    if (!token) return;
    setCreating(true);
    setMessage("");
    setCreatedKey("");
    try {
      const res = await fetch(`${API_URL}/api/keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: keyName }),
      });
      const data = (await res.json()) as ApiKeyResponse | { error?: string };
      if (!res.ok || !("key" in data)) {
        setMessage(
          (data as { error?: string }).error ?? "Không tạo được API key",
        );
        return;
      }
      setCreatedKey(data.key);
      setTestKey(data.key);
      setMessage(
        "Đã tạo API key. Hãy copy ngay vì key đầy đủ chỉ hiển thị một lần.",
      );
      await loadKeys();
    } catch {
      setMessage("Không kết nối được backend API");
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: number) {
    if (!token) return;
    const ok = window.confirm(
      "Thu hồi API key này? Các ứng dụng đang dùng key này sẽ không gọi API được nữa.",
    );
    if (!ok) return;
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/api/keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setMessage(data.error ?? "Không thu hồi được API key");
        return;
      }
      setKeys((prev) => prev.filter((item) => item.id !== id));
      setMessage("Đã thu hồi API key");
    } catch {
      setMessage("Không kết nối được backend API");
    }
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function testApi() {
    if (!testKey.trim()) {
      setApiResult({ error: "Vui lòng nhập API key để test" });
      return;
    }
    if (!testFile) {
      setApiResult({ error: "Vui lòng chọn file audio/video" });
      return;
    }

    const formData = new FormData();
    formData.append("audio", testFile);
    formData.append("speakerLabels", String(speakerLabels));
    formData.append("language", testLanguage);
    formData.append("translateTo", testTranslateTo);

    setTesting(true);
    setApiResult(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/transcribe`, {
        method: "POST",
        headers: { "x-api-key": testKey.trim() },
        body: formData,
      });
      const data = (await res.json()) as ApiResult;
      setApiResult(data);
    } catch {
      setApiResult({
        error:
          "Không gọi được API. Kiểm tra backend và key nhà cung cấp trong backend/.env.",
      });
    } finally {
      setTesting(false);
    }
  }

  const curlSample = useMemo(() => {
    const key = createdKey || "vbee_sk_YOUR_API_KEY";
    return `curl -X POST ${API_URL}/api/v1/transcribe \\\n  -H "x-api-key: ${key}" \\\n  -F "audio=@meeting.mp3" \\\n  -F "speakerLabels=true" \\\n  -F "language=auto" \\\n  -F "translateTo=en" \\\n  -F "callbackUrl=https://example.com/webhooks/vbee" \\\n  -F "callbackSecret=replace-with-at-least-16-characters"`;
  }, [createdKey]);

  const jsSample = useMemo(() => {
    const key = createdKey || "vbee_sk_YOUR_API_KEY";
    return `const formData = new FormData();\nformData.append("audio", file);\nformData.append("speakerLabels", "true");\nformData.append("language", "auto");\nformData.append("translateTo", "en");\nformData.append("callbackUrl", "https://example.com/webhooks/vbee");\nformData.append("callbackSecret", "replace-with-at-least-16-characters");\n\nconst res = await fetch("${API_URL}/api/v1/transcribe", {\n  method: "POST",\n  headers: { "x-api-key": "${key}" },\n  body: formData,\n});\n\nconst data = await res.json();\nconsole.log(data.jobId);\n// Vbee gửi transcription.completed hoặc transcription.failed đến callbackUrl.`;
  }, [createdKey]);

  if (isLoading || (!user && !token)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-3 h-6 w-6 animate-spin" /> Đang kiểm tra đăng
        nhập...
      </div>
    );
  }

  if (!user) return null;

  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <AuthenticatedHeader />

      <section className="relative overflow-hidden bg-gradient-hero text-foreground">
        <div className="absolute -left-24 top-10 h-56 w-56 rounded-full bg-[#ffcb05]/18 blur-3xl" />
        <div className="absolute -right-16 bottom-0 h-56 w-56 rounded-full bg-[#21104a]/8 blur-3xl" />
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-[1fr_.85fr] md:px-6 md:py-12">
          <div className="relative z-10 min-w-0">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-bold text-primary">
              <PlugZap className="h-4 w-4" /> API chuyển giọng nói thành văn bản của Vbee
            </div>
            <h1 className="max-w-3xl text-2xl font-black leading-tight md:text-3xl">
              Tích hợp chuyển âm thanh thành văn bản vào sản phẩm của bạn.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
              Tạo và thu hồi API key, kiểm thử endpoint và tham khảo ví dụ tích
              hợp ngay tại đây. Đội kỹ thuật cấu hình nhà cung cấp nhận dạng
              giọng nói phù hợp trong môi trường máy chủ để bắt đầu xử lý file.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="#keys"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-black text-primary-foreground shadow-glow"
              >
                Tạo API key <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="#docs"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-5 py-2.5 font-black text-foreground hover:bg-primary/5"
              >
                Xem tài liệu <Code2 className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div className="relative z-10 min-w-0 rounded-lg border border-border bg-white p-4 text-foreground shadow-soft">
            <div className="min-w-0 rounded-lg bg-[#fbf8ef] p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <KeyRound className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="font-black">API endpoint</div>
                    <div className="text-sm text-muted-foreground">
                      POST /api/v1/transcribe
                    </div>
                  </div>
                </div>
                <span className="rounded-full bg-[#dcfce7] px-3 py-1 text-xs font-black text-[#166534]">
                  Sẵn sàng
                </span>
              </div>
              <pre className="max-w-full overflow-x-auto rounded-lg bg-white p-4 text-xs leading-6 text-primary">
                <code>{curlSample}</code>
              </pre>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  [ShieldCheck, "Key bảo mật", "Lưu hash SHA-256"],
                  [FileAudio, "Tải âm thanh lên", "MP3, WAV, M4A, MP4"],
                  [
                    Zap,
                    "Webhook kết quả",
                    "Ký HMAC SHA-256 qua X-Vbee-Signature",
                  ],
                ].map(([Icon, title, desc]) => (
                  <div
                    key={String(title)}
                    className="rounded-lg border border-border bg-white p-3 shadow-sm"
                  >
                    <Icon className="mb-2 h-5 w-5 text-primary" />
                    <div className="font-black">{String(title)}</div>
                    <div className="text-sm text-muted-foreground">
                      {String(desc)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="keys"
        className="mx-auto grid max-w-7xl gap-5 px-4 py-10 md:grid-cols-[.9fr_1.1fr] md:px-6"
      >
        <div className="min-w-0 rounded-lg border border-border bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <KeyRound className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-xl font-black">Tạo API key</h2>
              <p className="text-sm text-muted-foreground">
                Key đầy đủ chỉ hiện một lần sau khi tạo.
              </p>
            </div>
          </div>

          <label className="text-sm font-black">Tên API key</label>
          <input
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            className="mt-2 w-full rounded-lg border border-border bg-[#fbf8ef] px-4 py-2.5 font-semibold outline-none focus:border-primary"
            placeholder="VD: Website chính, ứng dụng di động, CRM..."
          />
          <button
            onClick={createKey}
            disabled={creating}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 font-black text-primary-foreground shadow-glow disabled:opacity-60"
          >
            {creating ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
            Tạo API key mới
          </button>

          {message && (
            <p className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm font-bold text-primary">
              {message}
            </p>
          )}

          {createdKey && (
            <div className="mt-5 rounded-lg border border-primary/25 bg-primary/5 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-black text-foreground">
                  API key vừa tạo
                </span>
                <button
                  onClick={() => void copyText(createdKey)}
                  className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-black text-primary-foreground"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Đã copy" : "Copy"}
                </button>
              </div>
              <code className="block break-all rounded-xl border border-border bg-card p-3 text-sm font-bold text-foreground">
                {createdKey}
              </code>
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-lg border border-border bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Danh sách API key</h2>
              <p className="text-sm text-muted-foreground">
                Quản lý key đang hoạt động trong tài khoản của bạn.
              </p>
            </div>
            <button
              onClick={() => void loadKeys()}
              className="rounded-full border border-border p-2 hover:bg-primary/10"
              title="Tải lại"
            >
              <RefreshCw
                className={`h-5 w-5 ${loadingKeys ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          <div className="space-y-3">
            {keys.length === 0 && (
              <div className="rounded-lg border border-border bg-[#fbf8ef] p-4 text-sm font-bold text-muted-foreground">
                Chưa có API key. Tạo một key mới để gọi endpoint
                /api/v1/transcribe.
              </div>
            )}
            {keys.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-[#fbf8ef] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-black">{item.name}</div>
                  <div className="mt-1 font-mono text-sm text-primary">
                    {item.key_prefix}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-muted-foreground">
                    Tạo: {formatDate(item.created_at)} · Dùng gần nhất:{" "}
                    {formatDate(item.last_used_at)}
                  </div>
                </div>
                <button
                  onClick={() => void revokeKey(item.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm font-black text-red-600 hover:bg-red-100"
                >
                  <Trash2 className="h-4 w-4" /> Thu hồi
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="docs"
        className="mx-auto grid max-w-7xl gap-5 px-4 pb-10 md:grid-cols-2 md:px-6"
      >
        <DocCard title="cURL" code={curlSample} onCopy={copyText} />
        <DocCard title="JavaScript" code={jsSample} onCopy={copyText} />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-12 md:px-6">
        <div className="grid gap-5 rounded-lg border border-border bg-white p-5 text-foreground shadow-soft md:grid-cols-[.9fr_1.1fr] md:p-6">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-black text-primary">
              <UploadCloud className="h-4 w-4" /> Kiểm thử API thật
            </div>
            <h2 className="text-xl font-black">
              Gọi thử endpoint bằng API key
            </h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              Chọn file audio/video, nhập API key, sau đó gửi request tới
              backend. Kết quả trả về là JSON để tích hợp trực tiếp vào website
              hoặc ứng dụng riêng.
            </p>
          </div>

          <div className="min-w-0 rounded-lg border border-border bg-[#fbf8ef] p-4 text-foreground">
            <label className="text-sm font-black">API key</label>
            <input
              value={testKey}
              onChange={(e) => setTestKey(e.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-white px-4 py-2.5 font-semibold outline-none focus:border-primary"
              placeholder="vbee_sk_..."
            />

            <label className="mt-4 block text-sm font-black">
              File audio/video
            </label>
            <input
              type="file"
              accept=".mp3,.wav,.m4a,.ogg,.flac,.aac,.mp4,.webm,audio/*,video/*"
              onChange={(e) => setTestFile(e.target.files?.[0] ?? null)}
              className="mt-2 w-full rounded-lg border border-dashed border-border bg-white px-4 py-2.5 text-sm font-semibold"
            />

            <label className="mt-4 flex items-center gap-3 text-sm font-bold text-muted-foreground">
              <input
                type="checkbox"
                checked={speakerLabels}
                onChange={(e) => setSpeakerLabels(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Nhận diện nhiều người nói
            </label>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-black">
                Ngôn ngữ âm thanh
                <select
                  value={testLanguage}
                  onChange={(e) => setTestLanguage(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-white px-4 py-2.5 font-semibold outline-none focus:border-primary"
                >
                  {SPEECH_LANGUAGE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-black">
                Dịch sang
                <select
                  value={testTranslateTo}
                  onChange={(e) => setTestTranslateTo(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-white px-4 py-2.5 font-semibold outline-none focus:border-primary"
                >
                  {TRANSLATION_LANGUAGE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              onClick={testApi}
              disabled={testing}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 font-black text-primary-foreground shadow-glow disabled:opacity-60"
            >
              {testing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Zap className="h-5 w-5" />
              )}
              Gọi API
            </button>

            {apiResult && (
              <div
                className={`mt-5 rounded-lg p-4 ${apiResult.error ? "bg-destructive/10 text-destructive" : "bg-primary/5 text-primary"}`}
              >
                <div className="mb-2 flex items-center gap-2 font-black">
                  {apiResult.error ? (
                    <X className="h-5 w-5" />
                  ) : (
                    <Check className="h-5 w-5" />
                  )}
                  {apiResult.error ? "API lỗi" : "API thành công"}
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-card p-3 text-xs leading-5">
                  {JSON.stringify(apiResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function DocCard({
  title,
  code,
  onCopy,
}: {
  title: string;
  code: string;
  onCopy: (value: string) => Promise<void>;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-white p-4 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xl font-black">
          <Code2 className="h-5 w-5" /> {title}
        </div>
        <button
          onClick={() => void onCopy(code)}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-background/45 px-3 py-2 text-xs font-black hover:bg-primary/10"
        >
          <Clipboard className="h-4 w-4" /> Sao chép
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto rounded-lg bg-[#fbf8ef] p-4 text-xs leading-6 text-primary">
        <code>{code}</code>
      </pre>
    </div>
  );
}
