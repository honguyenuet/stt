const DEFAULT_PRIVACY_SETTINGS = Object.freeze({
  audioRetentionDays: 30,
  keepAudioAfterTranscription: true,
  allowProductAnalytics: false,
});

const RETENTION_OPTIONS = new Set([0, 7, 30, 90, 365]);

function parseBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function normalizePrivacySettings(value = {}) {
  let source = value;
  if (typeof value === "string") {
    try {
      source = JSON.parse(value);
    } catch {
      source = {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    source = {};
  }

  const retention = Number(source.audioRetentionDays);
  return {
    audioRetentionDays: RETENTION_OPTIONS.has(retention)
      ? retention
      : DEFAULT_PRIVACY_SETTINGS.audioRetentionDays,
    keepAudioAfterTranscription: parseBoolean(
      source.keepAudioAfterTranscription,
      DEFAULT_PRIVACY_SETTINGS.keepAudioAfterTranscription,
    ),
    allowProductAnalytics: parseBoolean(
      source.allowProductAnalytics,
      DEFAULT_PRIVACY_SETTINGS.allowProductAnalytics,
    ),
  };
}

module.exports = {
  DEFAULT_PRIVACY_SETTINGS,
  normalizePrivacySettings,
};
