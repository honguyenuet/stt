require("../config/env");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const pool = require("../db");
const { encryptProviderSecret } = require("../services/providerSecrets");
const { checkProviderHealth } = require("../services/providerHealthService");
const { resolveStoredAudioPath } = require("../services/transcriptionService");
const {
  getAdminSettings,
  saveAdminSettings,
} = require("../services/adminSettingsService");
const {
  updateManagedUserRole,
  updateManagedUserStatus,
} = require("../services/adminUserService");
const {
  cancelTranscriptionJobForUser,
  kickTranscriptionWorker,
  retryTranscriptionJobForAdmin,
} = require("../services/transcriptionQueue");
const {
  ADMIN_ROLES,
  getEffectiveAdminRole,
  isAdminAccountActive,
} = require("../services/adminAccess");
const { requireAuth } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/security");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
const ADMIN_TOKEN_TTL = "8h";

const MUTATION_ROLES = new Set(["super_admin", "admin"]);

function createAdminError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function generateToken(user) {
  const adminRole = getEffectiveAdminRole(user);
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      adminRole,
      scope: "admin",
    },
    JWT_SECRET,
    { expiresIn: ADMIN_TOKEN_TTL },
  );
}

function readBearerToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
}

function normalizeAdminUser(row) {
  const role = getEffectiveAdminRole(row) || "viewer";
  return {
    id: String(row.id),
    name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
    email: row.email,
    role,
  };
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
    if (
      !user ||
      !isAdminAccountActive(user) ||
      !getEffectiveAdminRole(user)
    ) {
      return res.status(403).json({ error: "Tài khoản admin không hợp lệ" });
    }

    req.admin = {
      ...user,
      admin_role: getEffectiveAdminRole(user),
    };
    next();
  } catch {
    return res
      .status(401)
      .json({ error: "Token admin không hợp lệ hoặc đã hết hạn" });
  }
}

function requireMutation(req, res, next) {
  if (!MUTATION_ROLES.has(req.admin.admin_role)) {
    return res
      .status(403)
      .json({ error: "Bạn không có quyền thực hiện thao tác này" });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.admin.admin_role !== "super_admin") {
    return res
      .status(403)
      .json({ error: "Chỉ super_admin được thực hiện thao tác này" });
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
      u.quota_seconds, u.created_at, u.last_login_at,
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
    role: getEffectiveAdminRole(row) || "viewer",
    status: isAdminAccountActive(row) ? "active" : "suspended",
    quota_minutes: Math.ceil(Number(row.quota_seconds || 0) / 60),
    used_minutes: Math.ceil(Number(row.used_seconds || 0) / 60),
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

function createAdminSession(user) {
  const adminRole = getEffectiveAdminRole(user);
  if (!adminRole) return null;
  const sessionUser = { ...user, admin_role: adminRole };
  return {
    token: generateToken(sessionUser),
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    user: normalizeAdminUser(sessionUser),
  };
}

async function getManagedUserById(userId) {
  const { rows } = await pool.query(
    `${userSelectSql()}
     WHERE u.id = $1
     GROUP BY u.id
     LIMIT 1`,
    [userId],
  );
  return rows[0] ? normalizeManagedUser(rows[0]) : null;
}

function normalizeJob(row) {
  const status = row.status || "completed";
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
    transcription_status: row.status || "completed",
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
    const session = createAdminSession({ ...user, admin_role: adminRole });
    return res.json(session);
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({ error: "Không đăng nhập được admin" });
  }
});

