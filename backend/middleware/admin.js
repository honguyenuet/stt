const pool = require("../db");

const CMS_ROLES = new Set(["support", "admin"]);

function requireAdmin(req, res, next) {
  if (!req.user || !CMS_ROLES.has(String(req.user.role || ""))) {
    return res.status(403).json({ error: "Bạn không có quyền truy cập CMS" });
  }
  return next();
}

function requireAdminRole(...roles) {
  const allowed = new Set(roles);
  return (req, res, next) => {
    if (!req.user || !allowed.has(String(req.user.role || ""))) {
      return res.status(403).json({ error: "Vai trò của bạn không có quyền thực hiện thao tác này" });
    }
    return next();
  };
}

async function writeAdminAudit({
  req,
  action,
  targetType,
  targetId = null,
  reason = null,
  before = null,
  after = null,
  db = pool,
}) {
  await db.query(
    `INSERT INTO admin_audit_logs (
       actor_user_id, action, target_type, target_id, reason,
       before_data, after_data, request_id, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, NOW())`,
    [
      req.user.id,
      String(action || "unknown").slice(0, 100),
      String(targetType || "system").slice(0, 60),
      targetId === null ? null : String(targetId).slice(0, 120),
      reason ? String(reason).slice(0, 500) : null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      req.requestId || null,
    ],
  );
}

module.exports = { CMS_ROLES, requireAdmin, requireAdminRole, writeAdminAudit };
