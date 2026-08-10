const pool = require("../db");
const { rewardReferralAfterFirstUsage } = require("./referralService");
const { syncQuotaAlertState } = require("./quotaAlertService");

const SYSTEM_MAX_UPLOAD_MB = getEnvInt("MAX_UPLOAD_MB", 102400);
const ACTIVE_TRANSCRIPTION_JOB_STATUSES = [
  "queued",
  "pending",
  "uploaded",
  "processing",
];

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
    label: "Theo lượt",
    quotaSeconds: getEnvInt("FREE_PLAN_SECONDS", 30 * 60),
    maxUploadMb: getEnvInt("FREE_MAX_UPLOAD_MB", 100),
    maxRecordSeconds: getEnvInt("FREE_MAX_RECORD_SECONDS", 10 * 60),
    maxFileSeconds: getEnvInt("FREE_MAX_FILE_SECONDS", 30 * 60),
    queueWeight: 1,
    seats: 1,
    retentionDays: 30,
    apiAccess: false,
    webhookAccess: false,
    maxConcurrentJobs: 1,
    transcriptLimit: 5,
    rolloverLabel: "Không cộng dồn",
    supportLevel: "Email",
  },
  standard: {
    name: "standard",
    label: "Tiêu chuẩn",
    quotaSeconds: getEnvInt("STANDARD_MONTHLY_SECONDS", 300 * 60),
    yearlyQuotaSeconds: getEnvInt("STANDARD_YEARLY_SECONDS", 3600 * 60),
    maxUploadMb: getEnvInt("STANDARD_MAX_UPLOAD_MB", 300),
    maxRecordSeconds: getEnvInt("STANDARD_MAX_RECORD_SECONDS", 3 * 60 * 60),
    maxFileSeconds: getEnvInt("STANDARD_MAX_FILE_SECONDS", 3 * 60 * 60),
    queueWeight: 2,
    seats: 1,
    retentionDays: 180,
    apiAccess: true,
    apiAccessLabel: "Có giới hạn",
    webhookAccess: false,
    maxConcurrentJobs: 3,
    transcriptLimit: 100,
    rolloverLabel: "1 tháng",
    supportLevel: "Ưu tiên",
  },
  special: {
    name: "special",
    label: "Đặc biệt",
    quotaSeconds: getEnvInt("SPECIAL_MONTHLY_SECONDS", 20 * 60 * 60),
    yearlyQuotaSeconds: getEnvInt("SPECIAL_YEARLY_SECONDS", 240 * 60 * 60),
    maxUploadMb: getEnvInt("SPECIAL_MAX_UPLOAD_MB", 1024),
    maxRecordSeconds: getEnvInt("SPECIAL_MAX_RECORD_SECONDS", 4 * 60 * 60),
    maxFileSeconds: getEnvInt("SPECIAL_MAX_FILE_SECONDS", 4 * 60 * 60),
    queueWeight: 4,
    seats: 1,
    retentionDays: 365,
    apiAccess: true,
    apiAccessLabel: "Mở rộng",
    webhookAccess: true,
    maxConcurrentJobs: 5,
    transcriptLimit: null,
    rolloverLabel: "2 tháng",
    supportLevel: "Ưu tiên",
  },
  business: {
    name: "business",
    label: "Chuyên nghiệp",
    quotaSeconds: getEnvInt("BUSINESS_MONTHLY_SECONDS", 40 * 60 * 60),
    yearlyQuotaSeconds: getEnvInt("BUSINESS_YEARLY_SECONDS", 480 * 60 * 60),
    maxUploadMb: getEnvInt("BUSINESS_MAX_UPLOAD_MB", 2048),
    maxRecordSeconds: getEnvInt("BUSINESS_MAX_RECORD_SECONDS", 10 * 60 * 60),
    maxFileSeconds: getEnvInt("BUSINESS_MAX_FILE_SECONDS", 10 * 60 * 60),
    queueWeight: 8,
    seats: 5,
    retentionDays: 36500,
    apiAccess: true,
    apiAccessLabel: "Đầy đủ",
    webhookAccess: true,
    maxConcurrentJobs: 10,
    transcriptLimit: null,
    rolloverLabel: "3 tháng",
    supportLevel: "Ưu tiên + Chat",
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
    ["special", "pro", "premium", "professional", "chuyen_nghiep", "chuyên_nghiệp", "dac_biet", "đặc_biệt"].includes(clean)
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

async function getUserBilling(userId, db = pool) {
  await db.query(
    `UPDATE users
     SET plan = 'free',
          quota_seconds = $2,
          plan_started_at = COALESCE(free_trial_started_at, created_at, plan_started_at),
          plan_expires_at = NULL,
         plan_cancel_at_period_end = FALSE,
         plan_cancellation_requested_at = NULL
     WHERE id = $1
       AND plan <> 'free'
       AND plan_expires_at IS NOT NULL
       AND plan_expires_at <= NOW()`,
    [userId, PLAN_CONFIG.free.quotaSeconds],
  );

  const { rows } = await db.query(
    `SELECT id, plan, quota_seconds, quota_alert_seconds, plan_started_at,
       plan_expires_at, free_trial_started_at, plan_cancel_at_period_end,
       plan_cancellation_requested_at
     FROM users WHERE id = $1`,
    [userId],
  );
  if (!rows[0]) throw createHttpError(404, "Không tìm thấy người dùng");

  const planName = normalizePlan(rows[0].plan);
  const config = getPlanConfig(planName);
  return {
    userId,
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
      maxUploadMb: Math.min(config.maxUploadMb, SYSTEM_MAX_UPLOAD_MB),
      maxRecordSeconds: config.maxRecordSeconds,
      maxFileSeconds: config.maxFileSeconds,
      maxConcurrentJobs: config.maxConcurrentJobs,
      transcriptLimit: config.transcriptLimit,
      retentionDays: config.retentionDays,
      webhookAccess: Boolean(config.webhookAccess),
      apiAccess: Boolean(config.apiAccess),
    },
  };
}

