require("../config/env");
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const pool = require("../db");
const {
  assertTranscriptionProviderReady,
  probeMediaFile,
  resolveStoredAudioPath,
} = require("../services/transcriptionService");
const {
  getQuotaStatus,
  recordQuotaUsage,
  validateAfterTranscription,
  validateBeforeTranscription,
} = require("../services/quotaService");
const {
  cancelTranscriptionJobForUser,
  enqueueTranscriptionJob,
  getTranscriptionJobForUser,
} = require("../services/transcriptionQueue");
const {
  getUserSettings,
  parseDictionaryKeywords,
} = require("../services/userSettingsService");
const {
  normalizeLanguageCode,
  normalizeTranslateTarget,
  translateTranscript,
} = require("../services/translationService");
const {
  verifyProviderFileSignature,
} = require("../services/providerFileAccess");
const { normalizeFilename } = require("../services/filenameEncoding");
const {
  cleanupStagedFile,
  createPlanAwareMediaUpload,
} = require("../services/uploadStorage");
const {
  downloadYoutubeAudio,
  getYoutubeMetadata,
} = require("../services/youtubeImportService");
const { requireAuth } = require("../middleware/auth");
const { uploadLimiter, urlImportLimiter } = require("../middleware/security");
const { writeSecurityAudit } = require("../services/securityAuditService");

const router = express.Router();

const upload = createPlanAwareMediaUpload(async (req) => {
  const quota = await getQuotaStatus(req.user.id);
  return quota.limits.maxUploadMb;
});
const AUDIO_STREAM_TTL_SECONDS = Math.min(
  15 * 60,
  Math.max(
    60,
    Number.parseInt(process.env.AUDIO_STREAM_TTL_SECONDS || "300", 10) || 300,
  ),
);

function createAudioStreamSignature(id, userId, expiresAt) {
  const secret = process.env.AUDIO_URL_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("Máy chủ chưa cấu hình khóa ký audio");
  return crypto
    .createHmac("sha256", secret)
    .update(`${id}:${userId}:${expiresAt}`)
    .digest("hex");
}

function isValidAudioStreamSignature(id, userId, expiresAt, signature) {
  if (!signature || expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(
    createAudioStreamSignature(id, userId, expiresAt),
    "hex",
  );
  const received = Buffer.from(String(signature), "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function hasAcceptedMediaRights(value) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function toFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function assertMediaRightsAccepted(req) {
  if (!hasAcceptedMediaRights(req.body?.rightsAccepted)) {
    const error = new Error(
      "Bạn cần xác nhận mình sở hữu video hoặc được phép sử dụng nội dung này.",
    );
    error.statusCode = 400;
    throw error;
  }
}

async function validateYoutubeMetadataForUser(userId, metadata) {
  const quota = await validateBeforeTranscription({
    userId,
    file: { size: metadata.approximateBytes || 0 },
    source: "youtube",
    expectedDurationSeconds: metadata.durationSeconds,
  });
  await validateAfterTranscription({
    userId,
    durationSeconds: metadata.durationSeconds,
    source: "youtube",
  });
  return quota;
}

router.post(
  "/url/metadata",
  requireAuth,
  urlImportLimiter,
  async (req, res) => {
    try {
      assertMediaRightsAccepted(req);
      const metadata = await getYoutubeMetadata(req.body?.url);
      const quota = await validateYoutubeMetadataForUser(req.user.id, metadata);
      return res.json({ metadata, quota });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Không đọc được thông tin video YouTube.",
        quota: error.details?.quota,
      });
    }
  },
);

