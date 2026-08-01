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
const initDatabase = require("./initDb");
const { getTranscriptionProvider } = require("./services/transcriptionService");
const { startTranscriptionWorker } = require("./services/transcriptionQueue");
const { cleanupExpiredStagingFiles } = require("./services/uploadStorage");
const { startQuotaAlertDispatcher } = require("./services/quotaAlertService");
const {
  startBillingReconciliationDispatcher,
} = require("./services/billingService");

const app = express();
app.disable("x-powered-by");
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || "", 10);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

app.use(requestId);
app.use(securityHeaders);

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
app.use("/api/v1", publicApiRoutes);

app.get("/", (_req, res) => {
  res.json({
    name: "Vbee API Backend",
    status: "ok",
    docs: "/api/v1/health",
    message:
      "Backend API đang chạy. Mở frontend ở http://localhost:3000 để dùng giao diện.",
  });
});

app.get("/api/health", async (_req, res) => {
  res.json({
    status: "ok",
    message: "Backend đang chạy",
    ...(IS_PRODUCTION
      ? {}
      : { transcriptionProvider: await getTranscriptionProvider() }),
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
      console.log(`Backend server đang chạy tại http://localhost:${PORT}`);
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