router.post("/auth/exchange", requireAuth, async (req, res) => {
  try {
    if (!isAdminAccountActive(req.user)) {
      return res.status(403).json({ error: "Tài khoản quản trị đã bị khóa" });
    }
    const session = createAdminSession(req.user);
    if (!session) {
      return res
        .status(403)
        .json({ error: "Tài khoản chưa được cấp quyền truy cập CMS" });
    }
    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
      req.user.id,
    ]);
    return res.json(session);
  } catch (error) {
    console.error("Admin session exchange error:", error);
    return res.status(500).json({ error: "Không thể mở phiên quản trị" });
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
      if (Object.prototype.hasOwnProperty.call(jobsByStatus, row.status)) {
        jobsByStatus[row.status] = row.count;
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
      params.push(role);
      filters.push(
        `(u.admin_role = $${params.length} OR
          (u.admin_role = 'none' AND u.role = $${params.length}))`,
      );
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
      if (
        status === "suspended" &&
        String(req.params.id) === String(req.admin.id)
      ) {
        return res
          .status(400)
          .json({ error: "Bạn không thể khóa chính tài khoản đang đăng nhập" });
      }
      if (status === "suspended") {
        const target = await pool.query(
          `SELECT admin_role FROM users WHERE id = $1`,
          [req.params.id],
        );
        if (target.rows[0]?.admin_role === "super_admin") {
          const activeSuperAdmins = await pool.query(
            `SELECT COUNT(*)::integer AS count
             FROM users
             WHERE admin_role = 'super_admin'
               AND status = 'active'
               AND account_status = 'active'`,
          );
          if (Number(activeSuperAdmins.rows[0]?.count || 0) <= 1) {
            return res.status(400).json({
              error: "Không thể khóa quản trị viên cao nhất cuối cùng",
            });
          }
        }
      }
      const updatedUser = await updateManagedUserStatus(
        pool,
        req.params.id,
        status,
      );
      if (!updatedUser)
        return res.status(404).json({ error: "Không tìm thấy user" });
      await writeAudit({
        actorRow: req.admin,
        action: status === "active" ? "user.activate" : "user.suspend",
        targetType: "user",
        targetId: req.params.id,
        details: { status },
      });
      return res.json(await getManagedUserById(updatedUser.id));
    } catch (error) {
      console.error("Admin update user status error:", error);
      return res.status(500).json({ error: "Không cập nhật được user" });
    }
  },
);