async function getUsageSeconds(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(usage.seconds), 0)::float AS used_seconds
     FROM quota_usage_ledger usage
     JOIN users account ON account.id = usage.user_id
     WHERE usage.user_id = $1
       AND usage.period_started_at = account.plan_started_at`,
    [userId],
  );
  return Math.max(0, Math.round(Number(rows[0]?.used_seconds || 0)));
}

async function getTopUpCreditStatus(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(seconds_granted), 0)::float AS granted_seconds,
            COALESCE(SUM(remaining_seconds), 0)::float AS remaining_seconds,
            MIN(expires_at) FILTER (WHERE remaining_seconds > 0) AS next_expiry
     FROM top_up_credits
     WHERE user_id = $1
       AND remaining_seconds > 0
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId],
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

async function getReservedSeconds(userId, excludeJobId = null, db = pool) {
  const values = [userId];
  const excludeClause =
    excludeJobId === null || excludeJobId === undefined
      ? ""
      : ` AND id <> $${values.push(excludeJobId)}`;
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(expected_duration_seconds), 0)::float AS reserved_seconds
     FROM transcription_jobs
     WHERE user_id = $1
       AND status = ANY($${values.push(ACTIVE_TRANSCRIPTION_JOB_STATUSES)}::text[])${excludeClause}`,
    values,
  );
  return Math.max(0, Math.ceil(Number(rows[0]?.reserved_seconds || 0)));
}

async function getQuotaStatus(
  userId,
  { excludeJobId = null, db = pool } = {},
) {
  const billing = await getUserBilling(userId, db);
  const usedSeconds = await getUsageSeconds(userId, db);
  const topUp = await getTopUpCreditStatus(userId, db);
  const reservedSeconds = await getReservedSeconds(userId, excludeJobId, db);
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
  db = pool,
}) {
  const quota = await getQuotaStatus(userId, { db });
  await syncQuotaAlertState({ userId, quota, source, db });
  const fileSizeMb = file?.size ? file.size / 1024 / 1024 : 0;
  const expected =
    expectedDurationSeconds !== null && expectedDurationSeconds !== undefined
      ? Math.ceil(Number(expectedDurationSeconds))
      : null;

  if (quota.limits.transcriptLimit !== null) {
    const transcriptCount = await db.query(
      "SELECT COUNT(*)::integer AS total FROM transcriptions WHERE user_id = $1",
      [userId],
    );
    if (Number(transcriptCount.rows[0]?.total || 0) >= quota.limits.transcriptLimit) {
      throw createHttpError(
        403,
        `Gói ${quota.label} chỉ lưu tối đa ${quota.limits.transcriptLimit} transcript. Vui lòng xóa bớt lịch sử hoặc nâng cấp gói.`,
        { quota },
      );
    }
  }

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
  db = pool,
}) {
  const quota = await getQuotaStatus(userId, { excludeJobId, db });
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
    [clean, userId],
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

  await db.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
  const billing = await getUserBilling(userId, db);
  const usedBefore = await getUsageSeconds(userId, db);
  const { rows } = await db.query(
    `INSERT INTO quota_usage_ledger (
       user_id, transcription_id, seconds, period_started_at, period_ends_at
     )
     SELECT $1, $2, $3, plan_started_at, plan_expires_at
     FROM users
     WHERE id = $1
     ON CONFLICT (transcription_id) DO NOTHING
     RETURNING id, seconds, period_started_at, period_ends_at`,
    [userId, transcriptionId, seconds],
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
       WHERE user_id = $1
         AND remaining_seconds > 0
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY expires_at ASC NULLS LAST, id ASC
       FOR UPDATE`,
      [userId],
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
  const planName = normalizePlan(plan);
  const cleanBillingCycle = normalizeBillingCycle(billingCycle);
  const quotaSeconds = getPurchasedQuotaSeconds(planName, cleanBillingCycle);
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
    `UPDATE users
     SET plan = $1,
         quota_seconds = $2,
         plan_started_at = NOW(),
         plan_expires_at = $3,
         plan_cancel_at_period_end = FALSE,
         plan_cancellation_requested_at = NULL
     WHERE id = $4`,
    [planName, quotaSeconds, expiresAt, userId],
  );
  const quota = await getQuotaStatus(userId);
  await syncQuotaAlertState({ userId, quota, source: "plan_upgrade" });
  return quota;
}

module.exports = {
  PLAN_CONFIG,
  DEFAULT_ALERT_SECONDS,
  createHttpError,
  getPlanConfig,
  normalizePlan,
  normalizeBillingCycle,
  getPurchasedQuotaSeconds,
  getTopUpCreditStatus,
  getQuotaStatus,
  recordQuotaUsage,
  updateQuotaAlert,
  upgradeUserPlan,
  validateBeforeTranscription,
  validateAfterTranscription,
};
