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
  translateAudioWithAssemblyAI,
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
  retryTranscriptionJobForUser,
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
  createZipBuffer,
  sanitizeZipName,
} = require("../services/zipExportService");
const {
  cleanupStagedFile,
  cleanupStagedFiles,
  createPlanAwareMediaUpload,
} = require("../services/uploadStorage");
const {
  createUserFolder,
  listUserFolders,
} = require("../services/workspaceFolderService");
const {
  MULTITRACK_MAX_TRACKS,
  finalizeMultitrackBatch,
  getMultitrackBatchForUser,
  normalizeTrackName,
} = require("../services/multitrackService");
const {
  downloadMediaAudio,
  getMediaMetadata,
} = require("../services/youtubeImportService");
const { requireAuth } = require("../middleware/auth");
const {
  translationLimiter,
  uploadLimiter,
  urlImportLimiter,
} = require("../middleware/security");
const { writeSecurityAudit } = require("../services/securityAuditService");

const router = express.Router();
const MAX_TRANSCRIPT_VERSIONS = 50;

const upload = createPlanAwareMediaUpload(async (req) => {
  const quota = await getQuotaStatus(req.user.id);
  return {
    maxSizeMb: quota.limits.maxUploadMb,
    supportedFormats: quota.limits.supportedFormats,
  };
});
const uploadBatch = createPlanAwareMediaUpload(
  async (req) => {
    const quota = await getQuotaStatus(req.user.id);
    return {
      maxSizeMb: quota.limits.maxUploadMb,
      supportedFormats: quota.limits.supportedFormats,
    };
  },
  "audio",
  { maxFiles: 8 },
);
const AUDIO_STREAM_TTL_SECONDS = Math.min(
  15 * 60,
  Math.max(
    60,
    Number.parseInt(process.env.AUDIO_STREAM_TTL_SECONDS || "300", 10) || 300,
  ),
);
const AUDIO_MIME_TYPES = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".weba": "audio/webm",
  ".webm": "audio/webm",
};

function getAudioContentType(filePath) {
  return (
    AUDIO_MIME_TYPES[path.extname(filePath).toLowerCase()] ||
    "application/octet-stream"
  );
}

function parseHttpRange(rangeHeader, fileSize) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match) return { invalid: true };

  let start = match[1] === "" ? null : Number.parseInt(match[1], 10);
  let end = match[2] === "" ? null : Number.parseInt(match[2], 10);

  if (start === null && end === null) return { invalid: true };
  if (start === null) {
    const suffixLength = end;
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { invalid: true };
    }
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    if (!Number.isFinite(start) || start < 0) return { invalid: true };
    end = end === null ? fileSize - 1 : end;
  }

  if (!Number.isFinite(end) || end < start || start >= fileSize) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, fileSize - 1) };
}

function streamAudioFile(req, res, filePath) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const contentType = getAudioContentType(filePath);
  const range = parseHttpRange(req.headers.range, fileSize);

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", "inline");

  if (range?.invalid) {
    res.setHeader("Content-Range", `bytes */${fileSize}`);
    return res.status(416).end();
  }

  if (fileSize === 0) {
    res.setHeader("Content-Length", "0");
    return res.end();
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : fileSize - 1;
  const contentLength = Math.max(0, end - start + 1);

  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  }
  res.setHeader("Content-Length", String(contentLength));

  if (req.method === "HEAD") {
    return res.end();
  }

  const stream = fs.createReadStream(filePath, { start, end });
  req.on("close", () => {
    stream.destroy();
  });
  stream.on("error", (error) => {
    if (!res.headersSent) {
      res.status(500).json({ error: "Không đọc được file audio" });
      return;
    }
    res.destroy(error);
  });
  return stream.pipe(res);
}

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
      "Bạn cần xác nhận mình sở hữu nội dung hoặc được phép sử dụng nội dung này.",
    );
    error.statusCode = 400;
    throw error;
  }
}

async function validateUrlMetadataForUser(userId, metadata) {
  const quota = await validateBeforeTranscription({
    userId,
    file: { size: metadata.approximateBytes || 0 },
    source: "url",
    expectedDurationSeconds: metadata.durationSeconds,
  });
  await validateAfterTranscription({
    userId,
    durationSeconds: metadata.durationSeconds,
    source: "url",
  });
  return quota;
}

