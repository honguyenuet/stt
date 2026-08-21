const pool = require("../db");
const { normalizePrivacySettings } = require("./privacySettingsService");

const DEFAULT_TRANSCRIPTION_SETTINGS = {
  timecodeOffset: "no",
  spellingPreference: "american",
  fillerWords: "yes",
  profanityFilter: "no",
};

function normalizeDictionaryText(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 400);
  return [...new Set(lines)].join("\n");
}

function parseDictionaryKeywords(value) {
  return normalizeDictionaryText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeTranscriptionSettings(settings = {}) {
  let source = settings;
  if (typeof settings === "string") {
    try {
      source = JSON.parse(settings);
    } catch {
      source = {};
    }
  }
  if (!source || typeof source !== "object") source = {};
  const next = { ...DEFAULT_TRANSCRIPTION_SETTINGS };
  if (["yes", "no"].includes(source.timecodeOffset)) {
    next.timecodeOffset = source.timecodeOffset;
  }
  if (
    ["american", "australian", "british"].includes(source.spellingPreference)
  ) {
    next.spellingPreference = source.spellingPreference;
  }
  if (["yes", "no"].includes(source.fillerWords)) {
    next.fillerWords = source.fillerWords;
  }
  if (["yes", "no"].includes(source.profanityFilter)) {
    next.profanityFilter = source.profanityFilter;
  }
  return next;
}

async function getUserSettings(userId) {
  const { rows } = await pool.query(
    `SELECT custom_dictionary, transcription_settings, privacy_settings
     FROM user_settings
     WHERE user_id = $1`,
    [userId],
  );

  return {
    customDictionary: rows[0]?.custom_dictionary || "",
    transcriptionSettings: normalizeTranscriptionSettings(
      rows[0]?.transcription_settings || {},
    ),
    privacySettings: normalizePrivacySettings(rows[0]?.privacy_settings || {}),
  };
}

async function saveCustomDictionary(userId, dictionaryText) {
  const customDictionary = normalizeDictionaryText(dictionaryText);
  const { rows } = await pool.query(
    `INSERT INTO user_settings (user_id, custom_dictionary)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET custom_dictionary = EXCLUDED.custom_dictionary, updated_at = NOW()
     RETURNING custom_dictionary, transcription_settings, privacy_settings`,
    [userId, customDictionary],
  );
  return {
    customDictionary: rows[0].custom_dictionary || "",
    transcriptionSettings: normalizeTranscriptionSettings(
      rows[0].transcription_settings || {},
    ),
    privacySettings: normalizePrivacySettings(rows[0].privacy_settings || {}),
  };
}

async function saveTranscriptionSettings(userId, settings) {
  const transcriptionSettings = normalizeTranscriptionSettings(settings);
  const { rows } = await pool.query(
    `INSERT INTO user_settings (user_id, transcription_settings)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET transcription_settings = EXCLUDED.transcription_settings, updated_at = NOW()
     RETURNING custom_dictionary, transcription_settings, privacy_settings`,
    [userId, JSON.stringify(transcriptionSettings)],
  );
  return {
    customDictionary: rows[0].custom_dictionary || "",
    transcriptionSettings: normalizeTranscriptionSettings(
      rows[0].transcription_settings || {},
    ),
    privacySettings: normalizePrivacySettings(rows[0].privacy_settings || {}),
  };
}

async function savePrivacySettings(userId, settings) {
  const privacySettings = normalizePrivacySettings(settings);
  const { rows } = await pool.query(
    `INSERT INTO user_settings (user_id, privacy_settings)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET privacy_settings = EXCLUDED.privacy_settings, updated_at = NOW()
     RETURNING custom_dictionary, transcription_settings, privacy_settings`,
    [userId, JSON.stringify(privacySettings)],
  );
  return {
    customDictionary: rows[0].custom_dictionary || "",
    transcriptionSettings: normalizeTranscriptionSettings(
      rows[0].transcription_settings || {},
    ),
    privacySettings: normalizePrivacySettings(rows[0].privacy_settings || {}),
  };
}

module.exports = {
  DEFAULT_TRANSCRIPTION_SETTINGS,
  getUserSettings,
  normalizeDictionaryText,
  normalizeTranscriptionSettings,
  parseDictionaryKeywords,
  saveCustomDictionary,
  savePrivacySettings,
  saveTranscriptionSettings,
};
