const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const {
  ALLOWED_EXT,
  getTranscriptionProviderChain,
  normalizeSpeakerCount,
  resolveStoredAudioPath,
  transcribeFile,
} = require("./transcriptionService");
const { createProviderFileUrl } = require("./providerFileAccess");
const { normalizeFilename } = require("./filenameEncoding");
const { isInsideStaging } = require("./uploadStorage");
const { resolveUserFolder } = require("./workspaceFolderService");
const {
  deliverAndRecordCustomerWebhook,
} = require("./customerWebhookService");
const { finalizeMultitrackBatch } = require("./multitrackService");
const { getAdminSettings } = require("./adminSettingsService");
const {
  hasSmtpConfig,
  sendJobFailureAdminAlertEmail,
} = require("./emailService");
const {
  recordQuotaUsage,
  validateAfterTranscription,
  validateBeforeTranscription,
} = require("./quotaService");
const { recordApiUsage } = require("./apiUsageService");
const {
  generateTranscriptInsights,
  normalizeTranscriptTemplate,
} = require("./transcriptInsightsService");

function getEnvInt(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeQueueTranslationTarget(value) {
  const clean = String(value || "").trim();
  return !clean || clean.toLowerCase() === "none" ? null : clean;
}

const QUEUE_CONCURRENCY = getEnvInt("TRANSCRIPTION_QUEUE_CONCURRENCY", 2);
const QUEUE_POLL_MS = getEnvInt("TRANSCRIPTION_QUEUE_POLL_MS", 1000);
const QUEUE_STALE_SECONDS = getEnvInt(
  "TRANSCRIPTION_QUEUE_STALE_SECONDS",
  20 * 60,
);
const QUEUE_JOB_TIMEOUT_SECONDS = getEnvInt(
  "TRANSCRIPTION_JOB_TIMEOUT_SECONDS",
  60 * 60,
);
const QUEUE_MAX_ATTEMPTS = getEnvInt("TRANSCRIPTION_QUEUE_MAX_ATTEMPTS", 3);
const QUEUE_RETRY_BASE_SECONDS = getEnvInt(
  "TRANSCRIPTION_QUEUE_RETRY_BASE_SECONDS",
  15,
);
const QUEUE_RETRY_MAX_SECONDS = getEnvInt(
  "TRANSCRIPTION_QUEUE_RETRY_MAX_SECONDS",
  5 * 60,
);
const QUEUE_HEARTBEAT_MS = Math.min(
  getEnvInt("TRANSCRIPTION_QUEUE_HEARTBEAT_MS", 60 * 1000),
  Math.max(5 * 1000, QUEUE_STALE_SECONDS * 1000 - 1000),
);
const MAX_PENDING_JOBS_PER_USER = getEnvInt("MAX_PENDING_JOBS_PER_USER", 5);
const MAX_PENDING_JOBS_GLOBAL = getEnvInt("MAX_PENDING_JOBS_GLOBAL", 500);
const FREE_RETENTION_DAYS = getEnvInt("FREE_AUDIO_RETENTION_DAYS", 7);
const STANDARD_RETENTION_DAYS = getEnvInt("STANDARD_AUDIO_RETENTION_DAYS", 90);
const SPECIAL_RETENTION_DAYS = getEnvInt("SPECIAL_AUDIO_RETENTION_DAYS", 365);
const BUSINESS_RETENTION_DAYS = getEnvInt("BUSINESS_AUDIO_RETENTION_DAYS", 365);
const MAX_REASONABLE_DURATION_SECONDS = 31 * 24 * 60 * 60;
const ACTIVE_JOB_STATUSES = ["queued", "pending", "uploaded", "processing"];
const WAITING_JOB_STATUSES = ["queued", "pending", "uploaded"];

function normalizeTranscriptionStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "pending" || value === "uploaded") return "queued";
  if (["queued", "processing", "completed", "failed", "cancelled"].includes(value)) {
    return value;
  }
  return value || "queued";
}

const QUEUE_PRIORITY_SQL = `
  (CASE
     WHEN account.plan_expires_at IS NOT NULL AND account.plan_expires_at <= NOW() THEN 0
     WHEN account.plan = 'business' THEN 300
     WHEN account.plan IN ('special', 'premium') THEN 200
     WHEN account.plan = 'standard' THEN 100
     ELSE 0
   END)
  + FLOOR(EXTRACT(EPOCH FROM (NOW() - job.created_at)) / 300) * 25
`;

let activeWorkers = 0;
let workerStarted = false;
let pollTimer = null;
let cleanupTimer = null;
let runtimeQueueConcurrency = QUEUE_CONCURRENCY;
let queueSettingsReadAt = 0;
let queueSettingsPromise = null;

function createLeaseLostError(jobId) {
  const error = new Error(`Worker khong con quyen xu ly job ${jobId}`);
  error.code = "JOB_LEASE_LOST";
  return error;
}

function isLeaseLostError(error) {
  return error?.code === "JOB_LEASE_LOST";
}

function isWorkerEnabled() {
  return !["false", "0", "off", "no"].includes(
    String(process.env.RUN_TRANSCRIPTION_WORKER || "true")
      .trim()
      .toLowerCase(),
  );
}

async function cleanupExpiredAudioFiles({
  db = pool,
  resolveAudioPath = resolveStoredAudioPath,
  unlink = fs.promises.unlink,
  warn = (message) => console.warn(message),
  retentionDays = {
    free: FREE_RETENTION_DAYS,
    standard: STANDARD_RETENTION_DAYS,
    special: SPECIAL_RETENTION_DAYS,
    business: BUSINESS_RETENTION_DAYS,
  },
} = {}) {
  const { rows } = await db.query(
    `WITH expired_audio AS (
       SELECT transcript.id, transcript.audio_filename
       FROM transcriptions transcript
       JOIN users account ON account.id = transcript.user_id
       LEFT JOIN user_settings settings ON settings.user_id = transcript.user_id
       WHERE transcript.audio_filename IS NOT NULL
         AND transcript.status IN ('completed', 'failed', 'cancelled')
         AND transcript.created_at < NOW() - ((
           LEAST(
             CASE
               WHEN account.plan_expires_at IS NOT NULL AND account.plan_expires_at <= NOW() THEN $1::integer
               WHEN account.plan = 'business' THEN $4::integer
               WHEN account.plan IN ('special', 'premium') THEN $3::integer
               WHEN account.plan = 'standard' THEN $2::integer
               ELSE $1::integer
             END,
             CASE
               WHEN settings.privacy_settings->>'keepAudioAfterTranscription' = 'false' THEN 0
               WHEN settings.privacy_settings->>'audioRetentionDays' IN ('0', '7', '30', '90', '365')
                 THEN (settings.privacy_settings->>'audioRetentionDays')::integer
               ELSE 36500
             END
           )
         )::integer * INTERVAL '1 day')
       FOR UPDATE OF transcript
     ), cleared_audio AS (
       UPDATE transcriptions transcript
       SET audio_filename = NULL
       FROM expired_audio
       WHERE transcript.id = expired_audio.id
       RETURNING expired_audio.audio_filename
     )
     SELECT audio_filename FROM cleared_audio`,
    [
      retentionDays.free,
      retentionDays.standard,
      retentionDays.special,
      retentionDays.business,
    ],
  );
  await Promise.all(
    rows.map(async (row) => {
      let audioPath;
      try {
        audioPath = resolveAudioPath(row.audio_filename);
      } catch (error) {
        warn(`Bỏ qua file lưu trữ không hợp lệ: ${error.message}`);
        return;
      }

      try {
        await unlink(audioPath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          warn(`Không thể xóa file âm thanh hết hạn: ${error.message}`);
        }
      }
    }),
  );
  return rows.length;
}