function normalizeExportIds(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return [
    ...new Set(
      values
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isSafeInteger(item) && item > 0),
    ),
  ].slice(0, 100);
}

async function insertTranscriptVersion(client, transcript, label = "Auto-save") {
  await client.query(
    `INSERT INTO transcription_versions (transcription_id, user_id, text, words, speaker_names, label)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
    [
      transcript.id,
      transcript.user_id,
      String(transcript.text || ""),
      JSON.stringify(Array.isArray(transcript.words) ? transcript.words : []),
      JSON.stringify(
        transcript.speaker_names &&
          typeof transcript.speaker_names === "object" &&
          !Array.isArray(transcript.speaker_names)
          ? transcript.speaker_names
          : {},
      ),
      label,
    ],
  );
  await client.query(
    `DELETE FROM transcription_versions
     WHERE id IN (
       SELECT id
       FROM transcription_versions
       WHERE transcription_id = $1
       ORDER BY created_at DESC, id DESC
       OFFSET $2
     )`,
    [transcript.id, MAX_TRANSCRIPT_VERSIONS],
  );
}

router.get("/folders", requireAuth, async (req, res) => {
  try {
    const folders = await listUserFolders(req.user.id);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ folders });
  } catch (error) {
    console.error("List transcription folders error:", error.message);
    return res.status(500).json({ error: "Không tải được danh sách thư mục" });
  }
});

router.post("/folders", requireAuth, async (req, res) => {
  try {
    const folder = await createUserFolder(req.user.id, req.body?.name);
    return res.status(201).json({ folder });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không tạo được thư mục" });
  }
});

router.post(
  "/url/metadata",
  requireAuth,
  urlImportLimiter,
  async (req, res) => {
    try {
      assertMediaRightsAccepted(req);
      const metadata = await getMediaMetadata(req.body?.url);
      const quota = await validateUrlMetadataForUser(req.user.id, metadata);
      return res.json({ metadata, quota });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Không đọc được thông tin audio/video từ link.",
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

    const metadata = await getMediaMetadata(req.body?.url);
    const quotaBeforeDownload = await validateUrlMetadataForUser(
      req.user.id,
      metadata,
    );
    const imported = await downloadMediaAudio(metadata.url, {
      maxSizeMb: quotaBeforeDownload.limits.maxUploadMb,
      metadata,
    });
    importedFile = imported.file;

    const { durationSeconds: expectedDurationSeconds } =
      await probeMediaFile(importedFile);
    await validateBeforeTranscription({
      userId: req.user.id,
      file: importedFile,
      source: "url",
      expectedDurationSeconds,
    });
    await validateAfterTranscription({
      userId: req.user.id,
      durationSeconds: expectedDurationSeconds,
      source: "url",
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
      source: "url",
      language,
      audioMode,
      translateTo,
      dictionaryKeywords,
      transcriptionSettings: userSettings.transcriptionSettings,
      speakerLabels:
        req.body.speakerLabels === "true" || req.body.speakerLabels === true,
      speakerCount: req.body.speakerCount,
      expectedDurationSeconds,
      folderId: req.body.folderId,
      uploadFingerprint: req.body.uploadFingerprint,
    });
    const jobState = await getTranscriptionJobForUser(job.jobId, req.user.id);
    const quota = await getQuotaStatus(req.user.id);

    await writeSecurityAudit({
      event: "transcription.url_queued",
      outcome: "accepted",
      req,
      userId: req.user.id,
      metadata: {
        jobId: job.jobId,
        mediaId: metadata.videoId,
        platform: metadata.platform,
        sourceHost: metadata.sourceHost,
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
      message: `${metadata.platform || "Nội dung"} đã được đưa vào hàng đợi chuyển đổi.`,
      reused: Boolean(job.reused),
      quota,
    });
  } catch (error) {
    console.error("Media URL import error:", error.message);
    await writeSecurityAudit({
      event: "transcription.url_rejected",
      outcome: "failure",
      req,
      userId: req.user?.id,
      metadata: { reason: error.message },
    });
    return res.status(error.statusCode || 500).json({
      error: error.message || "Không nhập được audio/video từ link.",
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

// POST /api/transcribe/batch — nhận nhiều file và tạo một transcript riêng cho mỗi file.
router.post(
  "/batch",
  requireAuth,
  uploadLimiter,
  uploadBatch,
  async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    try {
      if (files.length < 2) {
        return res.status(400).json({
          error: "Chế độ nhiều file cần ít nhất 2 file âm thanh",
        });
      }
      await assertTranscriptionProviderReady();
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
      const batchId = crypto.randomUUID();
      const accepted = [];
      const rejected = [];

      for (const file of files) {
        try {
          file.originalname = normalizeFilename(file.originalname);
          const { durationSeconds: expectedDurationSeconds } =
            await probeMediaFile(file);
          const job = await enqueueTranscriptionJob({
            userId: req.user.id,
            file,
            source: "upload",
            language,
            audioMode,
            translateTo,
            dictionaryKeywords,
            transcriptionSettings: userSettings.transcriptionSettings,
            speakerLabels:
              req.body.speakerLabels === "true" ||
              req.body.speakerLabels === true,
            speakerCount: req.body.speakerCount,
            expectedDurationSeconds,
            folderId: req.body.folderId,
            batchId,
          });
          accepted.push({
            id: job.transcription.id,
            jobId: job.jobId,
            status: job.status,
            progress: job.progress,
            expectedDurationSeconds: job.expectedDurationSeconds,
            filename: job.transcription.filename,
            folderId: job.transcription.folder_id,
            folderName: job.transcription.folder_name,
            createdAt: job.transcription.created_at,
          });
        } catch (error) {
          rejected.push({
            filename: normalizeFilename(file.originalname),
            error: error.message || "Không xếp hàng được file",
          });
          await cleanupStagedFile(file);
        }
      }

      if (accepted.length === 0) {
        return res.status(422).json({
          error: rejected[0]?.error || "Không có track nào được xếp hàng",
          rejected,
        });
      }
      const quota = await getQuotaStatus(req.user.id);
      await writeSecurityAudit({
        event: "transcription.batch_queued",
        outcome: rejected.length ? "partial" : "accepted",
        req,
        userId: req.user.id,
        metadata: {
          batchId,
          accepted: accepted.length,
          rejected: rejected.length,
        },
      });
      return res.status(rejected.length ? 207 : 202).json({
        ...accepted[0],
        batchId,
        jobs: accepted,
        rejected,
        message: `${accepted.length} file đã được đưa vào hàng đợi.`,
        quota,
      });
    } catch (error) {
      console.error("Batch transcribe error:", error);
      return res.status(error.statusCode || 500).json({
        error: error.message || "Không tải được nhiều file",
        quota: error.details?.quota,
      });
    } finally {
      await cleanupStagedFiles(files);
    }
  },
);

// POST /api/transcribe/multitrack — nhiều micro của cùng một phiên, hợp nhất thành một transcript.
router.post(
  "/multitrack",
  requireAuth,
  uploadLimiter,
  uploadBatch,
  async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    const acceptedJobs = [];
    let batchId = null;
    try {
      if (files.length < 2 || files.length > MULTITRACK_MAX_TRACKS) {
        return res.status(400).json({
          error: `Multitrack cần từ 2 đến ${MULTITRACK_MAX_TRACKS} file của cùng một phiên ghi.`,
        });
      }
      const pending = await pool.query(
        `SELECT COUNT(*)::integer AS total
         FROM transcription_jobs
         WHERE user_id = $1
           AND status IN ('queued', 'processing')
           AND cancel_requested = FALSE`,
        [req.user.id],
      );
      const maxPending = Number.parseInt(
        process.env.MAX_PENDING_JOBS_PER_USER || "5",
        10,
      );
      if (Number(pending.rows[0]?.total || 0) + files.length > maxPending) {
        return res.status(429).json({
          error: `Bạn cần còn ít nhất ${files.length} vị trí trống trong hàng đợi để xử lý multitrack.`,
        });
      }

      await assertTranscriptionProviderReady();
      const language =
        req.body.language || req.body.transcriptionLanguage || "auto";
      const userSettings = await getUserSettings(req.user.id);
      const dictionaryKeywords = parseDictionaryKeywords(
        userSettings.customDictionary,
      );
      let suppliedTrackNames = [];
      try {
        suppliedTrackNames = JSON.parse(req.body.trackNames || "[]");
      } catch {
        suppliedTrackNames = [];
      }
      const prepared = await Promise.all(
        files.map(async (file, index) => {
          file.originalname = normalizeFilename(file.originalname);
          const { durationSeconds } = await probeMediaFile(file);
          return {
            file,
            durationSeconds,
            trackName: normalizeTrackName(
              suppliedTrackNames[index] ||
                path.basename(file.originalname, path.extname(file.originalname)),
              index,
            ),
          };
        }),
      );

      batchId = crypto.randomUUID();
      const sessionName = String(req.body.sessionName || "")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 220);
      const outputName = (
        sessionName ||
        `${path.basename(files[0].originalname, path.extname(files[0].originalname))} - Multitrack.mp3`
      ).slice(0, 255);
      await pool.query(
        `INSERT INTO transcription_batches (
           id, user_id, kind, name, status, expected_tracks
         )
         VALUES ($1, $2, 'multitrack', $3, 'queued', $4)`,
        [batchId, req.user.id, outputName, files.length],
      );

      for (let index = 0; index < prepared.length; index += 1) {
        const item = prepared[index];
        const job = await enqueueTranscriptionJob({
          userId: req.user.id,
          file: item.file,
          source: "multitrack",
          language,
          audioMode: "speech",
          translateTo: "",
          dictionaryKeywords,
          transcriptionSettings: userSettings.transcriptionSettings,
          speakerLabels: false,
          expectedDurationSeconds: item.durationSeconds,
          folderId: req.body.folderId,
          batchId,
          batchKind: "multitrack",
          batchTrackIndex: index,
          batchTrackName: item.trackName,
        });
        acceptedJobs.push({
          id: job.transcription.id,
          jobId: job.jobId,
          status: job.status,
          progress: job.progress,
          filename: job.transcription.filename,
          trackName: item.trackName,
        });
      }
      await pool.query(
        `UPDATE transcription_batches
         SET folder_id = $2, status = 'processing', updated_at = NOW()
         WHERE id = $1`,
        [batchId, acceptedJobs.length ? req.body.folderId || null : null],
      );
      return res.status(202).json({
        batchId,
        status: "processing",
        progress: 0,
        jobs: acceptedJobs,
        message: `${files.length} track đang được nhận dạng và sẽ hợp nhất thành một transcript.`,
      });
    } catch (error) {
      await Promise.all(
        acceptedJobs.map((job) =>
          cancelTranscriptionJobForUser(job.jobId, req.user.id).catch(() => {}),
        ),
      );
      if (batchId) {
        await pool
          .query(
            `UPDATE transcription_batches
             SET status = 'failed', error_message = $2, completed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [batchId, String(error.message || "Không tạo được multitrack").slice(0, 2000)],
          )
          .catch(() => {});
      }
      console.error("Multitrack upload error:", error);
      return res.status(error.statusCode || 500).json({
        error: error.message || "Không tạo được phiên multitrack",
      });
    } finally {
      await cleanupStagedFiles(files);
    }
  },
);

