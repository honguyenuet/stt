require("./config/env");
process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || "api";
const express = require("express");
const cors = require("cors");
const {
  getAllowedOrigins,
  IS_PRODUCTION,
  validateSecurityConfig,
} = require("./config/security");
const {
  globalApiLimiter,
  requestId,
  securityHeaders,
} = require("./middleware/security");

validateSecurityConfig();

require("./config/passport");
const authRoutes = require("./routes/auth");
const transcribeRoutes = require("./routes/transcribe");
const apiKeyRoutes = require("./routes/apiKeys");
const publicApiRoutes = require("./routes/publicApi");
const quotaRoutes = require("./routes/quota");
const billingRoutes = require("./routes/billing");
const settingsRoutes = require("./routes/settings");
const supportRoutes = require("./routes/support");
const adminRoutes = require("./routes/admin");
const referralRoutes = require("./routes/referrals");
const collaborationRoutes = require("./routes/collaboration");
const teamRoutes = require("./routes/team");
const initDatabase = require("./initDb");
const {
  assertTranscriptionProviderReady,
  getTranscriptionProviderStatus,
} = require("./services/transcriptionService");
const { startTranscriptionWorker } = require("./services/transcriptionQueue");
const { cleanupExpiredStagingFiles } = require("./services/uploadStorage");
const { startQuotaAlertDispatcher } = require("./services/quotaAlertService");
const {
  startBillingReconciliationDispatcher,
} = require("./services/billingService");
const { requestMetrics } = require("./services/observabilityService");

const app = express();
app.disable("x-powered-by");
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || "", 10);
app.set(
  "trust proxy",
  Number.isInteger(trustProxyHops) && trustProxyHops > 0 ? trustProxyHops : 1,
);

app.use(requestId);
app.use(securityHeaders);
app.use(requestMetrics());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || getAllowedOrigins().includes(origin.replace(/\/$/, ""))) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin is not allowed"));
    },
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "X-API-Key", "X-Request-Id"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.use(express.json({ limit: "3mb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use("/api", globalApiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/transcribe", transcribeRoutes);
app.use("/api/keys", apiKeyRoutes);
app.use("/api/quota", quotaRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/collaboration", collaborationRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/v1", publicApiRoutes);

app.get("/", (_req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  res.json({
    name: "Vbee API Backend",
    status: "ok",
    docs: "/api/v1/health",
    message: `Backend API đang chạy. Mở frontend ở ${frontendUrl} để dùng giao diện.`,
  });
});

app.get("/api/health", async (req, res) => {
  const transcriptionProvider = getTranscriptionProviderStatus();
  let providerReady = false;
  let providerError = null;
  try {
    await assertTranscriptionProviderReady();
    providerReady = true;
  } catch (error) {
    providerError = error.message || "Provider chưa sẵn sàng";
  }

  res.json({
    status: providerReady ? "ok" : "degraded",
    message: "Backend đang chạy",
    requestId: req.requestId,
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    provider_ready: providerReady,
    ...(IS_PRODUCTION ? {} : { transcriptionProvider, providerError }),
  });
});

app.use((error, _req, res, next) => {
  if (!error) return next();
  if (error.message === "CORS origin is not allowed") {
    return res.status(403).json({ error: "Nguồn yêu cầu không được phép" });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Nội dung yêu cầu quá lớn" });
  }
  if (Number.isInteger(error.statusCode) && error.statusCode >= 400) {
    return res.status(error.statusCode).json({
      error: error.message || "Yêu cầu không hợp lệ",
      ...(error.details ? { details: error.details } : {}),
    });
  }
  console.error("Unhandled request error:", error.message);
  return res.status(500).json({ error: "Lỗi máy chủ" });
});

const PORT = process.env.PORT || 3001;

initDatabase()
  .then(async () => {
    await cleanupExpiredStagingFiles();
    const stagingCleanupTimer = setInterval(
      () => void cleanupExpiredStagingFiles().catch((error) => {
        console.error("Upload staging cleanup error:", error.message);
      }),
      15 * 60 * 1000,
    );
    stagingCleanupTimer.unref?.();
    startQuotaAlertDispatcher();
    startBillingReconciliationDispatcher();
    await startTranscriptionWorker();
    const server = app.listen(PORT, () => {
      const publicUrl = process.env.PUBLIC_BACKEND_URL || `http://localhost:${PORT}`;
      console.log(`Backend server đang chạy tại ${publicUrl}`);
    });
    server.requestTimeout = 15 * 60 * 1000;
    server.headersTimeout = 15 * 1000;
    server.keepAliveTimeout = 5 * 1000;
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} đang được sử dụng. Hãy dừng server cũ hoặc đổi PORT trong backend/.env.`,
        );
        process.exit(1);
      }
      throw error;
    });
  })
  .catch((error) => {
    console.error("Không thể khởi động backend:", error.message);
    process.exit(1);
  });
