const path = require("node:path");

const SUPPORTED_PROVIDERS = new Set([
  "vbee",
  "assemblyai",
  "deepgram",
  "sonix",
]);

const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024 * 1024;

function boundedPositiveNumber(value, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : null;
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeLanguage(value) {
  const normalized = String(value || "auto")
    .trim()
    .toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized) ||
    ["auto", "multi", "multilingual"].includes(normalized)
    ? normalized
    : "auto";
}

function normalizeAudioMode(value) {
  return ["song", "music", "lyrics", "vocal", "vocals"].includes(
    String(value || "speech")
      .trim()
      .toLowerCase(),
  )
    ? "song"
    : "speech";
}

function normalizeSpeakerCount(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10
    ? parsed
    : null;
}

function normalizeExtension(filename, explicitExtension) {
  const providedExtension = String(explicitExtension || "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "")
    .replace(/[^a-z0-9]/g, "");
  if (providedExtension) return providedExtension;

  const extension = path.extname(path.basename(String(filename || "")));
  return extension
    .replace(/^\./, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function createAudioSelectionProfile(input = {}) {
  const language = normalizeLanguage(input.language);
  const translateTo = normalizeLanguage(input.translateTo || "auto");

  return {
    language,
    audioMode: normalizeAudioMode(input.audioMode),
    speakerLabels: normalizeBoolean(input.speakerLabels),
    speakerCount: normalizeSpeakerCount(input.speakerCount),
    hasTranslation:
      normalizeBoolean(input.hasTranslation) ||
      (translateTo !== "auto" &&
        translateTo !== language &&
        translateTo !== "multi"),
    hasCustomVocabulary: normalizeBoolean(input.hasCustomVocabulary),
    durationSeconds: boundedPositiveNumber(
      input.durationSeconds,
      MAX_DURATION_SECONDS,
    ),
    fileSizeBytes: boundedPositiveNumber(
      input.fileSizeBytes,
      MAX_FILE_SIZE_BYTES,
    ),
    extension: normalizeExtension(input.filename, input.extension),
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function addScore(candidate, points, reason) {
  candidate.score += points;
  if (reason && !candidate.reasons.includes(reason)) {
    candidate.reasons.push(reason);
  }
}

function getProviderConfig(configs, provider) {
  if (configs instanceof Map) {
    return configs.get(provider) || {};
  }
  return configs?.[provider] || {};
}

function normalizedRuleValues(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
    : [];
}

function cmsRuleMatches(config, profile) {
  if (String(config.routingMode || "").toLowerCase() !== "rule_based") {
    return false;
  }

  const rules = config.routingRules || {};
  const languages = normalizedRuleValues(rules.languages);
  const audioModes = normalizedRuleValues(
    rules.audio_modes || rules.audioModes,
  ).map(normalizeAudioMode);
  const hasRule = languages.length > 0 || audioModes.length > 0;

  const languageMatches =
    languages.length === 0 ||
    languages.includes(profile.language) ||
    languages.includes(profile.language.split("-")[0]);
  const audioModeMatches =
    audioModes.length === 0 || audioModes.includes(profile.audioMode);

  return hasRule && languageMatches && audioModeMatches;
}

function applyOperationalScore(candidate, config) {
  const healthStatus = String(config.healthStatus || "unknown").toLowerCase();
  if (healthStatus === "down" || healthStatus === "unhealthy") {
    addScore(candidate, -1000, "provider_unavailable");
  } else if (healthStatus === "healthy") {
    addScore(candidate, 30, "provider_healthy");
  } else if (healthStatus === "degraded") {
    addScore(candidate, 5, "provider_degraded");
  }

  const successRate = Number(config.successRate);
  if (Number.isFinite(successRate) && successRate > 0 && successRate <= 100) {
    addScore(candidate, clamp((successRate - 50) / 2, -25, 25));
    if (successRate >= 90) {
      addScore(candidate, 0, "high_success_rate");
    }
  }

  const latency = Number(config.avgLatencyMs);
  if (Number.isFinite(latency) && latency > 0) {
    if (latency <= 1000) {
      addScore(candidate, 5, "low_latency");
    } else {
      addScore(candidate, -clamp((latency - 1000) / 1000, 0, 15));
    }
  }

  const cost = Number(config.costPerMinuteUsd);
  if (Number.isFinite(cost) && cost > 0) {
    addScore(candidate, -clamp(cost * 100, 0, 10));
  }
}

function applyAudioScore(candidate, profile) {
  const provider = candidate.provider;
  const languageRoot = profile.language.split("-")[0];

  if (profile.audioMode === "song") {
    const songScores = { assemblyai: 30, deepgram: 15, sonix: 10, vbee: -5 };
    addScore(candidate, songScores[provider] || 0, "music_or_lyrics");
  } else {
    const speechScores = { vbee: 10, deepgram: 10, assemblyai: 8, sonix: 5 };
    addScore(candidate, speechScores[provider] || 0);
  }

  if (languageRoot === "vi" && profile.audioMode === "speech") {
    const vietnameseScores = { vbee: 30, deepgram: 8, assemblyai: 8, sonix: 4 };
    addScore(candidate, vietnameseScores[provider] || 0, "vietnamese_speech");
  }

  if (["auto", "multi", "multilingual"].includes(profile.language)) {
    const multilingualScores = {
      assemblyai: 18,
      deepgram: 12,
      sonix: 7,
      vbee: 3,
    };
    addScore(
      candidate,
      multilingualScores[provider] || 0,
      "multilingual_audio",
    );
  }

  if (profile.speakerLabels) {
    const diarizationScores = {
      assemblyai: 30,
      deepgram: 25,
      sonix: 15,
      vbee: -35,
    };
    addScore(
      candidate,
      diarizationScores[provider] || 0,
      "speaker_diarization",
    );
  }

  if (profile.speakerCount) {
    const speakerCountScores = { assemblyai: 10, deepgram: 8, sonix: 3 };
    addScore(candidate, speakerCountScores[provider] || 0);
  }

  if (profile.hasTranslation) {
    const translationScores = { assemblyai: 25, sonix: 15, deepgram: 8 };
    addScore(
      candidate,
      translationScores[provider] || 0,
      "integrated_translation",
    );
  }

  if (profile.hasCustomVocabulary) {
    const vocabularyScores = {
      assemblyai: 55,
      deepgram: 50,
      sonix: 45,
      vbee: -100,
    };
    addScore(
      candidate,
      vocabularyScores[provider] || 0,
      provider === "vbee"
        ? "custom_vocabulary_unsupported"
        : "custom_vocabulary",
    );
  }

  if (profile.durationSeconds >= 2 * 60 * 60) {
    const longAudioScores = {
      deepgram: 15,
      sonix: 12,
      assemblyai: 5,
      vbee: -5,
    };
    addScore(candidate, longAudioScores[provider] || 0, "long_audio");
  }

  if (profile.fileSizeBytes >= 100 * 1024 * 1024) {
    const largeMediaScores = {
      deepgram: 15,
      sonix: 12,
      assemblyai: 5,
      vbee: -10,
    };
    addScore(candidate, largeMediaScores[provider] || 0, "large_media");
  }

  if (["mp4", "webm", "mkv", "mov"].includes(profile.extension)) {
    const containerScores = { deepgram: 5, sonix: 4, assemblyai: 2 };
    addScore(candidate, containerScores[provider] || 0, "media_container");
  } else if (
    ["wav", "pcm"].includes(profile.extension) &&
    provider === "vbee"
  ) {
    addScore(candidate, 4, "lossless_audio");
  }
}

function normalizeProviders(providers) {
  return [...new Set(providers || [])]
    .map((provider) => String(provider).trim().toLowerCase())
    .filter((provider) => SUPPORTED_PROVIDERS.has(provider));
}

function createManualProviderRanking({
  providers,
  primaryProvider,
  failoverEnabled = true,
}) {
  const primary = String(primaryProvider || "")
    .trim()
    .toLowerCase();
  const ordered = normalizeProviders([
    primary,
    ...(failoverEnabled ? providers || [] : []),
  ]);

  return ordered.map((provider, index) => ({
    provider,
    rank: index + 1,
    score: null,
    reasons: ["manual_provider_order"],
  }));
}

function rankProvidersForAudio({
  providers,
  configs = new Map(),
  profile = {},
}) {
  const normalizedProfile = createAudioSelectionProfile(profile);
  const uniqueProviders = normalizeProviders(providers);

  const ranked = uniqueProviders.map((provider, index) => {
    const candidate = { provider, score: 0, reasons: [], originalIndex: index };
    const config = getProviderConfig(configs, provider);

    applyOperationalScore(candidate, config);
    applyAudioScore(candidate, normalizedProfile);

    if (cmsRuleMatches(config, normalizedProfile)) {
      const priority = Number(config.routingRules?.priority);
      addScore(
        candidate,
        clamp(Number.isFinite(priority) ? priority / 5 : 20, 1, 80),
        "cms_routing_rule",
      );
    }

    return candidate;
  });

  ranked.sort(
    (left, right) =>
      right.score - left.score || left.originalIndex - right.originalIndex,
  );

  return ranked.map(({ provider, score, reasons }, index) => ({
    provider,
    rank: index + 1,
    score: Number(score.toFixed(2)),
    reasons,
  }));
}

function createProviderRanking({
  providerPreference,
  configuredProviders,
  autoProviders = configuredProviders,
  configs = new Map(),
  profile = {},
  failoverEnabled = true,
}) {
  const preference = String(providerPreference || "auto")
    .trim()
    .toLowerCase();
  if (preference !== "auto") {
    return createManualProviderRanking({
      providers: configuredProviders,
      primaryProvider: preference,
      failoverEnabled,
    });
  }
  return rankProvidersForAudio({ providers: autoProviders, configs, profile });
}

module.exports = {
  createAudioSelectionProfile,
  createManualProviderRanking,
  createProviderRanking,
  rankProvidersForAudio,
};
