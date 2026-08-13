const jwt = require("jsonwebtoken");

const ADMIN_ROLES = new Set(["user", "supporter", "admin"]);
const CMS_ROLES = new Set(["supporter", "admin"]);
const ADMIN_MUTATION_ROLES = new Set(["admin"]);
const SUPPORT_REPLY_ROLES = new Set(["admin", "supporter"]);
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_TOKEN_TTL = "8h";

function normalizeRole(role) {
  if (role === "super_admin") return "admin";
  if (role === "support") return "supporter";
  if (role === "admin" || role === "supporter" || role === "user") return role;
  return "user";
}

function getEffectiveAdminRole(user) {
  const adminRole = normalizeRole(user?.admin_role);
  if (CMS_ROLES.has(adminRole)) return adminRole;
  const accountRole = normalizeRole(user?.role);
  if (CMS_ROLES.has(accountRole)) return accountRole;
  return null;
}

function normalizeAdminUser(row) {
  const role = getEffectiveAdminRole(row) || "user";
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
  CMS_ROLES,
  canMutateAdminRole,
  canReplySupportRole,
  canUpdateSupportStatusRole,
  createAdminSession,
  getEffectiveAdminRole,
  isAdminAccountActive,
  normalizeAdminUser,
  normalizeRole,
};
