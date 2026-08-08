require("dotenv").config();
const path = require("path");
const fs = require("fs");
const os = require("os");
const { AsyncLocalStorage } = require("async_hooks");
const { execFile } = require("child_process");
const { promisify } = require("util");
const ffmpegStaticPath = require("ffmpeg-static");
const { AssemblyAI } = require("assemblyai");
const pool = require("../db");
const { recordQuotaUsage } = require("./quotaService");
const { normalizeFilename } = require("./filenameEncoding");
const { scanFileForMalware } = require("./malwareScanService");
const {
  normalizeLanguageCode,
  normalizeTranslateTarget,
  translateTranscript,
} = require("./translationService");
const {
  acquireProviderPermit,
  recordProviderFailure,
  recordProviderSuccess,
} = require("./providerCircuitBreaker");
const { decryptProviderSecret } = require("./providerSecrets");

const ALLOWED_EXT = /\.(mp3|wav|m4a|ogg|flac|aac|mp4|webm)$/i;
const SUPPORTED_TRANSCRIPTION_PROVIDERS = [
  "vbee",
  "assemblyai",
  "deepgram",
  "sonix",
];
const MAX_SIZE_MB = Number.parseInt(process.env.MAX_UPLOAD_MB || "102400", 10);
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
const VBEE_STT_API_BASE_URL = (
  process.env.VBEE_STT_API_BASE_URL ||
  process.env.VBEE_API_BASE_URL ||
  "https://uat-api.vbeelabs.ai"
).replace(/\/$/, "");
const VBEE_TRANSCRIBE_PATH =
  process.env.VBEE_TRANSCRIBE_PATH || "/stt";
const VBEE_RESULT_PATH_TEMPLATE =
  process.env.VBEE_RESULT_PATH_TEMPLATE || "/stt/transcripts/{id}";
const VBEE_STT_POLL_INTERVAL_MS = Math.max(
  2_000,
  Number.parseInt(process.env.VBEE_STT_POLL_INTERVAL_MS || "3000", 10),
);
const VBEE_STT_TIMEOUT_MS = Math.max(
  30_000,
  Number.parseInt(process.env.VBEE_STT_TIMEOUT_MS || `${30 * 60 * 1000}`, 10),
);
const VBEE_STT_MAX_WAV_BYTES =
  Math.min(
    99,
    Math.max(1, Number.parseInt(process.env.VBEE_STT_MAX_WAV_MB || "99", 10)),
  ) *
  1024 *
  1024;
const PROVIDER_REQUEST_TIMEOUT_MS = Math.max(
  30_000,
  Number.parseInt(
    process.env.PROVIDER_REQUEST_TIMEOUT_MS || `${30 * 60 * 1000}`,
    10,
  ),
);
const PROVIDER_RETRY_ATTEMPTS = Math.min(
  3,
  Math.max(
    1,
    Number.parseInt(process.env.PROVIDER_RETRY_ATTEMPTS || "2", 10) || 2,
  ),
);
const PROVIDER_RETRY_BASE_MS = Math.max(
  250,
  Number.parseInt(process.env.PROVIDER_RETRY_BASE_MS || "750", 10) || 750,
);
const providerConfigContext = new AsyncLocalStorage();

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function resolveStoredAudioPath(filename) {
  const resolved = path.resolve(UPLOADS_DIR, String(filename || ""));
  if (
    !filename ||
    (resolved !== UPLOADS_DIR &&
      !resolved.startsWith(`${UPLOADS_DIR}${path.sep}`))
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
  const matches = [
    ...String(value || "").matchAll(
      /(?:Duration:|time=)\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g,
    ),
  ];
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
      throw createHttpError(
        503,
        "Server chưa cài đặt FFmpeg để kiểm tra file.",
      );
    }
    return `${error.stdout || ""}\n${error.stderr || ""}`;
  }
}

