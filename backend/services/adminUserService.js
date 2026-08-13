const {
  getEffectiveAdminRole,
  isAdminAccountActive,
} = require("./adminAccess");
const {
  getRuntimePlanConfig,
  getRuntimePurchasedQuotaSeconds,
  normalizeBillingCycle,
  normalizePlan,
} = require("./quotaService");

const WAITING_JOB_STATUSES = ["queued", "pending", "waiting", "retry_wait"];

function normalizeManagedUser(row) {
  return {
    id: String(row.id),
    name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
    email: row.email,
    role: getEffectiveAdminRole(row) || "viewer",
    status:
      row.status === "deleted"
        ? "deleted"
        : isAdminAccountActive(row)
          ? "active"
          : "suspended",
    plan: normalizePlan(row.plan),
    quota_minutes: Math.ceil(Number(row.quota_seconds || 0) / 60),
    used_minutes: Math.ceil(Number(row.used_seconds || 0) / 60),
    plan_started_at: row.plan_started_at || null,
    plan_expires_at: row.plan_expires_at || null,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

async function updateManagedUserStatus(db, userId, status) {
  const accountStatus = status === "active" ? "active" : "blocked";
  const { rows } = await db.query(
    `UPDATE users
     SET status = $1,
         account_status = $2
     WHERE id = $3
       AND status <> 'deleted'
     RETURNING id, first_name, last_name, email, admin_role, status,
       role, account_status, quota_seconds, created_at, last_login_at`,
    [status, accountStatus, userId],
  );
  return rows[0] || null;
}

async function updateManagedUserPlan(db, userId, plan, billingCycle) {
  const planName = normalizePlan(plan);
  const cleanBillingCycle = normalizeBillingCycle(billingCycle);
  const config = await getRuntimePlanConfig(planName, db);
  if (!config.enabled) {
    const error = new Error("Gói cước này hiện không nhận đăng ký mới");
    error.statusCode = 400;
    throw error;
  }
  const quotaSeconds = await getRuntimePurchasedQuotaSeconds(
    planName,
    cleanBillingCycle,
    db,
  );
  const expiresAt =
    planName === "free"
      ? null
      : new Date(
          Date.now() +
            (cleanBillingCycle === "yearly" ? 365 : 30) * 24 * 60 * 60 * 1000,
        );
  const { rows } = await db.query(
    `UPDATE users
     SET plan = $1,
         quota_seconds = $2,
         plan_started_at = NOW(),
         plan_expires_at = $3,
         plan_cancel_at_period_end = FALSE,
         plan_cancellation_requested_at = NULL
     WHERE id = $4
       AND status <> 'deleted'
     RETURNING *`,
    [planName, quotaSeconds, expiresAt, userId],
  );
  return rows[0] || null;
}

async function deleteManagedUserAccount(db, userId) {
  const { rows } = await db.query(
    `UPDATE users
     SET status = 'deleted',
         account_status = 'blocked',
         auth_version = auth_version + 1,
         plan_cancel_at_period_end = FALSE,
         plan_cancellation_requested_at = NULL
     WHERE id = $1
     RETURNING *`,
    [userId],
  );
  if (!rows[0]) return null;

  await db.query(
    `UPDATE auth_refresh_tokens
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE user_id = $1`,
    [userId],
  );
  await db.query(
    `UPDATE api_keys
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE user_id = $1`,
    [userId],
  );
  await db.query(
    `UPDATE transcription_jobs
     SET cancel_requested = TRUE,
         status = CASE
           WHEN status = ANY($2::text[]) THEN 'cancelled'
           ELSE status
         END,
         progress_stage = CASE
           WHEN status = ANY($2::text[]) THEN 'cancelled'
           ELSE progress_stage
         END,
         completed_at = CASE
           WHEN status = ANY($2::text[]) THEN NOW()
           ELSE completed_at
         END,
         next_retry_at = NULL,
         updated_at = NOW()
     WHERE user_id = $1
       AND status NOT IN ('completed', 'failed', 'cancelled')`,
    [userId, WAITING_JOB_STATUSES],
  );
  await db.query(
    `UPDATE transcriptions
     SET status = 'cancelled', error_message = NULL
     WHERE user_id = $1 AND status = ANY($2::text[])`,
    [userId, WAITING_JOB_STATUSES],
  );
  return rows[0];
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
       AND status <> 'deleted'
     RETURNING id, first_name, last_name, email, admin_role, status,
       role, account_status, quota_seconds, created_at, last_login_at`,
    [adminRole, accountRole, userId],
  );
  return rows[0] || null;
}

module.exports = {
  deleteManagedUserAccount,
  normalizeManagedUser,
  updateManagedUserPlan,
  updateManagedUserRole,
  updateManagedUserStatus,
};
