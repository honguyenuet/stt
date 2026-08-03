const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { normalizeFilename } = require("./filenameEncoding");

const MEDIA_EXTENSIONS = /\.(mp3|wav|m4a|ogg|flac|aac|mp4|webm)$/i;
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

function createMediaUpload(maxSizeMb) {
  return multer({
    storage,
    limits: {
      fileSize: maxSizeMb * 1024 * 1024,
      files: 1,
      fields: 30,
      parts: 40,
      fieldNameSize: 100,
      fieldSize: 64 * 1024,
    },
    fileFilter: (_req, file, callback) => {
      file.originalname = normalizeFilename(file.originalname);
      if (MEDIA_EXTENSIONS.test(file.originalname || "")) {
        return callback(null, true);
      }
      return callback(new Error("Định dạng file không được hỗ trợ"));
    },
  });
}

function createPlanAwareMediaUpload(resolveMaxSizeMb, fieldName = "audio") {
  return async (req, res, next) => {
    let maxSizeMb;
    try {
      maxSizeMb = Number(await resolveMaxSizeMb(req));
      if (!Number.isFinite(maxSizeMb) || maxSizeMb <= 0) {
        throw new Error("Giới hạn tải file không hợp lệ");
      }
    } catch (error) {
      return next(error);
    }

    req.mediaUploadLimitMb = maxSizeMb;
    return createMediaUpload(maxSizeMb).single(fieldName)(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res
          .status(413)
          .json({ error: `File quá lớn (tối đa ${maxSizeMb}MB)` });
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
  createMediaUpload,
  createPlanAwareMediaUpload,
  isInsideStaging,
  materializeFileBuffer,
};
