const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ffmpegStaticPath = require("ffmpeg-static");
const youtubeDlPackage = require("youtube-dl-exec");
const { IS_PRODUCTION } = require("../config/security");
const { STAGING_DIR, isInsideStaging } = require("./uploadStorage");
const { normalizeFilename } = require("./filenameEncoding");
const {
  assertPublicWebhookDestination,
  isPrivateWebhookHost,
} = require("./customerWebhookService");

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);
const SPOTIFY_HOSTS = new Set(["spotify.com", "open.spotify.com"]);
const DEFAULT_MEDIA_IMPORT_HOSTS = [
  "youtube.com",
  "youtu.be",
  "soundcloud.com",
  "tiktok.com",
  "facebook.com",
  "fb.watch",
  "instagram.com",
  "vimeo.com",
  "dailymotion.com",
  "dai.ly",
  "twitch.tv",
  "x.com",
  "twitter.com",
  "reddit.com",
  "redd.it",
  "streamable.com",
  "loom.com",
  "archive.org",
  "podbean.com",
  "buzzsprout.com",
  "simplecast.com",
  "spreaker.com",
];
const YOUTUBE_ANONYMOUS_PLAYER_CLIENTS = new Set([
  "android_vr",
  "web_embedded",
]);

function positiveInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const METADATA_TIMEOUT_MS = positiveInt(
  "MEDIA_URL_METADATA_TIMEOUT_MS",
  positiveInt("YOUTUBE_METADATA_TIMEOUT_MS", 45_000),
);
const DOWNLOAD_TIMEOUT_MS = positiveInt(
  "MEDIA_URL_DOWNLOAD_TIMEOUT_MS",
  positiveInt("YOUTUBE_DOWNLOAD_TIMEOUT_MS", 10 * 60_000),
);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isEnabled() {
  return !["false", "0", "off", "no"].includes(
    String(
      process.env.MEDIA_URL_IMPORT_ENABLED ??
        process.env.YOUTUBE_IMPORT_ENABLED ??
        "true",
    )
      .trim()
      .toLowerCase(),
  );
}

function assertEnabled() {
  if (!isEnabled()) {
    throw createHttpError(503, "Máy chủ chưa bật chức năng nhập link media.");
  }
}

function getMediaImportEgressProxy({ production = IS_PRODUCTION } = {}) {
  const raw = String(process.env.MEDIA_IMPORT_EGRESS_PROXY_URL || "").trim();
  if (!raw) {
    if (production) {
      throw createHttpError(
        503,
        "Production phải cấu hình MEDIA_IMPORT_EGRESS_PROXY_URL tới egress proxy có lọc SSRF.",
      );
    }
    return null;
  }

  let proxy;
  try {
    proxy = new URL(raw);
  } catch {
    throw createHttpError(503, "MEDIA_IMPORT_EGRESS_PROXY_URL không hợp lệ.");
  }
  if (!["http:", "https:"].includes(proxy.protocol) || proxy.hash) {
    throw createHttpError(
      503,
      "MEDIA_IMPORT_EGRESS_PROXY_URL phải là HTTP hoặc HTTPS và không chứa fragment.",
    );
  }
  return proxy.toString();
}

function normalizeHost(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
}

function isHostOrSubdomain(hostname, allowedHost) {
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
}

function getAllowedMediaHosts() {
  const configured = String(process.env.MEDIA_IMPORT_HOSTS || "")
    .split(",")
    .map(normalizeHost)
    .filter(
      (host) =>
        host.includes(".") &&
        !host.includes("..") &&
        /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host),
    );
  return configured.length > 0 ? configured : DEFAULT_MEDIA_IMPORT_HOSTS;
}

function isYoutubeHost(hostname) {
  const host = normalizeHost(hostname);
  return [...YOUTUBE_HOSTS].some((allowed) => isHostOrSubdomain(host, allowed));
}

function isSpotifyHost(hostname) {
  const host = normalizeHost(hostname);
  return [...SPOTIFY_HOSTS].some((allowed) => isHostOrSubdomain(host, allowed));
}

function normalizeMediaUrl(input) {
  const raw = String(input || "").trim();
  if (!raw || raw.length > 2048) {
    throw createHttpError(400, "Link audio/video không hợp lệ.");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw createHttpError(400, "Link audio/video không hợp lệ.");
  }

  const hostname = normalizeHost(parsed.hostname);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw createHttpError(
      400,
      "Chỉ chấp nhận link HTTPS công khai, không chứa tài khoản hoặc cổng tùy chỉnh.",
    );
  }

  if (isPrivateWebhookHost(hostname)) {
    throw createHttpError(400, "Link không được trỏ vào máy cục bộ hoặc mạng nội bộ.");
  }
  if (isSpotifyHost(hostname)) {
    throw createHttpError(
      422,
      "Spotify không cung cấp luồng audio công khai cho công cụ nhập link. Hãy tải lên file bạn sở hữu hoặc được phép sử dụng.",
    );
  }
  if (
    !getAllowedMediaHosts().some((allowed) =>
      isHostOrSubdomain(hostname, allowed),
    )
  ) {
    throw createHttpError(
      400,
      "Nền tảng của link này chưa được hỗ trợ. Hãy dùng YouTube, SoundCloud, TikTok, Facebook, Instagram, Vimeo hoặc nguồn podcast công khai.",
    );
  }

  if (
    isYoutubeHost(hostname) &&
    parsed.pathname.toLowerCase().includes("/playlist")
  ) {
    throw createHttpError(400, "Hiện tại chỉ hỗ trợ từng nội dung, chưa hỗ trợ playlist.");
  }

  parsed.hash = "";
  return parsed.toString();
}

