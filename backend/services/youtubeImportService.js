const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ffmpegStaticPath = require("ffmpeg-static");
const youtubeDlPackage = require("youtube-dl-exec");
const { STAGING_DIR, isInsideStaging } = require("./uploadStorage");
const { normalizeFilename } = require("./filenameEncoding");

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);
const YOUTUBE_ANONYMOUS_PLAYER_CLIENTS = new Set([
  "android_vr",
  "web_embedded",
]);

function positiveInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const METADATA_TIMEOUT_MS = positiveInt("YOUTUBE_METADATA_TIMEOUT_MS", 45_000);
const DOWNLOAD_TIMEOUT_MS = positiveInt("YOUTUBE_DOWNLOAD_TIMEOUT_MS", 10 * 60_000);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isEnabled() {
  return !["false", "0", "off", "no"].includes(
    String(process.env.YOUTUBE_IMPORT_ENABLED || "true")
      .trim()
      .toLowerCase(),
  );
}

function assertEnabled() {
  if (!isEnabled()) {
    throw createHttpError(503, "Máy chủ chưa bật chức năng nhập link YouTube.");
  }
}

function normalizeYoutubeUrl(input) {
  const raw = String(input || "").trim();
  if (!raw || raw.length > 2048) {
    throw createHttpError(400, "Link YouTube không hợp lệ.");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw createHttpError(400, "Link YouTube không hợp lệ.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443") ||
    !YOUTUBE_HOSTS.has(hostname)
  ) {
    throw createHttpError(
      400,
      "Chỉ chấp nhận link HTTPS từ youtube.com hoặc youtu.be.",
    );
  }

  if (parsed.pathname.toLowerCase().includes("/playlist")) {
    throw createHttpError(400, "Hiện tại chỉ hỗ trợ từng video, chưa hỗ trợ playlist.");
  }

  parsed.hash = "";
  return parsed.toString();
}

function getYoutubeDl() {
  const customPath = String(process.env.YT_DLP_PATH || "").trim();
  if (!customPath) return youtubeDlPackage;
  if (!path.isAbsolute(customPath)) {
    throw createHttpError(503, "YT_DLP_PATH phải là đường dẫn tuyệt đối.");
  }
  return youtubeDlPackage.create(customPath);
}

function youtubeErrorDetail(error) {
  return `${error?.stderr || ""}\n${error?.message || ""}`
    .replace(/[’‘]/g, "'")
    .toLowerCase();
}

function isYoutubeVerificationError(error) {
  const detail = youtubeErrorDetail(error);
  return (
    detail.includes("confirm you're not a bot") ||
    detail.includes("confirm you are not a bot")
  );
}

function getYoutubeAttemptProfiles() {
  if (String(process.env.YOUTUBE_COOKIES_FILE || "").trim()) {
    return [null];
  }

  const configured =
    process.env.YOUTUBE_FALLBACK_PLAYER_CLIENTS === undefined
      ? "android_vr"
      : process.env.YOUTUBE_FALLBACK_PLAYER_CLIENTS;
  const fallbackClients = String(configured || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => YOUTUBE_ANONYMOUS_PLAYER_CLIENTS.has(value));

  return [null, ...new Set(fallbackClients)];
}

function youtubeRuntimeFlags(playerClient = null) {
  const flags = {
    jsRuntimes: `node:${process.execPath}`,
  };
  const cookiesFile = String(process.env.YOUTUBE_COOKIES_FILE || "").trim();
  if (cookiesFile) {
    if (!path.isAbsolute(cookiesFile) || !fs.existsSync(cookiesFile)) {
      throw createHttpError(
        503,
        "Máy chủ chưa cấu hình đúng file xác thực YouTube.",
      );
    }
    flags.cookies = cookiesFile;
  }
  if (playerClient && !cookiesFile) {
    flags.extractorArgs = `youtube:player_client=${playerClient}`;
  }
  return flags;
}

