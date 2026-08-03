require("../config/env");
const express = require("express");
const pool = require("../db");
const { hashApiKey } = require("./apiKeys");
const {
  assertTranscriptionProviderReady,
  getTranscriptionProvider,
  probeMediaFile,
  transcribeAndSave,
} = require("../services/transcriptionService");
const {
  cancelTranscriptionJobForUser,
  enqueueTranscriptionJob,
  getTranscriptionJobForUser,
} = require("../services/transcriptionQueue");
const {
  getQuotaStatus,
  validateBeforeTranscription,
  validateAfterTranscription,
} = require("../services/quotaService");
const {
  getUserSettings,
  parseDictionaryKeywords,
} = require("../services/userSettingsService");
const { normalizeFilename } = require("../services/filenameEncoding");
const {
  cleanupStagedFile,
  createPlanAwareMediaUpload,
  materializeFileBuffer,
} = require("../services/uploadStorage");
const { publicApiLimiter } = require("../middleware/security");
const { IS_PRODUCTION } = require("../config/security");
const { writeSecurityAudit } = require("../services/securityAuditService");

const router = express.Router();

const upload = createPlanAwareMediaUpload(async (req) => {
  const quota = await getQuotaStatus(req.user.id);
  return quota.limits.maxUploadMb;
});
const SYNC_API_MAX_MB = Math.max(
  1,
  Number.parseInt(process.env.SYNC_API_MAX_MB || "25", 10),
);
const ALLOW_SYNC_PUBLIC_API = process.env.ALLOW_SYNC_PUBLIC_API === "true";

function getApiKeyFromRequest(req) {
  const directKey = req.header("x-api-key");
  if (directKey) return directKey.trim();

  const auth = req.header("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  return "";
}

async function apiKeyAuth(req, res, next) {
  const apiKey = getApiKeyFromRequest(req);
  if (!apiKey)
    return res
      .status(401)
      .json({
        error:
          "Thiếu API key. Dùng header x-api-key hoặc Authorization: Bearer <api_key>.",
      });
  if (!apiKey.startsWith("vbee_sk_"))
    return res.status(401).json({ error: "API key không hợp lệ" });

  try {
    const { rows } = await pool.query(
      `SELECT api_key.id, api_key.user_id, api_key.name,
              account.plan, account.plan_expires_at, account.account_status
       FROM api_keys api_key
       JOIN users account ON account.id = api_key.user_id
       WHERE api_key.key_hash = $1 AND api_key.revoked_at IS NULL
       LIMIT 1`,
      [hashApiKey(apiKey)],
    );

    if (rows.length === 0)
      return res
        .status(401)
        .json({ error: "API key không hợp lệ hoặc đã bị thu hồi" });

    if (rows[0].account_status !== "active") {
      return res.status(403).json({ error: "Tài khoản đã bị khóa" });
    }

    if (
      rows[0].plan === "free" ||
      (rows[0].plan_expires_at && new Date(rows[0].plan_expires_at) <= new Date())
    ) {
      return res.status(403).json({
        error: "API chỉ khả dụng từ gói Tiêu chuẩn trở lên",
      });
    }

    await pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [
      rows[0].id,
    ]);
    req.apiKey = rows[0];
    req.user = { id: rows[0].user_id };
    return next();
  } catch (error) {
    console.error("API key auth error:", error);
    return res.status(500).json({ error: "Không thể xác thực API key" });
  }
}

router.get("/health", async (_req, res) => {
  res.json({
    status: "ok",
    service: "Vbee API",
    version: "v1",
    ...(IS_PRODUCTION
      ? {}
      : { transcriptionProvider: await getTranscriptionProvider() }),
  });
});

router.get("/transcribe/jobs/:jobId", apiKeyAuth, publicApiLimiter, async (req, res) => {
  const jobId = Number.parseInt(req.params.jobId, 10);
  if (!Number.isFinite(jobId)) {
    return res.status(400).json({ error: "Job ID khong hop le" });
  }
  try {
    const job = await getTranscriptionJobForUser(jobId, req.user.id);
    if (!job) return res.status(404).json({ error: "Khong tim thay job" });
    return res.json({ object: "transcription_job", ...job });
  } catch (error) {
    console.error("Public API job error:", error.message);
    return res.status(500).json({ error: "Khong the tai trang thai job" });
  }
});

