const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_PRIVACY_SETTINGS,
  normalizePrivacySettings,
} = require("../services/privacySettingsService");

test("privacy settings reject unsafe retention values and unknown fields", () => {
  assert.deepEqual(
    normalizePrivacySettings({
      audioRetentionDays: -5,
      keepAudioAfterTranscription: "false",
      allowProductAnalytics: true,
      ignored: "value",
    }),
    {
      ...DEFAULT_PRIVACY_SETTINGS,
      keepAudioAfterTranscription: false,
      allowProductAnalytics: true,
    },
  );
});

test("privacy settings accept the supported retention periods", () => {
  for (const audioRetentionDays of [0, 7, 30, 90, 365]) {
    assert.equal(
      normalizePrivacySettings({ audioRetentionDays }).audioRetentionDays,
      audioRetentionDays,
    );
  }
});