async function runYoutubeDlWithFallback(operation, { beforeRetry } = {}) {
  const profiles = getYoutubeAttemptProfiles();
  let verificationError = null;

  for (let index = 0; index < profiles.length; index += 1) {
    const playerClient = profiles[index];
    try {
      return await operation(youtubeRuntimeFlags(playerClient));
    } catch (error) {
      if (index === 0 && !isYoutubeVerificationError(error)) {
        throw error;
      }
      verificationError ||= error;
      if (index >= profiles.length - 1) {
        throw verificationError;
      }
      await beforeRetry?.();
      console.warn(
        `YouTube yêu cầu xác minh; thử lại bằng client công khai ${profiles[index + 1]}.`,
      );
    }
  }

  throw verificationError || new Error("Không thể kết nối YouTube.");
}

function sanitizeTitle(value) {
  const normalized = normalizeFilename(String(value || "Video YouTube"))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "Video YouTube").slice(0, 160);
}

function mapYoutubeError(error, fallback) {
  if (error?.statusCode) return error;
  const detail = youtubeErrorDetail(error);
  if (detail.includes("timed out") || detail.includes("timeout")) {
    return createHttpError(504, "YouTube phản hồi quá chậm. Vui lòng thử lại.");
  }
  if (isYoutubeVerificationError(error)) {
    return createHttpError(
      503,
      "YouTube đang yêu cầu máy chủ xác minh. Vui lòng thử video công khai khác hoặc liên hệ quản trị viên.",
    );
  }
  if (
    detail.includes("private video") ||
    detail.includes("sign in") ||
    detail.includes("age-restricted") ||
    detail.includes("members-only")
  ) {
    return createHttpError(
      422,
      "Video riêng tư, giới hạn độ tuổi hoặc yêu cầu đăng nhập nên không thể xử lý.",
    );
  }
  if (detail.includes("unsupported url")) {
    return createHttpError(400, "Link YouTube không được hỗ trợ.");
  }
  if (detail.includes("unavailable") || detail.includes("removed")) {
    return createHttpError(422, "Video không còn khả dụng trên YouTube.");
  }
  if (detail.includes("file is larger") || detail.includes("max-filesize")) {
    return createHttpError(413, "Audio của video vượt giới hạn dung lượng gói hiện tại.");
  }
  return createHttpError(422, fallback);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function getYoutubeMetadata(inputUrl) {
  assertEnabled();
  const url = normalizeYoutubeUrl(inputUrl);
  try {
    const raw = await runYoutubeDlWithFallback((runtimeFlags) =>
      getYoutubeDl()(
        url,
        {
          ...runtimeFlags,
          dumpSingleJson: true,
          skipDownload: true,
          noPlaylist: true,
          format: "bestaudio[ext=m4a]/bestaudio/best",
          noWarnings: true,
          socketTimeout: 20,
          retries: 1,
        },
        {
          timeout: METADATA_TIMEOUT_MS,
          maxBuffer: 12 * 1024 * 1024,
          windowsHide: true,
        },
      ),
    );
    const metadata = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!metadata || metadata._type === "playlist") {
      throw createHttpError(400, "Hiện tại chỉ hỗ trợ từng video YouTube.");
    }
    if (metadata.is_live || ["is_live", "is_upcoming"].includes(metadata.live_status)) {
      throw createHttpError(400, "Chưa hỗ trợ video đang phát trực tiếp hoặc sắp phát.");
    }

    const durationSeconds = numberOrNull(metadata.duration);
    if (!durationSeconds) {
      throw createHttpError(422, "Không đọc được thời lượng của video YouTube.");
    }

    const title = sanitizeTitle(metadata.title);
    return {
      url,
      videoId: String(metadata.id || "").slice(0, 32),
      title,
      filename: `${title}.m4a`,
      durationSeconds: Math.ceil(durationSeconds),
      approximateBytes:
        numberOrNull(metadata.filesize) || numberOrNull(metadata.filesize_approx),
      thumbnail:
        typeof metadata.thumbnail === "string" && metadata.thumbnail.startsWith("https://")
          ? metadata.thumbnail
          : null,
      channel: sanitizeTitle(metadata.channel || metadata.uploader || "YouTube"),
    };
  } catch (error) {
    throw mapYoutubeError(error, "Không đọc được thông tin video YouTube.");
  }
}

