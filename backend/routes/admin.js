require("../config/env");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const pool = require("../db");
const { encryptProviderSecret } = require("../services/providerSecrets");
const {
  UPLOADS_DIR,
  isTranscriptionProviderConfigured,
} = require("../services/transcriptionService");
const {
  ACTIVE_JOB_STATUSES,
  cancelTranscriptionJobForUser,
  kickTranscriptionWorker,
  normalizeTranscriptionStatus,
  WAITING_JOB_STATUSES,
} = require("../services/transcriptionQueue");
const { revokeAllSessions } = require("../services/sessionService");
const {
  PLAN_CONFIG,
  getPurchasedQuotaSeconds,
  normalizeBillingCycle,
  normalizePlan: normalizeUserPlan,
} = require("../services/quotaService");
const {
  canMutateAdminRole,
  canReplySupportRole,
  canUpdateSupportStatusRole,
  createAdminSession,
  getEffectiveAdminRole,
  isAdminAccountActive,
  normalizeAdminUser,
} = require("../services/adminAccess");
const { requireAuth } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/security");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";

const ASSIGNABLE_ADMIN_ROLES = new Set(["admin", "support", "user"]);
const SUPPORT_STATUSES = new Set(["open", "pending", "resolved", "closed"]);

function readBearerToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
}

async function requireAdmin(req, res, next) {
  const token = readBearerToken(req);
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập admin" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.scope !== "admin") {
      return res.status(403).json({ error: "Token không có quyền admin" });
    }

    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, admin_role, status,
              role, account_status
       FROM users WHERE id = $1`,
      [decoded.id],
    );
    const user = rows[0];
    const adminRole = getEffectiveAdminRole(user);
    if (
      !user ||
      !isAdminAccountActive(user) ||
      !adminRole
    ) {
      return res.status(403).json({ error: "Tài khoản admin không hợp lệ" });
    }

    if (
      adminRole === "support" &&
      req.path !== "/auth/me" &&
      !req.path.startsWith("/support/")
    ) {
      return res
        .status(403)
        .json({ error: "Hỗ trợ viên chỉ được truy cập phản hồi hỗ trợ" });
    }

    req.admin = { ...user, admin_role: adminRole };
    next();
  } catch {
    return res
      .status(401)
      .json({ error: "Token admin không hợp lệ hoặc đã hết hạn" });
  }
}

function requireAdminManagement(req, res, next) {
  if (!canMutateAdminRole(req.admin.admin_role)) {
    return res
      .status(403)
      .json({ error: "Bạn không có quyền truy cập mục quản trị này" });
  }
  next();
}

function requireMutation(req, res, next) {
  if (!canMutateAdminRole(req.admin.admin_role)) {
    return res
      .status(403)
      .json({ error: "Bạn không có quyền thực hiện thao tác này" });
  }
  next();
}

function requireSupportMutation(req, res, next) {
  if (!canReplySupportRole(req.admin.admin_role)) {
    return res
      .status(403)
      .json({ error: "Bạn không có quyền phản hồi hỗ trợ" });
  }
  next();
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function paginate(rows, page, limit, total) {
  return {
    data: rows,
    page,
    limit,
    total,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  };
}

async function writeAudit({
  actorRow,
  action,
  targetType,
  targetId,
  details = {},
}) {
  await pool.query(
    `INSERT INTO audit_logs (actor_id, actor, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      actorRow.id,
      normalizeAdminUser(actorRow).name,
      action,
      targetType,
      String(targetId),
      JSON.stringify(details),
    ],
  );
}

function userSelectSql() {
  return `
    SELECT u.id, u.first_name, u.last_name, u.email,
      u.admin_role, u.status, u.role, u.account_status,
      u.plan, u.quota_seconds, u.plan_started_at, u.plan_expires_at,
      u.created_at, u.last_login_at,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN COALESCE(t.duration, 0) ELSE 0 END), 0) AS used_seconds
    FROM users u
    LEFT JOIN transcriptions t ON t.user_id = u.id
  `;
}

