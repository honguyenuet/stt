async function updateManagedUserStatus(db, userId, status) {
  const accountStatus = status === "active" ? "active" : "blocked";
  const { rows } = await db.query(
    `UPDATE users
     SET status = $1,
         account_status = $2
     WHERE id = $3
     RETURNING id, first_name, last_name, email, admin_role, status,
       role, account_status, quota_seconds, created_at, last_login_at`,
    [status, accountStatus, userId],
  );
  return rows[0] || null;
}

async function updateManagedUserRole(db, userId, adminRole) {
  const accountRole = ["admin", "super_admin"].includes(adminRole)
    ? adminRole
    : "user";
  const { rows } = await db.query(
    `UPDATE users
     SET admin_role = $1,
         role = $2
     WHERE id = $3
     RETURNING id, first_name, last_name, email, admin_role, status,
       role, account_status, quota_seconds, created_at, last_login_at`,
    [adminRole, accountRole, userId],
  );
  return rows[0] || null;
}

module.exports = {
  updateManagedUserRole,
  updateManagedUserStatus,
};
