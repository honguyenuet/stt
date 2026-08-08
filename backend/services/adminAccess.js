const jwt = require("jsonwebtoken");

const ADMIN_ROLES = new Set(["super_admin", "admin", "support", "viewer"]);
const ADMIN_MUTATION_ROLES = new Set(["super_admin", "admin"]);
const SUPPORT_REPLY_ROLES = new Set(["super_admin", "admin", "support"]);
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_TOKEN_TTL = "8h";

function getEffectiveAdminRole(user) {
  if (ADMIN_ROLES.has(user?.admin_role)) return user.admin_role;
  if (["super_admin", "admin"].includes(user?.role)) return user.role;
  return null;
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

function createAdminSession(
  user,
  {
    jwtSecret = process.env.JWT_SECRET || "change-this-secret-in-production",
    nowMs = Date.now(),
  } = {},
) {
  const adminRole = getEffectiveAdminRole(user);
  const sessionUser = { ...user, admin_role: adminRole };
  return {
    token: jwt.sign(
      {
        id: user.id,
        email: user.email,
        adminRole,
        scope: "admin",
      },
      jwtSecret,
      { expiresIn: ADMIN_TOKEN_TTL },
    ),
    expiresAt: nowMs + ADMIN_TOKEN_TTL_MS,
    user: normalizeAdminUser(sessionUser),
  };
}

function isAdminAccountActive(user) {
  return (
    String(user?.status || "active") === "active" &&
    String(user?.account_status || "active") === "active"
  );
}

function canMutateAdminRole(role) {
  return ADMIN_MUTATION_ROLES.has(role);
}

function canReplySupportRole(role) {
  return SUPPORT_REPLY_ROLES.has(role);
}

function canUpdateSupportStatusRole(role) {
  return ADMIN_MUTATION_ROLES.has(role);
}

module.exports = {
  ADMIN_ROLES,
  canMutateAdminRole,
  canReplySupportRole,
  canUpdateSupportStatusRole,
  createAdminSession,
  getEffectiveAdminRole,
  isAdminAccountActive,
  normalizeAdminUser,
};
