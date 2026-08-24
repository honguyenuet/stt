const assert = require("node:assert/strict");
const test = require("node:test");

const managedKeys = [
  "NODE_ENV",
  "JWT_SECRET",
  "AUDIT_HASH_SECRET",
  "PROVIDER_FILE_SIGNING_SECRET",
  "PROVIDER_SECRET_KEY",
  "AUDIO_URL_SECRET",
  "REQUEST_LOG_IP_SALT",
  "FRONTEND_URL",
  "CORS_ALLOWED_ORIGINS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CALLBACK_URL",
  "DB_HOST",
  "PAYMENT_PROVIDER",
  "MALWARE_SCAN_REQUIRED",
  "CLAMAV_SCAN_COMMAND",
  "CLAMAV_DATABASE_DIR",
  "PROCESS_ROLE",
  "RUN_TRANSCRIPTION_WORKER",
];
const previousEnvironment = Object.fromEntries(
  managedKeys.map((key) => [key, process.env[key]]),
);

function restoreEnvironment() {
  for (const key of managedKeys) {
    if (previousEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnvironment[key];
  }
}

function configureSafeProduction(overrides = {}) {
  Object.assign(process.env, {
    NODE_ENV: "production",
    JWT_SECRET: "j".repeat(64),
    AUDIT_HASH_SECRET: "a".repeat(64),
    PROVIDER_FILE_SIGNING_SECRET: "f".repeat(64),
    PROVIDER_SECRET_KEY: "p".repeat(64),
    AUDIO_URL_SECRET: "u".repeat(64),
    REQUEST_LOG_IP_SALT: "i".repeat(64),
    FRONTEND_URL: "https://app.example.test",
    CORS_ALLOWED_ORIGINS: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CALLBACK_URL: "https://api.example.test/api/auth/google/callback",
    DB_HOST: "localhost",
    PAYMENT_PROVIDER: "disabled-for-test",
    MALWARE_SCAN_REQUIRED: "true",
    CLAMAV_SCAN_COMMAND: "clamscan",
    CLAMAV_DATABASE_DIR: "/var/lib/clamav",
    PROCESS_ROLE: "api",
    RUN_TRANSCRIPTION_WORKER: "false",
    ...overrides,
  });
}

test("production requires independent purpose-specific secrets", (t) => {
  t.after(restoreEnvironment);
  configureSafeProduction();
  delete process.env.PROVIDER_SECRET_KEY;
  delete process.env.AUDIO_URL_SECRET;
  delete process.env.REQUEST_LOG_IP_SALT;

  delete require.cache[require.resolve("../config/security")];
  const { validateSecurityConfig } = require("../config/security");

  assert.throws(
    () => validateSecurityConfig(),
    (error) => {
      assert.match(error.message, /PROVIDER_SECRET_KEY/);
      assert.match(error.message, /AUDIO_URL_SECRET/);
      assert.match(error.message, /REQUEST_LOG_IP_SALT/);
      return true;
    },
  );
});

test("production accepts separate strong secrets for each purpose", (t) => {
  t.after(restoreEnvironment);
  configureSafeProduction();

  delete require.cache[require.resolve("../config/security")];
  const { validateSecurityConfig } = require("../config/security");

  assert.doesNotThrow(() => validateSecurityConfig());
});
