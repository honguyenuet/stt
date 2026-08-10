const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { normalizeFilename } = require("./filenameEncoding");
const {
  DEFAULT_SUPPORTED_MEDIA_FORMATS,
  SAFE_MEDIA_FORMATS,
} = require("./adminSettingsService");

const DEFAULT_MEDIA_FORMATS = DEFAULT_SUPPORTED_MEDIA_FORMATS;
const STAGING_DIR = path.resolve(
  process.env.UPLOAD_STAGING_DIR || path.join(__dirname, "..", "upload-staging"),
);

fs.mkdirSync(STAGING_DIR, { recursive: true, mode: 0o700 });

function safeExtension(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase();
  return /^\.[a-z0-9]{2,5}$/.test(extension) ? extension : ".bin";
}

function isInsideStaging(filePath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  return resolved === STAGING_DIR || resolved.startsWith(`${STAGING_DIR}${path.sep}`);
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, STAGING_DIR),
  filename: (_req, file, callback) => {
    callback(
      null,
      `${Date.now()}-${crypto.randomBytes(18).toString("hex")}${safeExtension(file.originalname)}`,
    );
  },
});

function normalizeAllowedFormats(formats) {
  const values = Array.isArray(formats) ? formats : DEFAULT_MEDIA_FORMATS;
  const safe = [
    ...new Set(
      values
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => SAFE_MEDIA_FORMATS.has(value)),
    ),
  ];
  return new Set(safe.length > 0 ? safe : DEFAULT_MEDIA_FORMATS);
}

function createMediaUpload(maxSizeMb, maxFiles = 1, supportedFormats = null) {
  const allowedFormats = normalizeAllowedFormats(supportedFormats);
  return multer({
    storage,
    limits: {
      fileSize: maxSizeMb * 1024 * 1024,
      files: maxFiles,
      fields: 30,
      parts: 40,
      fieldNameSize: 100,
      fieldSize: 64 * 1024,
    },
    fileFilter: (_req, file, callback) => {
      file.originalname = normalizeFilename(file.originalname);
      const extension = path
        .extname(file.originalname || "")
        .slice(1)
        .toLowerCase();
      if (allowedFormats.has(extension)) {
        return callback(null, true);
      }
      return callback(
        new Error(
          `Định dạng file không được hỗ trợ. Cho phép: ${[
            ...allowedFormats,
          ].join(", ")}`,
        ),
      );
    },
  });
}

function createPlanAwareMediaUpload(
  resolveMaxSizeMb,
  fieldName = "audio",
  { maxFiles = 1 } = {},
) {
  return async (req, res, next) => {
    let maxSizeMb;
    let supportedFormats;
    try {
      const resolved = await resolveMaxSizeMb(req);
      const uploadPolicy =
        resolved && typeof resolved === "object"
          ? resolved
          : { maxSizeMb: resolved };
      maxSizeMb = Number(uploadPolicy.maxSizeMb);
      supportedFormats = uploadPolicy.supportedFormats;
      if (!Number.isFinite(maxSizeMb) || maxSizeMb <= 0) {
        throw new Error("Giới hạn tải file không hợp lệ");
      }
    } catch (error) {
      return next(error);
    }

    req.mediaUploadLimitMb = maxSizeMb;
    const mediaUpload = createMediaUpload(
      maxSizeMb,
      maxFiles,
      supportedFormats,
    );
    const middleware =
      maxFiles > 1
        ? mediaUpload.array(fieldName, maxFiles)
        : mediaUpload.single(fieldName);
    return middleware(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res
          .status(413)
          .json({ error: `File quá lớn (tối đa ${maxSizeMb}MB)` });
      }
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT") {
        return res
          .status(400)
          .json({ error: `Chỉ được tải tối đa ${maxFiles} file mỗi lần` });
      }
      if (error) return res.status(400).json({ error: error.message });
      return next();
    });
  };
}

async function cleanupStagedFile(file) {
  if (!isInsideStaging(file?.path)) return;
  await fs.promises.unlink(file.path).catch(() => {});
  file.path = null;
}

async function cleanupStagedFiles(files) {
  await Promise.all((Array.isArray(files) ? files : []).map(cleanupStagedFile));
}

async function materializeFileBuffer(file, maxSizeMb) {
  if (!file?.path || !isInsideStaging(file.path)) {
    const error = new Error("File tải lên không hợp lệ");
    error.statusCode = 400;
    throw error;
  }
  const stat = await fs.promises.stat(file.path);
  const maxBytes = maxSizeMb * 1024 * 1024;
  if (!stat.isFile() || stat.size <= 0) {
    const error = new Error("File tải lên rỗng hoặc không hợp lệ");
    error.statusCode = 400;
    throw error;
  }
  if (stat.size > maxBytes) {
    const error = new Error(
      `Chế độ xử lý đồng bộ chỉ nhận file tối đa ${maxSizeMb}MB. Hãy gửi async=true để dùng hàng đợi.`,
    );
    error.statusCode = 413;
    throw error;
  }
  return {
    ...file,
    size: stat.size,
    buffer: await fs.promises.readFile(file.path),
  };
}

async function cleanupExpiredStagingFiles(maxAgeMinutes = 60) {
  const cutoff = Date.now() - Math.max(5, maxAgeMinutes) * 60 * 1000;
  const entries = await fs.promises.readdir(STAGING_DIR, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = path.join(STAGING_DIR, entry.name);
        const stat = await fs.promises.stat(filePath).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) {
          await fs.promises.unlink(filePath).catch(() => {});
        }
      }),
  );
}

module.exports = {
  STAGING_DIR,
  cleanupExpiredStagingFiles,
  cleanupStagedFile,
  cleanupStagedFiles,
  createMediaUpload,
  createPlanAwareMediaUpload,
  isInsideStaging,
  materializeFileBuffer,
  normalizeAllowedFormats,
};