async function cleanupManagedStorage({ db = pool } = {}) {
  const settings = await getAdminSettings(db);
  const globalRetention = settings.data_retention_days;
  const queueRetentionMs = settings.system_parameters.queue_retention_ms;
  const deleteMediaImmediately =
    settings.storage_policy === "delete_media_keep_transcript";
  const retentionDays = {
    free: deleteMediaImmediately
      ? 0
      : Math.min(FREE_RETENTION_DAYS, globalRetention),
    standard: deleteMediaImmediately
      ? 0
      : Math.min(STANDARD_RETENTION_DAYS, globalRetention),
    special: deleteMediaImmediately
      ? 0
      : Math.min(SPECIAL_RETENTION_DAYS, globalRetention),
    business: deleteMediaImmediately
      ? 0
      : Math.min(BUSINESS_RETENTION_DAYS, globalRetention),
  };
  const deletedMedia = await cleanupExpiredAudioFiles({ db, retentionDays });
  let deletedTranscripts = 0;
  const deletedJobsResult = await db.query(
    `DELETE FROM transcription_jobs job
     USING transcriptions transcript
     WHERE transcript.id = job.transcription_id
       AND job.status IN ('completed', 'failed', 'cancelled')
       AND COALESCE(job.completed_at, job.updated_at, job.created_at)
           < NOW() - ($1::bigint * INTERVAL '1 millisecond')
       AND (job.status <> 'failed' OR transcript.audio_filename IS NULL)`,
    [queueRetentionMs],
  );

  if (settings.storage_policy === "delete_all_after_retention") {
    const result = await db.query(
      `DELETE FROM transcriptions
       WHERE status IN ('completed', 'failed', 'cancelled')
         AND created_at < NOW() - ($1::integer * INTERVAL '1 day')
       RETURNING id`,
      [globalRetention],
    );
    deletedTranscripts = result.rowCount || result.rows.length;
  }
  const privacyDeleted = await db.query(
    `DELETE FROM transcriptions transcript
     USING user_settings settings
     WHERE settings.user_id = transcript.user_id
       AND transcript.status IN ('completed', 'failed', 'cancelled')
       AND settings.privacy_settings->>'transcriptRetentionPolicy' = 'delete_after_days'
       AND transcript.created_at < NOW() - (
         GREATEST(
           1,
           LEAST(
             3650,
             CASE
               WHEN settings.privacy_settings->>'transcriptRetentionDays' ~ '^[0-9]+$'
                 THEN (settings.privacy_settings->>'transcriptRetentionDays')::integer
               ELSE 365
             END
           )
         ) * INTERVAL '1 day'
       )
     RETURNING transcript.id`,
  );
  deletedTranscripts += privacyDeleted.rowCount || privacyDeleted.rows.length;

  return {
    deletedMedia,
    deletedJobs: deletedJobsResult.rowCount || 0,
    deletedTranscripts,
  };
}

function makeStoredFilename(filename) {
  const extension = path
    .extname(String(filename || ""))
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "");
  const safeExtension = ALLOWED_EXT.test(`file${extension}`)
    ? extension.slice(1)
    : "webm";
  return `queue-${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExtension}`;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) &&
    number > 0 &&
    number <= MAX_REASONABLE_DURATION_SECONDS
    ? Math.ceil(number)
    : null;
}

function normalizeUploadFingerprint(value) {
  const clean = String(value || "").trim().slice(0, 128);
  return /^[a-z0-9:_-]{12,128}$/i.test(clean) ? clean : null;
}

function getProgressStageLabel(stage, status) {
  const labels = {
    queued: "Đang chờ trong hàng đợi",
    retry_waiting: "Đang chờ thử lại",
    processing_started: "Worker đã nhận job",
    preparing_provider: "Đang chuẩn bị file cho provider",
    provider_transcribing: "Provider đang chuyển giọng nói thành văn bản",
    finalizing: "Đang lưu transcript và cập nhật quota",
    completed: "Hoàn tất",
    failed: "Xử lý thất bại",
    dead_lettered: "Đã chuyển vào hàng lỗi cần xử lý",
    timed_out: "Job quá thời gian xử lý",
    recovered: "Đã phục hồi sau restart worker",
    cancelled: "Đã hủy",
  };
  return labels[stage] || labels[normalizeTranscriptionStatus(status)] || "Đang xử lý";
}

function getRetryPolicy() {
  return {
    maxAttempts: QUEUE_MAX_ATTEMPTS,
    baseDelaySeconds: QUEUE_RETRY_BASE_SECONDS,
    maxDelaySeconds: QUEUE_RETRY_MAX_SECONDS,
    timeoutSeconds: QUEUE_JOB_TIMEOUT_SECONDS,
    multiplier: 2,
  };
}

function computeRetryDelaySeconds(attempt, retryAfterSeconds = null) {
  const retryAfter = Number(retryAfterSeconds);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(QUEUE_RETRY_MAX_SECONDS, Math.ceil(retryAfter));
  }
  const retryAt = Date.parse(String(retryAfterSeconds || ""));
  if (Number.isFinite(retryAt)) {
    const seconds = Math.ceil((retryAt - Date.now()) / 1000);
    if (seconds > 0) return Math.min(QUEUE_RETRY_MAX_SECONDS, seconds);
  }
  const exponent = Math.max(0, Number(attempt || 1) - 1);
  const rawDelay = QUEUE_RETRY_BASE_SECONDS * 2 ** exponent;
  const jitter = Math.max(1, Math.round(rawDelay * 0.2));
  return Math.min(QUEUE_RETRY_MAX_SECONDS, rawDelay + jitter);
}

function createJobTimeoutError(job) {
  const error = new Error(
    `Job quá thời gian xử lý ${Number(job.timeout_seconds || QUEUE_JOB_TIMEOUT_SECONDS)} giây.`,
  );
  error.code = "JOB_TIMEOUT";
  error.retryable = true;
  return error;
}