async function probeMediaFile(file) {
  const sourcePath = file?.path ? path.resolve(file.path) : null;
  if (!sourcePath && !file?.buffer?.length) {
    throw createHttpError(400, "File tải lên rỗng hoặc không hợp lệ.");
  }

  const tempPath =
    sourcePath ||
    path.join(
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
      else if (item.name.toLowerCase() === targetName.toLowerCase())
        return fullPath;
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
    if (!demucs.vocalsPath) {
      return {
        file,
        applied: false,
        method: null,
        warning:
          demucs.warning ||
          "Không tách được vocal, backend gửi file gốc để tránh làm méo giọng hát.",
      };
    }
    await transcodeToSttWav(
      demucs.vocalsPath,
      outputPath,
      process.env.SONG_VOCAL_FILTER || "anull",
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
      method: "demucs",
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

function createProviderConfigurationError(message) {
  const error = createHttpError(503, message);
  error.providerConfiguration = true;
  return error;
}

function createProviderLocalError(statusCode, message) {
  const error = createHttpError(statusCode, message);
  error.providerLocalError = true;
  error.providerFallbackEligible = true;
  return error;
}

function annotateProviderError(
  error,
  { provider, stage, fallbackEligible = true } = {},
) {
  const annotated =
    error instanceof Error
      ? error
      : createHttpError(502, String(error || "Provider không phản hồi"));
  if (provider) annotated.provider = provider;
  if (stage) annotated.providerStage = stage;
  annotated.providerFallbackEligible = Boolean(fallbackEligible);
  return annotated;
}

function createProviderResultError(provider, audioMode) {
  const isSongMode = normalizeAudioMode(audioMode) === "song";
  const error = createHttpError(
    422,
    isSongMode
      ? `${provider} chưa phát hiện đủ lời hát để xuất văn bản.`
      : `${provider} chưa phát hiện lời nói đủ rõ để xuất văn bản.`,
  );
  error.provider = provider;
  error.providerStage = "result_validation";
  error.providerFallbackEligible = true;
  error.providerResultRejected = true;
  error.retryable = false;
  return error;
}

function getSongTranscriptQuality(result) {
  const words = Array.isArray(result?.words) ? result.words : [];
  const confidenceValues = words
    .map((word) => Number(word?.confidence))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  const averageConfidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) /
        confidenceValues.length
      : null;
  const durationSeconds = Number(result?.duration);
  const wordsPerMinute =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? words.length / (durationSeconds / 60)
      : null;
  const minimumConfidence = Math.min(
    0.95,
    Math.max(
      0,
      Number.parseFloat(process.env.SONG_MIN_TRANSCRIPT_CONFIDENCE || "0.7"),
    ),
  );
  const minimumWordsPerMinute = Math.max(
    1,
    Number.parseFloat(process.env.SONG_MIN_WORDS_PER_MINUTE || "18"),
  );
  const reasons = [];

  if (
    averageConfidence !== null &&
    averageConfidence < minimumConfidence
  ) {
    reasons.push("low_confidence");
  }
  if (
    wordsPerMinute !== null &&
    wordsPerMinute < minimumWordsPerMinute
  ) {
    reasons.push("insufficient_lyrics");
  }

  return {
    acceptable: reasons.length === 0,
    averageConfidence,
    wordsPerMinute,
    minimumConfidence,
    minimumWordsPerMinute,
    reasons,
  };
}

function assertProviderResultQuality(result, audioMode) {
  if (normalizeAudioMode(audioMode) !== "song") return;
  const quality = getSongTranscriptQuality(result);
  if (quality.acceptable) return;

  const confidenceText =
    quality.averageConfidence === null
      ? ""
      : ` (độ tin cậy ${Math.round(quality.averageConfidence * 100)}%)`;
  const error = createProviderResultError(
    result?.provider || "API",
    audioMode,
  );
  error.code = "LOW_TRANSCRIPT_CONFIDENCE";
  error.message = `Kết quả nhận dạng lời hát chưa đủ tin cậy${confidenceText}. Hệ thống đã dừng để tránh trả về văn bản sai. Hãy thử bản acapella/vocal rõ hơn hoặc chọn file nói.`;
  error.transcriptQuality = quality;
  throw error;
}

async function prepareVbeeAudioForStt(file, filename) {
  if (!file?.buffer?.length) {
    throw createHttpError(400, "Không tìm thấy dữ liệu audio để gửi Vbee.");
  }

  const tempBase = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputPath = path.join(
    os.tmpdir(),
    `${tempBase}.${getSafeExtension(file.originalname || filename)}`,
  );
  const outputPath = path.join(os.tmpdir(), `${tempBase}-vbee.wav`);
  const timeout = Number.parseInt(
    process.env.VBEE_STT_AUDIO_CONVERT_TIMEOUT_MS || `${10 * 60 * 1000}`,
    10,
  );

  try {
    await fs.promises.writeFile(inputPath, file.buffer);
    await transcodeToSttWav(
      inputPath,
      outputPath,
      process.env.VBEE_STT_AUDIO_FILTER || "anull",
      timeout,
    );
    const stats = await fs.promises.stat(outputPath);
    if (stats.size >= VBEE_STT_MAX_WAV_BYTES) {
      throw createProviderLocalError(
        413,
        `File WAV sau chuẩn hóa vượt giới hạn ${Math.floor(
          VBEE_STT_MAX_WAV_BYTES / 1024 / 1024,
        )}MB của Vbee. Hãy chia file thành các phần ngắn hơn.`,
      );
    }
    const buffer = await fs.promises.readFile(outputPath);
    return {
      ...file,
      buffer,
      size: buffer.length,
      originalname: `${stripExtension(filename)}-vbee.wav`,
      mimetype: "audio/wav",
    };
  } catch (error) {
    if (error.statusCode) throw error;
    if (error.code === "ENOENT") {
      throw createProviderConfigurationError(
        "Server chưa cài đặt FFmpeg để chuẩn hóa file WAV cho Vbee.",
      );
    }
    throw createProviderLocalError(
      502,
      `Không chuẩn hóa được audio cho Vbee: ${error.message}`,
    );
  } finally {
    await fs.promises.unlink(inputPath).catch(() => {});
    await fs.promises.unlink(outputPath).catch(() => {});
  }
}

function hasConfiguredProviderSecret(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    Boolean(normalized) &&
    normalized !== "..." &&
    normalized !== "changeme" &&
    normalized !== "placeholder" &&
    !normalized.includes("your_") &&
    !normalized.includes("_here")
  );
}

function normalizeProviderEndpoint(value, fallback) {
  return String(value || fallback || "")
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

function getEnvApiKey(provider) {
  if (provider === "vbee") {
    return process.env.VBEE_API_KEY || process.env.AIMP_API_KEY;
  }
  if (provider === "sonix") return process.env.SONIX_API_KEY;
  if (provider === "deepgram") return process.env.DEEPGRAM_API_KEY;
  return process.env.ASSEMBLYAI_API_KEY;
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

function getRuntimeProviderConfig(provider) {
  const config = providerConfigContext.getStore();
  return config?.provider === provider ? config : null;
}

function getProviderEndpoint(provider, fallback) {
  return normalizeProviderEndpoint(
    getRuntimeProviderConfig(provider)?.endpoint,
    fallback,
  );
}

function getProviderApiKey(provider, envValue) {
  const cmsKey = getRuntimeProviderConfig(provider)?.apiKey;
  return hasConfiguredProviderSecret(cmsKey) ? cmsKey : envValue;
}

async function getCmsTranscriptionProviderConfig() {
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
    const provider = String(row.code || "").trim().toLowerCase();
    assertSupportedProvider(provider);
    return {
      provider,
      apiKey: resolveProviderApiKey(provider, row.api_key_encrypted),
      endpoint: normalizeProviderEndpoint(row.endpoint),
      source: "cms",
    };
  } catch (error) {
    if (error?.code !== "42P01") {
      console.warn(
        "Không đọc được provider mặc định từ CMS, dùng cấu hình .env:",
        error.message,
      );
    }
    return null;
  }
}

async function getTranscriptionRuntimePlan() {
  const envProviders = getTranscriptionProviderChain();
  const cmsConfig = await getCmsTranscriptionProviderConfig();
  if (!cmsConfig) {
    return { providers: envProviders, configs: new Map() };
  }

  const providers = isProviderFailoverEnabled()
    ? Array.from(new Set([cmsConfig.provider, ...envProviders]))
    : [cmsConfig.provider];
  return {
    providers,
    configs: new Map([[cmsConfig.provider, cmsConfig]]),
  };
}

function getTranscriptionProviderPreference() {
  const configured = String(process.env.TRANSCRIPTION_PROVIDER || "auto")
    .trim()
    .toLowerCase();
  if (!configured || configured === "auto") return "auto";
  assertSupportedProvider(configured);
  return configured;
}

function isTranscriptionProviderConfigured(provider) {
  assertSupportedProvider(provider);
  if (provider === "vbee") {
    return (
      hasConfiguredProviderSecret(process.env.VBEE_API_KEY) ||
      (hasConfiguredProviderSecret(process.env.VBEE_STT_TOKEN) &&
        hasConfiguredProviderSecret(process.env.VBEE_STT_APP_ID))
    );
  }
  if (provider === "sonix") {
    return hasConfiguredProviderSecret(process.env.SONIX_API_KEY);
  }
  if (provider === "deepgram") {
    return hasConfiguredProviderSecret(process.env.DEEPGRAM_API_KEY);
  }
  return hasConfiguredProviderSecret(process.env.ASSEMBLYAI_API_KEY);
}

function getConfiguredProviderOrder() {
  const configured = String(process.env.TRANSCRIPTION_PROVIDER_CHAIN || "")
    .split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider) => provider && provider !== "auto");
  const providers = Array.from(
    new Set([
      ...configured,
      "vbee",
      "assemblyai",
      "deepgram",
      "sonix",
    ]),
  );
  providers.forEach(assertSupportedProvider);
  return providers;
}

