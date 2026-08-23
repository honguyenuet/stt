const assert = require("node:assert/strict");
const test = require("node:test");
const pool = require("../db");
const settingsRouter = require("../routes/settings");
const {
  DEFAULT_PRIVACY_SETTINGS,
  buildUserDataExport,
  normalizePrivacySettings,
} = require("../services/privacyCenterService");

test.after(() => pool.end());

function registeredMethods(path) {
  return [
    ...new Set(
      settingsRouter.stack
        .filter((item) => item.route?.path === path)
        .flatMap((item) => Object.keys(item.route.methods || {})),
    ),
  ].sort();
}

test("privacy center exposes the endpoints consumed by both settings screens", () => {
  assert.deepEqual(registeredMethods("/privacy"), ["get", "patch"]);
  assert.deepEqual(registeredMethods("/privacy/export"), ["get"]);
  assert.deepEqual(registeredMethods("/privacy/media"), ["delete"]);
  assert.deepEqual(registeredMethods("/privacy/transcripts"), ["delete"]);
  assert.deepEqual(registeredMethods("/privacy/account"), ["delete"]);
});

test("privacy center keeps only supported policies and bounded retention days", () => {
  assert.deepEqual(
    normalizePrivacySettings({
      mediaRetentionPolicy: "unsafe",
      mediaRetentionDays: -10,
      transcriptRetentionPolicy: "unsafe",
      transcriptRetentionDays: 50_000,
      allowProductAnalytics: true,
    }),
    {
      ...DEFAULT_PRIVACY_SETTINGS,
      mediaRetentionDays: 1,
      transcriptRetentionDays: 3650,
      allowProductAnalytics: true,
    },
  );
});

test("privacy export includes the account profile with the user-owned data", async () => {
  const db = {
    async query(sql) {
      if (/FROM users/i.test(sql)) {
        return { rows: [{ id: 7, email: "user@example.test" }] };
      }
      if (/SELECT privacy_settings FROM user_settings/i.test(sql)) {
        return { rows: [{ privacy_settings: {} }] };
      }
      return { rows: [] };
    },
  };

  const archive = await buildUserDataExport(7, db);
  assert.equal(archive.includes(Buffer.from("account.json")), true);
  assert.equal(archive.includes(Buffer.from("user@example.test")), true);
});