function normalizeManagedUser(row) {
  return {
    id: String(row.id),
    name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
    email: row.email,
    role: getEffectiveAdminRole(row) || "user",
    status: isAdminAccountActive(row) ? "active" : "suspended",
    plan: normalizeUserPlan(row.plan),
    quota_minutes: Math.ceil(Number(row.quota_seconds || 0) / 60),
    used_minutes: Math.ceil(Number(row.used_seconds || 0) / 60),
    plan_started_at: row.plan_started_at,
    plan_expires_at: row.plan_expires_at,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

function normalizeJob(row) {
  const status = normalizeTranscriptionStatus(row.queue_status || row.status || "completed");
  return {
    job_id: `job_${row.id}`,
    user_id: String(row.user_id),
    user_name:
      `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
    user_email: row.email,
    file_id: `file_${row.id}`,
    file_name: row.filename,
    language: row.source_language || "auto",
    duration: Math.round(Number(row.duration || 0)),
    status,
    processing_time:
      row.processing_seconds === null || row.processing_seconds === undefined
        ? null
        : Math.round(Number(row.processing_seconds)),
    created_at: row.created_at,
    completed_at:
      row.completed_at || (status === "completed" ? row.created_at : null),
    error_message: row.error_message || undefined,
    queue_job_id: row.queue_job_id ? Number(row.queue_job_id) : null,
    progress: Number(row.queue_progress || 0),
    progress_stage: row.progress_stage || undefined,
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || 0),
    next_retry_at: row.next_retry_at || null,
    timeout_seconds: row.timeout_seconds ? Number(row.timeout_seconds) : null,
    dead_lettered: Boolean(row.dead_lettered),
    dead_letter_reason: row.dead_letter_reason || null,
    recovered_at: row.recovered_at || null,
    timed_out_at: row.timed_out_at || null,
    transcript: row.text || "",
  };
}

function normalizeFile(row) {
  const hasAudio =
    Boolean(row.audio_filename) || Number(row.file_size || 0) > 0;
  const storageStatus = row.deleted_at
    ? "missing"
    : row.error_message
      ? "error"
      : hasAudio
        ? "available"
        : "missing";
  return {
    file_id: `file_${row.id}`,
    file_name: row.filename,
    owner_id: String(row.user_id),
    owner_name:
      `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
    owner_email: row.email,
    file_type: /\.(mp4|mov|avi|mkv|webm)$/i.test(row.filename)
      ? "video"
      : "audio",
    file_size: Number(row.file_size || 0),
    duration_seconds: Math.round(Number(row.duration || 0)),
    storage_status: storageStatus,
    transcription_status: normalizeTranscriptionStatus(row.status || "completed"),
    created_at: row.created_at,
    media_url: row.audio_filename
      ? `/api/admin/files/file_${row.id}/media`
      : "",
    has_audio_track: hasAudio,
    metadata: {
      source_language: row.source_language || "auto",
      audio_filename: row.audio_filename || "",
      processing_seconds: Number(row.processing_seconds || 0),
    },
  };
}

function normalizeSupportTicket(row) {
  return {
    id: String(row.id),
    user_id: row.user_id ? String(row.user_id) : null,
    user_name:
      `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
      row.name ||
      row.email ||
      "Khách chưa đăng nhập",
    user_email: row.email || row.user_email || "",
    subject: row.subject || "Yêu cầu hỗ trợ Vbee",
    category: row.category || "general",
    priority: row.priority || "normal",
    status: SUPPORT_STATUSES.has(row.status) ? row.status : "open",
    page_url: row.page_url || null,
    user_plan: row.user_plan || null,
    latest_message: row.latest_message || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeSupportMessage(row) {
  return {
    id: String(row.id),
    ticket_id: String(row.ticket_id),
    sender: row.sender === "admin" ? "admin" : "user",
    message: row.message || "",
    created_at: row.created_at,
  };
}

function defaultAdminSettings() {
  return {
    max_file_size_mb: Number.parseInt(process.env.MAX_UPLOAD_MB || "500", 10),
    max_file_duration_minutes: 180,
    supported_formats: ["mp3", "wav", "m4a", "mp4", "mov"],
    supported_languages: ["vi", "en", "ja", "ko", "zh"],
    max_retry_attempts: 3,
    default_quota_minutes: 30,
    storage_policy: "keep_transcripts_and_media",
    data_retention_days: 365,
    system_parameters: {
      queue_concurrency: Number.parseInt(
        process.env.TRANSCRIPTION_QUEUE_CONCURRENCY || "1",
        10,
      ),
      queue_retention_ms: Number.parseInt(
        process.env.TRANSCRIPTION_QUEUE_RETENTION_MS || "3600000",
        10,
      ),
    },
    notification_config: {
      usage_alert_email: true,
      failure_alert_email: false,
    },
  };
}

router.post("/auth/login", loginLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) {
      return res.status(400).json({ error: "Vui lòng nhập email và mật khẩu" });
    }

    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, password, admin_role, status,
              role, account_status
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email],
    );
    const user = rows[0];
    if (!user || !user.password || !isAdminAccountActive(user)) {
      return res
        .status(401)
        .json({ error: "Email hoặc mật khẩu admin không đúng" });
    }
    const matched = await bcrypt.compare(password, user.password);
    const adminRole = getEffectiveAdminRole(user);
    if (!matched || !adminRole) {
      return res
        .status(401)
        .json({ error: "Email hoặc mật khẩu admin không đúng" });
    }

    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
      user.id,
    ]);
    return res.json(createAdminSession({ ...user, admin_role: adminRole }));
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({ error: "Không đăng nhập được admin" });
  }
});

router.post("/auth/sso", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, admin_role, status,
              role, account_status
       FROM users WHERE id = $1`,
      [req.user.id],
    );
    const user = rows[0];
    const adminRole = getEffectiveAdminRole(user);
    if (!user || !isAdminAccountActive(user) || !adminRole) {
      return res.status(403).json({ error: "Bạn không có quyền truy cập CMS" });
    }

    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
      user.id,
    ]);
    return res.json(createAdminSession({ ...user, admin_role: adminRole }));
  } catch (error) {
    console.error("Admin SSO error:", error);
    return res.status(500).json({ error: "Không đăng nhập được CMS" });
  }
});

router.get("/auth/me", requireAdmin, (req, res) => {
  return res.json({ user: normalizeAdminUser(req.admin) });
});

