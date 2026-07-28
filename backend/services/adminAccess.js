const ADMIN_ROLES = new Set(["super_admin", "admin", "viewer"]);

function getEffectiveAdminRole(user) {
  if (ADMIN_ROLES.has(user?.admin_role)) return user.admin_role;
  if (["super_admin", "admin"].includes(user?.role)) return user.role;
  return null;
}

function isAdminAccountActive(user) {
  return (
    String(user?.status || "active") === "active" &&
    String(user?.account_status || "active") === "active"
  );
}

module.exports = {
  ADMIN_ROLES,
  getEffectiveAdminRole,
  isAdminAccountActive,
};
