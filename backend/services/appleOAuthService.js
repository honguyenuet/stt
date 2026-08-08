const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = `${APPLE_ISSUER}/auth/keys`;
let jwksCache = { keys: [], expiresAt: 0 };

function isConfiguredSecret(value) {
  const clean = String(value || "").trim().toLowerCase();
  return Boolean(clean) && !clean.includes("your_") && !clean.includes("_here");
}

function getAppleConfig() {
  const config = {
    clientId: String(process.env.APPLE_CLIENT_ID || "").trim(),
    teamId: String(process.env.APPLE_TEAM_ID || "").trim(),
    keyId: String(process.env.APPLE_KEY_ID || "").trim(),
    callbackUrl: String(process.env.APPLE_CALLBACK_URL || "").trim(),
    privateKey: String(process.env.APPLE_PRIVATE_KEY || "").replace(
      /\\n/g,
      "\n",
    ),
    privateKeyPath: String(process.env.APPLE_PRIVATE_KEY_PATH || "").trim(),
  };
  if (
    !isConfiguredSecret(config.clientId) ||
    !isConfiguredSecret(config.teamId) ||
    !isConfiguredSecret(config.keyId) ||
    !config.callbackUrl ||
    (!isConfiguredSecret(config.privateKey) && !config.privateKeyPath)
  ) {
    const error = new Error("Apple OAuth chưa được cấu hình.");
    error.oauthCode = "apple_not_configured";
    throw error;
  }
  return config;
}

function hasAppleOAuth() {
  try {
    getAppleConfig();
    return true;
  } catch {
    return false;
  }
}

function readApplePrivateKey(config) {
  if (isConfiguredSecret(config.privateKey)) return config.privateKey;
  const resolved = path.resolve(config.privateKeyPath);
  const key = fs.readFileSync(resolved, "utf8");
  if (!key.includes("PRIVATE KEY")) {
    const error = new Error("APPLE_PRIVATE_KEY_PATH không chứa private key.");
    error.oauthCode = "apple_not_configured";
    throw error;
  }
  return key;
}

function createAppleClientSecret(config) {
  return jwt.sign({}, readApplePrivateKey(config), {
    algorithm: "ES256",
    audience: APPLE_ISSUER,
    expiresIn: "5m",
    issuer: config.teamId,
    keyid: config.keyId,
    subject: config.clientId,
  });
}

function createAppleAuthorizationUrl({ state, nonce, callbackUrl }) {
  const config = getAppleConfig();
  const redirectUri = String(callbackUrl || config.callbackUrl).trim();
  const url = new URL(`${APPLE_ISSUER}/auth/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code id_token",
    response_mode: "form_post",
    scope: "name email",
    state,
    nonce,
  }).toString();
  return url.toString();
}

async function getAppleJwks() {
  if (jwksCache.expiresAt > Date.now() && jwksCache.keys.length > 0) {
    return jwksCache.keys;
  }
  const response = await fetch(APPLE_JWKS_URL, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = new Error("Không tải được khóa xác minh của Apple.");
    error.oauthCode = "apple_failed";
    throw error;
  }
  const body = await response.json();
  jwksCache = {
    keys: Array.isArray(body.keys) ? body.keys : [],
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  return jwksCache.keys;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function verifyAppleIdentityToken(idToken, config) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid || decoded.header.alg !== "RS256") {
    const error = new Error("Apple identity token không hợp lệ.");
    error.oauthCode = "apple_failed";
    throw error;
  }
  const keys = await getAppleJwks();
  const jwk = keys.find(
    (item) => item.kid === decoded.header.kid && item.kty === "RSA",
  );
  if (!jwk) {
    jwksCache.expiresAt = 0;
    const error = new Error("Không tìm thấy khóa xác minh Apple phù hợp.");
    error.oauthCode = "apple_failed";
    throw error;
  }
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  return jwt.verify(idToken, publicKey, {
    algorithms: ["RS256"],
    audience: config.clientId,
    issuer: APPLE_ISSUER,
  });
}

async function exchangeAppleCode(code, callbackUrl) {
  const config = getAppleConfig();
  const redirectUri = String(callbackUrl || config.callbackUrl).trim();
  const response = await fetch(`${APPLE_ISSUER}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: createAppleClientSecret(config),
      code: String(code || ""),
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error || !body.id_token) {
    const error = new Error(
      body.error_description || body.error || "Apple không cấp identity token.",
    );
    error.oauthCode = "apple_failed";
    throw error;
  }
  const claims = await verifyAppleIdentityToken(body.id_token, config);
  return {
    providerUserId: claims.sub,
    email: claims.email || "",
    emailVerified:
      claims.email_verified === true || claims.email_verified === "true",
    nonce: claims.nonce || "",
    isPrivateEmail:
      claims.is_private_email === true || claims.is_private_email === "true",
  };
}

function assertAppleNonce(nonce, expectedNonceHash, hashValue) {
  if (!safeEqual(hashValue(nonce), expectedNonceHash)) {
    const error = new Error("Apple nonce không hợp lệ hoặc đã hết hạn.");
    error.oauthCode = "apple_failed";
    throw error;
  }
}

module.exports = {
  assertAppleNonce,
  createAppleAuthorizationUrl,
  exchangeAppleCode,
  hasAppleOAuth,
};
