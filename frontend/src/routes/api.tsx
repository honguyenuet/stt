import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { getApiBaseUrl } from "@/lib/api-base-url";
import {
  ArrowRight,
  BarChart3,
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

const API_URL = getApiBaseUrl();

type ApiKeyItem = {
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
};

type ApiKeyResponse = ApiKeyItem & { key: string };

type ApiUsageKey = {
  id: number;
  name: string;
  keyPrefix: string;
  requests: number;
  completed: number;
  failed: number;
  processedSeconds: number;
  lastEventAt: string | null;
};

type ApiUsageDaily = {
  date: string;
  requests: number;
  completed: number;
  failed: number;
  processedSeconds: number;
};

type ApiUsageSummary = {
  rangeDays: number;
  totals: {
    requests: number;
    completed: number;
    failed: number;
    processedSeconds: number;
  };
  keys: ApiUsageKey[];
  daily: ApiUsageDaily[];
};

type WebhookDelivery = {
  id: number;
  jobId: number | null;
  transcriptionId: number | null;
  event: string;
  callbackUrl: string;
  status: "pending" | "delivered" | "failed";
  responseStatus: number | null;
  attempts: number;
  errorMessage: string | null;
  deliveredAt: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
};

type ApiResult = {
  object?: "transcription" | "transcription_job";
  id?: number;
  jobId?: number;
  provider?: string;
  providerId?: string;
  filename?: string;
  status?: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress?: number;
  queuePosition?: number;
  estimatedRemainingSeconds?: number | null;
  expectedDurationSeconds?: number;
  duration?: number | null;
  text?: string;
  sourceLanguage?: string;
  translation?: TranslationResult | null;
  translationError?: string;
  message?: string;
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

function formatMinutes(seconds: number) {
  const minutes = Math.round((seconds / 60) * 10) / 10;
  return `${minutes.toLocaleString("vi-VN")} phút`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  const [usage, setUsage] = useState<ApiUsageSummary | null>(null);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);
  const [webhookLoading, setWebhookLoading] = useState(false);

  const [testKey, setTestKey] = useState("");
  const [testFile, setTestFile] = useState<File | null>(null);
  const [speakerLabels, setSpeakerLabels] = useState(false);
  const [testLanguage, setTestLanguage] = useState("auto");
  const [testTranslateTo, setTestTranslateTo] = useState("none");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [callbackSecret, setCallbackSecret] = useState("");
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
      void loadUsage();
      void loadWebhookDeliveries();
    } catch {
      setMessage("Không kết nối được backend API");
    } finally {
      setLoadingKeys(false);
    }
  }

  async function loadUsage() {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/keys/usage`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as ApiUsageSummary | { error?: string };
      if (res.ok && "totals" in data) setUsage(data);
    } catch {
      setUsage(null);
    }
  }

  async function loadWebhookDeliveries() {
    const key = testKey.trim() || createdKey;
    if (!key) return;
    setWebhookLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/webhooks/deliveries?limit=20`, {
        headers: { "x-api-key": key },
      });
      const data = (await res.json()) as
        | { data?: WebhookDelivery[] }
        | { error?: string };
      if (res.ok && Array.isArray((data as { data?: WebhookDelivery[] }).data)) {
        setWebhookDeliveries((data as { data: WebhookDelivery[] }).data);
      }
    } catch {
      setWebhookDeliveries([]);
    } finally {
      setWebhookLoading(false);
    }
  }

  async function replayWebhookDelivery(deliveryId: number) {
    const key = testKey.trim() || createdKey;
    if (!key) {
      setMessage("Nhập API key ở khu vực test để replay webhook");
      return;
    }
    try {
      const res = await fetch(
        `${API_URL}/api/v1/webhooks/deliveries/${deliveryId}/replay`,
        {
          method: "POST",
          headers: { "x-api-key": key },
        },
      );
      const data = (await res.json()) as { error?: string };
      setMessage(res.ok ? "Đã replay webhook" : data.error || "Không replay được webhook");
      await loadWebhookDeliveries();
    } catch {
      setMessage("Không kết nối được backend API");
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
    if (callbackUrl.trim()) formData.append("callbackUrl", callbackUrl.trim());
    if (callbackSecret.trim())
      formData.append("callbackSecret", callbackSecret.trim());

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
      void loadWebhookDeliveries();
      const jobId = data.jobId ?? data.id;
      if (
        res.ok &&
        jobId &&
        (data.object === "transcription_job" || data.status === "queued")
      ) {
        for (let attempt = 0; attempt < 45; attempt += 1) {
          await delay(2000);
          const statusResponse = await fetch(
            `${API_URL}/api/v1/transcribe/jobs/${jobId}`,
            { headers: { "x-api-key": testKey.trim() } },
          );
          const statusData = (await statusResponse.json()) as ApiResult;
          setApiResult(statusData);
          if (
            !statusResponse.ok ||
            ["completed", "failed", "cancelled"].includes(
              String(statusData.status || ""),
            )
          ) {
            return;
          }
        }
        setApiResult((current) => ({
          ...current,
          message:
            "Job vẫn đang xử lý. Dùng endpoint status để tiếp tục theo dõi kết quả.",
        }));
      }
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
    return `curl -X POST ${API_URL}/api/v1/transcribe \\\n  -H "x-api-key: ${key}" \\\n  -F "audio=@meeting.mp3" \\\n  -F "async=true" \\\n  -F "speakerLabels=true" \\\n  -F "language=auto" \\\n  -F "translateTo=en" \\\n  -F "callbackUrl=https://your-app.com/webhooks/vbee" \\\n  -F "callbackSecret=replace-with-random-secret"`;
  }, [createdKey]);

  const jsSample = useMemo(() => {
    const key = createdKey || "vbee_sk_YOUR_API_KEY";
    return `class VbeeClient {\n  constructor(apiKey, baseUrl = "${API_URL}") {\n    this.apiKey = apiKey;\n    this.baseUrl = baseUrl;\n  }\n\n  async transcribe(file, options = {}) {\n    const form = new FormData();\n    form.append("audio", file);\n    form.append("async", "true");\n    for (const [key, value] of Object.entries(options)) {\n      if (value !== undefined && value !== null && value !== "") {\n        form.append(key, String(value));\n      }\n    }\n    const res = await fetch(\`\${this.baseUrl}/api/v1/transcribe\`, {\n      method: "POST",\n      headers: { "x-api-key": this.apiKey },\n      body: form,\n    });\n    const data = await res.json();\n    if (!res.ok) throw new Error(data.error || "Transcription failed");\n    return data;\n  }\n\n  async getJob(jobId) {\n    const res = await fetch(\`\${this.baseUrl}/api/v1/transcribe/jobs/\${jobId}\`, {\n      headers: { "x-api-key": this.apiKey },\n    });\n    const data = await res.json();\n    if (!res.ok) throw new Error(data.error || "Cannot load job");\n    return data;\n  }\n\n  async waitForJob(jobId, { intervalMs = 2000, maxAttempts = 90 } = {}) {\n    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {\n      const job = await this.getJob(jobId);\n      if (["completed", "failed", "cancelled"].includes(job.status)) return job;\n      await new Promise((resolve) => setTimeout(resolve, intervalMs));\n    }\n    throw new Error("Job is still processing");\n  }\n}\n\nconst client = new VbeeClient("${key}");\nconst job = await client.transcribe(file, {\n  speakerLabels: true,\n  language: "auto",\n  translateTo: "en",\n  callbackUrl: "https://your-app.com/webhooks/vbee",\n  callbackSecret: "replace-with-random-secret",\n});\nconst result = await client.waitForJob(job.jobId);\nconsole.log(result.text, result.translation?.text);`;
  }, [createdKey]);

  const webhookSample = useMemo(
    () =>
      `import crypto from "node:crypto";\nimport express from "express";\n\nconst app = express();\nconst secret = process.env.VBEE_WEBHOOK_SECRET;\n\napp.post(\n  "/webhooks/vbee",\n  express.raw({ type: "application/json" }),\n  (req, res) => {\n    const expected = "sha256=" + crypto\n      .createHmac("sha256", secret)\n      .update(req.body)\n      .digest("hex");\n    const received = req.header("x-vbee-signature") || "";\n    const expectedBuffer = Buffer.from(expected);\n    const receivedBuffer = Buffer.from(received);\n\n    if (\n      expectedBuffer.length !== receivedBuffer.length ||\n      !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)\n    ) {\n      return res.status(401).send("Invalid signature");\n    }\n\n    const event = req.header("x-vbee-event");\n    const payload = JSON.parse(req.body.toString("utf8"));\n    if (event === "transcription.completed") {\n      console.log(payload.data.jobId, payload.data.text, payload.data.words);\n    }\n    if (event === "transcription.failed") {\n      console.error(payload.data.jobId, payload.data.error);\n    }\n    res.sendStatus(204);\n  },\n);`,
    [],
  );

  const pollingSample = useMemo(
    () =>
      `GET ${API_URL}/api/v1/transcribe/jobs/{jobId}\nHeader: x-api-key: vbee_sk_YOUR_API_KEY\n\nResponse khi đang xử lý:\n{\n  "object": "transcription_job",\n  "jobId": 123,\n  "status": "processing",\n  "progress": 45,\n  "queuePosition": 1,\n  "estimatedRemainingSeconds": 80\n}\n\nResponse khi hoàn tất có thêm text, words và translation nếu request có translateTo.`,
    [],
  );

  if (isLoading || (!user && !token)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-foreground">
        <Loader2 className="mr-3 h-6 w-6 animate-spin" /> Đang kiểm tra đăng
        nhập...
      </div>
    );
  }

  if (!user) return null;

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-foreground">
      <AuthenticatedHeader />

      <section className="relative overflow-hidden bg-white text-foreground">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-[1fr_.85fr] md:px-6 md:py-12">
          <div className="relative z-10 min-w-0">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm font-bold text-primary">
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
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-black text-primary-foreground"
              >
                Tạo API key <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="#docs"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-5 py-2.5 font-black text-foreground hover:border-primary/50"
              >
                Xem tài liệu <Code2 className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div className="relative z-10 min-w-0 rounded-lg border border-border bg-white p-4 text-foreground shadow-soft">
            <div className="min-w-0 rounded-lg bg-white p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-white text-primary">
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
                  [Zap, "Nhà cung cấp linh hoạt", "Deepgram, AssemblyAI, Google STT"],
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
            className="mt-2 w-full rounded-lg border border-border bg-white px-4 py-2.5 font-semibold outline-none focus:border-primary"
            placeholder="VD: Website chính, ứng dụng di động, CRM..."
          />
          <button
            onClick={createKey}
            disabled={creating}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 font-black text-primary-foreground disabled:opacity-60"
          >
            {creating ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <PlugZap className="h-5 w-5" />
            )}
            Tạo API key mới
          </button>

          {message && (
            <p className="mt-4 rounded-lg border border-primary/25 bg-white p-3 text-sm font-bold text-primary">
              {message}
            </p>
          )}

          {createdKey && (
            <div className="mt-5 rounded-lg border border-primary/25 bg-white p-4">
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
              <code className="block break-all rounded-xl border border-border bg-white p-3 text-sm font-bold text-foreground">
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
              className="rounded-full border border-border bg-white p-2 hover:border-primary/50"
              title="Tải lại"
            >
              <RefreshCw
                className={`h-5 w-5 ${loadingKeys ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          <div className="space-y-3">
            {keys.length === 0 && (
              <div className="rounded-lg border border-border bg-white p-4 text-sm font-bold text-muted-foreground">
                Chưa có API key. Tạo một key mới để gọi endpoint
                /api/v1/transcribe.
              </div>
            )}
            {keys.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
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

      <section className="mx-auto max-w-7xl px-4 pb-10 md:px-6">
        <div className="rounded-lg border border-border bg-white p-5 shadow-soft">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm font-black text-primary">
                <BarChart3 className="h-4 w-4" /> Usage analytics
              </div>
              <h2 className="text-xl font-black">Thống kê API key 30 ngày</h2>
            </div>
            <button
              onClick={() => void loadUsage()}
              className="rounded-full border border-border bg-white p-2 hover:border-primary/50"
              title="Tải lại thống kê"
            >
              <RefreshCw className="h-5 w-5" />
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            {[
              ["Request", usage?.totals.requests ?? 0],
              ["Hoàn tất", usage?.totals.completed ?? 0],
              ["Thất bại", usage?.totals.failed ?? 0],
              [
                "Phút xử lý",
                formatMinutes(usage?.totals.processedSeconds ?? 0),
              ],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-border bg-white p-4"
              >
                <div className="text-sm font-bold text-muted-foreground">
                  {String(label)}
                </div>
                <div className="mt-2 text-2xl font-black text-foreground">
                  {String(value)}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-white text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">API key</th>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Hoàn tất</th>
                  <th className="px-4 py-3">Lỗi</th>
                  <th className="px-4 py-3">Thời lượng</th>
                  <th className="px-4 py-3">Lần cuối</th>
                </tr>
              </thead>
              <tbody>
                {(usage?.keys.length ? usage.keys : []).map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-black">{item.name}</div>
                      <div className="font-mono text-xs text-primary">
                        {item.keyPrefix}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-bold">{item.requests}</td>
                    <td className="px-4 py-3 font-bold text-[#166534]">
                      {item.completed}
                    </td>
                    <td className="px-4 py-3 font-bold text-red-600">
                      {item.failed}
                    </td>
                    <td className="px-4 py-3 font-bold">
                      {formatMinutes(item.processedSeconds)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(item.lastEventAt)}
                    </td>
                  </tr>
                ))}
                {!usage?.keys.length && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center font-bold text-muted-foreground"
                    >
                      Chưa có dữ liệu usage. Gọi API một lần để bắt đầu ghi
                      nhận thống kê.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {!!usage?.daily.length && (
            <div className="mt-5 grid grid-cols-10 items-end gap-1">
              {usage.daily.slice(-30).map((day) => {
                const maxRequests = Math.max(
                  1,
                  ...usage.daily.map((item) => item.requests),
                );
                const height = Math.max(8, (day.requests / maxRequests) * 72);
                return (
                  <div
                    key={day.date}
                    className="flex flex-col items-center gap-2"
                    title={`${day.date}: ${day.requests} request`}
                  >
                    <div
                      className="w-full rounded-t bg-primary/70"
                      style={{ height }}
                    />
                    <span className="text-[10px] font-bold text-muted-foreground">
                      {day.date.slice(8)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section
        id="docs"
        className="mx-auto grid max-w-7xl gap-5 px-4 pb-10 md:grid-cols-2 md:px-6"
      >
        <DocCard title="cURL" code={curlSample} onCopy={copyText} />
        <DocCard title="JavaScript SDK mẫu" code={jsSample} onCopy={copyText} />
        <DocCard title="Webhook callback" code={webhookSample} onCopy={copyText} />
        <DocCard title="Async polling" code={pollingSample} onCopy={copyText} />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-10 md:px-6">
        <div className="rounded-lg border border-border bg-white p-5 shadow-soft">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm font-black text-primary">
                <PlugZap className="h-4 w-4" /> Webhook deliveries
              </div>
              <h2 className="text-xl font-black">Callback gần đây</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Dùng API key ở khu vực test để xem delivery log và replay callback lỗi.
              </p>
            </div>
            <button
              onClick={() => void loadWebhookDeliveries()}
              className="rounded-full border border-border bg-white p-2 hover:border-primary/50"
              title="Tải lại webhook deliveries"
            >
              <RefreshCw className={`h-5 w-5 ${webhookLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-white text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Job</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Attempts</th>
                  <th className="px-4 py-3">Callback</th>
                  <th className="px-4 py-3">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {webhookDeliveries.map((delivery) => (
                  <tr key={delivery.id} className="border-t border-border">
                    <td className="px-4 py-3 font-black">{delivery.event}</td>
                    <td className="px-4 py-3 font-bold">
                      #{delivery.jobId || delivery.transcriptionId || delivery.id}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-black ${
                          delivery.status === "delivered"
                            ? "bg-emerald-50 text-emerald-700"
                            : delivery.status === "failed"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {delivery.status}
                        {delivery.responseStatus ? ` · ${delivery.responseStatus}` : ""}
                      </span>
                      {delivery.errorMessage && (
                        <p className="mt-1 max-w-xs truncate text-xs text-red-600">
                          {delivery.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-bold">{delivery.attempts}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                      {delivery.callbackUrl}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void replayWebhookDelivery(delivery.id)}
                        className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-black hover:border-primary/50"
                      >
                        Replay
                      </button>
                    </td>
                  </tr>
                ))}
                {!webhookDeliveries.length && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center font-bold text-muted-foreground"
                    >
                      Chưa có webhook delivery. Gửi request có callbackUrl để bắt đầu ghi log.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-12 md:px-6">
        <div className="grid gap-5 rounded-lg border border-border bg-white p-5 text-foreground shadow-soft md:grid-cols-[.9fr_1.1fr] md:p-6">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm font-black text-primary">
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

          <div className="min-w-0 rounded-lg border border-border bg-white p-4 text-foreground">
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

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-black">
                Callback URL
                <input
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-white px-4 py-2.5 font-semibold outline-none focus:border-primary"
                  placeholder="https://your-app.com/webhooks/vbee"
                />
              </label>
              <label className="text-sm font-black">
                Callback secret
                <input
                  value={callbackSecret}
                  onChange={(e) => setCallbackSecret(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-white px-4 py-2.5 font-semibold outline-none focus:border-primary"
                  placeholder="random-secret"
                />
              </label>
            </div>

            <button
              onClick={testApi}
              disabled={testing}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 font-black text-primary-foreground disabled:opacity-60"
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
                className={`mt-5 rounded-lg p-4 ${
                  apiResult.error ||
                  apiResult.status === "failed" ||
                  apiResult.status === "cancelled"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-white text-primary"
                }`}
              >
                <div className="mb-2 flex items-center gap-2 font-black">
                  {apiResult.error ? (
                    <X className="h-5 w-5" />
                  ) : (
                    <Check className="h-5 w-5" />
                  )}
                  {apiResult.error ||
                  apiResult.status === "failed" ||
                  apiResult.status === "cancelled"
                    ? "API lỗi"
                    : apiResult.status === "completed"
                      ? "API hoàn tất"
                      : apiResult.object === "transcription_job" ||
                          apiResult.jobId
                        ? "API đang xử lý"
                        : "API thành công"}
                </div>
                {!apiResult.error &&
                  (apiResult.object === "transcription_job" ||
                    apiResult.jobId) &&
                  apiResult.status !== "completed" && (
                    <p className="mb-3 text-sm font-bold">
                      Job #{apiResult.jobId ?? apiResult.id} đang ở trạng thái{" "}
                      {apiResult.status ?? "queued"}. Gọi{" "}
                      <code className="rounded bg-white px-1 py-0.5">
                        GET /api/v1/transcribe/jobs/
                        {apiResult.jobId ?? apiResult.id}
                      </code>{" "}
                      để lấy tiến độ và kết quả.
                    </p>
                  )}
                {apiResult.message && (
                  <p className="mb-3 text-sm font-bold">
                    {apiResult.message}
                  </p>
                )}
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs leading-5">
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
    <div className="rounded-lg border border-border bg-white p-4 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xl font-black">
          <Code2 className="h-5 w-5" /> {title}
        </div>
        <button
          onClick={() => void onCopy(code)}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-2 text-xs font-black hover:border-primary/50"
        >
          <Clipboard className="h-4 w-4" /> Sao chép
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto rounded-lg bg-white p-4 text-xs leading-6 text-primary">
        <code>{code}</code>
      </pre>
    </div>
  );
}