function mimeTypeForExtension(extension) {
  const types = {
    ".aac": "audio/aac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".webm": "audio/webm",
  };
  return types[extension] || "application/octet-stream";
}

async function cleanupPrefix(prefix) {
  const entries = await fs.promises.readdir(STAGING_DIR).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => fs.promises.unlink(path.join(STAGING_DIR, entry)).catch(() => {})),
  );
}

async function downloadYoutubeAudio(inputUrl, { maxSizeMb, metadata: knownMetadata } = {}) {
  assertEnabled();
  const metadata = knownMetadata || (await getYoutubeMetadata(inputUrl));
  const maxBytes = Math.max(1, Number(maxSizeMb || 1)) * 1024 * 1024;
  const prefix = `youtube-${Date.now()}-${crypto.randomBytes(16).toString("hex")}`;
  const outputTemplate = path.join(STAGING_DIR, `${prefix}.%(ext)s`);

  try {
    await runYoutubeDlWithFallback(
      (runtimeFlags) =>
        getYoutubeDl()(
          metadata.url,
          {
            ...runtimeFlags,
            extractAudio: true,
            audioFormat: "m4a",
            audioQuality: "128K",
            format: "bestaudio[ext=m4a]/bestaudio/best",
            output: outputTemplate,
            noPlaylist: true,
            noWarnings: true,
            noPart: true,
            maxFilesize: `${Math.max(1, Math.floor(Number(maxSizeMb || 1)))}M`,
            ffmpegLocation: ffmpegStaticPath,
            socketTimeout: 30,
            retries: 2,
          },
          {
            timeout: DOWNLOAD_TIMEOUT_MS,
            maxBuffer: 8 * 1024 * 1024,
            windowsHide: true,
          },
        ),
      {
        beforeRetry: () => cleanupPrefix(prefix),
      },
    );

    const entries = await fs.promises.readdir(STAGING_DIR);
    const candidates = entries.filter(
      (entry) => entry.startsWith(`${prefix}.`) && !entry.endsWith(".part"),
    );
    if (candidates.length !== 1) {
      throw createHttpError(422, "YouTube không trả về luồng âm thanh có thể xử lý.");
    }

    const filePath = path.join(STAGING_DIR, candidates[0]);
    if (!isInsideStaging(filePath)) {
      throw createHttpError(400, "Đường dẫn file YouTube không hợp lệ.");
    }
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) {
      throw createHttpError(422, "Audio lấy từ YouTube bị rỗng.");
    }
    if (stat.size > maxBytes) {
      throw createHttpError(
        413,
        `Audio của video vượt giới hạn ${Math.floor(Number(maxSizeMb))}MB của gói hiện tại.`,
      );
    }

    const extension = path.extname(filePath).toLowerCase();
    return {
      metadata,
      file: {
        fieldname: "audio",
        originalname: metadata.filename,
        encoding: "7bit",
        mimetype: mimeTypeForExtension(extension),
        destination: STAGING_DIR,
        filename: path.basename(filePath),
        path: filePath,
        size: stat.size,
      },
    };
  } catch (error) {
    await cleanupPrefix(prefix);
    throw mapYoutubeError(error, "Không tải được audio từ video YouTube.");
  }
}

module.exports = {
  downloadYoutubeAudio,
  getYoutubeAttemptProfiles,
  getYoutubeMetadata,
  isYoutubeVerificationError,
  normalizeYoutubeUrl,
  runYoutubeDlWithFallback,
};
