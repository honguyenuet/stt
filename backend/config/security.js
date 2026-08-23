require("dotenv").config();

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const LOCAL_JWT_SECRET = "vbee-local-development-secret-change-before-production";
const INSECURE_SECRETS = new Set([
  "change-this-secret",
  "change-this-secret-in-production",
  "change_this_to_a_very_long_random_secret_string",
  LOCAL_JWT_SECRET,
]);

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedInt(value, fallback, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, positiveInt(value, fallback)));
}

function isStrongSecret(value) {
  const secret = String(value || "").trim();
  return secret.length >= 32 && !INSECURE_SECRETS.has(secret);
}

const JWT_SECRET = String(process.env.JWT_SECRET || LOCAL_JWT_SECRET).trim();
const FRONTEND_URL = String(
  process.env.FRONTEND_URL || "http://localhost:3000",
)
  .trim()
  .replace(/\/$/, "");
const ACCESS_TOKEN_TTL_SECONDS = boundedInt(
  process.env.ACCESS_TOKEN_TTL_SECONDS,
  15 * 60,
  5 * 60,
  30 * 60,
);
const REFRESH_TOKEN_TTL_DAYS = boundedInt(
  process.env.REFRESH_TOKEN_TTL_DAYS,
  30,
  1,
  90,
);
const JWT_ISSUER = process.env.JWT_ISSUER || "vbee-aivoice";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "vbee-web";
const REFRESH_COOKIE_NAME = IS_PRODUCTION
  ? "__Host-vbee_refresh"
  : "vbee_refresh";
const DEVELOPMENT_FRONTEND_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function getAllowedOrigins() {
  return Array.from(
    new Set(
      [
        FRONTEND_URL,
        ...(IS_PRODUCTION ? [] : DEVELOPMENT_FRONTEND_ORIGINS),
        ...String(process.env.CORS_ALLOWED_ORIGINS || "").split(","),
      ]
        .map((value) => value.trim().replace(/\/$/, ""))
        .filter(Boolean),
    ),
  );
}

function isTrustedOrigin(origin) {
  if (!origin) return true;
  return getAllowedOrigins().includes(String(origin).replace(/\/$/, ""));
}

