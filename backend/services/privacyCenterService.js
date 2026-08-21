const fs = require("fs");
const pool = require("../db");
const { resolveStoredAudioPath } = require("./transcriptionService");
const { createZipBuffer, sanitizeZipName } = require("./zipExportService");

const MEDIA_RETENTION_POLICIES = new Set([
  "keep_until_deleted",
  "delete_after_days",
  "delete_after_transcription",
]);
const TRANSCRIPT_RETENTION_POLICIES = new Set([
  "keep_until_deleted",
  "delete_after_days",
]);

const DEFAULT_PRIVACY_SETTINGS = Object.freeze({
  mediaRetentionPolicy: "keep_until_deleted",
  mediaRetentionDays: 365,
  transcriptRetentionPolicy: "keep_until_deleted",
  transcriptRetentionDays: 365,
  allowProductAnalytics: false,
  securityPolicyAcknowledgedAt: null,
});

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizePrivacySettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const mediaRetentionPolicy = MEDIA_RETENTION_POLICIES.has(
    source.mediaRetentionPolicy,
  )
    ? source.mediaRetentionPolicy
    : DEFAULT_PRIVACY_SETTINGS.mediaRetentionPolicy;
  const transcriptRetentionPolicy = TRANSCRIPT_RETENTION_POLICIES.has(
    source.transcriptRetentionPolicy,
  )
    ? source.transcriptRetentionPolicy
    : DEFAULT_PRIVACY_SETTINGS.transcriptRetentionPolicy;

  return {
    mediaRetentionPolicy,
    mediaRetentionDays: clampInteger(
      source.mediaRetentionDays,
      DEFAULT_PRIVACY_SETTINGS.mediaRetentionDays,
      1,
      3650,
    ),
    transcriptRetentionPolicy,
    transcriptRetentionDays: clampInteger(
      source.transcriptRetentionDays,
      DEFAULT_PRIVACY_SETTINGS.transcriptRetentionDays,
      1,
      3650,
    ),
    allowProductAnalytics: Boolean(source.allowProductAnalytics),
    securityPolicyAcknowledgedAt:
      source.securityPolicyAcknowledgedAt || null,
  };
}

async function getPrivacySettings(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT privacy_settings FROM user_settings WHERE user_id = $1`,
    [userId],
  );
  return normalizePrivacySettings(rows[0]?.privacy_settings || {});
}

async function savePrivacySettings(userId, settings, db = pool) {
  const normalized = normalizePrivacySettings({
    ...(await getPrivacySettings(userId, db)),
    ...(settings || {}),
    securityPolicyAcknowledgedAt: new Date().toISOString(),
  });
  const { rows } = await db.query(
    `INSERT INTO user_settings (user_id, privacy_settings)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id)
     DO UPDATE SET privacy_settings = EXCLUDED.privacy_settings, updated_at = NOW()
     RETURNING privacy_settings`,
    [userId, JSON.stringify(normalized)],
  );
  return normalizePrivacySettings(rows[0]?.privacy_settings || normalized);
}

async function deleteTranscriptMedia(userId, { olderThanDays = null } = {}, db = pool) {
  const values = [userId];
  let ageSql = "";
  const days = Number.parseInt(olderThanDays, 10);
  if (Number.isSafeInteger(days) && days > 0) {
    values.push(days);
    ageSql = ` AND created_at < NOW() - ($${values.length} * INTERVAL '1 day')`;
  }
  const { rows } = await db.query(
    `SELECT id, audio_filename
     FROM transcriptions
     WHERE user_id = $1
       AND audio_filename IS NOT NULL
       ${ageSql}`,
    values,
  );

  let deletedFiles = 0;
  for (const row of rows) {
    try {
      const filePath = resolveStoredAudioPath(row.audio_filename);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        deletedFiles += 1;
      }
    } catch {
      // The DB record is still cleared so privacy actions are not blocked by stale paths.
    }
  }

  if (rows.length > 0) {
    await db.query(
      `UPDATE transcriptions
       SET audio_filename = NULL
       WHERE user_id = $1
         AND id = ANY($2::int[])`,
      [userId, rows.map((row) => row.id)],
    );
  }

  return { affectedRecords: rows.length, deletedFiles };
}

async function deleteAllUserTranscriptionData(userId, db = pool) {
  const media = await deleteTranscriptMedia(userId, {}, db);
  const deleted = await db.query(
    `DELETE FROM transcriptions WHERE user_id = $1`,
    [userId],
  );
  return {
    deletedTranscripts: deleted.rowCount || 0,
    deletedMediaFiles: media.deletedFiles,
  };
}

async function buildUserDataExport(userId, db = pool) {
  const [settings, transcripts, folders, apiKeys, auditEvents] =
    await Promise.all([
      getPrivacySettings(userId, db),
      db.query(
        `SELECT id, filename, file_size, duration, processing_seconds, text,
                translated_text, source_language, translation_target_language,
                status, created_at, completed_at
         FROM transcriptions
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId],
      ),
      db.query(
        `SELECT id, name, created_at, updated_at
         FROM transcription_folders
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId],
      ),
      db.query(
        `SELECT id, name, key_prefix, created_at, last_used_at, revoked_at
         FROM api_keys
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId],
      ),
      db.query(
        `SELECT event_type, outcome, request_id, metadata, created_at
         FROM security_audit_events
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 500`,
        [userId],
      ),
    ]);

  const entries = [
    {
      name: "privacy-settings.json",
      data: JSON.stringify(settings, null, 2),
    },
    {
      name: "transcripts.json",
      data: JSON.stringify(transcripts.rows, null, 2),
    },
    {
      name: "folders.json",
      data: JSON.stringify(folders.rows, null, 2),
    },
    {
      name: "api-keys.json",
      data: JSON.stringify(apiKeys.rows, null, 2),
    },
    {
      name: "security-audit.json",
      data: JSON.stringify(auditEvents.rows, null, 2),
    },
    ...transcripts.rows.map((row) => ({
      name: `transcripts/${sanitizeZipName(row.filename || `transcript-${row.id}`)}-${row.id}.txt`,
      data: String(row.text || ""),
      date: row.created_at,
    })),
  ];

  return createZipBuffer(entries);
}

module.exports = {
  DEFAULT_PRIVACY_SETTINGS,
  buildUserDataExport,
  deleteAllUserTranscriptionData,
  deleteTranscriptMedia,
  getPrivacySettings,
  normalizePrivacySettings,
  savePrivacySettings,
};