router.delete("/transcribe/jobs/:jobId", apiKeyAuth, publicApiLimiter, async (req, res) => {
  const jobId = Number.parseInt(req.params.jobId, 10);
  if (!Number.isFinite(jobId)) {
    return res.status(400).json({ error: "Job ID không hợp lệ" });
  }
  try {
    const job = await cancelTranscriptionJobForUser(jobId, req.user.id);
    return res.json({ object: "transcription_job", ...job });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không hủy được job" });
  }
});

router.post(
  "/transcribe",
  apiKeyAuth,
  publicApiLimiter,
  upload,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Vui lòng chọn file âm thanh" });
      }
      req.file.originalname = normalizeFilename(req.file.originalname);
      await assertTranscriptionProviderReady();
      const source = req.body.source === "recording" ? "recording" : "api";
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

      const useQueue =
        !ALLOW_SYNC_PUBLIC_API ||
        req.body.async === "true" ||
        req.body.async === true ||
        req.body.wait === "false";
      if (useQueue) {
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
          event: "transcription.api_queued",
          outcome: "accepted",
          req,
          userId: req.user.id,
          metadata: { apiKeyId: req.apiKey.id, jobId: job.jobId },
        });
        return res.status(202).json({
          id: job.transcription.id,
          jobId: job.jobId,
          object: "transcription_job",
          status: job.status,
          progress: job.progress,
          queuePosition: jobState?.queue_position || 1,
          estimatedRemainingSeconds:
            jobState?.estimated_remaining_seconds || null,
          expectedDurationSeconds: job.expectedDurationSeconds,
          filename: job.transcription.filename,
          createdAt: job.transcription.created_at,
          quota,
        });
      }

      const bufferedFile = await materializeFileBuffer(req.file, SYNC_API_MAX_MB);
      const result = await transcribeAndSave({
        userId: req.user.id,
        file: bufferedFile,
        source,
        language,
        audioMode,
        translateTo,
        dictionaryKeywords,
        transcriptionSettings: userSettings.transcriptionSettings,
        speakerLabels:
          req.body.speakerLabels === "true" || req.body.speakerLabels === true,
        validateResult: ({ duration }) =>
          validateAfterTranscription({
            userId: req.user.id,
            durationSeconds: duration,
            source,
          }),
      });
      const quota = await getQuotaStatus(req.user.id);
      await writeSecurityAudit({
        event: "transcription.api_completed",
        outcome: "success",
        req,
        userId: req.user.id,
        metadata: { apiKeyId: req.apiKey.id, transcriptionId: result.id },
      });

      return res.json({
        id: result.id,
        object: "transcription",
        provider: result.provider,
        providerId: result.providerId,
        audioMode: result.audioMode,
        preprocessingApplied: result.preprocessingApplied,
        preprocessingMethod: result.preprocessingMethod,
        preprocessingWarning: result.preprocessingWarning,
        filename: result.filename,
        duration: result.duration,
        processingSeconds: result.processingSeconds,
        text: result.text,
        sourceLanguage: result.sourceLanguage,
        translation: result.translation,
        translationError: result.translationError,
        words: result.words,
        createdAt: result.createdAt,
        quota,
      });
    } catch (error) {
      console.error("Public API transcribe error:", error);
      await writeSecurityAudit({
        event: "transcription.api_rejected",
        outcome: "failure",
        req,
        userId: req.user?.id,
        metadata: { apiKeyId: req.apiKey?.id, reason: error.message },
      });
      return res
        .status(error.statusCode || 500)
        .json({
          error: error.message || "Lỗi khi xử lý API",
          quota: error.details?.quota,
        });
    } finally {
      await cleanupStagedFile(req.file);
    }
  },
);

module.exports = router;
