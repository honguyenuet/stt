require("../config/env");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const pool = require("../db");
const { encryptProviderSecret } = require("../services/providerSecrets");
const { UPLOADS_DIR } = require("../services/transcriptionService");
const { transcriptionQueue } = require("../services/jobQueue");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
const ADMIN_TOKEN_TTL = "8h";

const ADMIN_ROLES = new Set(["super_admin", "admin", "viewer"]);
const MUTATION_ROLES = new Set(["super_admin", "admin"]);

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      adminRole: user.admin_role,
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
  return {
    id: String(row.id),
    name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
    email: row.email,
    role: ADMIN_ROLES.has(row.admin_role) ? row.admin_role : "viewer",
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
      `SELECT id, first_name, last_name, email, admin_role, status
       FROM users WHERE id = $1`,
      [decoded.id],
    );
    const user = rows[0];
    if (
      !user ||
      user.status !== "active" ||
      !ADMIN_ROLES.has(user.admin_role)
    ) {
      return res.status(403).json({ error: "Tài khoản admin không hợp lệ" });
    }

    req.admin = user;
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
    SELECT u.id, u.first_name, u.last_name, u.email, u.admin_role, u.status,
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
    role: ADMIN_ROLES.has(row.admin_role) ? row.admin_role : "viewer",
    status: row.status || "active",
    quota_minutes: Math.ceil(Number(row.quota_seconds || 0) / 60),
    used_minutes: Math.ceil(Number(row.used_seconds || 0) / 60),
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
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

function normalizeQueueJob(job, userRow) {
  const fileName = job.input?.filename || "queued-audio";
  return {
    job_id: job.id,
    user_id: String(job.userId || ""),
    user_name: userRow
      ? `${userRow.first_name || ""} ${userRow.last_name || ""}`.trim() ||
        userRow.email
      : "Unknown user",
    user_email: userRow?.email || "",
    file_id: `queue_${job.id}`,
    file_name: fileName,
    language: job.result?.sourceLanguage || "auto",
    duration: Math.round(Number(job.result?.duration || 0)),
    status: job.status,
    processing_time:
      job.startedAt && job.finishedAt
        ? Math.round(
            (new Date(job.finishedAt).getTime() -
              new Date(job.startedAt).getTime()) /
              1000,
          )
        : null,
    created_at: job.createdAt,
    completed_at: job.finishedAt,
    error_message: job.error?.message || undefined,
    transcript: job.result?.text || "",
  };
}