function withJobTimeout(promise, job) {
  const timeoutSeconds = Number(job.timeout_seconds || QUEUE_JOB_TIMEOUT_SECONDS);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createJobTimeoutError(job)), timeoutSeconds * 1000);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function summarizeProviderFailure(error) {
  const attempts = Array.isArray(error?.providerAttempts)
    ? error.providerAttempts
    : [];
  const failed = attempts.filter((attempt) => attempt?.status === "failed");
  if (failed.length === 0) return String(error?.message || "Không thể xử lý transcript");
  const names = failed
    .map((attempt) => String(attempt.provider || "provider").toUpperCase())
    .filter(Boolean)
    .join(", ");
  const last = failed[failed.length - 1] || {};
  const status = last.httpStatus || last.statusCode || "";
  const reason = String(last.error || error?.message || "").slice(0, 300);
  return [
    `Các provider (${names}) chưa xử lý được file này${status ? `, mã ${status}` : ""}.`,
    reason,
    "Bạn có thể thử lại job; nếu vẫn lỗi, hãy đổi file sang WAV/MP3 hoặc kiểm tra cấu hình provider.",
  ]
    .filter(Boolean)
    .join(" ");
}

function createAdminRetryError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function inferRetrySource(transcription) {
  const filename = String(transcription?.filename || "").toLowerCase();
  return filename.endsWith(".webm") || filename.startsWith("recording")
    ? "recording"
    : "upload";
}

function inferRetryAudioMode(transcription) {
  const context =
    `${transcription?.filename || ""} ${transcription?.error_message || ""}`.toLowerCase();
  return /(bài hát|lời hát|vocal|karaoke|acapella|lyrics|song)/u.test(context)
    ? "song"
    : "speech";
}

function inferMimeType(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase();
  return (
    {
      ".aac": "audio/aac",
      ".flac": "audio/flac",
      ".m4a": "audio/mp4",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".mpeg": "video/mpeg",
      ".mpga": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".wav": "audio/wav",
      ".webm": "audio/webm",
    }[extension] || "application/octet-stream"
  );
}