router.get("/dashboard", requireAdmin, async (_req, res) => {
  try {
    const [
      usersResult,
      filesResult,
      jobsResult,
      statusResult,
      usageResult,
      processingResult,
      recentResult,
    ] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM users"),
      pool.query("SELECT COUNT(*)::int AS count FROM transcriptions"),
      pool.query("SELECT COUNT(*)::int AS count FROM transcriptions"),
      pool.query(
        "SELECT status, COUNT(*)::int AS count FROM transcriptions GROUP BY status",
      ),
      pool.query(`
          SELECT to_char(day, 'YYYY-MM-DD') AS date,
            COALESCE(SUM(web_minutes), 0)::float AS web_minutes,
            COALESCE(SUM(api_minutes), 0)::float AS api_minutes
          FROM (
            SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
          ) days
          LEFT JOIN (
            SELECT DATE(t.created_at) AS usage_day,
              CASE WHEN COALESCE(t.filename, '') LIKE 'api-%' THEN 0 ELSE CEIL(COALESCE(t.duration, 0) / 60.0) END AS web_minutes,
              CASE WHEN COALESCE(t.filename, '') LIKE 'api-%' THEN CEIL(COALESCE(t.duration, 0) / 60.0) ELSE 0 END AS api_minutes
            FROM transcriptions t
            WHERE t.status = 'completed'
          ) usage ON usage.usage_day = days.day
          GROUP BY day
          ORDER BY day
        `),
      pool.query(
        "SELECT AVG(processing_seconds)::float AS average FROM transcriptions WHERE processing_seconds IS NOT NULL",
      ),
      pool.query(`
          SELECT t.*, u.first_name, u.last_name, u.email
          FROM transcriptions t
          JOIN users u ON u.id = t.user_id
          ORDER BY t.created_at DESC
          LIMIT 10
        `),
    ]);

    const jobsByStatus = {
      uploaded: 0,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    statusResult.rows.forEach((row) => {
      const status = normalizeTranscriptionStatus(row.status);
      if (Object.prototype.hasOwnProperty.call(jobsByStatus, status)) {
        jobsByStatus[status] += Number(row.count || 0);
      }
    });
    const completed = jobsByStatus.completed;
    const failed = jobsByStatus.failed;
    const terminal = completed + failed + jobsByStatus.cancelled;
    const jobs = recentResult.rows.map(normalizeJob).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    return res.json({
      total_users: usersResult.rows[0].count,
      total_files: filesResult.rows[0].count,
      total_jobs: jobsResult.rows[0].count,
      processed_minutes: usageResult.rows.reduce(
        (sum, row) =>
          sum + Number(row.web_minutes || 0) + Number(row.api_minutes || 0),
        0,
      ),
      jobs_by_status: jobsByStatus,
      success_rate: terminal ? Math.round((completed / terminal) * 100) : 0,
      failure_rate: terminal ? Math.round((failed / terminal) * 100) : 0,
      average_processing_time: Math.round(
        Number(processingResult.rows[0].average || 0),
      ),
      usage: usageResult.rows,
      recent_jobs: jobs.slice(0, 5),
      recent_failed_jobs: jobs
        .filter((job) => job.status === "failed")
        .slice(0, 5),
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    return res.status(500).json({ error: "Không tải được dashboard" });
  }
});

router.get("/users", requireAdmin, async (req, res) => {
  try {
    const page = toInt(req.query.page, 1);
    const limit = Math.min(toInt(req.query.limit, 20), 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const role = String(req.query.role || "all");
    const status = String(req.query.status || "all");
    const filters = [];
    const params = [];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      filters.push(
        `(LOWER(u.first_name || ' ' || u.last_name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length})`,
      );
    }
    if (role !== "all") {
      if (role === "admin") {
        filters.push(`u.admin_role IN ('admin', 'super_admin')`);
      } else if (role === "support") {
        params.push(role);
        filters.push(`u.admin_role = $${params.length}`);
      } else if (role === "user") {
        filters.push(
          `(u.admin_role IS NULL OR u.admin_role IN ('none', 'user') OR
            (u.admin_role NOT IN ('admin', 'support', 'super_admin', 'viewer') AND COALESCE(u.role, 'user') = 'user'))`,
        );
      } else {
        params.push(role);
        filters.push(
          `(u.admin_role = $${params.length} OR
            (u.admin_role = 'none' AND u.role = $${params.length}))`,
        );
      }
    }
    if (status !== "all") {
      params.push(status);
      filters.push(
        `(u.status = $${params.length} AND
          u.account_status = CASE
            WHEN $${params.length} = 'active' THEN 'active'
            ELSE 'blocked'
          END)`,
      );
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `${userSelectSql()}
       ${where}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const totalResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users u ${where}`,
      params,
    );
    return res.json(
      paginate(
        rows.map(normalizeManagedUser),
        page,
        limit,
        totalResult.rows[0].count,
      ),
    );
  } catch (error) {
    console.error("Admin users error:", error);
    return res.status(500).json({ error: "Không tải được users" });
  }
});

router.patch(
  "/users/:id/status",
  requireAdmin,
  requireMutation,
  async (req, res) => {
    try {
      const status = String(req.body.status || "");
      if (!["active", "suspended"].includes(status)) {
        return res.status(400).json({ error: "Status không hợp lệ" });
      }
      const accountStatus = status === "active" ? "active" : "suspended";
      const authVersionIncrement = status === "suspended" ? 1 : 0;
      const { rows } = await pool.query(
        `UPDATE users
         SET status = $1,
             account_status = $2,
             auth_version = auth_version + $3
         WHERE id = $4
       RETURNING id, first_name, last_name, email, admin_role, status, role,
         account_status, plan, quota_seconds, plan_started_at, plan_expires_at,
         created_at, last_login_at`,
        [status, accountStatus, authVersionIncrement, req.params.id],
      );
      if (!rows[0])
        return res.status(404).json({ error: "Không tìm thấy user" });
      if (status === "suspended") {
        await revokeAllSessions(req.params.id);
      }
      await writeAudit({
        actorRow: req.admin,
        action: status === "active" ? "user.activate" : "user.suspend",
        targetType: "user",
        targetId: req.params.id,
        details: { status },
      });
      rows[0].used_seconds = 0;
      return res.json(normalizeManagedUser(rows[0]));
    } catch (error) {
      console.error("Admin update user status error:", error);
      return res.status(500).json({ error: "Không cập nhật được user" });
    }
  },
);

router.patch(
  "/users/:id/role",
  requireAdmin,
  requireAdminManagement,
  async (req, res) => {
    try {
      const role = String(req.body.role || "");
      if (!ASSIGNABLE_ADMIN_ROLES.has(role))
        return res.status(400).json({ error: "Role không hợp lệ" });
      const storedRole = role === "user" ? "none" : role;
      const accountRole = role === "user" ? "user" : role;
      const { rows } = await pool.query(
        `UPDATE users SET admin_role = $1, role = $2 WHERE id = $3
       RETURNING id, first_name, last_name, email, admin_role, status, role,
         account_status, plan, quota_seconds, plan_started_at, plan_expires_at,
         created_at, last_login_at`,
        [storedRole, accountRole, req.params.id],
      );
      if (!rows[0])
        return res.status(404).json({ error: "Không tìm thấy user" });
      await writeAudit({
        actorRow: req.admin,
        action: "user.role_update",
        targetType: "user",
        targetId: req.params.id,
        details: { role },
      });
      rows[0].used_seconds = 0;
      return res.json(normalizeManagedUser(rows[0]));
    } catch (error) {
      console.error("Admin update user role error:", error);
      return res.status(500).json({ error: "Không cập nhật được role" });
    }
  },
);

router.post(
  "/users/:id/quota",
  requireAdmin,
  requireMutation,
  async (req, res) => {
    try {
      const quotaMinutes = Number(req.body.quotaMinutes);
      const reason = String(req.body.reason || "").trim();
      if (!Number.isFinite(quotaMinutes) || quotaMinutes < 0) {
        return res.status(400).json({ error: "Quota không được âm" });
      }
      if (!reason)
        return res
          .status(400)
          .json({ error: "Vui lòng nhập lý do điều chỉnh quota" });

      const current = await pool.query(
        "SELECT quota_seconds FROM users WHERE id = $1",
        [req.params.id],
      );
      if (!current.rows[0])
        return res.status(404).json({ error: "Không tìm thấy user" });
      const previousMinutes = Math.ceil(
        Number(current.rows[0].quota_seconds || 0) / 60,
      );
      const nextSeconds = Math.round(quotaMinutes * 60);

      const { rows } = await pool.query(
        `UPDATE users SET quota_seconds = $1 WHERE id = $2
       RETURNING id, first_name, last_name, email, admin_role, status, plan,
         quota_seconds, plan_started_at, plan_expires_at, created_at, last_login_at`,
        [nextSeconds, req.params.id],
      );
      await writeAudit({
        actorRow: req.admin,
        action: "quota.adjust",
        targetType: "quota",
        targetId: req.params.id,
        details: {
          quota_minutes: quotaMinutes,
          previous_quota_minutes: previousMinutes,
          reason,
        },
      });
      rows[0].used_seconds = 0;
      return res.json(normalizeManagedUser(rows[0]));
    } catch (error) {
      console.error("Admin quota error:", error);
      return res.status(500).json({ error: "Không điều chỉnh được quota" });
    }
  },
);

router.patch(
  "/users/:id/plan",
  requireAdmin,
  requireMutation,
  async (req, res) => {
    try {
      const requestedPlan = String(req.body.plan || "").trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(PLAN_CONFIG, requestedPlan)) {
        return res.status(400).json({ error: "Gói không hợp lệ" });
      }
      const plan = normalizeUserPlan(requestedPlan);
      const billingCycle = normalizeBillingCycle(req.body.billingCycle);
      const quotaSeconds = getPurchasedQuotaSeconds(plan, billingCycle);
      const planExpiresAt =
        plan === "free"
          ? null
          : new Date(
              Date.now() +
                (billingCycle === "yearly" ? 365 : 30) * 24 * 60 * 60 * 1000,
            );

      const { rows } = await pool.query(
        `UPDATE users
         SET plan = $1,
             quota_seconds = $2,
             plan_started_at = NOW(),
             plan_expires_at = $3,
             plan_cancel_at_period_end = FALSE,
             plan_cancellation_requested_at = NULL
         WHERE id = $4
         RETURNING id, first_name, last_name, email, admin_role, status, plan,
           quota_seconds, plan_started_at, plan_expires_at, created_at, last_login_at`,
        [plan, quotaSeconds, planExpiresAt, req.params.id],
      );
      if (!rows[0])
        return res.status(404).json({ error: "Không tìm thấy user" });
      await writeAudit({
        actorRow: req.admin,
        action: "plan.update",
        targetType: "user",
        targetId: req.params.id,
        details: {
          plan,
          billing_cycle: billingCycle,
          quota_minutes: Math.ceil(quotaSeconds / 60),
        },
      });
      rows[0].used_seconds = 0;
      return res.json(normalizeManagedUser(rows[0]));
    } catch (error) {
      console.error("Admin update user plan error:", error);
      return res.status(500).json({ error: "Không cập nhật được gói" });
    }
  },
);

