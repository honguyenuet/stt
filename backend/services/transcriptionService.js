require("../config/env");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const ffmpegStaticPath = require("ffmpeg-static");
const { AssemblyAI } = require("assemblyai");
const pool = require("../db");
const { decryptProviderSecret } = require("./providerSecrets");
const { recordQuotaUsage } = require("./quotaService");
const { normalizeFilename } = require("./filenameEncoding");
const { scanFileForMalware } = require("./malwareScanService");
const {
  normalizeLanguageCode,
  normalizeTranslateTarget,
  translateTranscript,
} = require("./translationService");

const ALLOWED_EXT = /\.(mp3|wav|m4a|ogg|flac|aac|mp4|webm)$/i;
const MAX_SIZE_MB = Number.parseInt(process.env.MAX_UPLOAD_MB || "200", 10);
const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads"),
);
const execFileAsync = promisify(execFile);

const SONIX_API_BASE_URL = (
  process.env.SONIX_API_BASE_URL || "https://api.sonix.ai/v1"
).replace(/\/$/, "");
const SONIX_DIRECT_UPLOAD_MAX_MB = 100;
const SONIX_POLL_INTERVAL_MS = Number.parseInt(
  process.env.SONIX_POLL_INTERVAL_MS || "5000",
  10,
);
const SONIX_TIMEOUT_MS = Number.parseInt(
  process.env.SONIX_TIMEOUT_MS || `${30 * 60 * 1000}`,
  10,
);
const DEEPGRAM_API_BASE_URL = (
  process.env.DEEPGRAM_API_BASE_URL || "https://api.deepgram.com/v1"
).replace(/\/$/, "");
const DEEPGRAM_TIMEOUT_MS = Number.parseInt(
  process.env.DEEPGRAM_TIMEOUT_MS || `${30 * 60 * 1000}`,
  10,
);
const DEEPGRAM_MAX_RETRIES = Number.parseInt(
  process.env.DEEPGRAM_MAX_RETRIES || "1",
  10,
);
const DEEPGRAM_RETRY_DELAY_MS = Number.parseInt(
  process.env.DEEPGRAM_RETRY_DELAY_MS || "1500",
  10,
);
const VBEE_API_BASE_URL = (
  process.env.VBEE_API_BASE_URL || "https://api-voice-uat.vbeelabs.ai"
).replace(/\/$/, "");
const VBEE_TRANSCRIBE_PATH =
  process.env.VBEE_TRANSCRIBE_PATH ||
  "/v1/audio/transcriptions";
const VBEE_RESULT_PATH_TEMPLATE =
  process.env.VBEE_RESULT_PATH_TEMPLATE || "/v1/transcribe/{id}";