async function retryTranscriptionJobForAdmin(
  transcriptionId,
  {
    db = pool,
    resolveAudioPath = resolveStoredAudioPath,
    accessAudio = (audioPath) =>
      fs.promises.access(audioPath, fs.constants.R_OK),
    loadSettings = getAdminSettings,
  } = {},
) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT t.*, q.id AS queue_job_id,
              u.first_name, u.last_name, u.email
       FROM transcriptions t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN transcription_jobs q ON q.transcription_id = t.id
       WHERE t.id = $1
       FOR UPDATE OF t`,
      [transcriptionId],
    );
    const transcription = rows[0];
    if (!transcription) {
      throw createAdminRetryError(404, "Không tìm thấy job");
    }
    if (transcription.status === "completed") {
      throw createAdminRetryError(
        400,
        "Không thể chạy lại job đã hoàn thành",
      );
    }
    if (!["failed", "cancelled"].includes(transcription.status)) {
      throw createAdminRetryError(
        409,
        "Chỉ có thể chạy lại job lỗi hoặc đã hủy.",
      );
    }
    if (!transcription.audio_filename) {
      throw createAdminRetryError(
        409,
        "File nguồn đã hết thời gian lưu trữ. Người dùng cần tải lại file để chuyển đổi.",
      );
    }

    try {
      await accessAudio(resolveAudioPath(transcription.audio_filename));
    } catch {
      throw createAdminRetryError(
        409,
        "File nguồn đã hết thời gian lưu trữ hoặc không còn trên máy chủ. Người dùng cần tải lại file.",
      );
    }

    const settings = await loadSettings(client);
    const payload = {
      mimeType: inferMimeType(transcription.filename),
      adminRetryRecreated: !transcription.queue_job_id,
    };
    const queueJob = await client.query(
      `INSERT INTO transcription_jobs (
         user_id, transcription_id, status, progress, source, language, audio_mode,
         translate_to, speaker_labels, expected_duration_seconds, payload, attempts,
         max_attempts, cancel_requested, error_message, available_at, locked_at,
         lock_token, started_at, completed_at, updated_at
       )
       VALUES (
         $1, $2, 'queued', 0, $3, $4, $5, $6, FALSE, $7, $8::jsonb, 0, $9,
         FALSE, NULL, NOW(), NULL, NULL, NULL, NULL, NOW()
       )
       ON CONFLICT (transcription_id) DO UPDATE
       SET status = 'queued', progress = 0, attempts = 0,
            progress_stage = 'queued',
            max_attempts = EXCLUDED.max_attempts,
            cancel_requested = FALSE, error_message = NULL,
            dead_lettered = FALSE, dead_letter_reason = NULL,
            timed_out_at = NULL, next_retry_at = NULL,
            available_at = NOW(), locked_at = NULL, lock_token = NULL,
            started_at = NULL, completed_at = NULL, updated_at = NOW()
       RETURNING id`,
      [
        transcription.user_id,
        transcription.id,
        inferRetrySource(transcription),
        transcription.source_language || "auto",
        inferRetryAudioMode(transcription),
        normalizeQueueTranslationTarget(
          transcription.translation_target_language,
        ),
        numberOrNull(transcription.duration),
        JSON.stringify(payload),
        settings.max_retry_attempts,
      ],
    );
    const updated = await client.query(
      `UPDATE transcriptions
       SET status = 'queued', error_message = NULL, completed_at = NULL
       WHERE id = $1
       RETURNING *`,
      [transcription.id],
    );
    await client.query("COMMIT");
    return {
      transcription: updated.rows[0],
      original: transcription,
      queueJobId: queueJob.rows[0].id,
      recreatedQueueJob: !transcription.queue_job_id,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function moveUploadedFile(file, storedPath) {
  if (file.path) {
    if (!isInsideStaging(file.path)) {
      const error = new Error("Đường dẫn file tải lên không hợp lệ");
      error.statusCode = 400;
      throw error;
    }
    try {
      await fs.promises.rename(file.path, storedPath);
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      await fs.promises.copyFile(file.path, storedPath, fs.constants.COPYFILE_EXCL);
      await fs.promises.unlink(file.path);
    }
    await fs.promises.chmod(storedPath, 0o600).catch(() => {});
    file.path = null;
    return;
  }
  await fs.promises.writeFile(storedPath, file.buffer, { flag: "wx", mode: 0o600 });
}

async function enqueueTranscriptionJob({
  userId,
  file,
  source = "upload",
  language = "auto",
  audioMode = "speech",
  translateTo = "",
  speakerLabels = false,
  speakerCount = null,
  expectedDurationSeconds = null,
  dictionaryKeywords = [],
  transcriptionSettings = {},
  folderId = null,
  batchId = null,
  batchKind = null,
  batchTrackIndex = null,
  batchTrackName = null,
  customerWebhook = null,
  apiKeyId = null,
  uploadFingerprint = null,
  transcriptTemplate = "meeting",
}) {
  if (!file || (!file.buffer && !file.path)) {
    const error = new Error("Vui lòng chọn file âm thanh");
    error.statusCode = 400;
    throw error;
  }
  file.originalname = normalizeFilename(file.originalname);
  const normalizedSpeakerCount = speakerLabels
    ? normalizeSpeakerCount(speakerCount)
    : null;
  const storedFilename = makeStoredFilename(file.originalname);
  const storedPath = resolveStoredAudioPath(storedFilename);
  const expectedDuration = numberOrNull(expectedDurationSeconds);
  const client = await pool.connect();
  let uploaded = false;

  try {
    await moveUploadedFile(file, storedPath);
    uploaded = true;

    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [2026071601]);
    const cleanFingerprint = normalizeUploadFingerprint(uploadFingerprint);
    if (cleanFingerprint) {
      const existing = await client.query(
        `SELECT job.id, job.status, job.progress, job.expected_duration_seconds,
                transcript.id AS transcription_id, transcript.folder_id, transcript.filename,
                transcript.file_size, transcript.audio_filename, transcript.created_at,
                folder.name AS folder_name
         FROM transcription_jobs job
         JOIN transcriptions transcript ON transcript.id = job.transcription_id
         LEFT JOIN transcription_folders folder ON folder.id = transcript.folder_id
         WHERE job.user_id = $1
           AND job.upload_fingerprint = $2
           AND job.status = ANY($3::text[])
         ORDER BY job.created_at DESC
         LIMIT 1`,
        [userId, cleanFingerprint, ACTIVE_JOB_STATUSES],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        await fs.promises.unlink(storedPath).catch(() => {});
        return {
          jobId: existing.rows[0].id,
          status: normalizeTranscriptionStatus(existing.rows[0].status),
          progress: existing.rows[0].progress,
          expectedDurationSeconds: existing.rows[0].expected_duration_seconds,
          reused: true,
          transcription: {
            id: existing.rows[0].transcription_id,
            folder_id: existing.rows[0].folder_id,
            folder_name: existing.rows[0].folder_name,
            filename: existing.rows[0].filename,
            file_size: existing.rows[0].file_size,
            audio_filename: existing.rows[0].audio_filename,
            created_at: existing.rows[0].created_at,
          },
        };
      }
    }
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const adminSettings = await getAdminSettings(client);
    const folder = await resolveUserFolder(userId, folderId, { db: client });
    const pending = await client.query(
      `SELECT COUNT(*) FILTER (WHERE user_id = $1)::integer AS user_count,
              COUNT(*)::integer AS global_count
       FROM transcription_jobs
       WHERE status = ANY($2::text[]) AND cancel_requested = FALSE`,
      [userId, ACTIVE_JOB_STATUSES],
    );
    if (Number(pending.rows[0]?.user_count || 0) >= MAX_PENDING_JOBS_PER_USER) {
      const error = new Error(
        `Bạn chỉ có thể có tối đa ${MAX_PENDING_JOBS_PER_USER} tác vụ đang chờ hoặc xử lý.`,
      );
      error.statusCode = 429;
      throw error;
    }
    if (Number(pending.rows[0]?.global_count || 0) >= MAX_PENDING_JOBS_GLOBAL) {
      const error = new Error("Hàng đợi đang đầy. Vui lòng thử lại sau.");
      error.statusCode = 503;
      throw error;
    }
    await validateBeforeTranscription({
      userId,
      file,
      source,
      expectedDurationSeconds: expectedDuration,
      reservationBatchId:
        batchKind === "multitrack" ? batchId : null,
      db: client,
    });
    const transcription = await client.query(
      `INSERT INTO transcriptions (
         user_id, folder_id, filename, file_size, duration, processing_seconds, text, words, audio_filename,
         source_language, translated_text, translation_target_language, translation_provider,
         transcript_template, status, error_message
       )
       VALUES ($1, $2, $3, $4, NULL, NULL, '', '[]'::jsonb, $5, $6, NULL, NULL, NULL, $7, 'queued', NULL)
       RETURNING id, folder_id, filename, file_size, audio_filename, transcript_template, created_at`,
      [
        userId,
        folder.id,
        file.originalname || "audio.webm",
        Number(file.size || file.buffer?.length || 0),
        storedFilename,
        language || "auto",
        ["meeting", "interview", "podcast", "lecture"].includes(transcriptTemplate)
          ? transcriptTemplate
          : "meeting",
      ],
    );

    const job = await client.query(
      `INSERT INTO transcription_jobs (
         user_id, transcription_id, status, progress, source, language, audio_mode, translate_to,
         speaker_labels, expected_duration_seconds, upload_fingerprint, progress_stage, payload,
         max_attempts, timeout_seconds, retry_policy
       )
       VALUES ($1, $2, 'queued', 0, $3, $4, $5, $6, $7, $8, $9, 'queued', $10::jsonb,
               $11, $12, $13::jsonb)
       RETURNING id, status, progress, expected_duration_seconds, created_at`,
      [
        userId,
        transcription.rows[0].id,
        source,
        language || "auto",
        audioMode || "speech",
        normalizeQueueTranslationTarget(translateTo),
        Boolean(speakerLabels),
        expectedDuration,
        cleanFingerprint,
        JSON.stringify({
          mimeType: file.mimetype || "audio/webm",
          dictionaryKeywords,
          transcriptionSettings,
          speakerCount: normalizedSpeakerCount,
          batchId: batchId || null,
          batchKind: batchKind || null,
          batchTrackIndex:
            batchTrackIndex === null || batchTrackIndex === undefined
              ? null
              : Number(batchTrackIndex),
          batchTrackName: batchTrackName || null,
          customerWebhook: customerWebhook || null,
          apiKeyId: apiKeyId || null,
        }),
        adminSettings.max_retry_attempts || QUEUE_MAX_ATTEMPTS,
        QUEUE_JOB_TIMEOUT_SECONDS,
        JSON.stringify(getRetryPolicy()),
      ],
    );

    await client.query("COMMIT");
    void kickTranscriptionWorker();

    return {
      jobId: job.rows[0].id,
      status: job.rows[0].status,
      progress: job.rows[0].progress,
      expectedDurationSeconds: job.rows[0].expected_duration_seconds,
      transcription: {
        ...transcription.rows[0],
        folder_name: folder.name,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (uploaded) await fs.promises.unlink(storedPath).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recoverStaleJobs() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cancelled = await client.query(
      `UPDATE transcription_jobs job
       SET status = 'cancelled', progress = 0, locked_at = NULL, lock_token = NULL,
           completed_at = NOW(), updated_at = NOW(),
           error_message = 'Job đã dừng vì tài khoản bị khóa hoặc có yêu cầu hủy.'
       FROM users account
       WHERE job.user_id = account.id
         AND job.status = 'processing'
         AND job.locked_at < NOW() - ($1::text || ' seconds')::interval
         AND (job.cancel_requested = TRUE OR account.account_status <> 'active')
       RETURNING job.transcription_id`,
      [String(QUEUE_STALE_SECONDS)],
    );
    if (cancelled.rows.length > 0) {
      await client.query(
        `UPDATE transcriptions
         SET status = 'cancelled',
             error_message = 'Job đã dừng vì tài khoản bị khóa hoặc có yêu cầu hủy.'
         WHERE id = ANY($1::integer[])`,
        [cancelled.rows.map((row) => row.transcription_id)],
      );
    }
    await client.query(
      `UPDATE transcription_jobs job
       SET status = 'queued', progress = 0, locked_at = NULL, lock_token = NULL,
           progress_stage = 'recovered',
           available_at = NOW(), recovered_at = NOW(), updated_at = NOW(),
           error_message = 'Worker trước đó đã dừng, job được xếp lại.'
       FROM users account
       WHERE job.user_id = account.id
         AND job.status = 'processing'
         AND job.cancel_requested = FALSE
         AND account.account_status = 'active'
         AND job.locked_at < NOW() - ($1::text || ' seconds')::interval`,
      [String(QUEUE_STALE_SECONDS)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function claimNextJob() {
  const client = await pool.connect();
  const lockToken = crypto.randomUUID();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `WITH next_job AS (
         SELECT job.id
         FROM transcription_jobs job
          JOIN users account ON account.id = job.user_id
          WHERE job.status = ANY($2::text[])
            AND job.cancel_requested = FALSE
            AND account.account_status = 'active'
            AND job.available_at <= NOW()
           AND NOT EXISTS (
             SELECT 1
             FROM transcription_jobs running
             WHERE running.user_id = job.user_id
               AND running.status = 'processing'
           )
         ORDER BY ${QUEUE_PRIORITY_SQL} DESC, job.created_at ASC, job.id ASC
         FOR UPDATE OF job, account SKIP LOCKED
         LIMIT 1
       )
       UPDATE transcription_jobs job
       SET status = 'processing', progress = 10, progress_stage = 'processing_started',
           attempts = attempts + 1,
           locked_at = NOW(), lock_token = $1,
           started_at = COALESCE(started_at, NOW()), updated_at = NOW(),
           error_message = NULL
       FROM next_job
       WHERE job.id = next_job.id
       RETURNING job.*`,
      [lockToken, WAITING_JOB_STATUSES],
    );
    await client.query("COMMIT");
    return rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function refreshJobLease(job) {
  const result = await pool.query(
    `UPDATE transcription_jobs
     SET locked_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'processing' AND lock_token = $2`,
    [job.id, job.lock_token],
  );
  return result.rowCount > 0;
}

function startJobHeartbeat(job) {
  let stopped = false;
  let leaseLost = false;
  let heartbeatRunning = false;

  const heartbeat = async () => {
    if (stopped || heartbeatRunning || leaseLost) return;
    heartbeatRunning = true;
    try {
      leaseLost = !(await refreshJobLease(job));
    } catch (error) {
      console.error(`Transcription job ${job.id} heartbeat failed:`, error.message);
    } finally {
      heartbeatRunning = false;
    }
  };

  const timer = setInterval(() => void heartbeat(), QUEUE_HEARTBEAT_MS);
  timer.unref?.();

  return {
    assertActive() {
      if (leaseLost) throw createLeaseLostError(job.id);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function setJobProgress(job, progress, stage = null) {
  const result = await pool.query(
    `UPDATE transcription_jobs
     SET progress = $3,
         progress_stage = COALESCE($4, progress_stage),
         locked_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND status = 'processing' AND lock_token = $2`,
    [job.id, job.lock_token, progress, stage],
  );
  if (result.rowCount === 0) throw createLeaseLostError(job.id);
}

async function completeJob(job, result) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transcriptState = await client.query(
      `SELECT transcript_template
       FROM transcriptions
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [job.transcription_id, job.user_id],
    );
    if (!transcriptState.rows[0]) {
      throw new Error(`Khong tim thay transcript cua job ${job.id}`);
    }
    const automaticInsights = generateTranscriptInsights({
      text: result.text,
      words: result.words || [],
      template: normalizeTranscriptTemplate(
        transcriptState.rows[0].transcript_template,
      ),
    });
    const finalizeJob = await client.query(
      `UPDATE transcription_jobs
       SET status = 'completed', progress = 100, locked_at = NULL, lock_token = NULL,
           progress_stage = 'completed', completed_at = NOW(), updated_at = NOW(), error_message = NULL,
           next_retry_at = NULL
       WHERE id = $1 AND status = 'processing' AND lock_token = $2
       RETURNING id`,
      [job.id, job.lock_token],
    );
    if (finalizeJob.rowCount === 0) throw createLeaseLostError(job.id);

    const updateTranscript = await client.query(
      `UPDATE transcriptions
       SET duration = $3, processing_seconds = $4, text = $5, words = $6::jsonb,
            segments = $7::jsonb,
            source_language = $8, translated_text = $9, translation_target_language = $10,
            translation_provider = $11, translation_error = $12,
            transcription_provider = $13, provider_request_id = $14,
            provider_attempts = $15::jsonb,
            insights = $16::jsonb, insights_updated_at = NOW(),
            status = 'completed', error_message = NULL
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [
        job.transcription_id,
        job.user_id,
        result.duration,
        result.processingSeconds,
        result.text,
        JSON.stringify(result.words || []),
        JSON.stringify(result.segments || []),
        result.sourceLanguage,
        result.translation?.text || null,
        result.translation?.targetLanguage ||
          normalizeQueueTranslationTarget(job.translate_to),
        result.translation?.provider || null,
        result.translationError || null,
        result.provider || null,
        result.providerId || null,
        JSON.stringify(result.providerAttempts || []),
        JSON.stringify(automaticInsights),
      ],
    );

    if (updateTranscript.rowCount === 0) {
      throw new Error(`Khong tim thay transcript cua job ${job.id}`);
    }
    if (job.payload?.batchKind !== "multitrack") {
      await recordQuotaUsage({
        userId: job.user_id,
        transcriptionId: job.transcription_id,
        durationSeconds: result.duration,
        source: job.source,
        db: client,
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function failJob(job, error) {
  const message = summarizeProviderFailure(error).slice(0, 2000);
  const retryable =
    (error?.retryable === true ||
      (error?.retryable !== false && !error?.statusCode)) &&
    job.attempts < job.max_attempts;

  if (retryable) {
    const retryDelaySeconds = computeRetryDelaySeconds(
      job.attempts,
      error?.retryAfterSeconds || error?.retryAfter,
    );
    const retry = await pool.query(
      `UPDATE transcription_jobs
       SET status = 'queued', progress = 0, locked_at = NULL, lock_token = NULL,
           progress_stage = 'retry_waiting',
           available_at = NOW() + ($2::text || ' seconds')::interval,
           next_retry_at = NOW() + ($2::text || ' seconds')::interval,
           updated_at = NOW(), error_message = $3
       WHERE id = $1 AND status = 'processing' AND lock_token = $4`,
      [
        job.id,
        String(retryDelaySeconds),
        `Lần thử ${job.attempts}/${job.max_attempts} thất bại. Tự động thử lại sau ${retryDelaySeconds} giây. ${message}`.slice(0, 2000),
        job.lock_token,
      ],
    );
    if (retry.rowCount === 0) throw createLeaseLostError(job.id);
    return { terminal: false };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const failedJob = await client.query(
      `UPDATE transcription_jobs
       SET status = 'failed', progress = 0, locked_at = NULL, lock_token = NULL,
           progress_stage = $4, completed_at = NOW(), updated_at = NOW(), error_message = $3,
           dead_lettered = TRUE, dead_letter_reason = $3,
           timed_out_at = CASE WHEN $5 = TRUE THEN NOW() ELSE timed_out_at END,
           next_retry_at = NULL
       WHERE id = $1 AND status = 'processing' AND lock_token = $2
       RETURNING id`,
      [
        job.id,
        job.lock_token,
        message,
        error?.code === "JOB_TIMEOUT" ? "timed_out" : "dead_lettered",
        error?.code === "JOB_TIMEOUT",
      ],
    );
    if (failedJob.rowCount === 0) throw createLeaseLostError(job.id);
    await client.query(
      `UPDATE transcriptions
       SET status = 'failed', error_message = $2,
            provider_attempts = $4::jsonb
       WHERE id = $1 AND user_id = $3`,
      [
        job.transcription_id,
        message,
        job.user_id,
        JSON.stringify(error?.providerAttempts || []),
      ],
    );
    await client.query("COMMIT");
    return { terminal: true, message };
  } catch (failureError) {
    await client.query("ROLLBACK").catch(() => {});
    throw failureError;
  } finally {
    client.release();
  }
}

async function notifyCustomerWebhook(job, status, { result = null, error = null } = {}) {
  const webhook = job.payload?.customerWebhook;
  if (!webhook) return;
  const event = `transcription.${status}`;
  const payload = {
    jobId: Number(job.id),
    transcriptionId: Number(job.transcription_id),
    status,
    source: job.source,
    language: result?.sourceLanguage || job.language || null,
    duration: result?.duration || null,
    provider: result?.provider || null,
    text: result?.text || null,
    words: Array.isArray(result?.words) ? result.words : [],
    translation: result?.translation || null,
    error: error ? String(error.message || error).slice(0, 2000) : null,
  };
  try {
    await deliverAndRecordCustomerWebhook({
      userId: job.user_id,
      apiKeyId: job.payload?.apiKeyId || null,
      jobId: job.id,
      transcriptionId: job.transcription_id,
      webhook,
      event,
      payload,
    });
  } catch (webhookError) {
    console.error(
      `Customer webhook for transcription job ${job.id} failed:`,
      webhookError.message,
    );
  }
}

async function notifyAdminJobFailure(job, error) {
  const settings = await getAdminSettings();
  if (
    !settings.notification_config.failure_alert_email ||
    !hasSmtpConfig()
  ) {
    return;
  }
  const recipients = [
    ...new Set(
      String(
        process.env.QUOTA_ALERT_ADMIN_EMAILS ||
          process.env.ADMIN_EMAILS ||
          "",
      )
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (recipients.length === 0) return;
  const userResult = await pool.query(
    "SELECT first_name, last_name, email FROM users WHERE id = $1",
    [job.user_id],
  );
  await sendJobFailureAdminAlertEmail({
    recipients,
    job: {
      ...job,
      error_message: String(error?.message || error || "Không rõ nguyên nhân"),
    },
    user: userResult.rows[0] || null,
  });
}

async function processJob(job) {
  const heartbeat = startJobHeartbeat(job);
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, file_size, audio_filename
       FROM transcriptions
       WHERE id = $1 AND user_id = $2`,
      [job.transcription_id, job.user_id],
    );
    const transcription = rows[0];
    if (!transcription?.audio_filename) {
      throw new Error("Khong tim thay file da dua vao hang doi");
    }

    const audioPath = resolveStoredAudioPath(transcription.audio_filename);
    const providerChain = getTranscriptionProviderChain();
    const useSonixFileUrl =
      providerChain.length === 1 &&
      providerChain[0] === "sonix" &&
      Number(transcription.file_size || 0) > 100 * 1024 * 1024 &&
      job.audio_mode !== "song";
    const buffer = useSonixFileUrl
      ? null
      : await fs.promises.readFile(audioPath);
    const payload = job.payload || {};
    await setJobProgress(job, 25, "preparing_provider");
    await setJobProgress(job, 45, "provider_transcribing");

    const expectedDuration = numberOrNull(job.expected_duration_seconds);
    const result = await withJobTimeout(
      transcribeFile({
        userId: job.user_id,
        file: {
          buffer,
          originalname: transcription.filename,
          mimetype: payload.mimeType || "audio/webm",
          size: Number(transcription.file_size || buffer?.length || 0),
          fileUrl: useSonixFileUrl ? createProviderFileUrl(job.id) : null,
          getFileUrl: () => createProviderFileUrl(job.id),
        },
        speakerLabels: job.speaker_labels,
        speakerCount: payload.speakerCount,
        source: job.source,
        language: job.language,
        audioMode: job.audio_mode,
        translateTo: job.translate_to || "",
        dictionaryKeywords: payload.dictionaryKeywords || [],
        transcriptionSettings: payload.transcriptionSettings || {},
        providerMetadata: {
          job_id: job.id,
          audioProfile: { durationSeconds: expectedDuration },
        },
        validateResult: ({ duration }) =>
          validateAfterTranscription({
            userId: job.user_id,
            durationSeconds: expectedDuration || numberOrNull(duration),
            source: job.source,
            excludeJobId: job.id,
            reservationBatchId:
              job.payload?.batchKind === "multitrack"
                ? job.payload?.batchId
                : null,
          }),
      }),
      job,
    );
    result.duration =
      expectedDuration || numberOrNull(result.duration);
    if (!result.duration) {
      const durationError = new Error(
        "Không xác định được thời lượng hợp lệ của file âm thanh.",
      );
      durationError.statusCode = 422;
      throw durationError;
    }
    heartbeat.assertActive();
    await setJobProgress(job, 85, "finalizing");

    const cancelCheck = await pool.query(
      `SELECT cancel_requested
       FROM transcription_jobs
       WHERE id = $1 AND status = 'processing' AND lock_token = $2`,
      [job.id, job.lock_token],
    );
    if (!cancelCheck.rows[0]) throw createLeaseLostError(job.id);
    if (cancelCheck.rows[0]?.cancel_requested) {
      await markJobCancelled(job, transcription.audio_filename);
      return;
    }

    await setJobProgress(job, 90, "finalizing");
    await completeJob(job, result);
    await recordApiUsage({
      apiKeyId: job.payload?.apiKeyId,
      userId: job.user_id,
      event: "completed",
      jobId: job.id,
      transcriptionId: job.transcription_id,
      durationSeconds: result.duration || job.expected_duration_seconds,
      status: "completed",
    });
    if (job.payload?.batchKind === "multitrack" && job.payload?.batchId) {
      await finalizeMultitrackBatch(job.payload.batchId);
    }
    await notifyCustomerWebhook(job, "completed", { result });
  } catch (error) {
    if (isLeaseLostError(error)) {
      console.warn(`Transcription job ${job.id} stopped because its lease was lost.`);
      return;
    }
    console.error(`Transcription job ${job.id} failed:`, error.message);
    try {
      const failure = await failJob(job, error);
      if (
        failure?.terminal &&
        job.payload?.batchKind === "multitrack" &&
        job.payload?.batchId
      ) {
        await finalizeMultitrackBatch(job.payload.batchId).catch(
          (finalizeError) => {
            console.error(
              `Multitrack batch ${job.payload.batchId} finalize failed:`,
              finalizeError.message,
            );
          },
        );
      }
      if (failure?.terminal) {
        await recordApiUsage({
          apiKeyId: job.payload?.apiKeyId,
          userId: job.user_id,
          event: "failed",
          jobId: job.id,
          transcriptionId: job.transcription_id,
          durationSeconds: 0,
          status: "failed",
        });
        await notifyCustomerWebhook(job, "failed", { error });
        await notifyAdminJobFailure(job, error).catch((notificationError) => {
          console.error(
            `Admin failure email for job ${job.id} failed:`,
            notificationError.message,
          );
        });
      }
    } catch (failureError) {
      if (!isLeaseLostError(failureError)) throw failureError;
      console.warn(`Transcription job ${job.id} failure was ignored after lease loss.`);
    }
  } finally {
    heartbeat.stop();
  }
}