function getTranscriptionProvider() {
  const preference = getTranscriptionProviderPreference();
  if (preference !== "auto") return preference;
  const providerOrder = getConfiguredProviderOrder();
  return (
    providerOrder.find(isTranscriptionProviderConfigured) ||
    providerOrder[0] ||
    "assemblyai"
  );
}

function isProviderFailoverEnabled() {
  return !["false", "0", "off", "no"].includes(
    String(process.env.PROVIDER_FAILOVER_ENABLED || "true")
      .trim()
      .toLowerCase(),
  );
}

function getTranscriptionProviderChain() {
  const primary = getTranscriptionProvider();
  const configured = String(process.env.TRANSCRIPTION_PROVIDER_CHAIN || "")
    .split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider) => provider && provider !== "auto");
  const requested = isProviderFailoverEnabled()
    ? [primary, ...configured]
    : [primary];
  const unique = Array.from(new Set(requested));
  unique.forEach(assertSupportedProvider);
  return unique;
}

function prioritizeProvidersForLanguage(providers, language, audioMode) {
  const selectedLanguage = normalizeLanguageCode(language, "auto");
  const needsCodeSwitching =
    selectedLanguage === "multi" ||
    (selectedLanguage === "auto" &&
      normalizeAudioMode(audioMode) === "song");
  if (!needsCodeSwitching || !providers.includes("assemblyai")) {
    return providers;
  }
  return [
    "assemblyai",
    ...providers.filter((provider) => provider !== "assemblyai"),
  ];
}

function getTranscriptionProviderStatus() {
  const chain = getTranscriptionProviderChain();
  const configured = Object.fromEntries(
    SUPPORTED_TRANSCRIPTION_PROVIDERS.map((provider) => [
      provider,
      isTranscriptionProviderConfigured(provider),
    ]),
  );
  return {
    preference: getTranscriptionProviderPreference(),
    active: chain.find((provider) => configured[provider]) || null,
    chain,
    configured,
  };
}

function assertSupportedProvider(provider) {
  if (!SUPPORTED_TRANSCRIPTION_PROVIDERS.includes(provider)) {
    throw createHttpError(
      503,
      `TRANSCRIPTION_PROVIDER không hợp lệ: ${provider}. Hỗ trợ: vbee, assemblyai, sonix hoặc deepgram.`,
    );
  }
}

function getAssemblyClient() {
  const apiKey = getProviderApiKey(
    "assemblyai",
    process.env.ASSEMBLYAI_API_KEY,
  );
  if (!hasConfiguredProviderSecret(apiKey)) {
    throw createProviderConfigurationError(
      "Chưa cấu hình ASSEMBLYAI_API_KEY trong backend/.env",
    );
  }
  return new AssemblyAI({ apiKey });
}

function getSonixApiKey() {
  const apiKey = getProviderApiKey("sonix", process.env.SONIX_API_KEY);
  if (!hasConfiguredProviderSecret(apiKey)) {
    throw createProviderConfigurationError(
      "Chưa cấu hình SONIX_API_KEY trong backend/.env",
    );
  }
  return apiKey;
}

function getDeepgramApiKey() {
  const apiKey = getProviderApiKey("deepgram", process.env.DEEPGRAM_API_KEY);
  if (!hasConfiguredProviderSecret(apiKey)) {
    throw createProviderConfigurationError(
      "Chưa cấu hình DEEPGRAM_API_KEY trong backend/.env",
    );
  }
  return apiKey;
}