const VBEE_POLL_INTERVAL_MS = Number.parseInt(
  process.env.VBEE_POLL_INTERVAL_MS || "5000",
  10,
);
const VBEE_TIMEOUT_MS = Number.parseInt(
  process.env.VBEE_TIMEOUT_MS || `${30 * 60 * 1000}`,
  10,
);
const PROVIDER_REQUEST_TIMEOUT_MS = Math.max(
  30_000,
  Number.parseInt(process.env.PROVIDER_REQUEST_TIMEOUT_MS || `${30 * 60 * 1000}`, 10),
);
const PROVIDER_ENV_KEYS = {
  assemblyai: "ASSEMBLYAI_API_KEY",
  sonix: "SONIX_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  vbee: "VBEE_API_KEY",
};
const PROVIDER_DEFAULT_ENDPOINTS = {
  assemblyai: "https://api.assemblyai.com/v2",
  sonix: SONIX_API_BASE_URL,
  deepgram: DEEPGRAM_API_BASE_URL,
  vbee: VBEE_API_BASE_URL,
};

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function resolveStoredAudioPath(filename) {
  const resolved = path.resolve(UPLOADS_DIR, String(filename || ""));
  if (
    !filename ||
    (resolved !== UPLOADS_DIR && !resolved.startsWith(`${UPLOADS_DIR}${path.sep}`))
  ) {
    throw createHttpError(400, "Đường dẫn file âm thanh không hợp lệ");
  }
  return resolved;
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getSafeExtension(originalname = "") {
  const match = originalname.match(/\.([^.]+)$/);
  const ext = (match?.[1] || "webm").toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? ext : "webm";
}

function stripExtension(filename = "audio") {
  return filename.replace(/\.[^.]+$/, "") || "audio";
}

function normalizeAudioMode(mode) {
  const clean = String(mode || "")
    .trim()
    .toLowerCase();
  return ["song", "music", "lyrics", "vocal"].includes(clean)
    ? "song"
    : "speech";
}

function getFfmpegPath() {
  return process.env.FFMPEG_PATH || ffmpegStaticPath || "ffmpeg";
}

function safeUnlink(filePath) {
  if (filePath) fs.unlink(filePath, () => {});
}

function safeRmDir(dirPath) {
  if (dirPath) fs.rm(dirPath, { recursive: true, force: true }, () => {});
}

function parseMediaTime(value) {
  const matches = [...String(value || "").matchAll(/(?:Duration:|time=)\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  if (matches.length === 0) return null;
  const match = matches[matches.length - 1];
  const seconds =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

async function runFfmpegInspection(args, timeout) {
  try {
    const result = await execFileAsync(getFfmpegPath(), args, {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return `${result.stdout || ""}\n${result.stderr || ""}`;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw createHttpError(503, "Server chưa cài đặt FFmpeg để kiểm tra file.");
    }
    return `${error.stdout || ""}\n${error.stderr || ""}`;
  }
}

async function probeMediaFile(file) {
  const sourcePath = file?.path ? path.resolve(file.path) : null;
  if (!sourcePath && !file?.buffer?.length) {
    throw createHttpError(400, "File tải lên rỗng hoặc không hợp lệ.");
  }

  const tempPath = sourcePath || path.join(
      os.tmpdir(),
      `vbee-probe-${Date.now()}-${Math.random().toString(36).slice(2)}.${getSafeExtension(file.originalname)}`,
    );
  const ownsTempFile = !sourcePath;
  const timeout = Number.parseInt(
    process.env.MEDIA_PROBE_TIMEOUT_MS || `${2 * 60 * 1000}`,
    10,
  );

  try {
    if (ownsTempFile) await fs.promises.writeFile(tempPath, file.buffer);
    await scanFileForMalware(tempPath);
    const metadata = await runFfmpegInspection(
      ["-hide_banner", "-i", tempPath],
      timeout,
    );
    if (!/Stream\s+#.*Audio:/i.test(metadata)) {
      throw createHttpError(
        400,
        "File không có luồng âm thanh hợp lệ hoặc nội dung không đúng định dạng.",
      );
    }

    let durationSeconds = parseMediaTime(metadata);
    if (!durationSeconds) {
      const packetScan = await runFfmpegInspection(
        [
          "-hide_banner",
          "-i",
          tempPath,
          "-map",
          "0:a:0",
          "-c",
          "copy",
          "-f",
          "null",
          "-",
        ],
        timeout,
      );
      durationSeconds = parseMediaTime(packetScan);
    }

    if (!durationSeconds) {
      throw createHttpError(400, "Không đọc được thời lượng thật của file.");
    }
    return { durationSeconds };
  } finally {
    if (ownsTempFile) await fs.promises.unlink(tempPath).catch(() => {});
  }
}

function shouldAttemptDemucs() {
  const value = String(process.env.DEMUCS_ENABLED || "auto")
    .trim()
    .toLowerCase();
  return !["false", "0", "off", "no", "disabled"].includes(value);
}

function getDemucsCommandSpec() {
  if (process.env.DEMUCS_COMMAND) {
    return { command: process.env.DEMUCS_COMMAND, prefixArgs: [] };
  }
  return {
    command: process.env.DEMUCS_PYTHON_PATH || "python",
    prefixArgs: ["-m", "demucs"],
  };
}

function findFileByName(rootDir, targetName) {
  if (!fs.existsSync(rootDir)) return null;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, item.name);
      if (item.isDirectory()) stack.push(fullPath);
      else if (item.name.toLowerCase() === targetName.toLowerCase()) return fullPath;
    }
  }
  return null;
}

async function runDemucsVocalIsolation(inputPath) {
  if (!shouldAttemptDemucs()) return { vocalsPath: null, warning: null };

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "vbee-demucs-"));
  const { command, prefixArgs } = getDemucsCommandSpec();
  const model = String(process.env.DEMUCS_MODEL || "htdemucs").trim();
  const timeout = Number.parseInt(
    process.env.DEMUCS_TIMEOUT_MS || `${10 * 60 * 1000}`,
    10,
  );

  try {
    await execFileAsync(
      command,
      [
        ...prefixArgs,
        "--two-stems",
        "vocals",
        "-n",
        model,
        "--out",
        outputDir,
        inputPath,
      ],
      { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
    );
    const vocalsPath = findFileByName(outputDir, "vocals.wav");
    if (!vocalsPath) {
      return {
        vocalsPath: null,
        outputDir,
        warning:
          "Demucs chạy xong nhưng không tìm thấy vocals.wav, backend sẽ dùng ffmpeg filter.",
      };
    }
    return { vocalsPath, outputDir, warning: null };
  } catch (error) {
    safeRmDir(outputDir);
    return {
      vocalsPath: null,
      warning:
        error.code === "ENOENT"
          ? "Chưa tìm thấy Python/Demucs trên server, backend dùng ffmpeg filter thay thế."
          : `Demucs chưa xử lý được vocal (${error.message}), backend dùng ffmpeg filter thay thế.`,
    };
  }
}

async function transcodeToSttWav(inputPath, outputPath, filters, timeout) {
  await execFileAsync(
    getFfmpegPath(),
    [
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-af",
      filters,
      "-f",
      "wav",
      outputPath,
    ],
    { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
}

async function transcodeForDemucs(inputPath, outputPath, timeout) {
  await execFileAsync(
    getFfmpegPath(),
    [
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-f",
      "wav",
      outputPath,
    ],
    { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
}

async function prepareMusicAudioForStt(file, filename) {
  if (process.env.AUDIO_PREPROCESSING_ENABLED === "false") {
    return { file, applied: false, method: null, warning: null };
  }

  const tempBase = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputPath = path.join(
    os.tmpdir(),
    `${tempBase}.${getSafeExtension(file.originalname || filename)}`,
  );
  const demucsInputPath = path.join(os.tmpdir(), `${tempBase}-demucs.wav`);
  const outputPath = path.join(os.tmpdir(), `${tempBase}-vocal.wav`);
  const filters =
    process.env.SONG_AUDIO_FILTER ||
    "highpass=f=120,lowpass=f=8000,afftdn=nf=-25,dynaudnorm=f=150:g=15,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:LRA=11:TP=-1.5";
  const timeout = Number.parseInt(
    process.env.AUDIO_PREPROCESSING_TIMEOUT_MS || `${3 * 60 * 1000}`,
    10,
  );
  let demucsOutputDir = null;

  try {
    fs.writeFileSync(inputPath, file.buffer);
    await transcodeForDemucs(inputPath, demucsInputPath, timeout);
    const demucs = await runDemucsVocalIsolation(demucsInputPath);
    demucsOutputDir = demucs.outputDir;
    await transcodeToSttWav(
      demucs.vocalsPath || inputPath,
      outputPath,
      filters,
      timeout,
    );
    const buffer = fs.readFileSync(outputPath);
    return {
      file: {
        ...file,
        buffer,
        size: buffer.length,
        originalname: `${stripExtension(filename)}-vocal.wav`,
        mimetype: "audio/wav",
      },
      applied: true,
      method: demucs.vocalsPath ? "demucs" : "ffmpeg",
      warning: demucs.warning,
    };
  } catch (error) {
    return {
      file,
      applied: false,
      method: null,
      warning:
        error.message ||
        "Không xử lý được audio bằng ffmpeg, backend sẽ gửi file gốc cho provider.",
    };
  } finally {
    safeUnlink(inputPath);
    safeUnlink(demucsInputPath);
    safeUnlink(outputPath);
    safeRmDir(demucsOutputDir);
  }
}

function normalizeProviderCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getEnvApiKey(provider) {
  if (provider === "vbee") {
    return String(process.env.VBEE_API_KEY || process.env.AIMP_API_KEY || "").trim();
  }
  const envKey = PROVIDER_ENV_KEYS[provider];
  return envKey ? String(process.env[envKey] || "").trim() : "";
}

function normalizeProviderEndpoint(provider, endpoint) {
  return String(endpoint || PROVIDER_DEFAULT_ENDPOINTS[provider] || "")
    .trim()
    .replace(/\/$/, "");
}

function getProviderKeySource() {
  const value = String(process.env.PROVIDER_KEY_SOURCE || "cms")
    .trim()
    .toLowerCase();
  return ["env", "cms", "cms_fallback_env", "env_fallback_cms"].includes(value)
    ? value
    : "cms";
}

function resolveProviderApiKey(provider, encryptedCmsKey) {
  const cmsKey = decryptProviderSecret(encryptedCmsKey);
  const envKey = getEnvApiKey(provider);
  switch (getProviderKeySource()) {
    case "env":
      return envKey;
    case "env_fallback_cms":
      return envKey || cmsKey;
    case "cms_fallback_env":
    case "cms":
    default:
      return cmsKey || envKey;
  }
}

async function getCmsTranscriptionProvider() {
  try {
    const { rows } = await pool.query(
      `SELECT code, endpoint, api_key_encrypted
       FROM stt_providers
       WHERE enabled = TRUE AND is_default = TRUE
       ORDER BY id ASC
       LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return null;
    const provider = normalizeProviderCode(row.code);
    return {
      provider,
      endpoint: normalizeProviderEndpoint(provider, row.endpoint),
      apiKey: resolveProviderApiKey(provider, row.api_key_encrypted),
      source: "cms",
    };
  } catch (error) {
    console.warn(
      "Không đọc được cấu hình provider từ CMS, fallback về .env:",
      error.message,
    );
    return null;
  }
}

async function getTranscriptionProviderConfig() {
  const cmsProvider = await getCmsTranscriptionProvider();
  if (cmsProvider) return cmsProvider;

  const configured = (process.env.TRANSCRIPTION_PROVIDER || "")
    .trim()
    .toLowerCase();
  const provider =
    configured ||
    (process.env.SONIX_API_KEY
      ? "sonix"
      : process.env.VBEE_API_KEY || process.env.AIMP_API_KEY
        ? "vbee"
      : process.env.DEEPGRAM_API_KEY
        ? "deepgram"
        : "assemblyai");
  return {
    provider,
    endpoint: normalizeProviderEndpoint(provider),
    apiKey: getEnvApiKey(provider),
    source: "env",
  };
}

async function getTranscriptionProvider() {
  const { provider } = await getTranscriptionProviderConfig();
  return provider;
}

function assertSupportedProvider(provider) {
  if (!["assemblyai", "sonix", "deepgram", "vbee"].includes(provider)) {
    throw createHttpError(
      503,
      `Nhà cung cấp STT không hợp lệ: ${provider}. Hỗ trợ: assemblyai, sonix, deepgram hoặc vbee.`,
    );
  }
}

function requireProviderApiKey(provider, apiKey) {
  if (!apiKey) {
    const envKey = PROVIDER_ENV_KEYS[provider] || "API_KEY";
    throw createHttpError(
      503,
      `Chưa cấu hình API key cho provider ${provider}. Hãy nhập trong CMS hoặc biến ${envKey} trong backend/.env`,
    );
  }
  return apiKey;
}

function getAssemblyClient(providerConfig) {
  return new AssemblyAI({
    apiKey: requireProviderApiKey("assemblyai", providerConfig.apiKey),
  });
}


function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAbortController(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timer };
}

function isRetryableProviderError(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  return (
    error?.name === "AbortError" ||
    statusCode === 408 ||
    statusCode === 429 ||
    (statusCode >= 500 && statusCode <= 599)
  );
}

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await response.json();
    if (!response.ok) {
      throw createHttpError(
        response.status,
        getProviderErrorMessage(body, response.status),
      );
    }
    return body;
  }

  const text = await response.text();
  if (!response.ok) {
    throw createHttpError(
      response.status,
      text || `Provider API lỗi ${response.status}`,
    );
  }
  return text;
}

function getProviderErrorMessage(body, status) {
  if (body?.error?.message) return body.error.message;
  if (typeof body?.error === "string") return body.error;
  if (typeof body?.detail === "string") return body.detail;
  if (Array.isArray(body?.detail)) return JSON.stringify(body.detail);
  if (body?.message) return body.message;
  return `Provider API lỗi ${status}`;
}

async function sonixRequest(providerConfig, pathname, options = {}) {
  if (
    typeof fetch !== "function" ||
    typeof FormData !== "function" ||
    typeof Blob !== "function"
  ) {
    throw createHttpError(
      503,
      "Sonix provider cần Node.js 18+ để dùng fetch/FormData.",
    );
  }

  const headers = {
    Authorization: `Bearer ${requireProviderApiKey("sonix", providerConfig.apiKey)}`,
    ...(options.headers || {}),
  };

  const response = await fetch(`${providerConfig.endpoint}${pathname}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
    headers,
  });

  return readResponseBody(response);
}

function getDeepgramLanguage(language) {
  return normalizeLanguageCode(language || process.env.DEEPGRAM_LANGUAGE, "vi");
}

function getDeepgramModel() {
  return (process.env.DEEPGRAM_MODEL || "nova-3").trim();
}

function normalizeDeepgramWords(response) {
  const words =
    response?.results?.channels?.[0]?.alternatives?.[0]?.words || [];
  if (!Array.isArray(words)) return [];

  return words.map((word) => ({
    text: word.punctuated_word || word.word || "",
    start: Math.round(Number(word.start || 0) * 1000),
    end: Math.round(Number(word.end || word.start || 0) * 1000),
    speaker:
      word.speaker !== undefined && word.speaker !== null
        ? `Speaker ${word.speaker}`
        : null,
    confidence: word.confidence,
  }));
}

function buildTextFromDeepgram(response, speakerLabels) {
  const alternative = response?.results?.channels?.[0]?.alternatives?.[0];
  if (!alternative) return "";

  const paragraphs = alternative.paragraphs?.paragraphs;
  if (speakerLabels && Array.isArray(paragraphs) && paragraphs.length > 0) {
    return paragraphs
      .map((paragraph) => {
        const speaker =
          paragraph.speaker !== undefined && paragraph.speaker !== null
            ? `Speaker ${paragraph.speaker}`
            : "Speaker";
        const text = Array.isArray(paragraph.sentences)
          ? paragraph.sentences.map((sentence) => sentence.text).join(" ")
          : "";
        return text.trim() ? `${speaker}: ${text.trim()}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  return alternative.transcript || "";
}

async function transcribeWithDeepgram({
  file,
  speakerLabels,
  language,
  dictionaryKeywords = [],
  transcriptionSettings = {},
  providerConfig,
}) {
  if (typeof fetch !== "function") {
    throw createHttpError(503, "Deepgram provider cần Node.js 18+ để dùng fetch.");
  }

  const params = new URLSearchParams({
    model: getDeepgramModel(),
    smart_format: process.env.DEEPGRAM_SMART_FORMAT || "true",
    punctuate: process.env.DEEPGRAM_PUNCTUATE || "true",
    paragraphs: process.env.DEEPGRAM_PARAGRAPHS || "true",
    utterances: process.env.DEEPGRAM_UTTERANCES || "true",
  });

  const requestedLanguage = getDeepgramLanguage(language);
  if (
    requestedLanguage === "auto" ||
    process.env.DEEPGRAM_DETECT_LANGUAGE === "true"
  ) {
    params.set("detect_language", "true");
  } else {
    params.set("language", requestedLanguage);
  }
  if (speakerLabels) {
    if (process.env.DEEPGRAM_DIARIZE_MODEL) {
      params.set("diarize_model", process.env.DEEPGRAM_DIARIZE_MODEL);
    } else {
      params.set("diarize", "true");
    }
  }
  if (transcriptionSettings.fillerWords === "yes") {
    params.set("filler_words", "true");
  }
  if (transcriptionSettings.profanityFilter === "yes") {
    params.set("profanity_filter", "true");
  }
  for (const keyword of dictionaryKeywords) {
    const clean = String(keyword || "").trim();
    if (clean) params.append("keyterm", clean);
  }
  if (process.env.DEEPGRAM_KEYWORDS) {
    for (const keyword of process.env.DEEPGRAM_KEYWORDS.split(",")) {
      const clean = keyword.trim();
      if (clean) params.append("keywords", clean);
    }
  }

  let body;
  let lastError;
  for (let attempt = 0; attempt <= DEEPGRAM_MAX_RETRIES; attempt += 1) {
    const { controller, timer } = createAbortController(DEEPGRAM_TIMEOUT_MS);
    try {
      const response = await fetch(`${providerConfig.endpoint}/listen?${params}`, {
        method: "POST",
        headers: {
          Authorization: `Token ${requireProviderApiKey("deepgram", providerConfig.apiKey)}`,
          "Content-Type": file.mimetype || "application/octet-stream",
        },
        body: file.buffer,
        signal: controller.signal,
      });
      body = await readResponseBody(response);
      break;
    } catch (error) {
      lastError =
        error?.name === "AbortError"
          ? createHttpError(
              408,
              `Deepgram xử lý quá thời gian chờ ${Math.round(
                DEEPGRAM_TIMEOUT_MS / 1000,
              )} giây`,
            )
          : error;

      if (
        attempt >= DEEPGRAM_MAX_RETRIES ||
        !isRetryableProviderError(lastError)
      ) {
        throw lastError;
      }

      await delay(DEEPGRAM_RETRY_DELAY_MS * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  if (!body) {
    throw lastError || createHttpError(502, "Deepgram không trả về kết quả");
  }
  const metadata = body?.metadata || {};

  return {
    provider: "deepgram",
    providerId: metadata.request_id || null,
    duration: metadata.duration || null,
    detectedLanguage:
      body?.results?.channels?.[0]?.detected_language ||
      body?.results?.channels?.[0]?.alternatives?.[0]?.languages?.[0] ||
      null,
    text: buildTextFromDeepgram(body, speakerLabels),
    words: normalizeDeepgramWords(body),
  };
}

function getSonixLanguage() {
  const configured = normalizeLanguageCode(process.env.SONIX_LANGUAGE, "vi");
  return configured === "auto" || configured === "multi" ? "vi" : configured;
}

async function assertTranscriptionProviderReady() {
  const providerConfig = await getTranscriptionProviderConfig();
  const provider = providerConfig.provider;
  assertSupportedProvider(provider);
  requireProviderApiKey(provider, providerConfig.apiKey);
  return provider;
}

function getSonixCallbackUrl() {
  if (process.env.SONIX_CALLBACK_URL) return process.env.SONIX_CALLBACK_URL;
  const baseUrl = String(process.env.PUBLIC_BACKEND_URL || "")
    .trim()
    .replace(/\/$/, "");
  const secret = String(process.env.SONIX_CALLBACK_SECRET || "").trim();
  if (!baseUrl || !secret) return "";
  return `${baseUrl}/api/transcribe/sonix/callback?secret=${encodeURIComponent(secret)}`;
}

function resolveSonixLanguage(language) {
  const selected = normalizeLanguageCode(language, getSonixLanguage());
  // The REST API expects an explicit language code. The app's "auto" option
  // is useful for Deepgram, but would make a Sonix upload invalid or unreliable.
  return selected === "auto" || selected === "multi"
    ? getSonixLanguage()
    : selected;
}

async function submitSonixMedia(
  providerConfig,
  file,
  filename,
  language,
  dictionaryKeywords = [],
  customData = {},
) {
  const form = new FormData();
  if (file.size > SONIX_DIRECT_UPLOAD_MAX_MB * 1024 * 1024) {
    if (!file.fileUrl) {
      throw createHttpError(
        503,
        `Sonix chỉ nhận multipart tối đa ${SONIX_DIRECT_UPLOAD_MAX_MB}MB. Backend chưa tạo được file_url công khai cho file này.`,
      );
    }
    form.append("file_url", file.fileUrl);
  } else {
    form.append(
      "file",
      new Blob([file.buffer], {
        type: file.mimetype || "application/octet-stream",
      }),
      filename,
    );
  }
  form.append("language", resolveSonixLanguage(language));
  form.append("name", filename);
  if (Object.keys(customData).length > 0) {
    form.append("custom_data", JSON.stringify(customData));
  }

  const keywords = [
    ...dictionaryKeywords.map((keyword) => String(keyword || "").trim()),
    ...(process.env.SONIX_KEYWORDS || "")
      .split(",")
      .map((keyword) => keyword.trim()),
  ].filter(Boolean);
  if (keywords.length > 0) form.append("keywords", keywords.join(","));
  if (process.env.SONIX_FOLDER_ID)
    form.append("folder_id", process.env.SONIX_FOLDER_ID);
  const callbackUrl = getSonixCallbackUrl();
  if (callbackUrl) form.append("callback_url", callbackUrl);

  return sonixRequest(providerConfig, "/media", {
    method: "POST",
    body: form,
  });
}

async function waitForSonixCompletion(providerConfig, mediaId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SONIX_TIMEOUT_MS) {
    const media = await sonixRequest(
      providerConfig,
      `/media/${encodeURIComponent(mediaId)}`,
      {
        method: "GET",
      },
    );

    if (media.status === "completed") return media;
    if (["failed", "blocked"].includes(media.status)) {
      throw createHttpError(
        500,
        `Sonix xử lý thất bại với trạng thái: ${media.status}`,
      );
    }

    await delay(SONIX_POLL_INTERVAL_MS);
  }

  throw createHttpError(
    504,
    "Sonix xử lý quá lâu. Vui lòng thử lại sau hoặc tăng SONIX_TIMEOUT_MS.",
  );
}

function normalizeSonixWords(jsonTranscript) {
  const segments = Array.isArray(jsonTranscript?.transcript)
    ? jsonTranscript.transcript
    : [];

  return segments.flatMap((segment) => {
    const speaker = segment.speaker || null;
    const words = Array.isArray(segment.words) ? segment.words : [];
    return words.map((word) => ({
      text: word.text || "",
      start: Math.round(Number(word.start_time || 0) * 1000),
      end: Math.round(Number(word.end_time || word.start_time || 0) * 1000),
      speaker,
    }));
  });
}

function buildTextFromSonixJson(jsonTranscript, speakerLabels) {
  const segments = Array.isArray(jsonTranscript?.transcript)
    ? jsonTranscript.transcript
    : [];

  return segments
    .map((segment) => {
      const text = (segment.words || [])
        .map((word) => word.text)
        .filter(Boolean)
        .join(" ")
        .trim();
      if (!text) return "";
      if (speakerLabels && segment.speaker)
        return `${segment.speaker}: ${text}`;
      return text;
    })
    .filter(Boolean)
    .join(speakerLabels ? "\n\n" : " ")
    .trim();
}

async function transcribeWithSonix({
  file,
  speakerLabels,
  filename,
  language,
  dictionaryKeywords = [],
  providerConfig,
  customData = {},
}) {
  const uploadResult = await submitSonixMedia(
    providerConfig,
    file,
    filename,
    language,
    dictionaryKeywords,
    customData,
  );
  const mediaId = uploadResult.duplicate_media_id || uploadResult.id;

  if (!mediaId) {
    throw createHttpError(500, "Sonix không trả về media id sau khi upload.");
  }

  const media = await waitForSonixCompletion(providerConfig, mediaId);
  const jsonTranscript = await sonixRequest(
    providerConfig,
    `/media/${encodeURIComponent(mediaId)}/transcript.json`,
    {
      method: "GET",
    },
  );

  const words = normalizeSonixWords(jsonTranscript);
  const text = buildTextFromSonixJson(jsonTranscript, speakerLabels);

  return {
    provider: "sonix",
    providerId: mediaId,
    duration: media.duration || null,
    text,
    words,
  };
}

function normalizeVbeeLanguage(language) {
  const selected = normalizeLanguageCode(language || process.env.VBEE_LANGUAGE, "vi");
  return selected === "auto" || selected === "multi" ? "vi" : selected;
}

function getVbeeAuthHeaders(providerConfig) {
  const apiKey = requireProviderApiKey("vbee", providerConfig.apiKey);
  const headerName = process.env.VBEE_AUTH_HEADER || "Authorization";
  const scheme = String(process.env.VBEE_AUTH_SCHEME || "Bearer").trim();
  return {
    [headerName]: scheme ? `${scheme} ${apiKey}` : apiKey,
  };
}

async function vbeeRequest(providerConfig, pathname, options = {}) {
  if (
    typeof fetch !== "function" ||
    typeof FormData !== "function" ||
    typeof Blob !== "function"
  ) {
    throw createHttpError(
      503,
      "Vbee provider cần Node.js 18+ để dùng fetch/FormData.",
    );
  }

  const response = await fetch(resolveProviderUrl(providerConfig, pathname), {
    ...options,
    signal: options.signal || AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
    headers: {
      ...getVbeeAuthHeaders(providerConfig),
      ...(options.headers || {}),
    },
  });
  return readResponseBody(response);
}

function resolveProviderUrl(providerConfig, pathname) {
  const endpoint = String(providerConfig.endpoint || "").replace(/\/$/, "");
  const path = String(pathname || "");
  if (/^https?:\/\//i.test(path)) return path;
  if (
    providerConfig.provider === "vbee" &&
    path === VBEE_TRANSCRIBE_PATH &&
    endpoint.endsWith(VBEE_TRANSCRIBE_PATH)
  ) {
    return endpoint;
  }
  if (providerConfig.provider === "vbee" && endpoint.endsWith(VBEE_TRANSCRIBE_PATH)) {
    return `${endpoint.slice(0, -VBEE_TRANSCRIBE_PATH.length)}${path}`;
  }
  return `${endpoint}${path}`;
}

function getNestedValue(source, pathSpec) {
  if (!source || !pathSpec) return undefined;
  return String(pathSpec)
    .split(".")
    .reduce((current, key) => current?.[key], source);
}

function firstValue(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && String(value).trim() !== "",
  );
}

function extractVbeeText(body) {
  return String(
    firstValue(
      getNestedValue(body, process.env.VBEE_TEXT_PATH),
      body?.text,
      body?.transcript,
      body?.transcription,
      body?.result?.text,
      body?.result?.transcript,
      body?.data?.text,
      body?.data?.transcript,
      body?.data?.transcription,
    ) || "",
  );
}

function extractVbeeId(body) {
  return String(
    firstValue(
      getNestedValue(body, process.env.VBEE_ID_PATH),
      body?.id,
      body?.transcription_id,
      body?.transcriptionId,
      body?.job_id,
      body?.jobId,
      body?.request_id,
      body?.requestId,
      body?.data?.id,
      body?.data?.transcription_id,
      body?.data?.job_id,
      body?.result?.id,
    ) || "",
  );
}

function extractVbeeStatus(body) {
  return String(
    firstValue(
      getNestedValue(body, process.env.VBEE_STATUS_PATH),
      body?.status,
      body?.state,
      body?.data?.status,
      body?.data?.state,
      body?.result?.status,
    ) || "",
  ).toLowerCase();
}

function extractVbeeDuration(body) {
  const duration = Number(
    firstValue(
      getNestedValue(body, process.env.VBEE_DURATION_PATH),
      body?.duration,
      body?.audio_duration,
      body?.data?.duration,
      body?.result?.duration,
    ),
  );
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function extractVbeeWords(body) {
  const words = firstValue(
    getNestedValue(body, process.env.VBEE_WORDS_PATH),
    body?.words,
    body?.data?.words,
    body?.result?.words,
  );
  return Array.isArray(words) ? words : [];
}

function isVbeeCompleted(body) {
  if (extractVbeeText(body)) return true;
  return ["completed", "complete", "done", "success", "succeeded", "finished"].includes(
    extractVbeeStatus(body),
  );
}

function isVbeeFailed(body) {
  return ["failed", "failure", "error", "errored", "cancelled", "canceled"].includes(
    extractVbeeStatus(body),
  );
}

function buildVbeeResultPath(transcriptionId) {
  return VBEE_RESULT_PATH_TEMPLATE.replace(
    "{id}",
    encodeURIComponent(transcriptionId),
  );
}

async function submitVbeeTranscription({
  providerConfig,
  file,
  filename,
  language,
  speakerLabels,
  dictionaryKeywords = [],
}) {
  const form = new FormData();
  const fileField = process.env.VBEE_FILE_FIELD || "file";
  form.append(
    fileField,
    new Blob([file.buffer], {
      type: file.mimetype || "application/octet-stream",
    }),
    filename,
  );
  form.append(process.env.VBEE_MODEL_FIELD || "model", process.env.VBEE_MODEL || "chunkformer");
  form.append(
    process.env.VBEE_RESPONSE_FORMAT_FIELD || "response_format",
    process.env.VBEE_RESPONSE_FORMAT || "json",
  );
  const languageField = process.env.VBEE_LANGUAGE_FIELD || "language";
  if (languageField) {
    form.append(languageField, normalizeVbeeLanguage(language));
  }
  if (process.env.VBEE_FILENAME_FIELD) {
    form.append(process.env.VBEE_FILENAME_FIELD, filename);
  }
  if (process.env.VBEE_SPEAKER_LABELS_FIELD) {
    form.append(process.env.VBEE_SPEAKER_LABELS_FIELD, speakerLabels ? "true" : "false");
  }

  const keywords = [
    ...dictionaryKeywords.map((keyword) => String(keyword || "").trim()),
    ...(process.env.VBEE_KEYWORDS || "")
      .split(",")
      .map((keyword) => keyword.trim()),
  ].filter(Boolean);
  if (keywords.length > 0) {
    form.append(process.env.VBEE_KEYWORDS_FIELD || "keywords", keywords.join(","));
  }

  return vbeeRequest(providerConfig, VBEE_TRANSCRIBE_PATH, {
    method: "POST",
    body: form,
  });
}

async function waitForVbeeCompletion(providerConfig, transcriptionId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < VBEE_TIMEOUT_MS) {
    const body = await vbeeRequest(
      providerConfig,
      buildVbeeResultPath(transcriptionId),
      { method: "GET" },
    );
    if (isVbeeCompleted(body)) return body;
    if (isVbeeFailed(body)) {
      throw createHttpError(
        500,
        `Vbee STT xử lý thất bại với trạng thái: ${extractVbeeStatus(body)}`,
      );
    }
    await delay(VBEE_POLL_INTERVAL_MS);
  }

  throw createHttpError(
    504,
    "Vbee STT xử lý quá lâu. Vui lòng thử lại sau hoặc tăng VBEE_TIMEOUT_MS.",
  );
}

async function transcribeWithVbee({
  file,
  speakerLabels,
  filename,
  language,
  dictionaryKeywords = [],
  providerConfig,
}) {
  const submitted = await submitVbeeTranscription({
    providerConfig,
    file,
    filename,
    language,
    speakerLabels,
    dictionaryKeywords,
  });
  const transcriptionId = extractVbeeId(submitted);
  if (!isVbeeCompleted(submitted) && !transcriptionId) {
    throw createHttpError(
      500,
      "Vbee STT chưa trả về transcript hoặc id job. Hãy kiểm tra VBEE_ID_PATH/VBEE_TEXT_PATH trong backend/.env theo tài liệu API.",
    );
  }
  const result = isVbeeCompleted(submitted)
    ? submitted
    : await waitForVbeeCompletion(providerConfig, transcriptionId);

  if (!transcriptionId && !extractVbeeText(result)) {
    throw createHttpError(
      500,
      "Vbee STT chưa trả về transcript hoặc id job. Hãy kiểm tra VBEE_*_PATH trong backend/.env theo tài liệu API.",
    );
  }

  return {
    provider: "vbee",
    providerId: transcriptionId || null,
    duration: extractVbeeDuration(result),
    detectedLanguage: normalizeVbeeLanguage(language),
    text: extractVbeeText(result),
    words: extractVbeeWords(result),
  };
}

async function transcribeWithAssemblyAI({
  file,
  speakerLabels,
  providerConfig,
  targetLanguage,
}) {
  const client = getAssemblyClient(providerConfig);
  const normalizedTarget = normalizeTranslateTarget(targetLanguage);
  const transcriptParams = {
    audio: file.buffer,
    language_detection: true,
    speaker_labels: Boolean(speakerLabels),
  };
  if (
    normalizedTarget &&
    process.env.ASSEMBLYAI_TRANSLATION_ENABLED !== "false"
  ) {
    transcriptParams.speech_understanding = {
      request: {
        translation: {
          target_languages: [normalizedTarget],
          formal: false,
          match_original_utterance: Boolean(speakerLabels),
        },
      },
    };
  }

  const transcript = await client.transcripts.transcribe(transcriptParams);

  if (transcript.status === "error") {
    throw createHttpError(
      500,
      transcript.error || "Dịch vụ chuyển âm thanh thành văn bản trả về lỗi",
    );
  }

  const text =
    Boolean(speakerLabels) && transcript.utterances?.length > 0
      ? transcript.utterances
          .map((u) => `Người nói ${u.speaker}: ${u.text}`)
          .join("\n\n")
      : transcript.text || "";
  const translatedUtterances = normalizedTarget
    ? (transcript.utterances || [])
        .map((utterance) => {
          const translated =
            utterance.translated_texts?.[normalizedTarget] ||
            utterance.translatedTexts?.[normalizedTarget] ||
            "";
          if (!translated) return "";
          return speakerLabels
            ? `Người nói ${utterance.speaker}: ${translated}`
            : translated;
        })
        .filter(Boolean)
    : [];
  const translatedText = normalizedTarget
    ? transcript.translated_texts?.[normalizedTarget] ||
      transcript.translatedTexts?.[normalizedTarget] ||
      translatedUtterances.join("\n\n")
    : "";
  const translationStatus =
    transcript.speech_understanding?.response?.translation?.status || null;
  const translationError =
    normalizedTarget && !translatedText && translationStatus !== "success"
      ? transcript.speech_understanding?.response?.translation?.error ||
        "AssemblyAI chưa tạo được bản dịch cho transcript này."
      : null;

  return {
    provider: "assemblyai",
    providerId: transcript.id || null,
    duration: transcript.audio_duration || null,
    text,
    words: transcript.words || [],
    detectedLanguage: transcript.language_code || null,
    translation: translatedText
      ? {
          provider: "assemblyai-translation",
          text: translatedText,
          sourceLanguage: transcript.language_code || "auto",
          targetLanguage: normalizedTarget,
        }
      : null,
    translationError,
  };
}

async function transcribeAudio({
  file,
  speakerLabels,
  filename,
  language,
  audioMode = "speech",
  translateTo = "",
  dictionaryKeywords = [],
  transcriptionSettings = {},
  providerMetadata = {},
}) {
  const providerConfig = await getTranscriptionProviderConfig();
  const provider = providerConfig.provider;
  assertSupportedProvider(provider);
  const normalizedAudioMode = normalizeAudioMode(audioMode);
  const preprocessing =
    normalizedAudioMode === "song"
      ? await prepareMusicAudioForStt(file, filename)
      : { file, applied: false, method: null, warning: null };
  const providerFile = preprocessing.file;

  if (provider === "sonix") {
    const result = await transcribeWithSonix({
      file: providerFile,
      speakerLabels,
      filename: providerFile.originalname || filename,
      language,
      dictionaryKeywords,
      providerConfig,
      customData: providerMetadata,
    });
    return {
      ...result,
      audioMode: normalizedAudioMode,
      preprocessingApplied: preprocessing.applied,
      preprocessingMethod: preprocessing.method,
      preprocessingWarning: preprocessing.warning,
    };
  }
  if (provider === "deepgram") {
    const result = await transcribeWithDeepgram({
      file: providerFile,
      speakerLabels,
      filename: providerFile.originalname || filename,
      language,
      dictionaryKeywords,
      transcriptionSettings,
      providerConfig,
    });
    return {
      ...result,
      audioMode: normalizedAudioMode,
      preprocessingApplied: preprocessing.applied,
      preprocessingMethod: preprocessing.method,
      preprocessingWarning: preprocessing.warning,
    };
  }
  if (provider === "vbee") {
    const result = await transcribeWithVbee({
      file: providerFile,
      speakerLabels,
      filename: providerFile.originalname || filename,
      language,
      dictionaryKeywords,
      providerConfig,
    });
    return {
      ...result,
      audioMode: normalizedAudioMode,
      preprocessingApplied: preprocessing.applied,
      preprocessingMethod: preprocessing.method,
      preprocessingWarning: preprocessing.warning,
    };
  }

  const result = await transcribeWithAssemblyAI({
    file: providerFile,
    speakerLabels,
    providerConfig,
    targetLanguage: translateTo,
  });
  return {
    ...result,
    audioMode: normalizedAudioMode,
    preprocessingApplied: preprocessing.applied,
    preprocessingMethod: preprocessing.method,
    preprocessingWarning: preprocessing.warning,
  };
}

async function transcribeFile({
  userId,
  file,
  speakerLabels = false,
  source = "upload",
  language = "auto",
  audioMode = "speech",
  translateTo = "",
  dictionaryKeywords = [],
  transcriptionSettings = {},
  providerMetadata = {},
  validateResult,
}) {
  if (!file) throw createHttpError(400, "Vui lòng chọn file âm thanh");
  if (!ALLOWED_EXT.test(file.originalname || "")) {
    throw createHttpError(400, "Định dạng file không được hỗ trợ");
  }

  const filename = normalizeFilename(file.originalname);
  const startedAt = Date.now();
  const sourceLanguage = normalizeLanguageCode(language, "auto");
  const targetLanguage = normalizeTranslateTarget(translateTo);
  const result = await transcribeAudio({
    file,
    speakerLabels,
    filename,
    language: sourceLanguage,
    audioMode,
    translateTo: targetLanguage,
    dictionaryKeywords,
    transcriptionSettings,
    providerMetadata: {
      user_id: userId,
      ...providerMetadata,
    },
  });
  const processingSeconds = Number(
    ((Date.now() - startedAt) / 1000).toFixed(2),
  );

  if (!String(result.text || "").trim()) {
    const isSongMode = normalizeAudioMode(audioMode) === "song";
    throw createHttpError(
      422,
      isSongMode
        ? "Chế độ bài hát đã thử tách vocal nhưng vẫn chưa phát hiện đủ lời để xuất văn bản. Hãy thử bản có vocal rõ hơn hoặc karaoke/acapella."
        : "Không phát hiện lời nói hoặc lời hát đủ rõ để xuất thành văn bản. Hãy thử file gốc có chất lượng tốt hơn hoặc kiểm tra ngôn ngữ đã chọn.",
    );
  }

  if (validateResult) {
    await validateResult({
      duration: result.duration,
      processingSeconds,
      provider: result.provider,
      source,
    });
  }

  let translation = result.translation || null;
  let translationError = result.translationError || null;
  if (targetLanguage && !translation) {
    try {
      translation = await translateTranscript({
        text: result.text,
        sourceLanguage: result.detectedLanguage || sourceLanguage,
        targetLanguage,
      });
    } catch (error) {
      const fallbackError =
        error.message || "Không dịch được transcript sang ngôn ngữ đã chọn.";
      translationError = translationError
        ? `${translationError} ${fallbackError}`
        : fallbackError;
    }
  }

  return {
    provider: result.provider,
    providerId: result.providerId,
    audioMode: result.audioMode,
    preprocessingApplied: result.preprocessingApplied,
    preprocessingMethod: result.preprocessingMethod,
    preprocessingWarning: result.preprocessingWarning,
    filename,
    fileSize: file.size,
    duration: result.duration,
    processingSeconds,
    text: result.text,
    words: result.words || [],
    sourceLanguage: result.detectedLanguage || sourceLanguage,
    translation,
    translationError,
  };
}

async function transcribeAndSave(args) {
  const { userId, file } = args;
  let savedAudioFilename = null;
  let client = null;

  try {
    const result = await transcribeFile(args);
    const ext = getSafeExtension(file.originalname);
    savedAudioFilename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    fs.writeFileSync(resolveStoredAudioPath(savedAudioFilename), file.buffer, {
      flag: "wx",
      mode: 0o600,
    });

    client = await pool.connect();
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO transcriptions (
         user_id, filename, file_size, duration, processing_seconds, text, words, audio_filename,
         source_language, translated_text, translation_target_language, translation_provider,
         translation_error
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, filename, file_size, duration, processing_seconds, text, words, audio_filename,
         source_language, translated_text, translation_target_language, translation_provider,
         translation_error, created_at`,
      [
        userId,
        result.filename,
        result.fileSize,
        result.duration,
        result.processingSeconds,
        result.text,
        JSON.stringify(result.words),
        savedAudioFilename,
        result.sourceLanguage,
        result.translation?.text || null,
        result.translation?.targetLanguage ||
          normalizeTranslateTarget(args.translateTo) ||
          null,
        result.translation?.provider || null,
        result.translationError || null,
      ],
    );
    await recordQuotaUsage({
      userId,
      transcriptionId: rows[0].id,
      durationSeconds: rows[0].duration,
      db: client,
    });
    await client.query("COMMIT");

    return {
      id: rows[0].id,
      ...result,
      filename: rows[0].filename,
      fileSize: rows[0].file_size,
      duration: rows[0].duration,
      processingSeconds: rows[0].processing_seconds,
      text: rows[0].text,
      words: rows[0].words || [],
      sourceLanguage: rows[0].source_language,
      translation: rows[0].translated_text
        ? {
            text: rows[0].translated_text,
            sourceLanguage: rows[0].source_language,
            targetLanguage: rows[0].translation_target_language,
            provider: rows[0].translation_provider,
          }
        : null,
      translationError: rows[0].translation_error || null,
      createdAt: rows[0].created_at,
    };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (savedAudioFilename)
      fs.unlink(resolveStoredAudioPath(savedAudioFilename), () => {});
    throw error;
  } finally {
    client?.release();
  }
}

module.exports = {
  ALLOWED_EXT,
  MAX_SIZE_MB,
  UPLOADS_DIR,
  createHttpError,
  getTranscriptionProvider,
  assertTranscriptionProviderReady,
  probeMediaFile,
  resolveStoredAudioPath,
  transcribeFile,
  transcribeAndSave,
};