async function assertPublicMediaDestination(url) {
  try {
    await assertPublicWebhookDestination(url);
  } catch (error) {
    if (error?.statusCode) {
      throw createHttpError(400, "Link không được trỏ vào mạng nội bộ.");
    }
    throw createHttpError(502, "Không phân giải được địa chỉ của nền tảng media.");
  }
}

function collectMetadataDestinations(value, key = "", destinations = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectMetadataDestinations(item, key, destinations));
    return destinations;
  }
  if (!value || typeof value !== "object") return destinations;

  for (const [childKey, childValue] of Object.entries(value)) {
    if (
      typeof childValue === "string" &&
      /(?:^|_)url$/i.test(childKey) &&
      /^https?:\/\//i.test(childValue)
    ) {
      let parsed;
      try {
        parsed = new URL(childValue);
      } catch {
        throw createHttpError(422, "Nhà cung cấp trả về URL media không hợp lệ.");
      }
      if (parsed.username || parsed.password) {
        throw createHttpError(
          400,
          "URL media do nhà cung cấp trả về không được chứa thông tin đăng nhập.",
        );
      }
      destinations.set(parsed.host.toLowerCase(), parsed);
      if (destinations.size > 256) {
        throw createHttpError(422, "Nhà cung cấp trả về quá nhiều đích media.");
      }
    } else {
      collectMetadataDestinations(childValue, childKey, destinations);
    }
  }
  return destinations;
}