router.post("/url", requireAuth, urlImportLimiter, async (req, res) => {
  let importedFile = null;
  try {
    assertMediaRightsAccepted(req);
    await assertTranscriptionProviderReady();

    const metadata = await getYoutubeMetadata(req.body?.url);
    const quotaBeforeDownload = await validateYoutubeMetadataForUser(
      req.user.id,
      metadata,
    );
    const imported = await downloadYoutubeAudio(metadata.url, {
      maxSizeMb: quotaBeforeDownload.limits.maxUploadMb,
      metadata,
    });
    importedFile = imported.file;

    const { durationSeconds: expectedDurationSeconds } =
      await probeMediaFile(importedFile);
    await validateBeforeTranscription({
      userId: req.user.id,
      file: importedFile,
      source: "youtube",
      expectedDurationSeconds,
    });
    await validateAfterTranscription({
      userId: req.user.id,
      durationSeconds: expectedDurationSeconds,
      source: "youtube",
    });

    const language = req.body.language || req.body.transcriptionLanguage || "auto";
    const audioMode =
      req.body.audioMode === "song" || req.body.audioMode === "music"
        ? "song"
        : "speech";
    const translateTo = req.body.translateTo || req.body.targetLanguage || "";
    const userSettings = await getUserSettings(req.user.id);
    const dictionaryKeywords = parseDictionaryKeywords(
      userSettings.customDictionary,
    );
    const job = await enqueueTranscriptionJob({
      userId: req.user.id,
      file: importedFile,
      source: "youtube",
      language,
      audioMode,
      translateTo,
      dictionaryKeywords,
      transcriptionSettings: userSettings.transcriptionSettings,
      speakerLabels:
        req.body.speakerLabels === "true" || req.body.speakerLabels === true,
      expectedDurationSeconds,
    });
    const jobState = await getTranscriptionJobForUser(job.jobId, req.user.id);
    const quota = await getQuotaStatus(req.user.id);

    await writeSecurityAudit({
      event: "transcription.youtube_queued",
      outcome: "accepted",
      req,
      userId: req.user.id,
      metadata: {
        jobId: job.jobId,
        videoId: metadata.videoId,
        durationSeconds: expectedDurationSeconds,
      },
    });

    return res.status(202).json({
      id: job.transcription.id,
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      queuePosition: jobState?.queue_position || 1,
      estimatedRemainingSeconds: jobState?.estimated_remaining_seconds || null,
      expectedDurationSeconds: job.expectedDurationSeconds,
      filename: job.transcription.filename,
      fileSize: importedFile.size,
      createdAt: job.transcription.created_at,
      message: "Video YouTube đã được đưa vào hàng đợi chuyển đổi.",
      quota,
    });
  } catch (error) {
    console.error("YouTube import error:", error.message);
    await writeSecurityAudit({
      event: "transcription.youtube_rejected",
      outcome: "failure",
      req,
      userId: req.user?.id,
      metadata: { reason: error.message },
    });
    return res.status(error.statusCode || 500).json({
      error: error.message || "Không nhập được video YouTube.",
      quota: error.details?.quota,
    });
  } finally {
    await cleanupStagedFile(importedFile);
  }
});

router.post("/sonix/callback", async (req, res) => {
  const expectedSecret = String(process.env.SONIX_CALLBACK_SECRET || "");
  const providedSecret = String(req.query.secret || "");
  const expectedBuffer = Buffer.from(expectedSecret);
  const providedBuffer = Buffer.from(providedSecret);
  const validSecret =
    expectedBuffer.length > 0 &&
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  if (!validSecret) {
    return res.status(403).json({ error: "Callback Sonix không hợp lệ" });
  }

  const customData = req.body?.custom_data || req.body?.customData || {};
  const jobId = Number.parseInt(String(customData.job_id || ""), 10);
  const status = String(req.body?.status || "").toLowerCase();
  try {
    if (Number.isFinite(jobId)) {
      if (status === "completed") {
        await pool.query(
          `UPDATE transcription_jobs
           SET progress = GREATEST(progress, 80), updated_at = NOW()
           WHERE id = $1 AND status = 'processing'`,
          [jobId],
        );
      } else if (["failed", "blocked"].includes(status)) {
        await pool.query(
          `UPDATE transcription_jobs SET error_message = $2, updated_at = NOW()
           WHERE id = $1 AND status = 'processing'`,
          [jobId, `Sonix callback báo trạng thái ${status}`],
        );
      }
    }
    return res.json({ received: true });
  } catch (error) {
    console.error("Sonix callback error:", error.message);
    return res.status(500).json({ error: "Không ghi nhận được callback Sonix" });
  }
});