function getVbeeAuthHeaders() {
  const apiKey = String(
    getProviderApiKey(
      "vbee",
      process.env.VBEE_API_KEY || process.env.AIMP_API_KEY,
    ) || "",
  ).trim();
  if (hasConfiguredProviderSecret(apiKey)) {
    const header = String(
      process.env.VBEE_API_KEY_HEADER ||
        process.env.VBEE_AUTH_HEADER ||
        "X-API-Key",
    ).trim();
    const scheme = String(
      process.env.VBEE_API_KEY_SCHEME ??
        process.env.VBEE_AUTH_SCHEME ??
        "",
    ).trim();
    if (!/^[A-Za-z0-9-]+$/.test(header)) {
      throw createProviderConfigurationError(
        "VBEE_API_KEY_HEADER không hợp lệ trong backend/.env",
      );
    }
    return {
      [header]: scheme ? `${scheme} ${apiKey}` : apiKey,
    };
  }

  const token = String(process.env.VBEE_STT_TOKEN || "").trim();
  const appId = String(process.env.VBEE_STT_APP_ID || "").trim();
  if (
    !hasConfiguredProviderSecret(token) ||
    !hasConfiguredProviderSecret(appId)
  ) {
    throw createProviderConfigurationError(
      "Chưa cấu hình VBEE_API_KEY hoặc cặp VBEE_STT_TOKEN và VBEE_STT_APP_ID trong backend/.env",
    );
  }
  return {
    Authorization: `Bearer ${token}`,
    "App-Id": appId,
  };
}

function assertProviderReady(provider) {
  assertSupportedProvider(provider);
  if (provider === "vbee") getVbeeAuthHeaders();
  else if (provider === "sonix") getSonixApiKey();
  else if (provider === "deepgram") getDeepgramApiKey();
  else getAssemblyClient();
  return provider;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProviderErrorStatus(error) {
  const status = Number(error?.statusCode || error?.status);
  return Number.isInteger(status) && status > 0 ? status : null;
}

function getProviderErrorCode(error) {
  const status = getProviderErrorStatus(error);
  if (status) return `HTTP_${status}`;
  return String(error?.code || error?.name || "PROVIDER_ERROR")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "_")
    .slice(0, 80);
}

function isProviderAvailabilityError(error) {
  const status = getProviderErrorStatus(error);
  if ([401, 402, 403, 408, 425, 429].includes(status)) return true;
  if (status && status >= 500) return true;
  if (["AbortError", "TimeoutError"].includes(error?.name)) return true;
  return [
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ].includes(String(error?.code || "").toUpperCase());
}

function isProviderCircuitFailure(error) {
  return (
    !error?.providerConfiguration &&
    !error?.providerLocalError &&
    isProviderAvailabilityError(error)
  );
}

function isProviderFallbackEligible(error) {
  if (typeof error?.providerFallbackEligible === "boolean") {
    return error.providerFallbackEligible;
  }
  return (
    Boolean(error?.providerConfiguration || error?.providerLocalError) ||
    Boolean(error?.providerCircuitOpen) ||
    isProviderAvailabilityError(error)
  );
}

function shouldRetrySameProvider(error) {
  if (!isProviderCircuitFailure(error)) return false;
  const status = getProviderErrorStatus(error);
  if ([401, 402, 403].includes(status)) return false;
  return true;
}

async function bestEffortCircuitUpdate(operation, provider) {
  try {
    await operation();
  } catch (error) {
    console.error(
      `Không cập nhật được circuit breaker ${provider}:`,
      error.message,
    );
  }
}

async function executeProviderWithResilience(provider, operation) {
  assertProviderReady(provider);

  let permit = { allowed: true, state: "unavailable", retryAfter: null };
  try {
    permit = await acquireProviderPermit(provider);
  } catch (error) {
    console.error(
      `Không đọc được circuit breaker ${provider}, tạm cho phép request:`,
      error.message,
    );
  }
  if (!permit.allowed) {
    const error = createHttpError(
      503,
      `${provider} đang tạm ngắt do lỗi liên tiếp.`,
    );
    error.providerCircuitOpen = true;
    error.retryAfter = permit.retryAfter || null;
    throw error;
  }

  for (let attempt = 1; attempt <= PROVIDER_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const result = await operation();
      await bestEffortCircuitUpdate(
        () => recordProviderSuccess(provider),
        provider,
      );
      return {
        ...result,
        providerRetryCount: attempt - 1,
      };
    } catch (error) {
      error.providerRetryCount = attempt - 1;
      if (!isProviderCircuitFailure(error)) {
        await bestEffortCircuitUpdate(
          () => recordProviderSuccess(provider),
          provider,
        );
        throw error;
      }

      if (attempt < PROVIDER_RETRY_ATTEMPTS && shouldRetrySameProvider(error)) {
        await delay(PROVIDER_RETRY_BASE_MS * Math.pow(2, attempt - 1));
        continue;
      }

      await bestEffortCircuitUpdate(
        () => recordProviderFailure(provider, error),
        provider,
      );
      throw error;
    }
  }

  throw createHttpError(503, `${provider} không thể xử lý yêu cầu.`);
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