router.get("/multitrack/:batchId", requireAuth, async (req, res) => {
  try {
    const current = await getMultitrackBatchForUser(
      req.params.batchId,
      req.user.id,
    );
    if (!current) {
      return res.status(404).json({ error: "Không tìm thấy phiên multitrack" });
    }
    if (["queued", "processing", "merging"].includes(current.status)) {
      await finalizeMultitrackBatch(current.id).catch(() => {});
    }
    const batch = await getMultitrackBatchForUser(current.id, req.user.id);
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      id: batch.id,
      status: batch.status,
      progress: Math.max(0, Math.min(100, Number(batch.progress || 0))),
      expectedTracks: batch.expected_tracks,
      trackCount: batch.track_count,
      outputTranscriptionId: batch.output_transcription_id,
      error: batch.error_message,
    });
  } catch (error) {
    console.error("Multitrack status error:", error);
    return res.status(500).json({ error: "Không tải được trạng thái multitrack" });
  }
});

router.delete("/multitrack/:batchId", requireAuth, async (req, res) => {
  try {
    const batch = await getMultitrackBatchForUser(
      req.params.batchId,
      req.user.id,
    );
    if (!batch) {
      return res.status(404).json({ error: "Không tìm thấy phiên multitrack" });
    }
    const jobs = await pool.query(
      `SELECT id FROM transcription_jobs
       WHERE user_id = $1 AND payload->>'batchId' = $2`,
      [req.user.id, req.params.batchId],
    );
    await Promise.all(
      jobs.rows.map((job) =>
        cancelTranscriptionJobForUser(job.id, req.user.id).catch(() => {}),
      ),
    );
    await pool.query(
      `UPDATE transcription_batches
       SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [req.params.batchId, req.user.id],
    );
    return res.json({ status: "cancelled" });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không hủy được multitrack" });
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
        speakerCount: req.body.speakerCount,
        expectedDurationSeconds,
        folderId: req.body.folderId,
        uploadFingerprint: req.body.uploadFingerprint,
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
        fileSize: job.transcription.file_size,
        createdAt: job.transcription.created_at,
        message: "File da duoc xep hang xu ly. Ban co the chuyen sang trang khac.",
        reused: Boolean(job.reused),
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

router.post("/jobs/:jobId/retry", requireAuth, async (req, res) => {
  const jobId = Number.parseInt(req.params.jobId, 10);
  if (!Number.isFinite(jobId)) {
    return res.status(400).json({ error: "Job ID không hợp lệ" });
  }
  try {
    const job = await retryTranscriptionJobForUser(jobId, req.user.id);
    const quota = await getQuotaStatus(req.user.id);
    await writeSecurityAudit({
      event: "transcription.job_retry",
      outcome: "accepted",
      req,
      userId: req.user.id,
      metadata: { jobId },
    });
    return res.status(202).json({ job, quota });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Không thử lại được job",
      quota: error.details?.quota,
    });
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
    const requestedFolderId = String(req.query.folderId || "").trim();
    const folderId = requestedFolderId
      ? Number.parseInt(requestedFolderId, 10)
      : null;
    if (
      requestedFolderId &&
      (!Number.isFinite(folderId) || Number(folderId) <= 0)
    ) {
      return res.status(400).json({ error: "Thư mục không hợp lệ" });
    }
    const offset = (page - 1) * limit;
    const values = [req.user.id];
    let folderSql = "";
    if (folderId) {
      values.push(folderId);
      folderSql = ` AND transcript.folder_id = $${values.length}`;
    }
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
           LEFT JOIN transcription_jobs hidden_job
             ON hidden_job.transcription_id = transcript.id
           WHERE transcript.user_id = $1
             AND COALESCE(hidden_job.payload->>'batchKind', '') <> 'multitrack'
             ${folderSql}${searchSql}`,
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
         job.id AS job_id, transcript.folder_id, folder.name AS folder_name
       FROM transcriptions transcript
       LEFT JOIN transcription_jobs job ON job.transcription_id = transcript.id
       LEFT JOIN transcription_folders folder ON folder.id = transcript.folder_id
       WHERE transcript.user_id = $1
         AND COALESCE(job.payload->>'batchKind', '') <> 'multitrack'
         ${folderSql}${searchSql}
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
         transcript.processing_seconds, transcript.text, transcript.words, transcript.segments,
         transcript.speaker_names, transcript.audio_filename,
         transcript.source_language, transcript.translated_text, transcript.translation_target_language,
         transcript.translation_provider, transcript.translation_error, transcript.created_at,
         COALESCE(job.status, transcript.status, 'completed') AS status,
         COALESCE(job.progress, CASE WHEN transcript.status = 'completed' THEN 100 ELSE 0 END) AS progress,
         COALESCE(job.error_message, transcript.error_message) AS error_message,
         job.id AS job_id, transcript.folder_id, folder.name AS folder_name
       FROM transcriptions transcript
       LEFT JOIN transcription_jobs job ON job.transcription_id = transcript.id
       LEFT JOIN transcription_folders folder ON folder.id = transcript.folder_id
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
      segments: Array.isArray(rows[0].segments) ? rows[0].segments : [],
      speaker_names:
        rows[0].speaker_names &&
        typeof rows[0].speaker_names === "object" &&
        !Array.isArray(rows[0].speaker_names)
          ? rows[0].speaker_names
          : {},
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

// POST /api/transcribe/:id/translate - dịch lại transcript cũ qua chuỗi dự phòng.
router.post(
  "/:id/translate",
  requireAuth,
  translationLimiter,
  async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "ID không hợp lệ" });
    }

    let transcript;
    try {
      const { rows } = await pool.query(
        `SELECT transcript.id, transcript.filename, transcript.text,
                transcript.audio_filename, transcript.source_language,
                transcript.translation_target_language,
                transcript.transcription_provider,
                transcript.provider_request_id,
                COALESCE(job.audio_mode, 'speech') AS audio_mode
         FROM transcriptions transcript
         LEFT JOIN transcription_jobs job
           ON job.transcription_id = transcript.id
         WHERE transcript.id = $1 AND transcript.user_id = $2`,
        [id, req.user.id],
      );
      transcript = rows[0];
      if (!transcript) {
        return res.status(404).json({ error: "Không tìm thấy transcript" });
      }
      if (!String(transcript.text || "").trim()) {
        return res
          .status(409)
          .json({ error: "Transcript chưa có văn bản để dịch" });
      }

      const targetLanguage = normalizeTranslateTarget(
        req.body.targetLanguage ||
          req.body.translateTo ||
          transcript.translation_target_language,
      );
      if (!targetLanguage) {
        return res.status(400).json({
          error: "Vui lòng chọn ngôn ngữ cần dịch",
        });
      }

      const sourceLanguage = normalizeLanguageCode(
        transcript.source_language,
        "auto",
      );
      const assemblyTranscriptId =
        transcript.transcription_provider === "assemblyai"
          ? transcript.provider_request_id || ""
          : "";
      const translation = await translateTranscript({
        text: transcript.text,
        sourceLanguage,
        targetLanguage,
        assemblyTranscriptId,
        assemblyTranslate: assemblyTranscriptId
          ? undefined
          : async ({ targetLanguage: assemblyTargetLanguage }) => {
              if (!transcript.audio_filename) {
                throw new Error(
                  "Bản ghi không còn audio gốc để AssemblyAI dịch lại.",
                );
              }
              const audioPath = resolveStoredAudioPath(
                transcript.audio_filename,
              );
              if (!fs.existsSync(audioPath)) {
                throw new Error(
                  "File audio gốc không còn tồn tại trên server.",
                );
              }
              const buffer = await fs.promises.readFile(audioPath);
              return translateAudioWithAssemblyAI({
                file: {
                  buffer,
                  originalname:
                    transcript.filename || transcript.audio_filename,
                  mimetype: "application/octet-stream",
                },
                language: sourceLanguage,
                audioMode: transcript.audio_mode,
                targetLanguage: assemblyTargetLanguage,
              });
            },
      });

      await pool.query(
        `UPDATE transcriptions
         SET translated_text = $3,
             translation_target_language = $4,
             translation_provider = $5,
             translation_error = NULL
         WHERE id = $1 AND user_id = $2`,
        [
          id,
          req.user.id,
          translation.text,
          translation.targetLanguage,
          translation.provider,
        ],
      );
      return res.json({ translation });
    } catch (error) {
      const message =
        error.message || "Không dịch được transcript sang ngôn ngữ đã chọn.";
      if (transcript) {
        await pool
          .query(
            `UPDATE transcriptions
             SET translation_error = $3
             WHERE id = $1 AND user_id = $2`,
            [id, req.user.id, message],
          )
          .catch(() => {});
      }
      const statusCode = Number(error.statusCode);
      return res
        .status(
          Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600
            ? statusCode
            : 502,
        )
        .json({ error: message });
    }
  },
);

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
    return streamAudioFile(req, res, filePath);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Lỗi server" });
  }
});