router.delete(
  "/users/:id",
  requireAdmin,
  requireMutation,
  async (req, res) => {
    try {
      if (String(req.admin.id) === String(req.params.id)) {
        return res
          .status(400)
          .json({ error: "Không thể xóa tài khoản đang đăng nhập" });
      }
      const { rows } = await pool.query(
        `UPDATE users
         SET status = 'deleted',
             account_status = 'deleted',
             admin_role = 'none',
             role = 'user',
             auth_version = auth_version + 1
         WHERE id = $1
         RETURNING id, first_name, last_name, email, admin_role, status, plan,
           quota_seconds, plan_started_at, plan_expires_at, created_at, last_login_at`,
        [req.params.id],
      );
      if (!rows[0])
        return res.status(404).json({ error: "Không tìm thấy user" });
      await revokeAllSessions(req.params.id);
      await writeAudit({
        actorRow: req.admin,
        action: "user.delete",
        targetType: "user",
        targetId: req.params.id,
        details: { status: "deleted" },
      });
      rows[0].used_seconds = 0;
      return res.json(normalizeManagedUser(rows[0]));
    } catch (error) {
      console.error("Admin delete user error:", error);
      return res.status(500).json({ error: "Không xóa được user" });
    }
  },
);

router.get("/jobs", requireAdmin, async (req, res) => {
  try {
    const page = toInt(req.query.page, 1);
    const limit = Math.min(toInt(req.query.limit, 20), 100);
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "all");
    const language = String(req.query.language || "all");
    const filters = [];
    const params = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      filters.push(
        `(LOWER('job_' || t.id) LIKE $${params.length} OR LOWER(t.filename) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length})`,
      );
    }
    if (status !== "all") {
      const statuses =
        normalizeTranscriptionStatus(status) === "queued"
          ? WAITING_JOB_STATUSES
          : [status];
      params.push(statuses);
      filters.push(`COALESCE(q.status, t.status) = ANY($${params.length}::text[])`);
    }
    if (language !== "all") {
      params.push(language);
      filters.push(`t.source_language = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT t.*, u.first_name, u.last_name, u.email,
              q.id AS queue_job_id, q.status AS queue_status,
              q.progress AS queue_progress, q.progress_stage,
              q.attempts, q.max_attempts, q.next_retry_at,
              q.timeout_seconds, q.dead_lettered, q.dead_letter_reason,
              q.recovered_at, q.timed_out_at
       FROM transcriptions t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN transcription_jobs q ON q.transcription_id = t.id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT 500`,
      params,
    );
    const combined = rows.map(normalizeJob).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );
    const start = (page - 1) * limit;
    return res.json(
      paginate(
        combined.slice(start, start + limit),
        page,
        limit,
        combined.length,
      ),
    );
  } catch (error) {
    console.error("Admin jobs error:", error);
    return res.status(500).json({ error: "Không tải được jobs" });
  }
});