async function sonixRequest(pathname, options = {}) {
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
    Authorization: `Bearer ${getSonixApiKey()}`,
    ...(options.headers || {}),
  };
  const { providerStage, ...requestOptions } = options;

  try {
    const response = await fetch(
      `${getProviderEndpoint("sonix", SONIX_API_BASE_URL)}${pathname}`,
      {
      ...requestOptions,
      signal:
        requestOptions.signal ||
        AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      headers,
      },
    );

    return await readResponseBody(response);
  } catch (error) {
    throw annotateProviderError(error, {
      provider: "sonix",
      stage: providerStage || "request",
    });
  }
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
}) {
  if (typeof fetch !== "function") {
    throw createHttpError(
      503,
      "Deepgram provider cần Node.js 18+ để dùng fetch.",
    );
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
  try {
    const response = await fetch(
      `${getProviderEndpoint("deepgram", DEEPGRAM_API_BASE_URL)}/listen?${params}`,
      {
      method: "POST",
      headers: {
        Authorization: `Token ${getDeepgramApiKey()}`,
        "Content-Type": file.mimetype || "application/octet-stream",
      },
      body: file.buffer,
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      },
    );
    body = await readResponseBody(response);
  } catch (error) {
    throw annotateProviderError(error, {
      provider: "deepgram",
      stage: "upload",
    });
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

async function vbeeSttRequest(pathname, options = {}) {
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

  const authHeaders = getVbeeAuthHeaders();
  const { providerStage, ...requestOptions } = options;
  try {
    const response = await fetch(
      `${getProviderEndpoint("vbee", VBEE_STT_API_BASE_URL)}${pathname}`,
      {
      ...requestOptions,
      signal:
        requestOptions.signal ||
        AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      headers: {
        ...authHeaders,
        ...(requestOptions.headers || {}),
      },
      },
    );
    return await readResponseBody(response);
  } catch (error) {
    throw annotateProviderError(error, {
      provider: "vbee",
      stage: providerStage || "request",
    });
  }
}

function unwrapVbeeResponse(response) {
  return response?.result || response?.data || response || {};
}

function getNestedValue(source, pathSpec) {
  const pathParts = String(pathSpec || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  return pathParts.reduce(
    (value, part) =>
      value !== null && value !== undefined ? value[part] : undefined,
    source,
  );
}

function firstDefined(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

function getVbeeStatus(response) {
  const body = unwrapVbeeResponse(response);
  return String(
    firstDefined(
      getNestedValue(response, process.env.VBEE_STATUS_PATH),
      body.status,
      body.state,
    ) || "",
  )
    .trim()
    .toUpperCase();
}

function getVbeeTranscriptId(response) {
  const body = unwrapVbeeResponse(response);
  return (
    firstDefined(
      getNestedValue(response, process.env.VBEE_ID_PATH),
      body.transcriptId,
      body.transcript_id,
      body.jobId,
      body.job_id,
      body.id,
    ) || null
  );
}

function getVbeeUtterances(response) {
  const body = unwrapVbeeResponse(response);
  const value = firstDefined(
    getNestedValue(response, process.env.VBEE_WORDS_PATH),
    body.utterances,
    body.words,
  );
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getVbeeDetectedLanguage(response) {
  const body = unwrapVbeeResponse(response);
  const utteranceLanguage = getVbeeUtterances(body)
    .map(
      (utterance) =>
        utterance.detectedLanguage ??
        utterance.detected_language ??
        utterance.languageCode ??
        utterance.language_code ??
        utterance.language,
    )
    .find(Boolean);
  const value =
    body.detectedLanguage ??
    body.detected_language ??
    body.languageCode ??
    body.language_code ??
    body.language ??
    body.metadata?.detectedLanguage ??
    body.metadata?.detected_language ??
    body.metadata?.languageCode ??
    body.metadata?.language_code ??
    utteranceLanguage;
  const normalized = normalizeLanguageCode(value, "");
  return normalized && normalized !== "auto" && normalized !== "multi"
    ? normalized
    : null;
}

function normalizeVbeeWords(response) {
  return getVbeeUtterances(response).map((utterance) => {
    const startSeconds = Number(
      utterance.startTime ?? utterance.start_time ?? utterance.start ?? 0,
    );
    const endSeconds = Number(
      utterance.endTime ?? utterance.end_time ?? utterance.end ?? startSeconds,
    );
    const speaker =
      utterance.speaker ?? utterance.speakerLabel ?? utterance.speaker_label;
    return {
      text: String(utterance.text || ""),
      start: Math.round(
        (Number.isFinite(startSeconds) ? startSeconds : 0) * 1000,
      ),
      end: Math.round(
        (Number.isFinite(endSeconds) ? endSeconds : startSeconds || 0) * 1000,
      ),
      speaker:
        speaker !== undefined && speaker !== null ? String(speaker) : null,
    };
  });
}

function buildTextFromVbee(response, speakerLabels) {
  const body = unwrapVbeeResponse(response);
  const utterances = getVbeeUtterances(body);
  if (
    speakerLabels &&
    utterances.some((utterance) => utterance.speaker != null)
  ) {
    return utterances
      .map((utterance) => {
        const text = String(utterance.text || "").trim();
        if (!text) return "";
        const speaker =
          utterance.speaker ??
          utterance.speakerLabel ??
          utterance.speaker_label ??
          "Người nói";
        return `${speaker}: ${text}`;
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return (
    String(
      firstDefined(
        getNestedValue(response, process.env.VBEE_TEXT_PATH),
        body.transcript,
        body.text,
        body.resultText,
        body.result_text,
      ) || "",
    ).trim() ||
    utterances
      .map((utterance) => String(utterance.text || "").trim())
      .filter(Boolean)
      .join(" ")
  );
}

async function submitVbeeTranscript(file, filename) {
  const form = new FormData();
  form.append(
    process.env.VBEE_FILE_FIELD || "audioContent",
    new Blob([file.buffer], { type: "audio/wav" }),
    filename,
  );
  if (process.env.VBEE_MODEL) {
    form.append(process.env.VBEE_MODEL_FIELD || "model", process.env.VBEE_MODEL);
  }
  if (process.env.VBEE_RESPONSE_FORMAT) {
    form.append(
      process.env.VBEE_RESPONSE_FORMAT_FIELD || "response_format",
      process.env.VBEE_RESPONSE_FORMAT,
    );
  }
  if (process.env.VBEE_LANGUAGE_FIELD) {
    form.append(
      process.env.VBEE_LANGUAGE_FIELD,
      normalizeLanguageCode(process.env.VBEE_LANGUAGE, "vi"),
    );
  }
  if (process.env.VBEE_FILENAME_FIELD) {
    form.append(process.env.VBEE_FILENAME_FIELD, filename);
  }
  if (process.env.VBEE_MODE_FIELD !== "false") {
    form.append(process.env.VBEE_MODE_FIELD || "mode", "async");
  }
  const webhookUrl = String(process.env.VBEE_STT_WEBHOOK_URL || "").trim();
  if (webhookUrl) form.append("webhookUrl", webhookUrl);

  return vbeeSttRequest(VBEE_TRANSCRIBE_PATH, {
    method: "POST",
    body: form,
    providerStage: "upload",
  });
}

async function waitForVbeeCompletion(transcriptId, initialResponse) {
  const startedAt = Date.now();
  let transcript = initialResponse;

  while (Date.now() - startedAt < VBEE_STT_TIMEOUT_MS) {
    const status = getVbeeStatus(transcript);
    if (["COMPLETED", "COMPLETE", "DONE", "SUCCESS"].includes(status)) {
      return transcript;
    }
    if (["FAILED", "ERROR", "REJECTED", "CANCELLED"].includes(status)) {
      const body = unwrapVbeeResponse(transcript);
      throw createHttpError(
        500,
        body.errorMessage ||
          body.error_message ||
          body.error?.message ||
          "Vbee xử lý transcript thất bại.",
      );
    }

    await delay(VBEE_STT_POLL_INTERVAL_MS);
    transcript = await vbeeSttRequest(
      VBEE_RESULT_PATH_TEMPLATE.replace(
        "{id}",
        encodeURIComponent(transcriptId),
      ),
      { method: "GET", providerStage: "poll" },
    );
  }

  throw createHttpError(
    504,
    "Vbee xử lý quá lâu. Vui lòng thử lại sau hoặc tăng VBEE_STT_TIMEOUT_MS.",
  );
}

async function transcribeWithVbee({ file, speakerLabels, filename, language }) {
  const wavFile = await prepareVbeeAudioForStt(file, filename);
  const submitted = await submitVbeeTranscript(
    wavFile,
    wavFile.originalname || `${stripExtension(filename)}.wav`,
  );
  const transcriptId = getVbeeTranscriptId(submitted);
  const submittedText = buildTextFromVbee(submitted, speakerLabels);
  if (!transcriptId && !submittedText) {
    throw createHttpError(
      500,
      "Vbee không trả về transcriptId hoặc văn bản sau khi tải file. Hãy kiểm tra các biến VBEE_*_PATH.",
    );
  }

  const submittedStatus = getVbeeStatus(submitted);
  const transcript =
    submittedText ||
    ["COMPLETED", "COMPLETE", "DONE", "SUCCESS"].includes(submittedStatus)
      ? submitted
      : await waitForVbeeCompletion(transcriptId, submitted);
  const body = unwrapVbeeResponse(transcript);
  return {
    provider: "vbee",
    providerId: transcriptId || null,
    duration:
      firstDefined(
        getNestedValue(transcript, process.env.VBEE_DURATION_PATH),
        body.audioDurationSeconds,
        body.audioDuration,
        body.duration,
      ) ?? null,
    text: buildTextFromVbee(transcript, speakerLabels),
    words: normalizeVbeeWords(transcript),
    detectedLanguage:
      getVbeeDetectedLanguage(transcript) ||
      (normalizeLanguageCode(language, "auto") === "auto"
        ? null
        : normalizeLanguageCode(language, null)),
  };
}

function getSonixLanguage() {
  const configured = normalizeLanguageCode(process.env.SONIX_LANGUAGE, "vi");
  return configured === "auto" || configured === "multi" ? "vi" : configured;
}

async function assertTranscriptionProviderReady() {
  const errors = [];
  const runtimePlan = await getTranscriptionRuntimePlan();
  for (const provider of runtimePlan.providers) {
    try {
      const providerConfig = runtimePlan.configs.get(provider) || {
        provider,
        source: "env",
      };
      return providerConfigContext.run(providerConfig, () =>
        assertProviderReady(provider),
      );
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw createProviderConfigurationError(
    `Không có nhà cung cấp chuyển đổi nào sẵn sàng. ${errors.join(" ")}`,
  );
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
  file,
  filename,
  language,
  dictionaryKeywords = [],
  customData = {},
) {
  const form = new FormData();
  if (file.size > SONIX_DIRECT_UPLOAD_MAX_MB * 1024 * 1024) {
    const fileUrl =
      file.fileUrl ||
      (typeof file.getFileUrl === "function" ? await file.getFileUrl() : null);
    if (!fileUrl) {
      throw createHttpError(
        503,
        `Sonix chỉ nhận multipart tối đa ${SONIX_DIRECT_UPLOAD_MAX_MB}MB. Backend chưa tạo được file_url công khai cho file này.`,
      );
    }
    form.append("file_url", fileUrl);
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

  return sonixRequest("/media", {
    method: "POST",
    body: form,
    providerStage: "upload",
  });
}

async function waitForSonixCompletion(mediaId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SONIX_TIMEOUT_MS) {
    const media = await sonixRequest(`/media/${encodeURIComponent(mediaId)}`, {
      method: "GET",
      providerStage: "poll",
    });

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
  customData = {},
}) {
  const uploadResult = await submitSonixMedia(
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

  const media = await waitForSonixCompletion(mediaId);
  const jsonTranscript = await sonixRequest(
    `/media/${encodeURIComponent(mediaId)}/transcript.json`,
    {
      method: "GET",
      providerStage: "download_transcript",
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

function getAssemblySpeechModels() {
  const configured = String(process.env.ASSEMBLYAI_SPEECH_MODELS || "")
    .split(",")
    .map((model) => model.trim().toLowerCase())
    .filter(Boolean);
  const requested =
    configured.length > 0
      ? configured
      : ["universal-3-5-pro", "universal-2"];
  return Array.from(
    new Set(
      requested.map((model) =>
        model === "universal-3-pro" ? "universal-3-5-pro" : model,
      ),
    ),
  );
}

function buildAssemblyTranscriptParams({
  file,
  speakerLabels,
  language,
  audioMode,
  dictionaryKeywords = [],
}) {
  const selectedLanguage = normalizeLanguageCode(language, "auto");
  const isSongMode = normalizeAudioMode(audioMode) === "song";
  const transcriptParams = {
    audio: file.buffer,
    speech_models: getAssemblySpeechModels(),
    speaker_labels: Boolean(speakerLabels) && !isSongMode,
  };

  if (selectedLanguage === "multi") {
    // Universal-2 supports automatic Vietnamese-English code switching.
    transcriptParams.speech_models = ["universal-2"];
    transcriptParams.language_detection = true;
    transcriptParams.language_detection_options = {
      expected_languages: ["vi", "en"],
      fallback_language: "auto",
      code_switching: true,
      code_switching_confidence_threshold: 0.3,
    };
  } else if (selectedLanguage === "auto") {
    transcriptParams.language_detection = true;
    if (isSongMode) {
      transcriptParams.speech_models = ["universal-2"];
      transcriptParams.language_detection_options = {
        expected_languages: ["vi", "en"],
        fallback_language: "auto",
        code_switching: true,
        code_switching_confidence_threshold: 0.3,
      };
    }
  } else {
    transcriptParams.language_code = selectedLanguage;
  }

  const keyterms = dictionaryKeywords
    .map((keyword) => String(keyword || "").trim())
    .filter(Boolean)
    .slice(0, 200);
  if (keyterms.length > 0) transcriptParams.keyterms_prompt = keyterms;

  return transcriptParams;
}

async function transcribeWithAssemblyAI({
  file,
  speakerLabels,
  language,
  audioMode,
  dictionaryKeywords,
  targetLanguage,
}) {
  const client = getAssemblyClient();
  const normalizedTarget = normalizeTranslateTarget(targetLanguage);
  const transcriptParams = buildAssemblyTranscriptParams({
    file,
    speakerLabels,
    language,
    audioMode,
    dictionaryKeywords,
  });
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

  let transcript;
  try {
    transcript = await client.transcripts.transcribe(transcriptParams);
  } catch (error) {
    throw annotateProviderError(error, {
      provider: "assemblyai",
      stage: "upload_and_transcribe",
    });
  }

  if (transcript.status === "error") {
    throw annotateProviderError(
      createHttpError(
        500,
        transcript.error || "Dịch vụ chuyển âm thanh thành văn bản trả về lỗi",
      ),
      {
        provider: "assemblyai",
        stage: "transcribe",
      },
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

  const codeSwitchingLanguages =
    transcript.language_detection_results?.code_switching_languages
      ?.map((item) => item.language)
      .filter(Boolean) || [];
  const detectedLanguage =
    transcript.language_code ||
    (codeSwitchingLanguages.length > 1
      ? codeSwitchingLanguages.join("+")
      : codeSwitchingLanguages[0]) ||
    null;

  return {
    provider: "assemblyai",
    providerId: transcript.id || null,
    duration: transcript.audio_duration || null,
    text,
    words: transcript.words || [],
    detectedLanguage,
    translation: translatedText
      ? {
          provider: "assemblyai-translation",
          text: translatedText,
          sourceLanguage: detectedLanguage || "auto",
          targetLanguage: normalizedTarget,
        }
      : null,
    translationError,
  };
}

async function translateAudioWithAssemblyAI({
  file,
  language = "auto",
  audioMode = "speech",
  targetLanguage,
}) {
  const result = await executeProviderWithResilience("assemblyai", () =>
    transcribeWithAssemblyAI({
      file,
      speakerLabels: false,
      language,
      audioMode: normalizeAudioMode(audioMode),
      dictionaryKeywords: [],
      targetLanguage,
    }),
  );
  if (!String(result.translation?.text || "").trim()) {
    throw createHttpError(
      502,
      result.translationError ||
        "AssemblyAI chưa trả về nội dung bản dịch.",
    );
  }
  return result.translation;
}

const PROVIDER_DISPLAY_NAMES = {
  vbee: "Vbee",
  assemblyai: "AssemblyAI",
  deepgram: "Deepgram",
  sonix: "Sonix",
};

function createProvidersExhaustedError({
  providerAttempts,
  providerErrors,
  audioMode,
}) {
  const failedAttempts = providerAttempts.filter(
    (attempt) => attempt.status === "failed",
  );
  const failedProviders = failedAttempts.map(
    (attempt) => PROVIDER_DISPLAY_NAMES[attempt.provider] || attempt.provider,
  );
  const allFailedResultsRejected =
    failedAttempts.length > 0 &&
    providerErrors
      .filter((entry) => entry.status === "failed")
      .every((entry) => Boolean(entry.error?.providerResultRejected));
  const hasRejectedResult = providerErrors.some(
    (entry) => entry.error?.providerResultRejected,
  );

  let statusCode = 503;
  let message;
  if (
    allFailedResultsRejected ||
    (hasRejectedResult && normalizeAudioMode(audioMode) === "song")
  ) {
    statusCode = 422;
    const rejected = providerErrors.find(
      (entry) => entry.error?.providerResultRejected,
    );
    message =
      rejected?.error?.code === "LOW_TRANSCRIPT_CONFIDENCE"
        ? rejected.error.message
        : normalizeAudioMode(audioMode) === "song"
          ? "Các API chuyển đổi đã được thử nhưng chưa phát hiện đủ lời hát để xuất văn bản. Hãy thử bản có vocal rõ hơn hoặc karaoke/acapella."
          : "Các API chuyển đổi đã được thử nhưng chưa phát hiện lời nói đủ rõ để xuất văn bản. Hãy thử file gốc có chất lượng tốt hơn.";
  } else if (failedProviders.length > 0) {
    message = `Không thể chuyển đổi file sau khi đã tự động thử: ${failedProviders.join(
      ", ",
    )}. Vui lòng thử lại sau.`;
  } else {
    message =
      "Không có API chuyển đổi nào đủ điều kiện xử lý. Vui lòng kiểm tra cấu hình các nhà cung cấp dự phòng.";
  }

  const error = createHttpError(statusCode, message);
  error.code = "TRANSCRIPTION_PROVIDERS_EXHAUSTED";
  error.providerAttempts = providerAttempts;
  error.retryable =
    statusCode >= 500 &&
    providerErrors.some(({ error: providerError }) =>
      shouldRetrySameProvider(providerError),
    );
  return error;
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
  const normalizedAudioMode = normalizeAudioMode(audioMode);
  const preprocessing =
    normalizedAudioMode === "song"
      ? await prepareMusicAudioForStt(file, filename)
      : { file, applied: false, method: null, warning: null };
  const providerFile = preprocessing.file;
  const providerFilename = providerFile.originalname || filename;
  const providerAttempts = [];
  const providerErrors = [];
  const runtimePlan = await getTranscriptionRuntimePlan();
  const providers = prioritizeProvidersForLanguage(
    runtimePlan.providers,
    language,
    normalizedAudioMode,
  );

  const runProvider = async (provider) => {
    if (provider === "vbee") {
      return transcribeWithVbee({
        file: providerFile,
        speakerLabels,
        filename: providerFilename,
        language,
      });
    }
    if (provider === "sonix") {
      return transcribeWithSonix({
        file: providerFile,
        speakerLabels,
        filename: providerFilename,
        language,
        dictionaryKeywords,
        customData: providerMetadata,
      });
    }
    if (provider === "deepgram") {
      return transcribeWithDeepgram({
        file: providerFile,
        speakerLabels,
        filename: providerFilename,
        language,
        dictionaryKeywords,
        transcriptionSettings,
      });
    }
    return transcribeWithAssemblyAI({
      file: providerFile,
      speakerLabels,
      language,
      audioMode: normalizedAudioMode,
      dictionaryKeywords,
      targetLanguage: translateTo,
    });
  };

  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    const attemptedAt = Date.now();
    try {
      const providerConfig = runtimePlan.configs.get(provider) || {
        provider,
        source: "env",
      };
      const result = await providerConfigContext.run(
        providerConfig,
        () =>
          executeProviderWithResilience(provider, async () => {
            const providerResult = await runProvider(provider);
            if (!String(providerResult?.text || "").trim()) {
              throw createProviderResultError(provider, normalizedAudioMode);
            }
            assertProviderResultQuality(providerResult, normalizedAudioMode);
            return providerResult;
          }),
      );
      providerAttempts.push({
        provider,
        status: "success",
        retryCount: Number(result?.providerRetryCount || 0),
        durationMs: Date.now() - attemptedAt,
      });
      return {
        ...result,
        providerAttempts,
        audioMode: normalizedAudioMode,
        preprocessingApplied: preprocessing.applied,
        preprocessingMethod: preprocessing.method,
        preprocessingWarning: preprocessing.warning,
      };
    } catch (error) {
      providerAttempts.push({
        provider,
        status:
          error.providerConfiguration || error.providerCircuitOpen
            ? "skipped"
            : "failed",
        errorCode: getProviderErrorCode(error),
        httpStatus: getProviderErrorStatus(error),
          retryCount: Number(error.providerRetryCount || 0),
          durationMs: Date.now() - attemptedAt,
          stage: error.providerStage || null,
        });
      providerErrors.push({
        provider,
        status:
          error.providerConfiguration || error.providerCircuitOpen
            ? "skipped"
            : "failed",
        error,
      });
      if (!isProviderFallbackEligible(error)) {
        error.providerAttempts = providerAttempts;
        throw error;
      }
    }
  }

  throw createProvidersExhaustedError({
    providerAttempts,
    providerErrors,
    audioMode: normalizedAudioMode,
  });
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
        assemblyTranscriptId:
          result.provider === "assemblyai" ? result.providerId : "",
        assemblyTranslate:
          result.provider === "assemblyai"
            ? undefined
            : async ({ targetLanguage: assemblyTargetLanguage }) => {
                const assemblyResult = await executeProviderWithResilience(
                  "assemblyai",
                  () =>
                    transcribeWithAssemblyAI({
                      file,
                      speakerLabels,
                      language: sourceLanguage,
                      audioMode: normalizeAudioMode(audioMode),
                      dictionaryKeywords,
                      targetLanguage: assemblyTargetLanguage,
                    }),
                );
                if (!assemblyResult.translation?.text) {
                  throw createHttpError(
                    502,
                    assemblyResult.translationError ||
                      "AssemblyAI chưa trả về nội dung bản dịch.",
                  );
                }
                return assemblyResult.translation;
              },
      });
      translationError = null;
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
    providerAttempts: result.providerAttempts || [],
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
         translation_error, transcription_provider, provider_request_id, provider_attempts
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
       RETURNING id, filename, file_size, duration, processing_seconds, text, words, audio_filename,
         source_language, translated_text, translation_target_language, translation_provider,
         translation_error, transcription_provider, provider_request_id, provider_attempts, created_at`,
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
        result.provider || null,
        result.providerId || null,
        JSON.stringify(result.providerAttempts || []),
      ],
    );
    await recordQuotaUsage({
      userId,
      transcriptionId: rows[0].id,
      durationSeconds: rows[0].duration,
      source: args.source || "upload",
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
      provider: rows[0].transcription_provider || result.provider,
      providerId: rows[0].provider_request_id || result.providerId,
      providerAttempts:
        rows[0].provider_attempts || result.providerAttempts || [],
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
  annotateProviderError,
  assertProviderResultQuality,
  createHttpError,
  createProviderResultError,
  createProvidersExhaustedError,
  getSongTranscriptQuality,
  buildAssemblyTranscriptParams,
  getTranscriptionProvider,
  getTranscriptionProviderChain,
  getTranscriptionProviderPreference,
  getTranscriptionProviderStatus,
  getVbeeAuthHeaders,
  isProviderFallbackEligible,
  isTranscriptionProviderConfigured,
  prioritizeProvidersForLanguage,
  assertTranscriptionProviderReady,
  probeMediaFile,
  resolveStoredAudioPath,
  translateAudioWithAssemblyAI,
  transcribeFile,
  transcribeAndSave,
};
