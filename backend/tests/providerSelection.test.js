const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  createAudioSelectionProfile,
  createManualProviderRanking,
  createProviderRanking,
  rankProvidersForAudio,
} = require("../services/providerSelectionService");

const providers = ["vbee", "assemblyai", "deepgram", "sonix"];

function healthyConfigs(overrides = {}) {
  return new Map(
    providers.map((provider) => [
      provider,
      {
        healthStatus: "healthy",
        successRate: 95,
        avgLatencyMs: 600,
        costPerMinuteUsd: 0.006,
        ...(overrides[provider] || {}),
      },
    ]),
  );
}

describe("automatic transcription provider selection", () => {
  test("keeps an explicitly selected provider first", () => {
    assert.deepEqual(
      createManualProviderRanking({
        providers: ["vbee", "deepgram", "assemblyai"],
        primaryProvider: "sonix",
        failoverEnabled: true,
      }).map(({ provider }) => provider),
      ["sonix", "vbee", "deepgram", "assemblyai"],
    );
    assert.deepEqual(
      createManualProviderRanking({
        providers,
        primaryProvider: "sonix",
        failoverEnabled: false,
      }).map(({ provider }) => provider),
      ["sonix"],
    );
  });

  test("manual mode preserves the configured failover chain", () => {
    const configuredProviders = ["vbee", "sonix", "deepgram", "assemblyai"];
    const autoProviders = ["assemblyai", "deepgram", "sonix", "vbee"];

    assert.deepEqual(
      createProviderRanking({
        providerPreference: "vbee",
        configuredProviders,
        autoProviders,
        configs: healthyConfigs(),
        profile: createAudioSelectionProfile({ speakerLabels: true }),
        failoverEnabled: true,
      }).map(({ provider }) => provider),
      configuredProviders,
    );
  });

  test("prefers Vbee for a normal Vietnamese speech file", () => {
    const ranked = rankProvidersForAudio({
      providers,
      configs: healthyConfigs(),
      profile: createAudioSelectionProfile({
        language: "vi",
        audioMode: "speech",
        filename: "phong-van.wav",
        fileSizeBytes: 12 * 1024 * 1024,
      }),
    });

    assert.equal(ranked[0].provider, "vbee");
    assert.ok(ranked[0].reasons.includes("vietnamese_speech"));
    assert.ok(ranked[0].reasons.includes("lossless_audio"));
  });

  test("prefers AssemblyAI for multilingual music", () => {
    const ranked = rankProvidersForAudio({
      providers,
      configs: healthyConfigs(),
      profile: createAudioSelectionProfile({
        language: "multi",
        audioMode: "song",
        filename: "song.mp3",
      }),
    });

    assert.equal(ranked[0].provider, "assemblyai");
    assert.ok(ranked[0].reasons.includes("music_or_lyrics"));
    assert.ok(ranked[0].reasons.includes("multilingual_audio"));
  });

  test("uses Deepgram for diarization when AssemblyAI is down", () => {
    const ranked = rankProvidersForAudio({
      providers,
      configs: healthyConfigs({
        assemblyai: { healthStatus: "down", successRate: 99 },
      }),
      profile: createAudioSelectionProfile({
        language: "en",
        speakerLabels: true,
        speakerCount: 4,
      }),
    });

    assert.equal(ranked[0].provider, "deepgram");
    assert.equal(ranked.at(-1).provider, "assemblyai");
    assert.ok(ranked[0].reasons.includes("speaker_diarization"));
  });

  test("prefers a scalable provider for a long large speech file", () => {
    const ranked = rankProvidersForAudio({
      providers,
      configs: healthyConfigs(),
      profile: createAudioSelectionProfile({
        language: "en",
        audioMode: "speech",
        durationSeconds: 3 * 60 * 60,
        fileSizeBytes: 180 * 1024 * 1024,
        filename: "conference.mp4",
      }),
    });

    assert.equal(ranked[0].provider, "deepgram");
    assert.ok(ranked[0].reasons.includes("long_audio"));
    assert.ok(ranked[0].reasons.includes("large_media"));
  });

  test("applies matching CMS rules but never promotes a down provider", () => {
    const configs = healthyConfigs({
      sonix: {
        routingMode: "rule_based",
        routingRules: {
          languages: ["ja"],
          audio_modes: ["speech"],
          priority: 400,
        },
      },
    });
    const profile = createAudioSelectionProfile({
      language: "ja",
      audioMode: "speech",
    });

    assert.equal(
      rankProvidersForAudio({ providers, configs, profile })[0].provider,
      "sonix",
    );

    configs.set("sonix", {
      ...configs.get("sonix"),
      healthStatus: "down",
    });
    assert.notEqual(
      rankProvidersForAudio({ providers, configs, profile })[0].provider,
      "sonix",
    );
  });

  test("does not treat an empty CMS rule as a match", () => {
    const configs = healthyConfigs({
      sonix: {
        routingMode: "rule_based",
        routingRules: { priority: 1000 },
      },
    });
    const ranked = rankProvidersForAudio({
      providers,
      configs,
      profile: createAudioSelectionProfile({ language: "en" }),
    });

    assert.notEqual(ranked[0].provider, "sonix");
    assert.ok(!ranked.at(-1).reasons.includes("cms_routing_rule"));
  });

  test("normalizes untrusted audio metadata to safe bounded values", () => {
    assert.deepEqual(
      createAudioSelectionProfile({
        language: " VI-vn ",
        audioMode: "music",
        speakerLabels: "true",
        speakerCount: "999",
        durationSeconds: -4,
        fileSizeBytes: Number.POSITIVE_INFINITY,
        filename: "../unsafe.MP3",
      }),
      {
        language: "vi-vn",
        audioMode: "song",
        speakerLabels: true,
        speakerCount: null,
        hasTranslation: false,
        durationSeconds: null,
        fileSizeBytes: null,
        extension: "mp3",
      },
    );
  });
});