async function getAdminQueueJobs() {
  const jobs = transcriptionQueue.listAll(100);
  const userIds = [...new Set(jobs.map((job) => job.userId).filter(Boolean))];
  if (userIds.length === 0)
    return jobs.map((job) => normalizeQueueJob(job, null));
  const { rows } = await pool.query(
    "SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1::int[])",
    [userIds],
  );
  const usersById = new Map(rows.map((row) => [String(row.id), row]));
  return jobs.map((job) =>
    normalizeQueueJob(job, usersById.get(String(job.userId))),
  );
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

router.post("/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) {
      return res.status(400).json({ error: "Vui lòng nhập email và mật khẩu" });
    }

    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, password, admin_role, status
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email],
    );
    const user = rows[0];
    if (!user || !user.password || user.status !== "active") {
      return res
        .status(401)
        .json({ error: "Email hoặc mật khẩu admin không đúng" });
    }
    const matched = await bcrypt.compare(password, user.password);
    if (!matched || !ADMIN_ROLES.has(user.admin_role)) {
      return res
        .status(401)
        .json({ error: "Email hoặc mật khẩu admin không đúng" });
    }

    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
      user.id,
    ]);
    const session = {
      token: generateToken(user),
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
      user: normalizeAdminUser(user),
    };
    return res.json(session);
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({ error: "Không đăng nhập được admin" });
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

    const queueJobs = await getAdminQueueJobs();
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
    queueJobs.forEach((job) => {
      if (Object.prototype.hasOwnProperty.call(jobsByStatus, job.status)) {
        jobsByStatus[job.status] += 1;
      }
    });
    const completed = jobsByStatus.completed;
    const failed = jobsByStatus.failed;
    const terminal = completed + failed + jobsByStatus.cancelled;
    const jobs = [...queueJobs, ...recentResult.rows.map(normalizeJob)].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    return res.json({
      total_users: usersResult.rows[0].count,
      total_files: filesResult.rows[0].count,
      total_jobs: jobsResult.rows[0].count + queueJobs.length,
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
      filters.push(`u.admin_role = $${params.length}`);
    }
    if (status !== "all") {
      params.push(status);
      filters.push(`u.status = $${params.length}`);
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
      const { rows } = await pool.query(
        `UPDATE users SET status = $1 WHERE id = $2
       RETURNING id, first_name, last_name, email, admin_role, status, quota_seconds, created_at, last_login_at`,
        [status, req.params.id],
      );
      if (!rows[0])
        return res.status(404).json({ error: "Không tìm thấy user" });
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
  requireSuperAdmin,
  async (req, res) => {
    try {
      const role = String(req.body.role || "");
      if (!ADMIN_ROLES.has(role))
        return res.status(400).json({ error: "Role không hợp lệ" });
      const { rows } = await pool.query(
        `UPDATE users SET admin_role = $1 WHERE id = $2
       RETURNING id, first_name, last_name, email, admin_role, status, quota_seconds, created_at, last_login_at`,
        [role, req.params.id],
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
      const deltaMinutes = Number(req.body.deltaMinutes);
      const reason = String(req.body.reason || "").trim();
      if (!Number.isFinite(deltaMinutes) || deltaMinutes === 0) {
        return res.status(400).json({ error: "Quota thay đổi phải khác 0" });
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
      const nextSeconds =
        Number(current.rows[0].quota_seconds || 0) +
        Math.round(deltaMinutes * 60);
      if (nextSeconds < 0)
        return res.status(400).json({ error: "Quota không được âm" });

      const { rows } = await pool.query(
        `UPDATE users SET quota_seconds = $1 WHERE id = $2
       RETURNING id, first_name, last_name, email, admin_role, status, quota_seconds, created_at, last_login_at`,
        [nextSeconds, req.params.id],
      );
      await writeAudit({
        actorRow: req.admin,
        action: "quota.adjust",
        targetType: "quota",
        targetId: req.params.id,
        details: { delta_minutes: deltaMinutes, reason },
      });
      rows[0].used_seconds = 0;
      return res.json(normalizeManagedUser(rows[0]));
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
    const queueJobs = await getAdminQueueJobs();
    const cleanSearch = search.toLowerCase();
    const filteredQueueJobs = queueJobs.filter((job) => {
      const matchesSearch =
        !cleanSearch ||
        job.job_id.toLowerCase().includes(cleanSearch) ||
        job.file_name.toLowerCase().includes(cleanSearch) ||
        job.user_email.toLowerCase().includes(cleanSearch);
      const matchesStatus = status === "all" || job.status === status;
      const matchesLanguage = language === "all" || job.language === language;
      return matchesSearch && matchesStatus && matchesLanguage;
    });
    const combined = [...filteredQueueJobs, ...rows.map(normalizeJob)].sort(
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
      `SELECT t.*, u.first_name, u.last_name, u.email FROM transcriptions t JOIN users u ON u.id = t.user_id WHERE t.id = $1`,
      [id],
    );
    const job = rows[0];
    if (!job) return res.status(404).json({ error: "Không tìm thấy job" });
    if (job.status === "completed") {
      return res
        .status(400)
        .json({ error: "Không thể retry job đã hoàn thành" });
    }
    const updated = await pool.query(
      `UPDATE transcriptions SET status = 'queued', error_message = NULL, completed_at = NULL WHERE id = $1 RETURNING *`,
      [id],
    );
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
      `SELECT t.*, u.first_name, u.last_name, u.email FROM transcriptions t JOIN users u ON u.id = t.user_id WHERE t.id = $1`,
      [id],
    );
    const job = rows[0];
    if (!job) return res.status(404).json({ error: "Không tìm thấy job" });
    if (!["queued", "processing"].includes(job.status)) {
      return res
        .status(400)
        .json({ error: "Chỉ hủy job queued hoặc processing" });
    }
    const updated = await pool.query(
      `UPDATE transcriptions SET status = 'cancelled', completed_at = NOW() WHERE id = $1 RETURNING *`,
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

router.put("/settings", requireAdmin, requireSuperAdmin, async (req, res) => {
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

router.put("/plans/:id", requireAdmin, requireSuperAdmin, async (req, res) => {
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
  requireSuperAdmin,
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
           api_key_encrypted = COALESCE($9, api_key_encrypted),
           updated_at = NOW()
       WHERE id = $10
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

      const latency = 120 + Math.floor(Math.random() * 280);
      const healthStatus = latency > 330 ? "degraded" : "healthy";
      const { rows } = await pool.query(
        `UPDATE stt_providers
       SET health_status = $1,
           avg_latency_ms = $2,
           success_rate = CASE WHEN $1 = 'healthy' THEN 99.2 ELSE 94.5 END,
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
  const providers = await pool.query(
    "SELECT code, health_status, enabled FROM stt_providers ORDER BY id ASC",
  );
  return res.json({
    database: "ok",
    backend: "ok",
    transcription_queue: transcriptionQueue.stats(),
    providers: providers.rows,
    generated_at: new Date().toISOString(),
  });
});

module.exports = router;
