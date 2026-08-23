const pool = require("../db");
const { rewardReferralAfterFirstUsage } = require("./referralService");
const { syncQuotaAlertState } = require("./quotaAlertService");
const { getAdminSettings } = require("./adminSettingsService");
const { resolveQuotaScope } = require("./workspaceTeamService");

const SYSTEM_MAX_UPLOAD_MB = getEnvInt("MAX_UPLOAD_MB", 2048);

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function getEnvInt(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const PLAN_CONFIG = {
  free: {
    name: "free",
    label: "Free",
    quotaSeconds: getEnvInt("FREE_PLAN_SECONDS", 30 * 60),
    maxUploadMb: getEnvInt("FREE_MAX_UPLOAD_MB", 50),
    maxRecordSeconds: getEnvInt("FREE_MAX_RECORD_SECONDS", 10 * 60),
    maxFileSeconds: getEnvInt("FREE_MAX_FILE_SECONDS", 30 * 60),
    queueWeight: 1,
    seats: 1,
    retentionDays: 7,
    apiAccess: false,
  },
  standard: {
    name: "standard",
    label: "Tiêu chuẩn",
    quotaSeconds: getEnvInt("STANDARD_MONTHLY_SECONDS", 300 * 60),
    yearlyQuotaSeconds: getEnvInt("STANDARD_YEARLY_SECONDS", 3600 * 60),
    maxUploadMb: getEnvInt("STANDARD_MAX_UPLOAD_MB", 200),
    maxRecordSeconds: getEnvInt("STANDARD_MAX_RECORD_SECONDS", 60 * 60),
    maxFileSeconds: getEnvInt("STANDARD_MAX_FILE_SECONDS", 2 * 60 * 60),
    queueWeight: 2,
    seats: 1,
    retentionDays: 90,
    apiAccess: true,
  },
  special: {
    name: "special",
    label: "Đặc biệt",
    quotaSeconds: getEnvInt("SPECIAL_MONTHLY_SECONDS", 1200 * 60),
    yearlyQuotaSeconds: getEnvInt("SPECIAL_YEARLY_SECONDS", 14400 * 60),
    maxUploadMb: getEnvInt("SPECIAL_MAX_UPLOAD_MB", 1024),
    maxRecordSeconds: getEnvInt("SPECIAL_MAX_RECORD_SECONDS", 2 * 60 * 60),
    maxFileSeconds: getEnvInt("SPECIAL_MAX_FILE_SECONDS", 4 * 60 * 60),
    queueWeight: 4,
    seats: 1,
    retentionDays: 365,
    apiAccess: true,
  },
  business: {
    name: "business",
    label: "Chuyên nghiệp",
    quotaSeconds: getEnvInt("BUSINESS_MONTHLY_SECONDS", 40 * 60 * 60),
    yearlyQuotaSeconds: getEnvInt("BUSINESS_YEARLY_SECONDS", 480 * 60 * 60),
    maxUploadMb: getEnvInt("BUSINESS_MAX_UPLOAD_MB", 2048),
    maxRecordSeconds: getEnvInt("BUSINESS_MAX_RECORD_SECONDS", 8 * 60 * 60),
    maxFileSeconds: getEnvInt("BUSINESS_MAX_FILE_SECONDS", 8 * 60 * 60),
    queueWeight: 8,
    seats: 1,
    retentionDays: 365,
    apiAccess: true,
  },
};

const DEFAULT_ALERT_SECONDS = getEnvInt("DEFAULT_QUOTA_ALERT_SECONDS", 5 * 60);
const ABSOLUTE_MAX_ALERT_SECONDS = 24 * 60 * 60;

function normalizePlan(plan) {
  const clean = String(plan || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (["standard", "basic", "tieu_chuan", "tiêu_chuẩn"].includes(clean)) {
    return "standard";
  }
  if (
    ["special", "pro", "premium", "dac_biet", "đặc_biệt"].includes(clean)
  ) {
    return "special";
  }
  if (["business", "enterprise", "doanh_nghiep", "doanh_nghiệp"].includes(clean)) {
    return "business";
  }
  return "free";
}

function getPlanConfig(plan) {
  return PLAN_CONFIG[normalizePlan(plan)];
}

function normalizeBillingCycle(value) {
  return String(value || "").toLowerCase() === "yearly" ? "yearly" : "monthly";
}

function getPurchasedQuotaSeconds(planName, billingCycle) {
  const config = getPlanConfig(planName);
  return normalizeBillingCycle(billingCycle) === "yearly"
    ? config.yearlyQuotaSeconds || config.quotaSeconds * 12
    : config.quotaSeconds;
}

function mergeRuntimePlanConfig(row, fallback) {
  if (!row) return { ...fallback, enabled: true, priceVnd: null };
  const quotaMinutes = Number(row.quota_minutes);
  const maxUploadMb = Number(row.max_upload_mb);
  const maxFileDurationMinutes = Number(row.max_file_duration_minutes);
  return {
    ...fallback,
    name: row.code || fallback.name,
    label: String(row.name || fallback.label),
    quotaSeconds:
      Number.isFinite(quotaMinutes) && quotaMinutes > 0
        ? Math.round(quotaMinutes * 60)
        : fallback.quotaSeconds,
    maxUploadMb:
      Number.isFinite(maxUploadMb) && maxUploadMb > 0
        ? Math.round(maxUploadMb)
        : fallback.maxUploadMb,
    maxFileSeconds:
      Number.isFinite(maxFileDurationMinutes) && maxFileDurationMinutes > 0
        ? Math.round(maxFileDurationMinutes * 60)
        : fallback.maxFileSeconds,
    enabled: row.enabled !== false,
    priceVnd:
      Number.isSafeInteger(Number(row.price_vnd)) && Number(row.price_vnd) >= 0
        ? Number(row.price_vnd)
        : null,
    billingCycle: row.billing_cycle || "monthly",
  };
}

async function getRuntimePlanConfig(plan, db = pool) {
  const planName = normalizePlan(plan);
  const fallback = getPlanConfig(planName);
  try {
    const { rows } = await db.query(
      `SELECT code, name, quota_minutes, price_vnd, billing_cycle,
              max_upload_mb, max_file_duration_minutes, enabled
       FROM service_plans
       WHERE code = $1`,
      [planName],
    );
    return mergeRuntimePlanConfig(rows[0], fallback);
  } catch (error) {
    if (error.code === "42P01") {
      return mergeRuntimePlanConfig(null, fallback);
    }
    throw error;
  }
}

async function getRuntimePurchasedQuotaSeconds(
  planName,
  billingCycle,
  db = pool,
) {
  const config = await getRuntimePlanConfig(planName, db);
  return normalizeBillingCycle(billingCycle) === "yearly"
    ? config.quotaSeconds * 12
    : config.quotaSeconds;
}

async function getUserBilling(userId, db = pool) {
  const [freeConfig, settings] = await Promise.all([
    getRuntimePlanConfig("free", db),
    getAdminSettings(db),
  ]);
  const workspace = await resolveUserWorkspace(userId, db);
  await db.query(
    `UPDATE workspaces
     SET plan = 'free',
          quota_seconds = $2,
          plan_started_at = COALESCE(plan_started_at, created_at, NOW()),
          plan_expires_at = NULL,
         plan_cancel_at_period_end = FALSE,
         plan_cancellation_requested_at = NULL
     WHERE id = $1
       AND plan <> 'free'
       AND plan_expires_at IS NOT NULL
       AND plan_expires_at <= NOW()`,
    [workspace.id, freeConfig.quotaSeconds],
  );

  const { rows } = await db.query(
    `SELECT id, name, owner_user_id, plan, quota_seconds, quota_alert_seconds, plan_started_at,
       plan_expires_at, plan_cancel_at_period_end,
       plan_cancellation_requested_at
     FROM workspaces WHERE id = $1`,
    [workspace.id],
  );
  if (!rows[0]) throw createHttpError(404, "Không tìm thấy workspace");

  const planName = normalizePlan(rows[0].plan);
  const config = await getRuntimePlanConfig(planName, db);
  const globalMaxFileSeconds = settings.max_file_duration_minutes * 60;
  return {
    userId,
    workspaceId: Number(rows[0].id),
    workspaceName: rows[0].name,
    workspaceRole: workspace.member_role || "member",
    workspaceOwnerUserId: Number(rows[0].owner_user_id),
    plan: planName,
    label: config.label,
    quotaSeconds: Number(rows[0].quota_seconds || config.quotaSeconds),
    alertSeconds: Number(rows[0].quota_alert_seconds || DEFAULT_ALERT_SECONDS),
    maxAlertSeconds: Math.min(
      ABSOLUTE_MAX_ALERT_SECONDS,
      Number(rows[0].quota_seconds || config.quotaSeconds),
    ),
    planStartedAt: rows[0].plan_started_at,
    planExpiresAt: rows[0].plan_expires_at,
    cancelAtPeriodEnd: Boolean(rows[0].plan_cancel_at_period_end),
    cancellationRequestedAt: rows[0].plan_cancellation_requested_at,
    limits: {
      maxUploadMb: Math.min(
        config.maxUploadMb,
        settings.max_file_size_mb,
        SYSTEM_MAX_UPLOAD_MB,
      ),
      maxRecordSeconds: Math.min(
        config.maxRecordSeconds,
        globalMaxFileSeconds,
      ),
      maxFileSeconds: Math.min(config.maxFileSeconds, globalMaxFileSeconds),
      supportedFormats: settings.supported_formats,
      supportedLanguages: settings.supported_languages,
    },
  };
}

async function getUsageSeconds(userId, db = pool, memberIds = [userId], periodStartedAt = null) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(usage.seconds), 0)::float AS used_seconds
     FROM quota_usage_ledger usage
     WHERE usage.user_id = ANY($1::int[])
       AND ($2::timestamptz IS NULL OR usage.period_started_at = $2::timestamptz)`,
    [memberIds, periodStartedAt],
  );
  return Math.max(0, Math.round(Number(rows[0]?.used_seconds || 0)));
}

async function getTopUpCreditStatus(userId, db = pool) {
  const workspace = await resolveUserWorkspace(userId, db);
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(seconds_granted), 0)::float AS granted_seconds,
            COALESCE(SUM(remaining_seconds), 0)::float AS remaining_seconds,
            MIN(expires_at) FILTER (WHERE remaining_seconds > 0) AS next_expiry
     FROM top_up_credits
     WHERE (
        workspace_id = $2
        OR (workspace_id IS NULL AND user_id = $1)
       )
       AND remaining_seconds > 0
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId, workspace.id],
  );
  return {
    grantedSeconds: Math.max(0, Math.round(Number(rows[0]?.granted_seconds || 0))),
    remainingSeconds: Math.max(
      0,
      Math.round(Number(rows[0]?.remaining_seconds || 0)),
    ),
    nextExpiry: rows[0]?.next_expiry || null,
  };
}

async function getReservedSeconds(
  userId,
  excludeJobId = null,
  db = pool,
  excludeBatchId = null,
  memberIds = [userId],
) {
  const values = [memberIds];
  const excludeJobClause =
    excludeJobId === null || excludeJobId === undefined
      ? ""
      : ` AND job.id <> $${values.push(excludeJobId)}`;
  const excludeBatchClause = excludeBatchId
    ? ` AND batch.id::text <> $${values.push(String(excludeBatchId))}`
    : "";
  const { rows } = await db.query(
    `WITH normal_reservations AS (
       SELECT COALESCE(job.expected_duration_seconds, 0)::float AS seconds
       FROM transcription_jobs job
       WHERE job.user_id = ANY($1::int[])
         AND job.status IN ('queued', 'processing')
         AND job.cancel_requested = FALSE
         AND COALESCE(job.payload->>'batchKind', '') <> 'multitrack'
         ${excludeJobClause}
     ),
     multitrack_reservations AS (
       SELECT COALESCE(MAX(job.expected_duration_seconds), 0)::float AS seconds
       FROM transcription_batches batch
       JOIN transcription_jobs job
         ON job.payload->>'batchId' = batch.id::text
        AND job.payload->>'batchKind' = 'multitrack'
       WHERE batch.user_id = ANY($1::int[])
         AND batch.status IN ('queued', 'processing', 'merging')
         AND job.cancel_requested = FALSE
         ${excludeBatchClause}
       GROUP BY batch.id
     )
     SELECT COALESCE(SUM(reservation.seconds), 0)::float AS reserved_seconds
     FROM (
       SELECT seconds FROM normal_reservations
       UNION ALL
       SELECT seconds FROM multitrack_reservations
     ) reservation`,
    values,
  );
  return Math.max(0, Math.ceil(Number(rows[0]?.reserved_seconds || 0)));
}

async function getQuotaStatus(
  userId,
  { excludeJobId = null, excludeBatchId = null, db = pool } = {},
) {
  const scope = await resolveQuotaScope(userId, db);
  const billing = await getUserBilling(scope.billingOwnerUserId, db);
  const usedSeconds = await getUsageSeconds(
    userId,
    db,
    scope.memberIds,
    billing.planStartedAt,
  );
  const topUp = await getTopUpCreditStatus(scope.billingOwnerUserId, db);
  const reservedSeconds = await getReservedSeconds(
    userId,
    excludeJobId,
    db,
    excludeBatchId,
    scope.memberIds,
  );
  const baseRemainingSeconds = Math.max(0, billing.quotaSeconds - usedSeconds);
  const rawRemainingSeconds = baseRemainingSeconds + topUp.remainingSeconds;
  const remainingSeconds = Math.max(0, rawRemainingSeconds - reservedSeconds);
  const totalQuotaSeconds = Math.max(1, usedSeconds + rawRemainingSeconds);
  const percentUsed =
    totalQuotaSeconds > 0
      ? Math.min(
          100,
          Math.round(
            ((usedSeconds + reservedSeconds) / totalQuotaSeconds) * 100,
          ),
        )
      : 100;

  return {
    ...billing,
    userId,
    billingOwnerUserId: scope.billingOwnerUserId,
    workspaceId: scope.workspaceId,
    workspaceName: scope.workspaceName,
    sharedMemberCount: scope.memberIds.length,
    baseQuotaSeconds: billing.quotaSeconds,
    quotaSeconds: totalQuotaSeconds,
    topUpGrantedSeconds: topUp.grantedSeconds,
    topUpRemainingSeconds: topUp.remainingSeconds,
    topUpNextExpiry: topUp.nextExpiry,
    usedSeconds,
    reservedSeconds,
    rawRemainingSeconds,
    remainingSeconds,
    percentUsed,
    isLimitReached: remainingSeconds <= 0,
    shouldAlert:
      remainingSeconds > 0 && remainingSeconds <= billing.alertSeconds,
  };
}

async function validateBeforeTranscription({
  userId,
  file,
  source = "upload",
  expectedDurationSeconds = null,
  reservationBatchId = null,
  db = pool,
}) {
  const quota = await getQuotaStatus(userId, {
    excludeBatchId: reservationBatchId,
    db,
  });
  await syncQuotaAlertState({ userId, quota, source, db });
  const fileSizeMb = file?.size ? file.size / 1024 / 1024 : 0;
  const expected =
    expectedDurationSeconds !== null && expectedDurationSeconds !== undefined
      ? Math.ceil(Number(expectedDurationSeconds))
      : null;

  if (quota.isLimitReached) {
    throw createHttpError(
      402,
      "Tài khoản đã hết thời lượng. Vui lòng mua hoặc nâng cấp gói cước để tiếp tục.",
      { quota },
    );
  }

  if (fileSizeMb > quota.limits.maxUploadMb) {
    throw createHttpError(
      413,
      `File quá lớn cho gói ${quota.label}. Tối đa ${quota.limits.maxUploadMb}MB.`,
      { quota },
    );
  }

  if (
    ["recording", "realtime"].includes(source) &&
    expected &&
    expected > quota.limits.maxRecordSeconds
  ) {
    throw createHttpError(
      400,
      `Phiên âm thanh vượt giới hạn ${Math.floor(quota.limits.maxRecordSeconds / 60)} phút của gói ${quota.label}.`,
      { quota },
    );
  }

  if (expected && expected > quota.remainingSeconds) {
    throw createHttpError(
      402,
      `Thời lượng còn lại không đủ. Bạn còn khoảng ${Math.floor(quota.remainingSeconds / 60)} phút.`,
      { quota },
    );
  }

  return quota;
}

async function validateAfterTranscription({
  userId,
  durationSeconds,
  source = "upload",
  excludeJobId = null,
  reservationBatchId = null,
  db = pool,
}) {
  const quota = await getQuotaStatus(userId, {
    excludeJobId,
    excludeBatchId: reservationBatchId,
    db,
  });
  const duration = Math.ceil(Number(durationSeconds || 0));

  if (!Number.isFinite(duration) || duration <= 0) {
    throw createHttpError(
      422,
      "Không xác định được thời lượng hợp lệ của file âm thanh.",
      { quota },
    );
  }

  if (duration > quota.limits.maxFileSeconds) {
    throw createHttpError(
      400,
      `File vượt giới hạn thời lượng ${Math.floor(quota.limits.maxFileSeconds / 60)} phút của gói ${quota.label}.`,
      { quota },
    );
  }

  if (
    ["recording", "realtime"].includes(source) &&
    duration > quota.limits.maxRecordSeconds
  ) {
    throw createHttpError(
      400,
      `Phiên âm thanh vượt giới hạn ${Math.floor(quota.limits.maxRecordSeconds / 60)} phút của gói ${quota.label}.`,
      { quota },
    );
  }

  if (duration > quota.remainingSeconds) {
    throw createHttpError(
      402,
      "Thời lượng của file vượt quá quota còn lại. Vui lòng mua hoặc nâng cấp gói cước.",
      { quota },
    );
  }

  return quota;
}

async function updateQuotaAlert(userId, alertSeconds) {
  const quota = await getQuotaStatus(userId);
  await requireWorkspaceBillingRole(userId);
  const raw = Math.round(Number(alertSeconds));
  const maxAlertSeconds = Math.max(
    60,
    Math.min(ABSOLUTE_MAX_ALERT_SECONDS, quota.quotaSeconds),
  );
  const clean = Number.isFinite(raw)
    ? Math.max(60, Math.min(maxAlertSeconds, raw))
    : DEFAULT_ALERT_SECONDS;
  await pool.query(
    `UPDATE users SET quota_alert_seconds = $1 WHERE id = $2`,
    [clean, quota.billingOwnerUserId || userId],
  );
  return getQuotaStatus(userId);
}

async function recordQuotaUsage({
  userId,
  transcriptionId,
  durationSeconds,
  source = "transcription",
  db = pool,
}) {
  const seconds = Math.ceil(Number(durationSeconds || 0));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw createHttpError(
      422,
      "Không thể ghi nhận quota vì thời lượng âm thanh không hợp lệ.",
    );
  }

  const scope = await resolveQuotaScope(userId, db);
  await db.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
    scope.billingOwnerUserId,
  ]);
  const billing = await getUserBilling(scope.billingOwnerUserId, db);
  const usedBefore = await getUsageSeconds(
    userId,
    db,
    scope.memberIds,
    billing.planStartedAt,
  );
  const { rows } = await db.query(
    `INSERT INTO quota_usage_ledger (
       user_id, workspace_id, transcription_id, seconds, period_started_at, period_ends_at
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (transcription_id) DO NOTHING
     RETURNING id, seconds, period_started_at, period_ends_at`,
    [
      userId,
      transcriptionId,
      seconds,
      billing.planStartedAt,
      billing.planExpiresAt,
    ],
  );
  if (!rows[0]) return null;

  await rewardReferralAfterFirstUsage(userId, db);

  const usedAfter = usedBefore + seconds;
  let topUpToConsume =
    Math.max(0, usedAfter - billing.quotaSeconds) -
    Math.max(0, usedBefore - billing.quotaSeconds);

  if (topUpToConsume > 0) {
    const credits = await db.query(
      `SELECT id, remaining_seconds
       FROM top_up_credits
       WHERE (
          workspace_id = $2
          OR (workspace_id IS NULL AND user_id = $1)
         )
         AND remaining_seconds > 0
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY expires_at ASC NULLS LAST, id ASC
       FOR UPDATE`,
      [scope.billingOwnerUserId],
    );

    for (const credit of credits.rows) {
      if (topUpToConsume <= 0) break;
      const deduction = Math.min(
        topUpToConsume,
        Number(credit.remaining_seconds || 0),
      );
      await db.query(
        `UPDATE top_up_credits
         SET remaining_seconds = remaining_seconds - $2,
             updated_at = NOW()
         WHERE id = $1`,
        [credit.id, deduction],
      );
      topUpToConsume -= deduction;
    }

    if (topUpToConsume > 0) {
      throw createHttpError(
        402,
        "Quota mua thêm không còn đủ để hoàn tất tác vụ.",
      );
    }
  }

  const quota = await getQuotaStatus(userId, { db });
  const quotaAlert = await syncQuotaAlertState({
    userId,
    quota,
    source,
    db,
  });

  return {
    ...rows[0],
    quotaAlert: quotaAlert.alert,
    quotaAlertCreated: quotaAlert.created,
  };
}

async function upgradeUserPlan(userId, plan = "special", billingCycle = "monthly") {
  const workspace = await requireWorkspaceBillingRole(userId);
  const planName = normalizePlan(plan);
  const cleanBillingCycle = normalizeBillingCycle(billingCycle);
  const config = await getRuntimePlanConfig(planName);
  if (!config.enabled) {
    throw createHttpError(400, "Gói cước này hiện không nhận đăng ký mới");
  }
  const quotaSeconds = await getRuntimePurchasedQuotaSeconds(
    planName,
    cleanBillingCycle,
  );
  const expiresAt =
    planName === "free"
      ? null
      : new Date(
          Date.now() +
            (cleanBillingCycle === "yearly" ? 365 : 30) *
              24 *
              60 *
              60 *
              1000,
        );

  await pool.query(
    `UPDATE workspaces
     SET plan = $1,
         quota_seconds = $2,
         plan_started_at = NOW(),
         plan_expires_at = $3,
         plan_cancel_at_period_end = FALSE,
         plan_cancellation_requested_at = NULL,
         updated_at = NOW()
     WHERE id = $4`,
    [planName, quotaSeconds, expiresAt, workspace.id],
  );
  await pool.query(
    `UPDATE users
     SET plan = $1,
         quota_seconds = $2,
         plan_started_at = NOW(),
         plan_expires_at = $3,
         plan_cancel_at_period_end = FALSE,
         plan_cancellation_requested_at = NULL
     WHERE id = $4`,
    [planName, quotaSeconds, expiresAt, workspace.owner_user_id],
  );
  const quota = await getQuotaStatus(userId);
  await syncQuotaAlertState({ userId, quota, source: "plan_upgrade" });
  return quota;
}

module.exports = {
  PLAN_CONFIG,
  DEFAULT_ALERT_SECONDS,
  createHttpError,
  normalizePlan,
  normalizeBillingCycle,
  getPurchasedQuotaSeconds,
  getRuntimePlanConfig,
  getRuntimePurchasedQuotaSeconds,
  mergeRuntimePlanConfig,
  getReservedSeconds,
  getTopUpCreditStatus,
  getQuotaStatus,
  recordQuotaUsage,
  updateQuotaAlert,
  upgradeUserPlan,
  validateBeforeTranscription,
  validateAfterTranscription,
};