router.get("/provider-files/:jobId", async (req, res) => {
  const jobId = Number.parseInt(req.params.jobId, 10);
  if (
    !Number.isFinite(jobId) ||
    !verifyProviderFileSignature(
      jobId,
      req.query.expires,
      req.query.signature,
    )
  ) {
    return res.status(403).json({ error: "Liên kết file không hợp lệ hoặc đã hết hạn" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT transcript.audio_filename
       FROM transcription_jobs job
       JOIN transcriptions transcript ON transcript.id = job.transcription_id
       WHERE job.id = $1 AND job.status IN ('queued', 'processing')`,
      [jobId],
    );
    if (!rows[0]?.audio_filename) {
      return res.status(404).json({ error: "Không tìm thấy file cho job" });
    }
    const filePath = resolveStoredAudioPath(rows[0].audio_filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File không còn trên server" });
    }
    res.setHeader("Cache-Control", "private, no-store");
    return res.sendFile(filePath);
  } catch (error) {
    console.error("Provider file error:", error.message);
    return res.status(500).json({ error: "Không cung cấp được file cho provider" });
  }
});

// POST /api/transcribe — lưu file và trả job ngay; worker nền xử lý transcript.
router.post(
  "/",
  requireAuth,
  uploadLimiter,
  upload,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Vui lòng chọn file âm thanh" });
      }
      req.file.originalname = normalizeFilename(req.file.originalname);
      await assertTranscriptionProviderReady();
      const source =
        req.body.source === "recording" ||
        req.file?.originalname?.startsWith("recording.")
          ? "recording"
          : "upload";
      const { durationSeconds: expectedDurationSeconds } =
        await probeMediaFile(req.file);
      const language =
        req.body.language || req.body.transcriptionLanguage || "auto";
      const audioMode =
        req.body.audioMode === "song" || req.body.audioMode === "music"
          ? "song"
          : "speech";
      const translateTo =
        req.body.translateTo || req.body.targetLanguage || "";
      const userSettings = await getUserSettings(req.user.id);
      const dictionaryKeywords = parseDictionaryKeywords(
        userSettings.customDictionary,
      );

      await validateBeforeTranscription({
        userId: req.user.id,
        file: req.file,
        source,
        expectedDurationSeconds,
      });

      const job = await enqueueTranscriptionJob({
        userId: req.user.id,
        file: req.file,
        source,
        language,
        audioMode,
        translateTo,
        dictionaryKeywords,
        transcriptionSettings: userSettings.transcriptionSettings,
        speakerLabels:
          req.body.speakerLabels === "true" || req.body.speakerLabels === true,
        expectedDurationSeconds,
      });
      const jobState = await getTranscriptionJobForUser(job.jobId, req.user.id);
      const quota = await getQuotaStatus(req.user.id);
      await writeSecurityAudit({
        event: "transcription.upload_queued",
        outcome: "accepted",
        req,
        userId: req.user.id,
        metadata: { jobId: job.jobId, source },
      });

      return res.status(202).json({
        id: job.transcription.id,
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        queuePosition: jobState?.queue_position || 1,
        estimatedRemainingSeconds:
          jobState?.estimated_remaining_seconds || null,
        expectedDurationSeconds: job.expectedDurationSeconds,
        filename: job.transcription.filename,
        createdAt: job.transcription.created_at,
        message: "File da duoc xep hang xu ly. Ban co the chuyen sang trang khac.",
        quota,
      });
    } catch (err) {
      console.error("Transcribe error:", err);
      await writeSecurityAudit({
        event: "transcription.upload_rejected",
        outcome: "failure",
        req,
        userId: req.user?.id,
        metadata: { reason: err.message },
      });
      return res
        .status(err.statusCode || 500)
        .json({
          error: err.message || "Lỗi khi chuyển đổi âm thanh",
          quota: err.details?.quota,
        });
    } finally {
      await cleanupStagedFile(req.file);
    }
  },
);

// GET /api/transcribe/jobs/:jobId — trạng thái job nền của user
router.get("/jobs/:jobId", requireAuth, async (req, res) => {
  const jobId = Number.parseInt(req.params.jobId, 10);
  if (!Number.isFinite(jobId)) {
    return res.status(400).json({ error: "Job ID khong hop le" });
  }
  try {
    const job = await getTranscriptionJobForUser(jobId, req.user.id);
    if (!job) return res.status(404).json({ error: "Khong tim thay job" });
    return res.json(job);
  } catch (error) {
    console.error("Get transcription job error:", error.message);
    return res.status(500).json({ error: "Khong the tai trang thai job" });
  }
});

router.delete("/jobs/:jobId", requireAuth, async (req, res) => {
  const jobId = Number.parseInt(req.params.jobId, 10);
  if (!Number.isFinite(jobId)) {
    return res.status(400).json({ error: "Job ID không hợp lệ" });
  }
  try {
    const job = await cancelTranscriptionJobForUser(jobId, req.user.id);
    return res.json({ job });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không hủy được job" });
  }
});

// GET /api/transcribe/history — lịch sử và trạng thái job của user
router.get("/history", requireAuth, async (req, res) => {
  try {
    const paginated = String(req.query.paginated || "") === "1";
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 20),
    );
    const search = String(req.query.q || "").trim().slice(0, 200);
    const offset = (page - 1) * limit;
    const values = [req.user.id];
    let searchSql = "";
    if (search) {
      values.push(`%${search}%`);
      searchSql = `
        AND (
          transcript.filename ILIKE $${values.length}
          OR COALESCE(transcript.text, '') ILIKE $${values.length}
          OR COALESCE(transcript.translated_text, '') ILIKE $${values.length}
        )`;
    }

    const countResult = paginated
      ? await pool.query(
          `SELECT COUNT(*)::integer AS total
           FROM transcriptions transcript
           WHERE transcript.user_id = $1${searchSql}`,
          values,
        )
      : null;
    const queryValues = [...values, limit, offset];
    const limitParameter = queryValues.length - 1;
    const offsetParameter = queryValues.length;
    const { rows } = await pool.query(
      `SELECT transcript.id, transcript.filename, transcript.file_size, transcript.duration,
         transcript.processing_seconds,
         LEFT(COALESCE(transcript.text, ''), 500) AS text,
         LENGTH(COALESCE(transcript.text, '')) > 500 AS text_truncated,
         transcript.audio_filename, transcript.source_language,
         LEFT(transcript.translated_text, 500) AS translated_text,
         LENGTH(COALESCE(transcript.translated_text, '')) > 500 AS translation_truncated,
         transcript.translation_target_language,
         transcript.translation_provider, transcript.translation_error, transcript.created_at,
         COALESCE(job.status, transcript.status, 'completed') AS status,
         COALESCE(job.progress, CASE WHEN transcript.status = 'completed' THEN 100 ELSE 0 END) AS progress,
         COALESCE(job.error_message, transcript.error_message) AS error_message,
         job.id AS job_id
       FROM transcriptions transcript
       LEFT JOIN transcription_jobs job ON job.transcription_id = transcript.id
       WHERE transcript.user_id = $1${searchSql}
       ORDER BY transcript.created_at DESC, transcript.id DESC
       LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
      queryValues,
    );
    const enriched = await Promise.all(
      rows.map(async (item) => {
        const normalizedItem = {
          ...item,
          filename: normalizeFilename(item.filename),
          duration: toFiniteNumberOrNull(item.duration),
          processing_seconds: toFiniteNumberOrNull(item.processing_seconds),
        };
        if (!item.job_id || !["queued", "processing"].includes(item.status)) {
          return normalizedItem;
        }
        const job = await getTranscriptionJobForUser(item.job_id, req.user.id);
        return job
          ? {
              ...normalizedItem,
              queue_position: job.queue_position,
              estimated_wait_seconds: job.estimated_wait_seconds,
              estimated_processing_seconds: job.estimated_processing_seconds,
              estimated_remaining_seconds: job.estimated_remaining_seconds,
            }
          : normalizedItem;
      }),
    );
    res.setHeader("Cache-Control", "no-store");
    if (!paginated) return res.json(enriched);

    const total = Number(countResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return res.json({
      items: enriched,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
        hasPrevious: page > 1,
        hasNext: page < totalPages,
      },
    });
  } catch (error) {
    console.error("Get transcription history error:", error.message);
    return res.status(500).json({ error: "Lỗi server" });
  }
});

// GET /api/transcribe/history/:id - tải nội dung đầy đủ khi người dùng mở bản ghi
router.get("/history/:id", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "ID không hợp lệ" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT transcript.id, transcript.filename, transcript.file_size, transcript.duration,
         transcript.processing_seconds, transcript.text, transcript.words, transcript.audio_filename,
         transcript.source_language, transcript.translated_text, transcript.translation_target_language,
         transcript.translation_provider, transcript.translation_error, transcript.created_at,
         COALESCE(job.status, transcript.status, 'completed') AS status,
         COALESCE(job.progress, CASE WHEN transcript.status = 'completed' THEN 100 ELSE 0 END) AS progress,
         COALESCE(job.error_message, transcript.error_message) AS error_message,
         job.id AS job_id
       FROM transcriptions transcript
       LEFT JOIN transcription_jobs job ON job.transcription_id = transcript.id
       WHERE transcript.id = $1 AND transcript.user_id = $2
       LIMIT 1`,
      [id, req.user.id],
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Không tìm thấy bản ghi" });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ...rows[0],
      filename: normalizeFilename(rows[0].filename),
      text: String(rows[0].text || ""),
      words: Array.isArray(rows[0].words) ? rows[0].words : [],
    });
  } catch (error) {
    console.error("Get transcription detail error:", error.message);
    return res.status(500).json({ error: "Không thể tải nội dung bản ghi" });
  }
});

router.post("/realtime/sessions", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [req.user.id]);
    await client.query(
      `UPDATE realtime_sessions
       SET status = 'expired', ended_at = COALESCE(ended_at, expires_at)
       WHERE user_id = $1 AND status = 'active' AND expires_at <= NOW()`,
      [req.user.id],
    );
    const active = await client.query(
      "SELECT id FROM realtime_sessions WHERE user_id = $1 AND status = 'active'",
      [req.user.id],
    );
    if (active.rows[0]) {
      const error = new Error("Bạn đang có một phiên realtime khác đang hoạt động");
      error.statusCode = 409;
      throw error;
    }
    const quota = await getQuotaStatus(req.user.id, { db: client });
    if (quota.isLimitReached) {
      const error = new Error("Tài khoản đã hết thời lượng. Vui lòng nâng cấp gói cước.");
      error.statusCode = 402;
      error.details = { quota };
      throw error;
    }
    const maxSeconds = Math.max(
      1,
      Math.min(quota.remainingSeconds, quota.limits.maxRecordSeconds),
    );
    const sessionId = crypto.randomUUID();
    await client.query(
      `INSERT INTO realtime_sessions (id, user_id, max_seconds, expires_at)
       VALUES ($1, $2, $3::integer, NOW() + ($3::integer * INTERVAL '1 second'))`,
      [sessionId, req.user.id, maxSeconds],
    );
    await client.query("COMMIT");
    return res.status(201).json({ sessionId, maxSeconds, quota });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(error.statusCode || 500).json({
      error: error.message || "Không bắt đầu được phiên realtime",
      quota: error.details?.quota,
    });
  } finally {
    client.release();
  }
});

router.delete("/realtime/sessions/:sessionId", requireAuth, async (req, res) => {
  const sessionId = String(req.params.sessionId || "");
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ error: "Phiên realtime không hợp lệ" });
  }
  await pool.query(
    `UPDATE realtime_sessions
     SET status = 'cancelled', ended_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'active'`,
    [sessionId, req.user.id],
  );
  return res.json({ success: true });
});

// POST /api/transcribe/text — lưu transcript realtime/manual vào lịch sử
router.post("/text", requireAuth, async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "Thiếu nội dung transcript" });
    }
    if (text.length > 500_000) {
      return res.status(413).json({ error: "Transcript realtime quá dài" });
    }

    const source = req.body.source === "manual" ? "manual" : "realtime";
    const realtimeSessionId = String(req.body.realtimeSessionId || "");
    if (source === "realtime" && !/^[0-9a-f-]{36}$/i.test(realtimeSessionId)) {
      return res.status(400).json({ error: "Thiếu phiên realtime hợp lệ" });
    }
    let durationSeconds = source === "manual"
      ? Math.max(1, Math.min(3600, Math.ceil(Number(req.body.durationSeconds || 1) || 1)))
      : null;
    const sourceLanguage = normalizeLanguageCode(req.body.language, "auto");
    const targetLanguage = normalizeTranslateTarget(
      req.body.translateTo || req.body.targetLanguage,
    );
    const filename = normalizeFilename(
      String(req.body.filename || "").trim() ||
        `${source}-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
    ).slice(0, 255);

    let translation = null;
    let translationError = null;
    if (targetLanguage) {
      try {
        translation = await translateTranscript({
          text,
          sourceLanguage,
          targetLanguage,
        });
      } catch (error) {
        translationError =
          error.message || "Không dịch được transcript sang ngôn ngữ đã chọn.";
      }
    }

    const client = await pool.connect();
    let savedTranscript;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [req.user.id]);
      if (source === "realtime") {
        const sessionResult = await client.query(
          `SELECT id, started_at, expires_at, max_seconds
           FROM realtime_sessions
           WHERE id = $1 AND user_id = $2 AND status = 'active'
           FOR UPDATE`,
          [realtimeSessionId, req.user.id],
        );
        const session = sessionResult.rows[0];
        if (!session) {
          const error = new Error("Phiên realtime đã kết thúc hoặc không tồn tại");
          error.statusCode = 409;
          throw error;
        }
        const effectiveEnd = Math.min(Date.now(), new Date(session.expires_at).getTime());
        durationSeconds = Math.max(
          1,
          Math.min(
            Number(session.max_seconds),
            Math.ceil((effectiveEnd - new Date(session.started_at).getTime()) / 1000),
          ),
        );
      }
      await validateBeforeTranscription({
        userId: req.user.id,
        source,
        expectedDurationSeconds: durationSeconds,
        db: client,
      });
      await validateAfterTranscription({
        userId: req.user.id,
        durationSeconds,
        source,
        db: client,
      });
      const { rows } = await client.query(
        `INSERT INTO transcriptions (
         user_id, filename, file_size, duration, processing_seconds, text, words, audio_filename,
         source_language, translated_text, translation_target_language, translation_provider,
         translation_error
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10, $11, $12)
       RETURNING id, filename, file_size, duration, processing_seconds, text, words, audio_filename,
         source_language, translated_text, translation_target_language, translation_provider,
         translation_error, created_at`,
        [
          req.user.id,
          filename,
          0,
          durationSeconds,
          0,
          text,
          JSON.stringify([]),
          translation?.sourceLanguage || sourceLanguage,
          translation?.text || null,
           translation?.targetLanguage || targetLanguage || null,
           translation?.provider || null,
           translationError || null,
        ],
      );
      savedTranscript = rows[0];
      await recordQuotaUsage({
        userId: req.user.id,
        transcriptionId: savedTranscript.id,
        durationSeconds,
        source,
        db: client,
      });
      if (source === "realtime") {
        await client.query(
          `UPDATE realtime_sessions
           SET status = 'completed', ended_at = NOW(), transcription_id = $2
           WHERE id = $1`,
          [realtimeSessionId, savedTranscript.id],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const quota = await getQuotaStatus(req.user.id);

    return res.status(201).json({
      id: savedTranscript.id,
      provider: "browser-realtime",
      providerId: null,
      filename: savedTranscript.filename,
      fileSize: savedTranscript.file_size,
      duration: savedTranscript.duration,
      processingSeconds: savedTranscript.processing_seconds,
      text: savedTranscript.text,
      words: savedTranscript.words || [],
      sourceLanguage: savedTranscript.source_language,
      translation: savedTranscript.translated_text
        ? {
            text: savedTranscript.translated_text,
            sourceLanguage: savedTranscript.source_language,
            targetLanguage: savedTranscript.translation_target_language,
            provider: savedTranscript.translation_provider,
          }
        : null,
      translationError,
      createdAt: savedTranscript.created_at,
      quota,
    });
  } catch (err) {
    console.error("Save realtime transcript error:", err);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Không lưu được transcript realtime",
      quota: err.details?.quota,
    });
  }
});

