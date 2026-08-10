const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  defaultAdminSettings,
  normalizeAdminSettings,
} = require("../services/adminSettingsService");

describe("admin settings", () => {
  test("normalizes runtime limits and removes unsafe formats", () => {
    const settings = normalizeAdminSettings({
      max_file_size_mb: 99999,
      max_file_duration_minutes: 0,
      supported_formats: ["MP3", "exe", "wav", "mp3"],
      supported_languages: ["VI", "en-US", "../../etc", "multi"],
      max_retry_attempts: 99,
      default_quota_minutes: -1,
      storage_policy: "unknown",
      system_parameters: {
        queue_concurrency: 0,
        queue_retention_ms: 1,
      },
      notification_config: {
        usage_alert_email: false,
        failure_alert_email: true,
      },
    });

    assert.equal(settings.max_file_size_mb, 2048);
    assert.equal(settings.max_file_duration_minutes, 1);
    assert.deepEqual(settings.supported_formats, ["mp3", "wav"]);
    assert.deepEqual(settings.supported_languages, ["vi", "en-us", "multi"]);
    assert.equal(settings.max_retry_attempts, 10);
    assert.equal(settings.default_quota_minutes, 1);
    assert.equal(
      settings.storage_policy,
      defaultAdminSettings().storage_policy,
    );
    assert.equal(settings.system_parameters.queue_concurrency, 1);
    assert.equal(settings.system_parameters.queue_retention_ms, 60_000);
    assert.deepEqual(settings.notification_config, {
      usage_alert_email: false,
      failure_alert_email: true,
    });
  });

  test("keeps defaults when optional values are absent", () => {
    assert.deepEqual(normalizeAdminSettings({}), defaultAdminSettings());
  });

  test("includes every format shown in the upload workspace by default", () => {
    const formats = defaultAdminSettings().supported_formats;
    assert.deepEqual(formats, [
      "mp3",
      "wav",
      "m4a",
      "ogg",
      "flac",
      "aac",
      "mp4",
      "webm",
    ]);
  });
});