function getRequestOrigin(req) {
  const origin = req?.get?.("origin");
  if (origin) return String(origin).replace(/\/$/, "");
  const referer = req?.get?.("referer");
  if (!referer) return "";
  try {
    const url = new URL(referer);
    return url.origin.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function getRequestFrontendUrl(req) {
  const queryOrigin = String(req?.query?.frontendOrigin || "").trim();
  if (queryOrigin && isTrustedOrigin(queryOrigin)) {
    return queryOrigin.replace(/\/$/, "");
  }
  const origin = getRequestOrigin(req);
  return origin && isTrustedOrigin(origin) ? origin : FRONTEND_URL;
}

function getRequestBackendUrl(req) {
  const host = String(req?.get?.("host") || "").trim();
  const protocol = String(req?.protocol || "http").replace(/:$/, "");
  if (!host) return String(process.env.PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
  return `${protocol}://${host}`.replace(/\/$/, "");
}

function getOAuthCallbackUrl(req, provider) {
  const cleanProvider = String(provider || "").trim().toLowerCase();
  const frontendUrl = getRequestFrontendUrl(req);
  const backendUrl = frontendUrl === "http://localhost:3000"
    ? "http://localhost:3001"
    : getRequestBackendUrl(req);
  return `${backendUrl}/api/auth/${cleanProvider}/callback`;
}

function validateSecurityConfig() {
  const errors = [];
  const warnings = [];
  const providerSecret = String(
    process.env.PROVIDER_FILE_SIGNING_SECRET || "",
  ).trim();
  const providerEncryptionSecret = String(
    process.env.PROVIDER_SECRET_KEY || "",
  ).trim();
  const audioUrlSecret = String(process.env.AUDIO_URL_SECRET || "").trim();
  const requestLogIpSalt = String(process.env.REQUEST_LOG_IP_SALT || "").trim();
  const auditSecret = String(process.env.AUDIT_HASH_SECRET || "").trim();

  if (!isStrongSecret(JWT_SECRET)) {
    (IS_PRODUCTION ? errors : warnings).push(
      "JWT_SECRET must be a unique random value of at least 32 characters.",
    );
  }
  if (IS_PRODUCTION && !FRONTEND_URL.startsWith("https://")) {
    errors.push("FRONTEND_URL must use HTTPS in production.");
  }
  if (IS_PRODUCTION && getAllowedOrigins().some((origin) => origin === "*")) {
    errors.push("Wildcard CORS origins are not allowed in production.");
  }
  if (
    IS_PRODUCTION &&
    (!isStrongSecret(auditSecret) || auditSecret === JWT_SECRET)
  ) {
    errors.push("AUDIT_HASH_SECRET must be strong and separate from JWT_SECRET.");
  }
  if (
    IS_PRODUCTION &&
    process.env.PUBLIC_BACKEND_URL &&
    !String(process.env.PUBLIC_BACKEND_URL).startsWith("https://")
  ) {
    errors.push("PUBLIC_BACKEND_URL must use HTTPS in production.");
  }
  if (
    IS_PRODUCTION &&
    (!isStrongSecret(providerSecret) || providerSecret === JWT_SECRET)
  ) {
    errors.push(
      "PROVIDER_FILE_SIGNING_SECRET must be strong and separate from JWT_SECRET.",
    );
  }
  if (
    IS_PRODUCTION &&
    (!isStrongSecret(providerEncryptionSecret) ||
      providerEncryptionSecret === JWT_SECRET)
  ) {
    errors.push(
      "PROVIDER_SECRET_KEY must be strong and separate from JWT_SECRET.",
    );
  }
  if (
    IS_PRODUCTION &&
    (!isStrongSecret(audioUrlSecret) || audioUrlSecret === JWT_SECRET)
  ) {
    errors.push(
      "AUDIO_URL_SECRET must be strong and separate from JWT_SECRET.",
    );
  }
  if (
    IS_PRODUCTION &&
    (!isStrongSecret(requestLogIpSalt) || requestLogIpSalt === JWT_SECRET)
  ) {
    errors.push(
      "REQUEST_LOG_IP_SALT must be strong and separate from JWT_SECRET.",
    );
  }
  if (
    IS_PRODUCTION &&
    !["localhost", "127.0.0.1", "::1"].includes(process.env.DB_HOST || "localhost") &&
    process.env.DB_SSL !== "true"
  ) {
    errors.push("DB_SSL=true is required for a remote production database.");
  }
  if (
    IS_PRODUCTION &&
    (process.env.ENABLE_DEMO_PAYMENTS === "true" ||
      process.env.ENABLE_DEV_QUOTA_UPGRADE === "true" ||
      process.env.CREATE_DEMO_USER === "true")
  ) {
    errors.push("Demo users, payments, and quota upgrades must be disabled.");
  }
  if (IS_PRODUCTION && String(process.env.PAYMENT_PROVIDER || "payos") === "payos") {
    for (const name of ["PAYOS_CLIENT_ID", "PAYOS_API_KEY", "PAYOS_CHECKSUM_KEY"]) {
      if (!String(process.env[name] || "").trim()) {
        errors.push(`${name} is required for production PayOS billing.`);
      }
    }
    for (const name of [
      "STANDARD_MONTHLY_PRICE_VND",
      "STANDARD_YEARLY_PRICE_VND",
      "SPECIAL_MONTHLY_PRICE_VND",
      "SPECIAL_YEARLY_PRICE_VND",
    ]) {
      const price = Number(process.env[name]);
      if (!Number.isSafeInteger(price) || price <= 0) {
        errors.push(`${name} must be a positive integer in production.`);
      }
    }
  }
  if (
    IS_PRODUCTION &&
    process.env.GOOGLE_CLIENT_ID &&
    !String(process.env.GOOGLE_CALLBACK_URL || "").startsWith("https://")
  ) {
    errors.push("GOOGLE_CALLBACK_URL must use HTTPS in production.");
  }
  if (IS_PRODUCTION && process.env.MALWARE_SCAN_REQUIRED !== "true") {
    errors.push("MALWARE_SCAN_REQUIRED=true is required in production.");
  }
  if (IS_PRODUCTION && !String(process.env.CLAMAV_SCAN_COMMAND || "").trim()) {
    errors.push("CLAMAV_SCAN_COMMAND is required in production.");
  }
  if (IS_PRODUCTION && !String(process.env.CLAMAV_DATABASE_DIR || "").trim()) {
    errors.push("CLAMAV_DATABASE_DIR is required in production.");
  }
  if (
    IS_PRODUCTION &&
    process.env.CLAMAV_SCAN_MODE === "clamd" &&
    !String(process.env.CLAMAV_SCAN_CONFIG || "").trim()
  ) {
    errors.push("CLAMAV_SCAN_CONFIG is required for clamd mode in production.");
  }
  if (
    IS_PRODUCTION &&
    process.env.PROCESS_ROLE === "api" &&
    process.env.RUN_TRANSCRIPTION_WORKER !== "false"
  ) {
    errors.push(
      "The production API must set RUN_TRANSCRIPTION_WORKER=false and run npm run worker separately.",
    );
  }
  if (
    IS_PRODUCTION &&
    process.env.PROCESS_ROLE === "worker" &&
    process.env.RUN_TRANSCRIPTION_WORKER === "false"
  ) {
    errors.push("The dedicated worker requires RUN_TRANSCRIPTION_WORKER=true.");
  }

  warnings.forEach((message) => console.warn(`[security] ${message}`));
  if (errors.length > 0) {
    throw new Error(`Unsafe production configuration: ${errors.join(" ")}`);
  }
}

module.exports = {
  ACCESS_TOKEN_TTL_SECONDS,
  FRONTEND_URL,
  getOAuthCallbackUrl,
  getRequestBackendUrl,
  getRequestFrontendUrl,
  IS_PRODUCTION,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_TTL_DAYS,
  getAllowedOrigins,
  isStrongSecret,
  isTrustedOrigin,
  validateSecurityConfig,
};