router.post("/export/batch", requireAuth, async (req, res) => {
  const ids = normalizeExportIds(req.body?.ids || req.body?.transcriptionIds);
  if (ids.length === 0) {
    return res.status(400).json({ error: "Chọn ít nhất một transcript để export" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, filename, text, words, translated_text,
              source_language, translation_target_language, created_at
       FROM transcriptions
       WHERE user_id = $1
         AND id = ANY($2::int[])
       ORDER BY created_at DESC, id DESC`,
      [req.user.id, ids],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy transcript để export" });
    }

    const entries = [];
    for (const row of rows) {
      const base = `transcript-${row.id}-${sanitizeZipName(
        path.basename(normalizeFilename(row.filename || `transcript-${row.id}`), path.extname(row.filename || "")),
      )}`;
      entries.push({
        name: `${base}.txt`,
        data: String(row.text || ""),
        date: row.created_at,
      });
      if (row.translated_text) {
        entries.push({
          name: `${base}.translation.txt`,
          data: String(row.translated_text || ""),
          date: row.created_at,
        });
      }
      entries.push({
        name: `${base}.json`,
        data: JSON.stringify(
          {
            id: row.id,
            filename: normalizeFilename(row.filename),
            sourceLanguage: row.source_language,
            translationTargetLanguage: row.translation_target_language,
            createdAt: row.created_at,
            text: row.text || "",
            translatedText: row.translated_text || null,
            words: Array.isArray(row.words) ? row.words : [],
          },
          null,
          2,
        ),
        date: row.created_at,
      });
    }

    const archive = createZipBuffer(entries);
    await writeSecurityAudit({
      event: "transcription.batch_exported",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { requested: ids.length, exported: rows.length },
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vbee-transcripts-${Date.now()}.zip"`,
    );
    return res.send(archive);
  } catch (error) {
    console.error("Batch export error:", error);
    return res.status(500).json({ error: "Không export được batch" });
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

router.delete("/:id/audio", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID không hợp lệ" });
  try {
    const { rows } = await pool.query(
      "SELECT audio_filename FROM transcriptions WHERE id = $1 AND user_id = $2",
      [id, req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy bản ghi" });
    if (rows[0].audio_filename) {
      fs.unlink(resolveStoredAudioPath(rows[0].audio_filename), () => {});
      await pool.query(
        "UPDATE transcriptions SET audio_filename = NULL WHERE id = $1 AND user_id = $2",
        [id, req.user.id],
      );
    }
    await writeSecurityAudit({
      event: "transcription.media_deleted",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { transcriptionId: id },
    });
    return res.json({ success: true });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không xóa được media" });
  }
});

router.get("/:id/versions", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID không hợp lệ" });
  try {
    const { rows } = await pool.query(
      `SELECT version.id, version.label, version.created_at,
              LENGTH(version.text)::integer AS text_length,
              COALESCE(jsonb_array_length(version.words), 0)::integer AS word_count
       FROM transcription_versions version
       JOIN transcriptions transcript ON transcript.id = version.transcription_id
       WHERE version.transcription_id = $1 AND transcript.user_id = $2
       ORDER BY version.created_at DESC, version.id DESC
       LIMIT 50`,
      [id, req.user.id],
    );
    return res.json({ versions: rows });
  } catch (error) {
    console.error("List transcript versions error:", error.message);
    return res.status(500).json({ error: "Không tải được lịch sử phiên bản" });
  }
});

router.post("/:id/versions/:versionId/restore", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const versionId = parseInt(req.params.versionId, 10);
  if (isNaN(id) || isNaN(versionId)) {
    return res.status(400).json({ error: "ID không hợp lệ" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, user_id, text, words, speaker_names
       FROM transcriptions
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [id, req.user.id],
    );
    const transcript = current.rows[0];
    if (!transcript) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Không tìm thấy bản ghi" });
    }
    const version = await client.query(
      `SELECT id, text, words, speaker_names
       FROM transcription_versions
       WHERE id = $1 AND transcription_id = $2 AND user_id = $3`,
      [versionId, id, req.user.id],
    );
    if (!version.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Không tìm thấy phiên bản" });
    }
    await insertTranscriptVersion(client, transcript, "Trước khi khôi phục");
    const restored = await client.query(
      `UPDATE transcriptions
       SET text = $1,
           words = $4::jsonb,
           speaker_names = $5::jsonb
       WHERE id = $2 AND user_id = $3
       RETURNING id, text, words, speaker_names`,
      [
        String(version.rows[0].text || ""),
        id,
        req.user.id,
        JSON.stringify(Array.isArray(version.rows[0].words) ? version.rows[0].words : []),
        JSON.stringify(
          version.rows[0].speaker_names &&
            typeof version.rows[0].speaker_names === "object" &&
            !Array.isArray(version.rows[0].speaker_names)
            ? version.rows[0].speaker_names
            : {},
        ),
      ],
    );
    await client.query("COMMIT");
    return res.json(restored.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Restore transcript version error:", error.message);
    return res.status(500).json({ error: "Không khôi phục được phiên bản" });
  } finally {
    client.release();
  }
});

// PATCH /api/transcribe/:id — cập nhật nội dung và timestamp đã chỉnh sửa.
router.patch("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID không hợp lệ" });
  const { text, words, speakerNames } = req.body;
  if (
    text === undefined &&
    words === undefined &&
    speakerNames === undefined
  ) {
    return res.status(400).json({ error: "Không có thay đổi để lưu" });
  }
  if (
    text !== undefined &&
    (typeof text !== "string" || text.length > 2_000_000)
  ) {
    return res.status(400).json({ error: "Nội dung text không hợp lệ" });
  }
  let normalizedWords = null;
  if (words !== undefined) {
    if (!Array.isArray(words) || words.length > 100_000) {
      return res.status(400).json({ error: "Danh sách timestamp không hợp lệ" });
    }
    normalizedWords = [];
    for (const word of words) {
      const wordText = String(word?.text || "").trim();
      const start = Number(word?.start);
      const end = Number(word?.end);
      if (
        !wordText ||
        wordText.length > 500 ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start
      ) {
        return res
          .status(400)
          .json({ error: "Một timestamp trong transcript không hợp lệ" });
      }
      normalizedWords.push({
        text: wordText,
        start,
        end,
        speaker:
          word.speaker === null || word.speaker === undefined
            ? null
            : String(word.speaker).slice(0, 100),
        confidence: Number.isFinite(Number(word.confidence))
          ? Number(word.confidence)
          : null,
      });
    }
  }
  let normalizedSpeakerNames = null;
  if (speakerNames !== undefined) {
    if (
      !speakerNames ||
      typeof speakerNames !== "object" ||
      Array.isArray(speakerNames) ||
      Object.keys(speakerNames).length > 100
    ) {
      return res.status(400).json({ error: "Danh sách người nói không hợp lệ" });
    }
    normalizedSpeakerNames = {};
    for (const [speaker, label] of Object.entries(speakerNames)) {
      const cleanSpeaker = String(speaker).trim().slice(0, 100);
      const cleanLabel = String(label || "")
        .trim()
        .replace(/\s+/g, " ");
      if (!cleanSpeaker || cleanLabel.length > 100) {
        return res.status(400).json({ error: "Tên người nói không hợp lệ" });
      }
      if (cleanLabel) normalizedSpeakerNames[cleanSpeaker] = cleanLabel;
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, user_id, text, words, speaker_names
       FROM transcriptions
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [id, req.user.id],
    );
    const transcript = current.rows[0];
    if (!transcript) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Không tìm thấy bản ghi" });
    }
    const nextText = text === undefined ? String(transcript.text || "") : text;
    const nextWords =
      normalizedWords === null
        ? Array.isArray(transcript.words)
          ? transcript.words
          : []
        : normalizedWords;
    const currentSpeakerNames =
      transcript.speaker_names &&
      typeof transcript.speaker_names === "object" &&
      !Array.isArray(transcript.speaker_names)
        ? transcript.speaker_names
        : {};
    const nextSpeakerNames =
      normalizedSpeakerNames === null
        ? currentSpeakerNames
        : normalizedSpeakerNames;
    const changed =
      String(transcript.text || "") !== nextText ||
      JSON.stringify(Array.isArray(transcript.words) ? transcript.words : []) !==
        JSON.stringify(nextWords) ||
      JSON.stringify(currentSpeakerNames) !== JSON.stringify(nextSpeakerNames);
    if (changed) {
      await insertTranscriptVersion(client, transcript, "Auto-save");
    }
    const { rows } = await client.query(
      `UPDATE transcriptions
       SET text = $1,
           words = $4::jsonb,
           speaker_names = $5::jsonb
       WHERE id = $2 AND user_id = $3
       RETURNING id, text, words, speaker_names`,
      [
        nextText,
        id,
        req.user.id,
        JSON.stringify(nextWords),
        JSON.stringify(nextSpeakerNames),
      ],
    );
    await client.query("COMMIT");
    return res.json(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Update transcript error:", error.message);
    return res.status(500).json({ error: "Lỗi server" });
  } finally {
    client.release();
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