router.post(
  "/jobs/:jobId/retry",
  requireAdmin,
  requireMutation,
  async (req, res) => {
    const id = String(req.params.jobId).replace(/^job_/, "");
    const { rows } = await pool.query(
      `SELECT t.*, q.id AS queue_job_id, u.first_name, u.last_name, u.email
       FROM transcriptions t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN transcription_jobs q ON q.transcription_id = t.id
       WHERE t.id = $1`,
      [id],
    );
    const job = rows[0];
    if (!job) return res.status(404).json({ error: "Không tìm thấy job" });
    if (job.status === "completed") {
      return res
        .status(400)
        .json({ error: "Không thể retry job đã hoàn thành" });
    }
    if (!job.queue_job_id) {
      return res.status(409).json({
        error: "Job cũ không còn bản ghi hàng đợi để chạy lại.",
      });
    }
    const client = await pool.connect();
    let updated;
    try {
      await client.query("BEGIN");
      updated = await client.query(
        `UPDATE transcriptions
         SET status = 'queued', error_message = NULL, completed_at = NULL
         WHERE id = $1
         RETURNING *`,
        [id],
      );
      await client.query(
        `UPDATE transcription_jobs
         SET status = 'queued', progress = 0, attempts = 0,
             progress_stage = 'queued',
             cancel_requested = FALSE, error_message = NULL,
             dead_lettered = FALSE, dead_letter_reason = NULL,
             timed_out_at = NULL, next_retry_at = NULL,
             available_at = NOW(), locked_at = NULL, lock_token = NULL,
             started_at = NULL, completed_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [job.queue_job_id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    kickTranscriptionWorker();
    await writeAudit({
      actorRow: req.admin,
      action: "transcription.retry",
      targetType: "transcription",
      targetId: req.params.jobId,
      details: { previous_status: job.status },
    });
    return res.json(
      normalizeJob({
        ...updated.rows[0],
        first_name: job.first_name,
        last_name: job.last_name,
        email: job.email,
      }),
    );
  },
);

router.post(
  "/jobs/:jobId/cancel",
  requireAdmin,
  requireMutation,
  async (req, res) => {
    const id = String(req.params.jobId).replace(/^job_/, "");
    const { rows } = await pool.query(
      `SELECT t.*, q.id AS queue_job_id, u.first_name, u.last_name, u.email
       FROM transcriptions t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN transcription_jobs q ON q.transcription_id = t.id
       WHERE t.id = $1`,
      [id],
    );
    const job = rows[0];
    if (!job) return res.status(404).json({ error: "Không tìm thấy job" });
    if (!ACTIVE_JOB_STATUSES.includes(job.status)) {
      return res
        .status(400)
        .json({ error: "Chỉ hủy job đang chờ hoặc đang xử lý" });
    }
    if (!job.queue_job_id) {
      return res.status(409).json({
        error: "Job cũ không còn bản ghi hàng đợi để hủy.",
      });
    }
    await cancelTranscriptionJobForUser(job.queue_job_id, job.user_id);
    const updated = await pool.query(
      `SELECT * FROM transcriptions WHERE id = $1`,
      [id],
    );
    await writeAudit({
      actorRow: req.admin,
      action: "transcription.cancel",
      targetType: "transcription",
      targetId: req.params.jobId,
      details: { previous_status: job.status },
    });
    return res.json(
      normalizeJob({
        ...updated.rows[0],
        first_name: job.first_name,
        last_name: job.last_name,
        email: job.email,
      }),
    );
  },
);

router.get("/files", requireAdmin, async (req, res) => {
  try {
    const page = toInt(req.query.page, 1);
    const limit = Math.min(toInt(req.query.limit, 20), 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const fileType = String(req.query.fileType || "all");
    const storageStatus = String(req.query.storageStatus || "all");
    const transcriptionStatus = String(req.query.transcriptionStatus || "all");
    const filters = [];
    const params = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      filters.push(
        `(LOWER('file_' || t.id) LIKE $${params.length} OR LOWER(t.filename) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length})`,
      );
    }
    if (transcriptionStatus !== "all") {
      params.push(transcriptionStatus);
      filters.push(`t.status = $${params.length}`);
    }
    if (fileType === "audio")
      filters.push(`t.filename !~* '\\.(mp4|mov|avi|mkv|webm)$'`);
    if (fileType === "video")
      filters.push(`t.filename ~* '\\.(mp4|mov|avi|mkv|webm)$'`);
    if (storageStatus === "available")
      filters.push(`t.audio_filename IS NOT NULL`);
    if (storageStatus === "missing") filters.push(`t.audio_filename IS NULL`);
    if (storageStatus === "error") filters.push(`t.error_message IS NOT NULL`);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT t.*, u.first_name, u.last_name, u.email
       FROM transcriptions t
       JOIN users u ON u.id = t.user_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const totalResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM transcriptions t JOIN users u ON u.id = t.user_id ${where}`,
      params,
    );
    return res.json(
      paginate(rows.map(normalizeFile), page, limit, totalResult.rows[0].count),
    );
  } catch (error) {
    console.error("Admin files error:", error);
    return res.status(500).json({ error: "Không tải được files" });
  }
});

router.get("/files/:fileId/jobs", requireAdmin, async (req, res) => {
  const id = String(req.params.fileId).replace(/^file_/, "");
  const { rows } = await pool.query(
    `SELECT t.*, u.first_name, u.last_name, u.email
     FROM transcriptions t JOIN users u ON u.id = t.user_id WHERE t.id = $1`,
    [id],
  );
  return res.json(rows.map(normalizeJob));
});

router.get("/files/:fileId/media", requireAdmin, async (req, res) => {
  const id = String(req.params.fileId).replace(/^file_/, "");
  const { rows } = await pool.query(
    "SELECT audio_filename FROM transcriptions WHERE id = $1",
    [id],
  );
  if (!rows[0]?.audio_filename)
    return res.status(404).json({ error: "Không có file media" });
  const filePath = path.join(UPLOADS_DIR, rows[0].audio_filename);
  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: "File media không tồn tại" });
  return res.sendFile(filePath);
});

router.delete(
  "/files/:fileId",
  requireAdmin,
  requireMutation,
  async (req, res) => {
    const id = String(req.params.fileId).replace(/^file_/, "");
    const { rows } = await pool.query(
      "SELECT audio_filename FROM transcriptions WHERE id = $1",
      [id],
    );
    const result = await pool.query(
      "DELETE FROM transcriptions WHERE id = $1 RETURNING id",
      [id],
    );
    if (!result.rows[0])
      return res.status(404).json({ error: "Không tìm thấy file" });
    if (rows[0]?.audio_filename)
      fs.unlink(path.join(UPLOADS_DIR, rows[0].audio_filename), () => {});
    await writeAudit({
      actorRow: req.admin,
      action: "file.delete",
      targetType: "file",
      targetId: req.params.fileId,
      details: { deleted: true },
    });
    return res.json({ success: true });
  },
);

router.get("/usage", requireAdmin, async (_req, res) => {
  const [daily, users] = await Promise.all([
    pool.query(`
      SELECT to_char(day, 'YYYY-MM-DD') AS date,
        COALESCE(SUM(web_minutes), 0)::float AS web_minutes,
        COALESCE(SUM(api_minutes), 0)::float AS api_minutes
      FROM (
        SELECT generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
      ) days
      LEFT JOIN (
        SELECT DATE(created_at) AS usage_day,
          CASE WHEN COALESCE(filename, '') LIKE 'api-%' THEN 0 ELSE CEIL(COALESCE(duration, 0) / 60.0) END AS web_minutes,
          CASE WHEN COALESCE(filename, '') LIKE 'api-%' THEN CEIL(COALESCE(duration, 0) / 60.0) ELSE 0 END AS api_minutes
        FROM transcriptions WHERE status = 'completed'
      ) usage ON usage.usage_day = days.day
      GROUP BY day ORDER BY day
    `),
    pool.query(`
      ${userSelectSql()}
      GROUP BY u.id
      ORDER BY used_seconds DESC
      LIMIT 50
    `),
  ]);
  const byUser = users.rows.map(normalizeManagedUser);
  return res.json({
    total_processed_minutes: byUser.reduce(
      (sum, user) => sum + user.used_minutes,
      0,
    ),
    daily: daily.rows,
    by_user: byUser.map((user) => ({
      user_id: user.id,
      name: user.name,
      email: user.email,
      used_minutes: user.used_minutes,
      quota_minutes: user.quota_minutes,
    })),
    low_quota_users: byUser.filter(
      (user) => user.quota_minutes - user.used_minutes <= 60,
    ),
  });
});