async function markJobCancelled(job, audioFilename = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cancelledJob = await client.query(
      `UPDATE transcription_jobs
       SET status = 'cancelled', progress = 0, locked_at = NULL, lock_token = NULL,
           completed_at = NOW(), updated_at = NOW(), error_message = NULL
       WHERE id = $1 AND status = 'processing' AND lock_token = $2
       RETURNING id`,
      [job.id, job.lock_token],
    );
    if (cancelledJob.rowCount === 0) throw createLeaseLostError(job.id);
    await client.query(
      `UPDATE transcriptions
       SET status = 'cancelled', error_message = NULL, audio_filename = NULL
       WHERE id = $1 AND user_id = $2`,
      [job.transcription_id, job.user_id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (audioFilename) {
    await fs.promises
      .unlink(resolveStoredAudioPath(audioFilename))
      .catch(() => {});
  }
}

async function runOneWorker() {
  const job = await claimNextJob();
  if (!job) return false;
  await processJob(job);
  return true;
}

async function refreshQueueRuntimeSettings() {
  if (Date.now() - queueSettingsReadAt < 15_000) return;
  if (!queueSettingsPromise) {
    queueSettingsPromise = getAdminSettings()
      .then((settings) => {
        runtimeQueueConcurrency =
          settings.system_parameters.queue_concurrency;
        queueSettingsReadAt = Date.now();
      })
      .catch((error) => {
        console.error("Cannot refresh CMS queue settings:", error.message);
        queueSettingsReadAt = Date.now();
      })
      .finally(() => {
        queueSettingsPromise = null;
      });
  }
  await queueSettingsPromise;
}

async function kickTranscriptionWorker() {
  if (!workerStarted || !isWorkerEnabled()) return;
  await refreshQueueRuntimeSettings();
  while (activeWorkers < runtimeQueueConcurrency) {
    activeWorkers += 1;
    let processedJob = false;
    void runOneWorker()
      .then((processed) => {
        processedJob = processed;
      })
      .catch((error) => {
        console.error("Transcription queue worker error:", error.message);
      })
      .finally(() => {
        activeWorkers -= 1;
        if (processedJob) {
          setImmediate(() => void kickTranscriptionWorker());
        }
      });
  }
}

async function startTranscriptionWorker() {
  if (workerStarted || !isWorkerEnabled()) return;
  workerStarted = true;
  await recoverStaleJobs();
  await cleanupManagedStorage();
  await refreshQueueRuntimeSettings();
  void kickTranscriptionWorker();
  pollTimer = setInterval(() => void kickTranscriptionWorker(), QUEUE_POLL_MS);
  pollTimer.unref?.();
  cleanupTimer = setInterval(
    () => void cleanupManagedStorage().catch((error) => {
      console.error("Audio retention cleanup error:", error.message);
    }),
    6 * 60 * 60 * 1000,
  );
  cleanupTimer.unref?.();
  console.log(
    `Transcription queue worker started (concurrency: ${runtimeQueueConcurrency})`,
  );
}

function stopTranscriptionWorker() {
  if (pollTimer) clearInterval(pollTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);
  pollTimer = null;
  cleanupTimer = null;
  workerStarted = false;
}

async function getTranscriptionJobForUser(jobId, userId) {
  const { rows } = await pool.query(
    `SELECT job.id, job.status, job.progress, job.progress_stage,
            job.error_message, job.expected_duration_seconds,
            job.attempts, job.max_attempts,
            job.dead_lettered, job.dead_letter_reason, job.next_retry_at,
            job.timeout_seconds, job.recovered_at, job.timed_out_at,
            job.created_at, job.started_at, job.completed_at, job.transcription_id,
            transcript.filename, transcript.audio_filename,
            transcript.duration, transcript.processing_seconds,
             transcript.text, transcript.words, transcript.source_language,
             transcript.translated_text, transcript.translation_target_language,
              transcript.translation_provider, transcript.translation_error,
              transcript.transcription_provider, transcript.provider_request_id,
              transcript.provider_attempts, transcript.folder_id,
              folder.name AS folder_name
     FROM transcription_jobs job
     JOIN transcriptions transcript ON transcript.id = job.transcription_id
     LEFT JOIN transcription_folders folder ON folder.id = transcript.folder_id
     WHERE job.id = $1 AND job.user_id = $2`,
    [jobId, userId],
  );
  const job = rows[0];
  if (!job) return null;

  const speed = await pool.query(
    `SELECT COALESCE(AVG(processing_seconds / NULLIF(duration, 0)), 0.8)::float AS ratio
     FROM (
       SELECT processing_seconds, duration
       FROM transcriptions
       WHERE status = 'completed' AND processing_seconds > 0 AND duration > 0
       ORDER BY created_at DESC
       LIMIT 100
     ) recent`,
  );
  const processingRatio = Math.max(
    0.05,
    Math.min(5, Number(speed.rows[0]?.ratio || 0.8)),
  );
  const expectedSeconds = Number(
    job.expected_duration_seconds || job.duration || 0,
  );
  const estimatedProcessingSeconds = Math.max(
    1,
    Math.ceil(expectedSeconds * processingRatio),
  );

  let queuePosition = 0;
  let estimatedWaitSeconds = 0;
  if (normalizeTranscriptionStatus(job.status) === "queued") {
    const ahead = await pool.query(
      `WITH ranked AS (
         SELECT job.id,
                COALESCE(job.expected_duration_seconds, 0)::float AS expected_seconds,
                ROW_NUMBER() OVER (
                  ORDER BY ${QUEUE_PRIORITY_SQL} DESC, job.created_at ASC, job.id ASC
                ) AS queue_position
         FROM transcription_jobs job
         JOIN users account ON account.id = job.user_id
         WHERE job.status = ANY($2::text[])
           AND job.cancel_requested = FALSE
           AND job.available_at <= NOW()
           AND NOT EXISTS (
             SELECT 1
             FROM transcription_jobs running
             WHERE running.user_id = job.user_id
               AND running.status = 'processing'
           )
       ), target AS (
         SELECT queue_position FROM ranked WHERE id = $1
       )
       SELECT COALESCE(target.queue_position, 1)::integer AS position,
              COALESCE(SUM(ranked.expected_seconds) FILTER (
                WHERE ranked.queue_position < target.queue_position
              ), 0)::float AS seconds
       FROM target
       LEFT JOIN ranked ON TRUE
       GROUP BY target.queue_position`,
      [job.id, WAITING_JOB_STATUSES],
    );
    queuePosition = Number(ahead.rows[0]?.position || 1);
    estimatedWaitSeconds = Math.ceil(
      (Number(ahead.rows[0]?.seconds || 0) * processingRatio) /
        Math.max(1, QUEUE_CONCURRENCY),
    );
  }

  const elapsedSeconds = job.started_at
    ? Math.max(0, (Date.now() - new Date(job.started_at).getTime()) / 1000)
    : 0;
  const estimatedRemainingSeconds =
    normalizeTranscriptionStatus(job.status) === "queued"
      ? estimatedWaitSeconds + estimatedProcessingSeconds
      : normalizeTranscriptionStatus(job.status) === "processing"
        ? Math.max(1, Math.ceil(estimatedProcessingSeconds - elapsedSeconds))
        : 0;
  const dynamicProgress =
    normalizeTranscriptionStatus(job.status) === "processing"
      ? Math.max(
          Number(job.progress || 0),
          Math.min(
            88,
            25 +
              Math.round(
                (Math.min(elapsedSeconds, estimatedProcessingSeconds) /
                  Math.max(1, estimatedProcessingSeconds)) *
                  60,
              ),
          ),
        )
      : Number(job.progress || 0);

  return {
    ...job,
    status: normalizeTranscriptionStatus(job.status),
    progress: dynamicProgress,
    progress_stage_label: getProgressStageLabel(job.progress_stage, job.status),
    retry_attempt: Number(job.attempts || 0),
    max_attempts: Number(job.max_attempts || QUEUE_MAX_ATTEMPTS),
    dead_lettered: Boolean(job.dead_lettered),
    dead_letter_reason: job.dead_letter_reason || null,
    next_retry_at: job.next_retry_at || null,
    timeout_seconds: Number(job.timeout_seconds || QUEUE_JOB_TIMEOUT_SECONDS),
    retry_available:
      normalizeTranscriptionStatus(job.status) === "failed" &&
      Boolean(job.audio_filename),
    filename: normalizeFilename(job.filename),
    queue_position: queuePosition,
    estimated_wait_seconds: estimatedWaitSeconds,
    estimated_processing_seconds: estimatedProcessingSeconds,
    estimated_remaining_seconds: estimatedRemainingSeconds,
  };
}

async function retryTranscriptionJobForUser(jobId, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT job.*, transcript.audio_filename
       FROM transcription_jobs job
       JOIN transcriptions transcript ON transcript.id = job.transcription_id
       WHERE job.id = $1 AND job.user_id = $2
       FOR UPDATE OF job, transcript`,
      [jobId, userId],
    );
    const job = rows[0];
    if (!job) {
      const error = new Error("Không tìm thấy job");
      error.statusCode = 404;
      throw error;
    }
    if (normalizeTranscriptionStatus(job.status) !== "failed") {
      const error = new Error("Chỉ có thể thử lại job đã thất bại.");
      error.statusCode = 409;
      throw error;
    }
    if (!job.audio_filename || !fs.existsSync(resolveStoredAudioPath(job.audio_filename))) {
      const error = new Error(
        "File gốc của job này không còn trên server. Vui lòng tải lại file.",
      );
      error.statusCode = 410;
      throw error;
    }
    const expectedDuration = numberOrNull(job.expected_duration_seconds);
    if (expectedDuration) {
      await validateAfterTranscription({
        userId,
        durationSeconds: expectedDuration,
        source: job.source,
        excludeJobId: job.id,
        reservationBatchId:
          job.payload?.batchKind === "multitrack"
            ? job.payload?.batchId
            : null,
        db: client,
      });
    }
    await client.query(
      `UPDATE transcription_jobs
       SET status = 'queued',
           progress = 0,
           progress_stage = 'queued',
           attempts = 0,
           cancel_requested = FALSE,
           error_message = NULL,
           dead_lettered = FALSE,
           dead_letter_reason = NULL,
           timed_out_at = NULL,
           next_retry_at = NULL,
           available_at = NOW(),
           locked_at = NULL,
           lock_token = NULL,
           started_at = NULL,
           completed_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [jobId],
    );
    await client.query(
      `UPDATE transcriptions
       SET status = 'queued',
           text = '',
           words = '[]'::jsonb,
           error_message = NULL,
           provider_attempts = '[]'::jsonb
       WHERE id = $1 AND user_id = $2`,
      [job.transcription_id, userId],
    );
    await client.query("COMMIT");
    void kickTranscriptionWorker();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return getTranscriptionJobForUser(jobId, userId);
}

async function cancelTranscriptionJobForUser(jobId, userId) {
  const client = await pool.connect();
  let audioFilename = null;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT job.*, transcript.audio_filename
       FROM transcription_jobs job
       JOIN transcriptions transcript ON transcript.id = job.transcription_id
       WHERE job.id = $1 AND job.user_id = $2
       FOR UPDATE OF job, transcript`,
      [jobId, userId],
    );
    const job = rows[0];
    if (!job) {
      const error = new Error("Không tìm thấy job");
      error.statusCode = 404;
      throw error;
    }
    if (["completed", "failed", "cancelled"].includes(normalizeTranscriptionStatus(job.status))) {
      await client.query("COMMIT");
      return getTranscriptionJobForUser(jobId, userId);
    }

    if (normalizeTranscriptionStatus(job.status) === "queued") {
      audioFilename = job.audio_filename;
      await client.query(
        `UPDATE transcription_jobs
         SET status = 'cancelled', cancel_requested = TRUE, completed_at = NOW(),
             progress_stage = 'cancelled', updated_at = NOW(), error_message = NULL,
             next_retry_at = NULL
         WHERE id = $1`,
        [jobId],
      );
      await client.query(
        `UPDATE transcriptions
         SET status = 'cancelled', audio_filename = NULL, error_message = NULL
         WHERE id = $1`,
        [job.transcription_id],
      );
    } else {
      await client.query(
        `UPDATE transcription_jobs
         SET cancel_requested = TRUE, updated_at = NOW()
         WHERE id = $1`,
        [jobId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (audioFilename) {
    await fs.promises
      .unlink(resolveStoredAudioPath(audioFilename))
      .catch(() => {});
  }
  return getTranscriptionJobForUser(jobId, userId);
}

module.exports = {
  cancelTranscriptionJobForUser,
  cleanupExpiredAudioFiles,
  cleanupManagedStorage,
  computeRetryDelaySeconds,
  enqueueTranscriptionJob,
  getRetryPolicy,
  getTranscriptionJobForUser,
  kickTranscriptionWorker,
  normalizeTranscriptionStatus,
  retryTranscriptionJobForAdmin,
  retryTranscriptionJobForUser,
  ACTIVE_JOB_STATUSES,
  WAITING_JOB_STATUSES,
  startTranscriptionWorker,
  stopTranscriptionWorker,
};