async function assertPublicMediaMetadata(metadata, { lookup } = {}) {
  const destinations = collectMetadataDestinations(metadata);
  try {
    await Promise.all(
      [...destinations.values()].map((destination) =>
        assertPublicWebhookDestination(destination, lookup),
      ),
    );
  } catch (error) {
    if (error?.statusCode) {
      throw createHttpError(
        400,
        "Nhà cung cấp trả về URL media trỏ vào mạng nội bộ.",
      );
    }
    throw createHttpError(502, "Không phân giải được đích tải media.");
  }
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

function isYoutubeDownloadAccessError(error) {
  const detail = youtubeErrorDetail(error);
  return (
    detail.includes("http error 403") ||
    (detail.includes("forbidden") &&
      (detail.includes("download") || detail.includes("video data")))
  );
}

function getYoutubeAttemptProfiles(isYoutube = true) {
  if (!isYoutube) return [null];
  if (String(process.env.YOUTUBE_COOKIES_FILE || "").trim()) {
    return [null];
  }

  const configured =
    process.env.YOUTUBE_FALLBACK_PLAYER_CLIENTS === undefined
      ? "android_vr,web_embedded"
      : process.env.YOUTUBE_FALLBACK_PLAYER_CLIENTS;
  const fallbackClients = String(configured || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => YOUTUBE_ANONYMOUS_PLAYER_CLIENTS.has(value));

  return [null, ...new Set(fallbackClients)];
}

function youtubeRuntimeFlags(
  playerClient = null,
  { isYoutube = true, production = IS_PRODUCTION } = {},
) {
  const egressProxy = getMediaImportEgressProxy({ production });
  const flags = {
    jsRuntimes: `node:${process.execPath}`,
  };
  if (egressProxy) flags.proxy = egressProxy;
  if (!isYoutube) return flags;
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

async function runYoutubeDlWithFallback(
  operation,
  { beforeRetry, isYoutube = true } = {},
) {
  const profiles = getYoutubeAttemptProfiles(isYoutube);
  let fallbackError = null;

  for (let index = 0; index < profiles.length; index += 1) {
    const playerClient = profiles[index];
    try {
      return await operation(youtubeRuntimeFlags(playerClient, { isYoutube }));
    } catch (error) {
      const verificationRequired = isYoutubeVerificationError(error);
      const downloadAccessDenied = isYoutubeDownloadAccessError(error);
      if (!isYoutube || (!verificationRequired && !downloadAccessDenied)) {
        throw error;
      }
      fallbackError ||= error;
      if (index >= profiles.length - 1) {
        throw fallbackError;
      }
      await beforeRetry?.();
      console.warn(
        `YouTube ${verificationRequired ? "yêu cầu xác minh" : "từ chối luồng tải"}; thử lại bằng client công khai ${profiles[index + 1]}.`,
      );
    }
  }

  throw fallbackError || new Error("Không thể kết nối nền tảng media.");
}

function sanitizeTitle(value) {
  const normalized = normalizeFilename(String(value || "Nội dung trực tuyến"))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "Nội dung trực tuyến").slice(0, 160);
}

function mapMediaImportError(error, fallback, { isYoutube = false } = {}) {
  if (error?.statusCode) return error;
  const detail = youtubeErrorDetail(error);
  if (detail.includes("timed out") || detail.includes("timeout")) {
    return createHttpError(504, "Nền tảng media phản hồi quá chậm. Vui lòng thử lại.");
  }
  if (isYoutube && isYoutubeVerificationError(error)) {
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
      "Nội dung riêng tư, giới hạn độ tuổi hoặc yêu cầu đăng nhập nên không thể xử lý.",
    );
  }
  if (detail.includes("drm") || detail.includes("protected content")) {
    return createHttpError(
      422,
      "Nội dung được bảo vệ DRM nên không thể nhập trực tiếp. Hãy tải lên file bạn có quyền sử dụng.",
    );
  }
  if (detail.includes("unsupported url")) {
    return createHttpError(400, "Nền tảng hoặc định dạng link này chưa được hỗ trợ.");
  }
  if (detail.includes("unavailable") || detail.includes("removed")) {
    return createHttpError(422, "Nội dung không còn khả dụng trên nền tảng nguồn.");
  }
  if (detail.includes("file is larger") || detail.includes("max-filesize")) {
    return createHttpError(413, "Audio vượt giới hạn dung lượng gói hiện tại.");
  }
  return createHttpError(422, fallback);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function getMediaMetadata(inputUrl) {
  assertEnabled();
  const url = normalizeMediaUrl(inputUrl);
  const hostname = new URL(url).hostname;
  const isYoutube = isYoutubeHost(hostname);
  await assertPublicMediaDestination(url);
  try {
    const raw = await runYoutubeDlWithFallback(
      (runtimeFlags) =>
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
      { isYoutube },
    );
    const metadata = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!metadata || metadata._type === "playlist") {
      throw createHttpError(400, "Hiện tại chỉ hỗ trợ từng nội dung, chưa hỗ trợ playlist.");
    }
    if (metadata.is_live || ["is_live", "is_upcoming"].includes(metadata.live_status)) {
      throw createHttpError(400, "Chưa hỗ trợ nội dung đang phát trực tiếp hoặc sắp phát.");
    }
    await assertPublicMediaMetadata(metadata);

    const durationSeconds = numberOrNull(metadata.duration);
    if (!durationSeconds) {
      throw createHttpError(422, "Không đọc được thời lượng của nội dung.");
    }

    const title = sanitizeTitle(metadata.title);
    const platform = sanitizeTitle(
      metadata.extractor_key || metadata.extractor || hostname,
    );
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
      channel: sanitizeTitle(metadata.channel || metadata.uploader || platform),
      platform,
      sourceHost: normalizeHost(hostname),
    };
  } catch (error) {
    throw mapMediaImportError(
      error,
      "Không đọc được thông tin audio/video từ link này.",
      { isYoutube },
    );
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

async function downloadMediaAudio(inputUrl, { maxSizeMb, metadata: knownMetadata } = {}) {
  assertEnabled();
  const metadata = knownMetadata || (await getMediaMetadata(inputUrl));
  const isYoutube = isYoutubeHost(new URL(metadata.url).hostname);
  await assertPublicMediaDestination(metadata.url);
  const maxBytes = Math.max(1, Number(maxSizeMb || 1)) * 1024 * 1024;
  const prefix = `media-${Date.now()}-${crypto.randomBytes(16).toString("hex")}`;
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
        isYoutube,
      },
    );

    const entries = await fs.promises.readdir(STAGING_DIR);
    const candidates = entries.filter(
      (entry) => entry.startsWith(`${prefix}.`) && !entry.endsWith(".part"),
    );
    if (candidates.length !== 1) {
      throw createHttpError(422, "Nền tảng không trả về luồng âm thanh có thể xử lý.");
    }

    const filePath = path.join(STAGING_DIR, candidates[0]);
    if (!isInsideStaging(filePath)) {
      throw createHttpError(400, "Đường dẫn file media không hợp lệ.");
    }
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) {
      throw createHttpError(422, "Audio lấy từ link bị rỗng.");
    }
    if (stat.size > maxBytes) {
      throw createHttpError(
        413,
        `Audio từ link vượt giới hạn ${Math.floor(Number(maxSizeMb))}MB của gói hiện tại.`,
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
    throw mapMediaImportError(
      error,
      "Không tải được audio từ link này.",
      { isYoutube },
    );
  }
}

module.exports = {
  assertPublicMediaMetadata,
  downloadMediaAudio,
  downloadYoutubeAudio: downloadMediaAudio,
  getAllowedMediaHosts,
  getMediaImportEgressProxy,
  getMediaMetadata,
  getYoutubeAttemptProfiles,
  getYoutubeMetadata: getMediaMetadata,
  isYoutubeHost,
  isYoutubeVerificationError,
  normalizeMediaUrl,
  normalizeYoutubeUrl: normalizeMediaUrl,
  runYoutubeDlWithFallback,
};