// POST /api/transcribe/:id/audio-access - cấp URL ngắn hạn để trình duyệt stream audio.
router.post("/:id/audio-access", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "ID không hợp lệ" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT audio_filename FROM transcriptions WHERE id = $1 AND user_id = $2",
      [id, req.user.id],
    );
    if (!rows[0]?.audio_filename) {
      return res.status(404).json({ error: "Không có file audio" });
    }
    const filePath = resolveStoredAudioPath(rows[0].audio_filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File audio không tồn tại trên server" });
    }
    const expiresAt = Math.floor(Date.now() / 1000) + AUDIO_STREAM_TTL_SECONDS;
    const signature = createAudioStreamSignature(id, req.user.id, expiresAt);
    const query = new URLSearchParams({
      userId: String(req.user.id),
      expiresAt: String(expiresAt),
      signature,
    });
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      url: `/api/transcribe/${id}/audio-stream?${query.toString()}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Không tạo được đường dẫn audio",
    });
  }
});

// GET /api/transcribe/:id/audio-stream - URL ký ngắn hạn, hỗ trợ HTTP Range.
router.get("/:id/audio-stream", async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const userId = Number.parseInt(req.query.userId, 10);
  const expiresAt = Number.parseInt(req.query.expiresAt, 10);
  if (
    !Number.isFinite(id) ||
    !Number.isFinite(userId) ||
    !Number.isFinite(expiresAt)
  ) {
    return res.status(400).json({ error: "Đường dẫn audio không hợp lệ" });
  }
  try {
    if (
      !isValidAudioStreamSignature(
        id,
        userId,
        expiresAt,
        req.query.signature,
      )
    ) {
      return res.status(401).json({ error: "Đường dẫn audio đã hết hạn" });
    }
    const { rows } = await pool.query(
      "SELECT audio_filename FROM transcriptions WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    if (!rows[0]?.audio_filename) {
      return res.status(404).json({ error: "Không có file audio" });
    }
    const filePath = resolveStoredAudioPath(rows[0].audio_filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File audio không tồn tại trên server" });
    }
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Disposition", "inline");
    return res.sendFile(filePath);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Lỗi server" });
  }
});

// GET /api/transcribe/:id/audio — tải file audio có xác thực (tương thích cũ)
router.get("/:id/audio", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID không hợp lệ" });
  try {
    const { rows } = await pool.query(
      "SELECT audio_filename FROM transcriptions WHERE id = $1 AND user_id = $2",
      [id, req.user.id],
    );
    if (!rows[0]?.audio_filename)
      return res.status(404).json({ error: "Không có file audio" });
    const filePath = resolveStoredAudioPath(rows[0].audio_filename);
    if (!fs.existsSync(filePath))
      return res
        .status(404)
        .json({ error: "File audio không tồn tại trên server" });
    res.sendFile(filePath);
  } catch {
    return res.status(500).json({ error: "Lỗi server" });
  }
});

// PATCH /api/transcribe/:id — cập nhật nội dung văn bản
router.patch("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID không hợp lệ" });
  const { text } = req.body;
  if (typeof text !== "string" || text.length > 2_000_000)
    return res.status(400).json({ error: "Thiếu trường text" });
  try {
    const { rowCount, rows } = await pool.query(
      "UPDATE transcriptions SET text = $1 WHERE id = $2 AND user_id = $3 RETURNING id, text",
      [text, id, req.user.id],
    );
    if (rowCount === 0)
      return res.status(404).json({ error: "Không tìm thấy bản ghi" });
    return res.json(rows[0]);
  } catch {
    return res.status(500).json({ error: "Lỗi server" });
  }
});

// DELETE /api/transcribe/:id — xóa bản ghi và file audio
router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID không hợp lệ" });
  try {
    const active = await pool.query(
      `SELECT job.id
       FROM transcription_jobs job
       JOIN transcriptions transcript ON transcript.id = job.transcription_id
       WHERE transcript.id = $1 AND transcript.user_id = $2
         AND job.status IN ('queued', 'processing')
       LIMIT 1`,
      [id, req.user.id],
    );
    if (active.rows[0]) {
      return res.status(409).json({
        error: "Job đang xử lý. Vui lòng hủy job trước khi xóa bản ghi.",
        jobId: active.rows[0].id,
      });
    }
    // Lấy audio_filename trước khi xóa
    const { rows } = await pool.query(
      "SELECT audio_filename FROM transcriptions WHERE id = $1 AND user_id = $2",
      [id, req.user.id],
    );
    const { rowCount } = await pool.query(
      "DELETE FROM transcriptions WHERE id = $1 AND user_id = $2",
      [id, req.user.id],
    );
    if (rowCount === 0)
      return res.status(404).json({ error: "Không tìm thấy bản ghi" });
    // Xóa file audio trên disk
    if (rows[0]?.audio_filename) {
      fs.unlink(resolveStoredAudioPath(rows[0].audio_filename), () => {});
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Lỗi server" });
  }
});

module.exports = router;