router.patch(
  "/users/:id/role",
  requireAdmin,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const role = String(req.body.role || "");
      if (!ADMIN_ROLES.has(role))
        return res.status(400).json({ error: "Role không hợp lệ" });
      if (
        role !== "super_admin" &&
        String(req.params.id) === String(req.admin.id)
      ) {
        return res.status(400).json({
          error: "Bạn không thể tự hạ quyền của tài khoản đang đăng nhập",
        });
      }
      if (role !== "super_admin") {
        const target = await pool.query(
          "SELECT admin_role FROM users WHERE id = $1",
          [req.params.id],
        );
        if (target.rows[0]?.admin_role === "super_admin") {
          const superAdmins = await pool.query(
            `SELECT COUNT(*)::integer AS count
             FROM users
             WHERE admin_role = 'super_admin'
               AND status = 'active'
               AND account_status = 'active'`,
          );
          if (Number(superAdmins.rows[0]?.count || 0) <= 1) {
            return res.status(400).json({
              error: "Hệ thống phải còn ít nhất một quản trị viên cao nhất",
            });
          }
        }
      }
      const updatedUser = await updateManagedUserRole(
        pool,
        req.params.id,
        role,
      );
      if (!updatedUser)
        return res.status(404).json({ error: "Không tìm thấy user" });
      await writeAudit({
        actorRow: req.admin,
        action: "user.role_update",
        targetType: "user",
        targetId: req.params.id,
        details: { role },
      });
      return res.json(await getManagedUserById(updatedUser.id));
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
      const deltaMinutes = Number(req.body.deltaMinutes);
      const reason = String(req.body.reason || "").trim().slice(0, 500);
      if (
        !Number.isFinite(deltaMinutes) ||
        deltaMinutes === 0 ||
        Math.abs(deltaMinutes) > 100_000
      ) {
        return res.status(400).json({ error: "Quota thay đổi phải khác 0" });
      }
      if (!reason)
        return res
          .status(400)
          .json({ error: "Vui lòng nhập lý do điều chỉnh quota" });

      const { rows } = await pool.query(
        `UPDATE users
         SET quota_seconds = quota_seconds + $1
         WHERE id = $2
           AND quota_seconds + $1 >= 0
         RETURNING id, first_name, last_name, email, admin_role, status,
           quota_seconds, created_at, last_login_at`,
        [Math.round(deltaMinutes * 60), req.params.id],
      );
      if (!rows[0]) {
        const exists = await pool.query("SELECT id FROM users WHERE id = $1", [
          req.params.id,
        ]);
        return res.status(exists.rows[0] ? 400 : 404).json({
          error: exists.rows[0]
            ? "Quota không được âm"
            : "Không tìm thấy user",
        });
      }
      await writeAudit({
        actorRow: req.admin,
        action: "quota.adjust",
        targetType: "quota",
        targetId: req.params.id,
        details: { delta_minutes: deltaMinutes, reason },
      });
      return res.json(await getManagedUserById(rows[0].id));
    } catch (error) {
      console.error("Admin quota error:", error);
      return res.status(500).json({ error: "Không điều chỉnh được quota" });
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
      params.push(status);
      filters.push(`t.status = $${params.length}`);
    }
    if (language !== "all") {
      params.push(language);
      filters.push(`t.source_language = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT t.*, u.first_name, u.last_name, u.email
       FROM transcriptions t
       JOIN users u ON u.id = t.user_id
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
    try {
      const result = await retryTranscriptionJobForAdmin(id);
      void kickTranscriptionWorker();
      await writeAudit({
        actorRow: req.admin,
        action: "transcription.retry",
        targetType: "transcription",
        targetId: req.params.jobId,
        details: {
          previous_status: result.original.status,
          queue_job_id: result.queueJobId,
          recreated_queue_job: result.recreatedQueueJob,
        },
      });
      return res.json(
        normalizeJob({
          ...result.transcription,
          first_name: result.original.first_name,
          last_name: result.original.last_name,
          email: result.original.email,
        }),
      );
    } catch (error) {
      console.error("Admin retry job error:", error);
      return res
        .status(error.statusCode || 500)
        .json({ error: error.message || "Không thể chạy lại job" });
    }
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
    if (!["queued", "processing"].includes(job.status)) {
      return res
        .status(400)
        .json({ error: "Chỉ hủy job queued hoặc processing" });
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
  let filePath;
  try {
    filePath = resolveStoredAudioPath(rows[0].audio_filename);
  } catch {
    return res.status(400).json({ error: "Đường dẫn media không hợp lệ" });
  }
  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: "File media không tồn tại" });
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", "inline");
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
    if (rows[0]?.audio_filename) {
      try {
        fs.unlink(resolveStoredAudioPath(rows[0].audio_filename), () => {});
      } catch {
        // The database record is removed even when the legacy media path is invalid.
      }
    }
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
  return res.json(await getAdminSettings());
});

router.put("/settings", requireAdmin, requireSuperAdmin, async (req, res) => {
  const settings = await saveAdminSettings(req.body || {}, req.admin.id);
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

function planInteger(value, field, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw createAdminError(
      400,
      `${field} phải là số nguyên từ ${min} đến ${max}`,
    );
  }
  return parsed;
}

function normalizePlanUpdate(body, currentPlan) {
  const billingCycle = String(body.billing_cycle || "monthly")
    .trim()
    .toLowerCase();
  if (!["monthly", "custom"].includes(billingCycle)) {
    throw createAdminError(400, "Chu kỳ gói phải là monthly hoặc custom");
  }
  const name = String(body.name || "").trim();
  if (!name || name.length > 120) {
    throw createAdminError(400, "Tên gói phải có từ 1 đến 120 ký tự");
  }
  const enabled =
    currentPlan.code === "free" ? true : Boolean(body.enabled);
  const price = planInteger(
    body.price_vnd,
    "Giá gói",
    currentPlan.code === "free" ? 0 : 1,
    2_000_000_000,
  );
  if (currentPlan.code === "free" && price !== 0) {
    throw createAdminError(400, "Gói Free phải có giá bằng 0");
  }
  return {
    name,
    quotaMinutes: planInteger(
      body.quota_minutes,
      "Quota",
      1,
      10_000_000,
    ),
    priceVnd: price,
    billingCycle,
    maxUploadMb: planInteger(
      body.max_upload_mb,
      "Dung lượng tải lên",
      1,
      2048,
    ),
    maxFileDurationMinutes: planInteger(
      body.max_file_duration_minutes,
      "Thời lượng file",
      1,
      24 * 60,
    ),
    enabled,
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

function normalizeProviderEndpoint(code, value) {
  const allowedHosts = {
    assemblyai: ["assemblyai.com"],
    deepgram: ["deepgram.com"],
    sonix: ["sonix.ai"],
    vbee: ["vbeelabs.ai", "vbee.vn"],
  };
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw createAdminError(400, "Endpoint nhà cung cấp không hợp lệ");
  }
  const hostname = url.hostname.toLowerCase();
  const allowed = (allowedHosts[code] || []).some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
  if (url.protocol !== "https:" || !allowed || url.username || url.password) {
    throw createAdminError(
      400,
      "Endpoint phải dùng HTTPS và đúng tên miền chính thức của provider",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

router.get("/plans", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM service_plans ORDER BY price_vnd ASC, id ASC",
  );
  return res.json(rows.map(normalizePlan));
});

router.put("/plans/:id", requireAdmin, requireSuperAdmin, async (req, res) => {
  const current = await pool.query(
    "SELECT * FROM service_plans WHERE id = $1",
    [req.params.id],
  );
  if (!current.rows[0]) {
    return res.status(404).json({ error: "Không tìm thấy gói" });
  }
  const body = normalizePlanUpdate(req.body || {}, current.rows[0]);
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
      body.name,
      body.quotaMinutes,
      body.priceVnd,
      body.billingCycle,
      body.maxUploadMb,
      body.maxFileDurationMinutes,
      body.enabled,
      req.params.id,
    ],
  );
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
  const { rows } = await pool.query(
    `SELECT provider.*,
            COALESCE(
              SUM(
                CASE
                  WHEN transcript.status = 'completed'
                   AND transcript.created_at >= DATE_TRUNC('month', NOW())
                  THEN COALESCE(transcript.duration, 0) / 60.0
                       * provider.cost_per_minute_usd
                  ELSE 0
                END
              ),
              0
            ) AS monthly_cost_usd
     FROM stt_providers provider
     LEFT JOIN transcriptions transcript
       ON LOWER(transcript.transcription_provider) = LOWER(provider.code)
     GROUP BY provider.id
     ORDER BY provider.id ASC`,
  );
  return res.json(rows.map(normalizeProvider));
});

router.put(
  "/providers/:id",
  requireAdmin,
  requireSuperAdmin,
  async (req, res) => {
    const body = req.body || {};
    const providerId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(providerId) || providerId <= 0) {
      throw createAdminError(400, "ID nhà cung cấp không hợp lệ");
    }
    const name = String(body.name || "").trim();
    if (!name || name.length > 120) {
      throw createAdminError(400, "Tên provider phải có từ 1 đến 120 ký tự");
    }
    const routingMode = String(body.routing_mode || "auto");
    if (!["manual", "auto", "rule_based"].includes(routingMode)) {
      throw createAdminError(400, "Chế độ định tuyến không hợp lệ");
    }
    const routingRules =
      body.routing_rules &&
      typeof body.routing_rules === "object" &&
      !Array.isArray(body.routing_rules)
        ? body.routing_rules
        : {};
    if (JSON.stringify(routingRules).length > 10_000) {
      throw createAdminError(400, "Quy tắc định tuyến quá lớn");
    }
    const cost = Number(body.cost_per_minute_usd || 0);
    if (!Number.isFinite(cost) || cost < 0 || cost > 100) {
      throw createAdminError(400, "Chi phí mỗi phút không hợp lệ");
    }

    const client = await pool.connect();
    let updated;
    try {
      await client.query("BEGIN");
      const currentResult = await client.query(
        "SELECT * FROM stt_providers WHERE id = $1 FOR UPDATE",
        [providerId],
      );
      const current = currentResult.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Không tìm thấy provider" });
      }

      const enabled = Boolean(body.enabled);
      const isDefault = Boolean(body.is_default);
      if (isDefault && !enabled) {
        throw createAdminError(
          400,
          "Provider mặc định phải ở trạng thái đang bật",
        );
      }
      const endpoint = normalizeProviderEndpoint(current.code, body.endpoint);
      const failoverId = body.failover_provider_id
        ? Number.parseInt(body.failover_provider_id, 10)
        : null;
      if (failoverId === providerId) {
        throw createAdminError(
          400,
          "Provider không thể dự phòng cho chính nó",
        );
      }
      if (failoverId) {
        const failover = await client.query(
          "SELECT id FROM stt_providers WHERE id = $1 AND enabled = TRUE",
          [failoverId],
        );
        if (!failover.rows[0]) {
          throw createAdminError(
            400,
            "Provider dự phòng không tồn tại hoặc đang bị tắt",
          );
        }
      }
      if (!isDefault && current.is_default) {
        const replacement = await client.query(
          `SELECT id FROM stt_providers
           WHERE id <> $1 AND enabled = TRUE
           ORDER BY CASE WHEN health_status = 'healthy' THEN 0 ELSE 1 END, id
           LIMIT 1`,
          [providerId],
        );
        if (!replacement.rows[0]) {
          throw createAdminError(
            400,
            "Hệ thống phải có ít nhất một provider mặc định đang bật",
          );
        }
        await client.query(
          `UPDATE stt_providers
           SET is_default = (id = $1)
           WHERE id IN ($1, $2)`,
          [replacement.rows[0].id, providerId],
        );
      }
      if (isDefault) {
        await client.query(
          "UPDATE stt_providers SET is_default = FALSE WHERE id <> $1",
          [providerId],
        );
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
             api_key_encrypted = COALESCE($9, api_key_encrypted),
             updated_at = NOW()
         WHERE id = $10
         RETURNING *`,
        [
          name,
          endpoint,
          enabled,
          isDefault,
          routingMode,
          JSON.stringify(routingRules),
          failoverId,
          cost,
          normalizeProviderApiKey(body.api_key),
          providerId,
        ],
      );
      updated = rows[0];
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await writeAudit({
      actorRow: req.admin,
      action: "provider.update",
      targetType: "settings",
      targetId: updated.code,
      details: normalizeProvider(updated),
    });
    return res.json(normalizeProvider(updated));
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
        "SELECT * FROM stt_providers WHERE id = $1 LIMIT 1",
        [providerId],
      );
      const provider = providerResult.rows[0];
      if (!provider) {
        return res.status(404).json({ error: "Không tìm thấy nhà cung cấp" });
      }

      let healthStatus = "healthy";
      let latency = 0;
      let healthError = null;
      try {
        const health = await checkProviderHealth(provider);
        latency = health.latencyMs;
      } catch (error) {
        healthStatus = "down";
        latency = Number(error.latencyMs || 0);
        healthError = String(error.message || "Health check thất bại").slice(
          0,
          300,
        );
      }
      const { rows } = await pool.query(
        `UPDATE stt_providers
       SET health_status = $1::varchar,
           avg_latency_ms = $2,
           success_rate = CASE
             WHEN $1::varchar = 'healthy' THEN
               CASE WHEN success_rate <= 0 THEN 100 ELSE ROUND((success_rate * 9 + 100) / 10, 2) END
             ELSE ROUND(success_rate * 0.9, 2)
           END,
           last_checked_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
        [healthStatus, latency, providerId],
      );
      if (!rows[0])
        return res.status(404).json({ error: "Không tìm thấy nhà cung cấp" });
      return res.json({
        ...normalizeProvider(rows[0]),
        health_error: healthError,
      });
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
  const [providers, queue, settings] = await Promise.all([
    pool.query(
      "SELECT code, health_status, enabled FROM stt_providers ORDER BY id ASC",
    ),
    pool.query(
      `SELECT
         COUNT(*)::integer AS total,
         COUNT(*) FILTER (WHERE status = 'queued')::integer AS queued,
         COUNT(*) FILTER (WHERE status = 'processing')::integer AS active
       FROM transcription_jobs`,
    ),
    getAdminSettings(),
  ]);
  return res.json({
    database: "ok",
    backend: "ok",
    transcription_queue: {
      concurrency: settings.system_parameters.queue_concurrency,
      total: Number(queue.rows[0]?.total || 0),
      queued: Number(queue.rows[0]?.queued || 0),
      active: Number(queue.rows[0]?.active || 0),
    },
    providers: providers.rows,
    generated_at: new Date().toISOString(),
  });
});

module.exports = router;
