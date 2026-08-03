const crypto = require("crypto");
const helmet = require("helmet");
const { ipKeyGenerator, rateLimit } = require("express-rate-limit");
const { IS_PRODUCTION } = require("../config/security");
const { PostgresRateLimitStore } = require("../services/postgresRateLimitStore");

function requestId(req, res, next) {
  const id = String(req.get("x-request-id") || crypto.randomUUID()).slice(0, 100);
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}

const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: IS_PRODUCTION
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
});

function limiter({
  name,
  windowMs,
  limit,
  message,
  keyByIdentity = false,
  sharedStore = true,
  skipSuccessfulRequests = false,
  skip,
}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests,
    ...(skip ? { skip } : {}),
    ...(sharedStore ? { store: new PostgresRateLimitStore(name) } : {}),
    keyGenerator: keyByIdentity
      ? (req) => {
          if (req.apiKey?.id) return `api:${req.apiKey.id}`;
          if (req.user?.id) return `user:${req.user.id}`;
          return `ip:${ipKeyGenerator(req.ip)}`;
        }
      : undefined,
    handler: (_req, res) =>
      res.status(429).json({ error: message || "Bạn thao tác quá nhanh. Vui lòng thử lại sau." }),
  });
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const GLOBAL_API_LIMIT_EXEMPT_PATHS = new Set([
  "/api/health",
  "/api/billing/payos/webhook",
]);

function isGlobalApiLimitExempt(req) {
  const requestPath = String(req.originalUrl || req.url || "")
    .split("?")[0]
    .replace(/\/+$/, "");
  return GLOBAL_API_LIMIT_EXEMPT_PATHS.has(requestPath);
}

const globalApiLimiter = limiter({
  name: "global-api",
  windowMs:
    positiveInt(process.env.GLOBAL_API_RATE_WINDOW_SECONDS, 15 * 60) * 1000,
  limit: positiveInt(process.env.GLOBAL_API_RATE_LIMIT, 5000),
  skip: isGlobalApiLimitExempt,
  message: "Hệ thống đang nhận quá nhiều yêu cầu từ kết nối này.",
});
const loginLimiter = limiter({
  name: "auth-login",
  windowMs: 15 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  message: "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.",
});
const registrationLimiter = limiter({
  name: "auth-registration",
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: "Đã tạo quá nhiều tài khoản từ kết nối này.",
});
const oauthLimiter = limiter({
  name: "auth-oauth",
  windowMs: 60 * 60 * 1000,
  limit: 30,
  message: "Đã có quá nhiều yêu cầu đăng nhập Google từ kết nối này.",
});
const passwordLimiter = limiter({
  name: "auth-password",
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: "Đã có quá nhiều yêu cầu mật khẩu. Vui lòng thử lại sau.",
});
const refreshLimiter = limiter({
  name: "auth-refresh",
  windowMs: 15 * 60 * 1000,
  limit: 60,
});
const uploadLimiter = limiter({
  name: "transcription-upload",
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyByIdentity: true,
  message: "Bạn đã gửi quá nhiều file trong một giờ.",
});
const urlImportLimiter = limiter({
  name: "transcription-url-import",
  windowMs: 60 * 60 * 1000,
  limit: 40,
  keyByIdentity: true,
  message: "Bạn đã gửi quá nhiều link video trong một giờ.",
});
const publicApiLimiter = limiter({
  name: "public-api",
  windowMs: 60 * 1000,
  limit: 60,
  keyByIdentity: true,
  message: "API key đã vượt giới hạn yêu cầu mỗi phút.",
});
const supportLimiter = limiter({
  name: "support",
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyByIdentity: true,
});
const billingLimiter = limiter({
  name: "billing",
  windowMs: 60 * 1000,
  limit: 60,
  keyByIdentity: true,
});
const webhookLimiter = limiter({
  name: "billing-webhook",
  windowMs: 60 * 1000,
  limit: 120,
});

module.exports = {
  billingLimiter,
  globalApiLimiter,
  isGlobalApiLimitExempt,
  loginLimiter,
  oauthLimiter,
  passwordLimiter,
  publicApiLimiter,
  refreshLimiter,
  registrationLimiter,
  requestId,
  securityHeaders,
  supportLimiter,
  uploadLimiter,
  urlImportLimiter,
  webhookLimiter,
};