router.get("/support/tickets", requireAdmin, async (req, res) => {
  const page = toInt(req.query.page, 1);
  const limit = Math.min(toInt(req.query.limit, 10), 100);
  const offset = (page - 1) * limit;
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "all");
  const category = String(req.query.category || "").trim();
  const filters = [];
  const params = [];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    filters.push(
      `(LOWER(COALESCE(t.subject, '')) LIKE $${params.length}
        OR LOWER(COALESCE(t.email, u.email, '')) LIKE $${params.length}
        OR LOWER(COALESCE(t.name, u.first_name || ' ' || u.last_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(latest.message, '')) LIKE $${params.length})`,
    );
  }
  if (status !== "all" && SUPPORT_STATUSES.has(status)) {
    params.push(status);
    filters.push(`t.status = $${params.length}`);
  }
  if (category && category !== "all") {
    params.push(category.toLowerCase());
    filters.push(`LOWER(t.category) = $${params.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const baseSql = `
    FROM support_tickets t
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN LATERAL (
      SELECT message
      FROM support_messages m
      WHERE m.ticket_id = t.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ) latest ON TRUE
    ${where}
  `;

  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.user_id, t.name, COALESCE(t.email, u.email) AS email,
              u.first_name, u.last_name, t.subject, t.category, t.priority,
              t.status, t.page_url, t.user_plan, latest.message AS latest_message,
              t.created_at, t.updated_at
       ${baseSql}
       ORDER BY t.updated_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const totalResult = await pool.query(
      `SELECT COUNT(*)::int AS count ${baseSql}`,
      params,
    );
    return res.json(
      paginate(
        rows.map(normalizeSupportTicket),
        page,
        limit,
        totalResult.rows[0].count,
      ),
    );
  } catch (error) {
    console.error("Admin support list error:", error);
    return res.status(500).json({ error: "Không tải được phản hồi hỗ trợ" });
  }
});

router.get("/support/tickets/:id/messages", requireAdmin, async (req, res) => {
  const ticketId = Number(req.params.id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: "Ticket không hợp lệ" });
  }

  try {
    const ticket = await pool.query("SELECT id FROM support_tickets WHERE id = $1", [
      ticketId,
    ]);
    if (ticket.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy ticket" });
    }

    const { rows } = await pool.query(
      `SELECT id, ticket_id, sender, message, created_at
       FROM support_messages
       WHERE ticket_id = $1
       ORDER BY created_at ASC`,
      [ticketId],
    );
    return res.json({ messages: rows.map(normalizeSupportMessage) });
  } catch (error) {
    console.error("Admin support messages error:", error);
    return res.status(500).json({ error: "Không tải được hội thoại hỗ trợ" });
  }
});

router.post(
  "/support/tickets/:id/messages",
  requireAdmin,
  requireSupportMutation,
  async (req, res) => {
    const ticketId = Number(req.params.id);
    const message = String(req.body.message || "").trim();

    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return res.status(400).json({ error: "Ticket không hợp lệ" });
    }
    if (message.length < 2 || message.length > 10_000) {
      return res.status(400).json({ error: "Vui lòng nhập nội dung phản hồi" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id FROM support_tickets WHERE id = $1 FOR UPDATE",
        [ticketId],
      );
      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Không tìm thấy ticket" });
      }

      const messageResult = await client.query(
        `INSERT INTO support_messages (ticket_id, sender, message)
         VALUES ($1, 'admin', $2)
         RETURNING id, ticket_id, sender, message, created_at`,
        [ticketId, message],
      );
      const ticketResult = await client.query(
        `UPDATE support_tickets
         SET updated_at = NOW(), status = 'pending'
         WHERE id = $1
         RETURNING *`,
        [ticketId],
      );
      await client.query("COMMIT");

      await writeAudit({
        actorRow: req.admin,
        action: "support.reply",
        targetType: "support",
        targetId: ticketId,
        details: { ticket_id: ticketId },
      });

      return res.status(201).json({
        ticket: normalizeSupportTicket({
          ...ticketResult.rows[0],
          latest_message: message,
        }),
        message: normalizeSupportMessage(messageResult.rows[0]),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Admin support reply error:", error);
      return res.status(500).json({ error: "Không gửi được phản hồi" });
    } finally {
      client.release();
    }
  },
);

router.patch(
  "/support/tickets/:id/status",
  requireAdmin,
  (req, res, next) => {
    if (!canUpdateSupportStatusRole(req.admin.admin_role)) {
      return res
        .status(403)
        .json({ error: "Bạn không có quyền cập nhật trạng thái hỗ trợ" });
    }
    next();
  },
  async (req, res) => {
    const ticketId = Number(req.params.id);
    const status = String(req.body.status || "").trim();

    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return res.status(400).json({ error: "Ticket không hợp lệ" });
    }
    if (!SUPPORT_STATUSES.has(status)) {
      return res.status(400).json({ error: "Trạng thái hỗ trợ không hợp lệ" });
    }

    try {
      const { rows } = await pool.query(
        `UPDATE support_tickets
         SET status = $1,
             updated_at = NOW(),
             resolved_at = CASE WHEN $1 IN ('resolved', 'closed') THEN NOW() ELSE NULL END
         WHERE id = $2
         RETURNING *`,
        [status, ticketId],
      );
      if (!rows[0]) {
        return res.status(404).json({ error: "Không tìm thấy ticket" });
      }

      await writeAudit({
        actorRow: req.admin,
        action: "support.status_update",
        targetType: "support",
        targetId: ticketId,
        details: { status },
      });

      return res.json(normalizeSupportTicket(rows[0]));
    } catch (error) {
      console.error("Admin support status error:", error);
      return res.status(500).json({ error: "Không cập nhật được trạng thái" });
    }
  },
);

router.get("/audit-logs", requireAdmin, async (req, res) => {
  const page = toInt(req.query.page, 1);
  const limit = Math.min(toInt(req.query.limit, 20), 100);
  const offset = (page - 1) * limit;
  const search = String(req.query.search || "").trim();
  const action = String(req.query.action || "all");
  const actor = String(req.query.actor || "").trim();
  const filters = [];
  const params = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    filters.push(
      `(LOWER(actor) LIKE $${params.length} OR LOWER(target_id) LIKE $${params.length} OR LOWER(action) LIKE $${params.length})`,
    );
  }
  if (action !== "all") {
    params.push(action);
    filters.push(`action = $${params.length}`);
  }
  if (actor) {
    params.push(`%${actor.toLowerCase()}%`);
    filters.push(`LOWER(actor) LIKE $${params.length}`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT id::text, actor, action, target_type, target_id, details, created_at
     FROM audit_logs ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM audit_logs ${where}`,
    params,
  );
  return res.json(paginate(rows, page, limit, totalResult.rows[0].count));
});

router.get("/settings", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'global'",
  );
  return res.json({ ...defaultAdminSettings(), ...(rows[0]?.value || {}) });
});

