const pool = require("../db");

const DEFAULT_SUPPORTED_MEDIA_FORMATS = Object.freeze([
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "flac",
  "aac",
  "mp4",
  "webm",
]);
const LEGACY_DEFAULT_SUPPORTED_MEDIA_FORMATS = Object.freeze([
  "mp3",
  "wav",
  "m4a",
  "mp4",
  "mov",
]);
const SAFE_MEDIA_FORMATS = new Set([
  "aac",
  "aiff",
  "avi",
  "flac",
  "m4a",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "oga",
  "ogg",
  "opus",
  "wav",
  "webm",
  "wma",
]);
const STORAGE_POLICIES = new Set([
  "keep_transcripts_and_media",
  "delete_media_keep_transcript",
  "delete_all_after_retention",
]);

function envPositiveInt(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function defaultAdminSettings() {
  return {
    max_file_size_mb: envPositiveInt("MAX_UPLOAD_MB", 500),
    max_file_duration_minutes: 180,
    supported_formats: [...DEFAULT_SUPPORTED_MEDIA_FORMATS],
    supported_languages: ["auto", "multi", "vi", "en", "ja", "ko", "zh"],
    max_retry_attempts: 3,
    default_quota_minutes: Math.ceil(
      envPositiveInt("FREE_PLAN_SECONDS", 30 * 60) / 60,
    ),
    storage_policy: "keep_transcripts_and_media",
    data_retention_days: 365,
    system_parameters: {
      queue_concurrency: envPositiveInt("TRANSCRIPTION_QUEUE_CONCURRENCY", 1),
      queue_retention_ms: envPositiveInt(
        "TRANSCRIPTION_QUEUE_RETENTION_MS",
        3_600_000,
      ),
    },
    notification_config: {
      usage_alert_email: true,
      failure_alert_email: false,
    },
  };
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeStringList(values, validator, fallback, maxItems) {
  if (!Array.isArray(values)) return [...fallback];
  const normalized = [
    ...new Set(
      values
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => validator(value)),
    ),
  ];
  return normalized.length > 0 ? normalized.slice(0, maxItems) : [...fallback];
}

function normalizeAdminSettings(input = {}, defaults = defaultAdminSettings()) {
  const system = input.system_parameters || {};
  const notifications = input.notification_config || {};
  const storagePolicy = String(input.storage_policy || "").trim();

  return {
    max_file_size_mb: clampInteger(
      input.max_file_size_mb,
      defaults.max_file_size_mb,
      1,
      2048,
    ),
    max_file_duration_minutes: clampInteger(
      input.max_file_duration_minutes,
      defaults.max_file_duration_minutes,
      1,
      24 * 60,
    ),
    supported_formats: normalizeStringList(
      input.supported_formats,
      (value) => SAFE_MEDIA_FORMATS.has(value),
      defaults.supported_formats,
      SAFE_MEDIA_FORMATS.size,
    ),
    supported_languages: normalizeStringList(
      input.supported_languages,
      (value) => /^(auto|multi|[a-z]{2,3}(?:-[a-z]{2})?)$/.test(value),
      defaults.supported_languages,
      100,
    ),
    max_retry_attempts: clampInteger(
      input.max_retry_attempts,
      defaults.max_retry_attempts,
      1,
      10,
    ),
    default_quota_minutes: clampInteger(
      input.default_quota_minutes,
      defaults.default_quota_minutes,
      1,
      100_000,
    ),
    storage_policy: STORAGE_POLICIES.has(storagePolicy)
      ? storagePolicy
      : defaults.storage_policy,
    data_retention_days: clampInteger(
      input.data_retention_days,
      defaults.data_retention_days,
      1,
      3650,
    ),
    system_parameters: {
      queue_concurrency: clampInteger(
        system.queue_concurrency,
        defaults.system_parameters.queue_concurrency,
        1,
        32,
      ),
      queue_retention_ms: clampInteger(
        system.queue_retention_ms,
        defaults.system_parameters.queue_retention_ms,
        60_000,
        7 * 24 * 60 * 60 * 1000,
      ),
    },
    notification_config: {
      usage_alert_email:
        notifications.usage_alert_email === undefined
          ? defaults.notification_config.usage_alert_email
          : Boolean(notifications.usage_alert_email),
      failure_alert_email:
        notifications.failure_alert_email === undefined
          ? defaults.notification_config.failure_alert_email
          : Boolean(notifications.failure_alert_email),
    },
  };
}

async function getAdminSettings(db = pool) {
  const defaults = defaultAdminSettings();
  try {
    const { rows } = await db.query(
      "SELECT value FROM admin_settings WHERE key = 'global'",
    );
    return normalizeAdminSettings(rows[0]?.value || {}, defaults);
  } catch (error) {
    if (error.code === "42P01") return defaults;
    throw error;
  }
}

async function saveAdminSettings(settings, updatedBy, db = pool) {
  const normalized = normalizeAdminSettings(settings);
  await db.query(
    `INSERT INTO admin_settings (key, value, updated_by, updated_at)
     VALUES ('global', $1::jsonb, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [JSON.stringify(normalized), updatedBy],
  );
  return normalized;
}

module.exports = {
  DEFAULT_SUPPORTED_MEDIA_FORMATS,
  LEGACY_DEFAULT_SUPPORTED_MEDIA_FORMATS,
  SAFE_MEDIA_FORMATS,
  defaultAdminSettings,
  getAdminSettings,
  normalizeAdminSettings,
  saveAdminSettings,
};