router.put("/settings", requireAdmin, requireAdminManagement, async (req, res) => {
  const settings = req.body || {};
  await pool.query(
    `INSERT INTO admin_settings (key, value, updated_by, updated_at)
     VALUES ('global', $1::jsonb, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [JSON.stringify(settings), req.admin.id],
  );
  await writeAudit({
    actorRow: req.admin,
    action: "settings.update",
    targetType: "settings",
    targetId: "global",
    details: settings,
  });
  return res.json(settings);
});

function normalizePlan(row) {
  return {
    id: String(row.id),
    code: row.code,
    name: row.name,
    quota_minutes: Number(row.quota_minutes || 0),
    price_vnd: Number(row.price_vnd || 0),
    billing_cycle: row.billing_cycle || "monthly",
    max_upload_mb: Number(row.max_upload_mb || 0),
    max_file_duration_minutes: Number(row.max_file_duration_minutes || 0),
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeProvider(row) {
  return {
    id: String(row.id),
    name: row.name,
    code: row.code,
    api_key_masked: row.api_key_encrypted ? "••••••••" : "",
    endpoint: row.endpoint,
    enabled: Boolean(row.enabled),
    is_default: Boolean(row.is_default),
    routing_mode: row.routing_mode || "auto",
    routing_rules: row.routing_rules || {},
    failover_provider_id: row.failover_provider_id
      ? String(row.failover_provider_id)
      : null,
    health_status: row.health_status || "unknown",
    success_rate: Number(row.success_rate || 0),
    avg_latency_ms: Number(row.avg_latency_ms || 0),
    cost_per_minute_usd: Number(row.cost_per_minute_usd || 0),
    monthly_cost_usd: Number(row.monthly_cost_usd || 0),
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeProviderApiKey(value) {
  const apiKey = String(value || "").trim();
  return apiKey ? encryptProviderSecret(apiKey) : null;
}

router.get("/plans", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM service_plans ORDER BY price_vnd ASC, id ASC",
  );
  return res.json(rows.map(normalizePlan));
});

router.put("/plans/:id", requireAdmin, requireAdminManagement, async (req, res) => {
  const body = req.body || {};
  const { rows } = await pool.query(
    `UPDATE service_plans
     SET name = $1,
         quota_minutes = $2,
         price_vnd = $3,
         billing_cycle = $4,
         max_upload_mb = $5,
         max_file_duration_minutes = $6,
         enabled = $7,
         updated_at = NOW()
     WHERE id = $8
     RETURNING *`,
    [
      String(body.name || "").trim(),
      Number(body.quota_minutes || 0),
      Number(body.price_vnd || 0),
      String(body.billing_cycle || "monthly"),
      Number(body.max_upload_mb || 0),
      Number(body.max_file_duration_minutes || 0),
      Boolean(body.enabled),
      req.params.id,
    ],
  );
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy gói" });
  await writeAudit({
    actorRow: req.admin,
    action: "plan.update",
    targetType: "settings",
    targetId: rows[0].code,
    details: normalizePlan(rows[0]),
  });
  return res.json(normalizePlan(rows[0]));
});

router.get("/providers", requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM stt_providers ORDER BY id ASC",
    );
    return res.json(rows.map(normalizeProvider));
  } catch (error) {
    console.error("Admin providers list error:", error.message);
    return res.status(500).json({ error: "Không tải được nhà cung cấp" });
  }
});

router.put(
  "/providers/:id",
  requireAdmin,
  requireAdminManagement,
  async (req, res) => {
    const client = await pool.connect();
    try {
      const providerId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(providerId) || providerId <= 0) {
        return res.status(400).json({ error: "ID nhà cung cấp không hợp lệ" });
      }

      const body = req.body || {};
      const name = String(body.name || "").trim();
      const endpoint = String(body.endpoint || "").trim().replace(/\/$/, "");
      const routingMode = String(body.routing_mode || "auto");
      const routingRules =
        body.routing_rules &&
        typeof body.routing_rules === "object" &&
        !Array.isArray(body.routing_rules)
          ? body.routing_rules
          : {};
      const failoverProviderId = body.failover_provider_id
        ? Number.parseInt(String(body.failover_provider_id), 10)
        : null;
      const costPerMinute = Number(body.cost_per_minute_usd || 0);
      const monthlyCost = Number(body.monthly_cost_usd || 0);
      const isDefault = Boolean(body.is_default);
      const apiKey = normalizeProviderApiKey(body.api_key);

      if (!name) {
        return res.status(400).json({ error: "Tên nhà cung cấp không hợp lệ" });
      }
      if (!/^https?:\/\//i.test(endpoint)) {
        return res.status(400).json({ error: "Endpoint provider phải là URL http/https" });
      }
      if (!["manual", "auto", "rule_based"].includes(routingMode)) {
        return res.status(400).json({ error: "Chế độ định tuyến không hợp lệ" });
      }
      if (body.failover_provider_id && !Number.isFinite(failoverProviderId)) {
        return res.status(400).json({ error: "ID provider dự phòng không hợp lệ" });
      }
      if (!Number.isFinite(costPerMinute) || costPerMinute < 0) {
        return res.status(400).json({ error: "Chi phí provider không hợp lệ" });
      }
      if (!Number.isFinite(monthlyCost) || monthlyCost < 0) {
        return res.status(400).json({ error: "Chi phí tháng không hợp lệ" });
      }

      await client.query("BEGIN");
      if (isDefault) {
        await client.query("UPDATE stt_providers SET is_default = FALSE");
      }
      const { rows } = await client.query(
        `UPDATE stt_providers
       SET name = $1,
           endpoint = $2,
           enabled = $3,
           is_default = $4,
           routing_mode = $5,
           routing_rules = $6::jsonb,
           failover_provider_id = $7,
           cost_per_minute_usd = $8,
           monthly_cost_usd = $9,
           api_key_encrypted = COALESCE($10, api_key_encrypted),
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
        [
          name,
          endpoint,
          Boolean(body.enabled),
          isDefault,
          routingMode,
          JSON.stringify(routingRules),
          failoverProviderId,
          costPerMinute,
          monthlyCost,
          apiKey,
          providerId,
        ],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Không tìm thấy provider" });
      }
      await writeAudit({
        actorRow: req.admin,
        action: "provider.update",
        targetType: "settings",
        targetId: rows[0].code,
        details: normalizeProvider(rows[0]),
      });
      await client.query("COMMIT");
      return res.json(normalizeProvider(rows[0]));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Admin provider update error:", error.message);
      return res
        .status(500)
        .json({ error: error.message || "Không lưu được nhà cung cấp" });
    } finally {
      client.release();
    }
  },
);

router.post(
  "/providers/:id/health",
  requireAdmin,
  requireMutation,
  async (req, res) => {
    try {
      const providerId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(providerId) || providerId <= 0) {
        return res
          .status(400)
          .json({ error: "ID nhà cung cấp không hợp lệ" });
      }

      const providerResult = await pool.query(
        "SELECT code, enabled, api_key_encrypted FROM stt_providers WHERE id = $1",
        [providerId],
      );
      const provider = providerResult.rows[0];
      if (!provider) {
        return res.status(404).json({ error: "Không tìm thấy nhà cung cấp" });
      }

      const envConfigured = isTranscriptionProviderConfigured(provider.code);
      const hasCmsKey = Boolean(provider.api_key_encrypted);
      const enabled = Boolean(provider.enabled);
      const healthStatus = !enabled
        ? "down"
        : hasCmsKey || envConfigured
          ? "healthy"
          : "down";
      const latency = healthStatus === "healthy" ? 0 : null;
      const { rows } = await pool.query(
        `UPDATE stt_providers
       SET health_status = $1,
           avg_latency_ms = $2,
           success_rate = CASE WHEN $1 = 'healthy' THEN 100 ELSE 0 END,
           last_checked_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
        [healthStatus, latency, providerId],
      );
      if (!rows[0])
        return res.status(404).json({ error: "Không tìm thấy nhà cung cấp" });
      return res.json(normalizeProvider(rows[0]));
    } catch (error) {
      console.error("Admin provider health error:", error);
      return res
        .status(500)
        .json({ error: "Không kiểm tra được trạng thái nhà cung cấp" });
    }
  },
);

async function getReportSummary() {
  const [users, jobs, audio, quota, revenue, performance, usage, providers] =
    await Promise.all([
      pool.query(`
        SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended
        FROM users
      `),
      pool.query(`
        SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
        FROM transcriptions
      `),
      pool.query(`
        SELECT COUNT(*)::int AS files,
          COALESCE(CEIL(SUM(COALESCE(duration, 0)) / 60.0), 0)::int AS processed_minutes
        FROM transcriptions WHERE status = 'completed'
      `),
      pool.query(`
        SELECT COALESCE(CEIL(SUM(quota_seconds) / 60.0), 0)::int AS allocated_minutes
        FROM users
      `),
      pool.query(`
        SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::int AS total_vnd,
          COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_orders
        FROM billing_orders
      `),
      pool.query(`
        SELECT COALESCE(AVG(processing_seconds), 0)::float AS average_processing_time
        FROM transcriptions WHERE processing_seconds IS NOT NULL
      `),
      pool.query(`
        SELECT to_char(day, 'YYYY-MM-DD') AS date,
          COALESCE(SUM(web_minutes), 0)::float AS web_minutes,
          COALESCE(SUM(api_minutes), 0)::float AS api_minutes
        FROM (
          SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
        ) days
        LEFT JOIN (
          SELECT DATE(created_at) AS usage_day,
            CASE WHEN COALESCE(filename, '') LIKE 'api-%' THEN 0 ELSE CEIL(COALESCE(duration, 0) / 60.0) END AS web_minutes,
            CASE WHEN COALESCE(filename, '') LIKE 'api-%' THEN CEIL(COALESCE(duration, 0) / 60.0) ELSE 0 END AS api_minutes
          FROM transcriptions WHERE status = 'completed'
        ) usage ON usage.usage_day = days.day
        GROUP BY day ORDER BY day
      `),
      pool.query(
        "SELECT COALESCE(AVG(avg_latency_ms), 0)::float AS average_latency_ms FROM stt_providers WHERE enabled = TRUE",
      ),
    ]);
  const jobRow = jobs.rows[0];
  const terminal = Number(jobRow.completed || 0) + Number(jobRow.failed || 0);
  const usedMinutes = Number(audio.rows[0].processed_minutes || 0);
  return {
    users: users.rows[0],
    jobs: {
      total: Number(jobRow.total || 0),
      completed: Number(jobRow.completed || 0),
      failed: Number(jobRow.failed || 0),
      success_rate: terminal
        ? Math.round((Number(jobRow.completed || 0) / terminal) * 100)
        : 0,
    },
    audio: audio.rows[0],
    quota: {
      allocated_minutes: Number(quota.rows[0].allocated_minutes || 0),
      used_minutes: usedMinutes,
    },
    revenue: revenue.rows[0],
    performance: {
      average_processing_time: Math.round(
        Number(performance.rows[0].average_processing_time || 0),
      ),
      average_latency_ms: Math.round(
        Number(providers.rows[0].average_latency_ms || 0),
      ),
    },
    daily_usage: usage.rows,
  };
}

router.get("/reports/summary", requireAdmin, async (_req, res) => {
  return res.json(await getReportSummary());
});

router.get("/reports/export", requireAdmin, async (_req, res) => {
  const report = await getReportSummary();
  const lines = [
    "metric,value",
    `users_total,${report.users.total}`,
    `jobs_total,${report.jobs.total}`,
    `audio_processed_minutes,${report.audio.processed_minutes}`,
    `quota_used_minutes,${report.quota.used_minutes}`,
    `revenue_vnd,${report.revenue.total_vnd}`,
    `success_rate,${report.jobs.success_rate}`,
    `avg_processing_time,${report.performance.average_processing_time}`,
  ];
  return res.json({
    filename: `cms-report-${new Date().toISOString().slice(0, 10)}.csv`,
    content: lines.join("\n"),
  });
});

router.get("/system/status", requireAdmin, async (_req, res) => {
  const [providers, queue] = await Promise.all([
    pool.query(
      "SELECT code, health_status, enabled FROM stt_providers ORDER BY id ASC",
    ),
    pool.query(
      `SELECT
         COUNT(*)::integer AS total,
         COUNT(*) FILTER (WHERE status = ANY($1::text[]))::integer AS queued,
         COUNT(*) FILTER (WHERE status = 'processing')::integer AS active,
         COUNT(*) FILTER (WHERE dead_lettered = TRUE)::integer AS dead_lettered,
         COUNT(*) FILTER (WHERE status = 'queued' AND next_retry_at IS NOT NULL)::integer AS retry_waiting
       FROM transcription_jobs`,
      [WAITING_JOB_STATUSES],
    ),
  ]);
  return res.json({
    database: "ok",
    backend: "ok",
    transcription_queue: {
      concurrency: Number.parseInt(
        process.env.TRANSCRIPTION_QUEUE_CONCURRENCY || "2",
        10,
      ),
      total: Number(queue.rows[0]?.total || 0),
      queued: Number(queue.rows[0]?.queued || 0),
      active: Number(queue.rows[0]?.active || 0),
      retry_waiting: Number(queue.rows[0]?.retry_waiting || 0),
      dead_lettered: Number(queue.rows[0]?.dead_lettered || 0),
    },
    providers: providers.rows,
    generated_at: new Date().toISOString(),
  });
});

module.exports = router;
