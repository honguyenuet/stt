const pool = require("../db");
const {
  hasSmtpConfig,
  sendQuotaAdminAlertEmail,
} = require("./emailService");

const ACTIVE_STATUSES = ["open", "acknowledged"];
const LEVEL_CONFIG = {
  warning: { thresholdPercent: 20, priority: 1 },
  critical: { thresholdPercent: 5, priority: 2 },
  exhausted: { thresholdPercent: 0, priority: 3 },
};

let dispatcherTimer = null;
let reconcileTimer = null;

function getEnvInt(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function getQuotaAlertLevel(quota) {
  const remainingSeconds = Math.max(
    0,
    Math.round(Number(quota?.rawRemainingSeconds ?? quota?.remainingSeconds ?? 0)),
  );
  const quotaSeconds = Math.max(1, Math.round(Number(quota?.quotaSeconds || 0)));
  const percentRemaining = Math.max(
    0,
    Math.min(100, (remainingSeconds / quotaSeconds) * 100),
  );

  if (remainingSeconds <= 0) return { level: "exhausted", percentRemaining: 0 };
  if (percentRemaining <= LEVEL_CONFIG.critical.thresholdPercent) {
    return { level: "critical", percentRemaining };
  }
  if (percentRemaining <= LEVEL_CONFIG.warning.thresholdPercent) {
    return { level: "warning", percentRemaining };
  }
  return { level: null, percentRemaining };
}

async function resolveActiveQuotaAlerts({
  userId,
  db = pool,
  reason = "Quota đã được bổ sung hoặc chu kỳ gói đã thay đổi",
}) {
  const { rows } = await db.query(
    `UPDATE quota_admin_alerts
     SET status = CASE
           WHEN status = ANY($3::varchar[]) THEN 'resolved'
           ELSE status
         END,
         resolved_at = CASE
           WHEN status = ANY($3::varchar[]) THEN COALESCE(resolved_at, NOW())
           ELSE resolved_at
         END,
         state_cleared_at = COALESCE(state_cleared_at, NOW()),
         updated_at = NOW(), resolution_note = COALESCE(resolution_note, $2)
     WHERE user_id = $1
       AND state_cleared_at IS NULL
     RETURNING id`,
    [userId, reason, ACTIVE_STATUSES],
  );
  return rows;
}

async function syncQuotaAlertState({
  userId,
  quota,
  source = "transcription",
  db = pool,
}) {
  if (!userId || !quota) return { alert: null, created: false };

  await db.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
  const state = getQuotaAlertLevel(quota);
  const periodStartedAt = quota.planStartedAt || new Date().toISOString();
  if (!state.level) {
    await resolveActiveQuotaAlerts({ userId, db });
    return { alert: null, created: false };
  }

  await db.query(
    `UPDATE quota_admin_alerts
     SET status = 'resolved', resolved_at = NOW(), updated_at = NOW(),
         state_cleared_at = COALESCE(state_cleared_at, NOW()),
         resolution_note = COALESCE(
           resolution_note,
           'Hệ thống chuyển sang mức cảnh báo quota mới'
         )
     WHERE user_id = $1
       AND status = ANY($2::varchar[])
       AND (level <> $3 OR period_started_at <> $4)`,
    [
      userId,
      ACTIVE_STATUSES,
      state.level,
      periodStartedAt,
    ],
  );

  const existing = await db.query(
    `SELECT *
     FROM quota_admin_alerts
     WHERE user_id = $1
       AND level = $2
       AND status = ANY($3::varchar[])
       AND period_started_at = $4
     ORDER BY created_at DESC
     LIMIT 1`,
    [
      userId,
      state.level,
      ACTIVE_STATUSES,
      periodStartedAt,
    ],
  );

  const snapshot = {
    plan: String(quota.plan || "free"),
    periodStartedAt,
    quotaSeconds: Math.max(0, Math.round(Number(quota.quotaSeconds || 0))),
    usedSeconds: Math.max(0, Math.round(Number(quota.usedSeconds || 0))),
    remainingSeconds: Math.max(
      0,
      Math.round(Number(quota.rawRemainingSeconds ?? quota.remainingSeconds ?? 0)),
    ),
    percentRemaining: Number(state.percentRemaining.toFixed(2)),
    thresholdPercent: LEVEL_CONFIG[state.level].thresholdPercent,
    source: String(source || "transcription").slice(0, 40),
  };

  if (existing.rows[0]) {
    const { rows } = await db.query(
      `UPDATE quota_admin_alerts
       SET plan = $2, period_started_at = $3, quota_seconds = $4,
           used_seconds = $5, remaining_seconds = $6,
           percent_remaining = $7, threshold_percent = $8,
           source = $9, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        existing.rows[0].id,
        snapshot.plan,
        snapshot.periodStartedAt,
        snapshot.quotaSeconds,
        snapshot.usedSeconds,
        snapshot.remainingSeconds,
        snapshot.percentRemaining,
        snapshot.thresholdPercent,
        snapshot.source,
      ],
    );
    return { alert: rows[0], created: false };
  }

  const latestSameLevel = await db.query(
    `SELECT * FROM quota_admin_alerts
     WHERE user_id = $1 AND level = $2 AND period_started_at = $3
     ORDER BY created_at DESC LIMIT 1`,
    [userId, state.level, snapshot.periodStartedAt],
  );
  if (
    latestSameLevel.rows[0]?.status === "resolved" &&
    !latestSameLevel.rows[0]?.state_cleared_at
  ) {
    return {
      alert: latestSameLevel.rows[0],
      created: false,
      suppressed: true,
    };
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO quota_admin_alerts (
         user_id, plan, period_started_at, level, quota_seconds,
         used_seconds, remaining_seconds, percent_remaining,
         threshold_percent, source
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        userId,
        snapshot.plan,
        snapshot.periodStartedAt,
        state.level,
        snapshot.quotaSeconds,
        snapshot.usedSeconds,
        snapshot.remainingSeconds,
        snapshot.percentRemaining,
        snapshot.thresholdPercent,
        snapshot.source,
      ],
    );
    return { alert: rows[0], created: true, suppressed: false };
  } catch (error) {
    if (error.code !== "23505") throw error;
    const { rows } = await db.query(
      `SELECT * FROM quota_admin_alerts
       WHERE user_id = $1 AND level = $2
         AND status = ANY($3::varchar[])
       ORDER BY created_at DESC LIMIT 1`,
      [userId, state.level, ACTIVE_STATUSES],
    );
    return { alert: rows[0] || null, created: false };
  }
}

function getAdminAlertRecipients() {
  const configured =
    process.env.QUOTA_ALERT_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "";
  return [...new Set(
    String(configured)
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )];
}

async function claimNextEmailAlert() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `WITH candidate AS (
         SELECT id
         FROM quota_admin_alerts
         WHERE status = ANY($1::varchar[])
           AND email_attempts < $2
           AND (
             (email_status IN ('pending', 'failed') AND next_email_attempt_at <= NOW())
             OR (email_status = 'sending' AND email_locked_until < NOW())
           )
         ORDER BY
           CASE level WHEN 'exhausted' THEN 3 WHEN 'critical' THEN 2 ELSE 1 END DESC,
           created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE quota_admin_alerts alert
       SET email_status = 'sending', email_attempts = email_attempts + 1,
           email_locked_until = NOW() + INTERVAL '5 minutes', updated_at = NOW()
       FROM candidate
       WHERE alert.id = candidate.id
       RETURNING alert.*`,
      [ACTIVE_STATUSES, getEnvInt("QUOTA_ALERT_EMAIL_MAX_ATTEMPTS", 5, 10)],
    );
    if (!rows[0]) {
      await client.query("COMMIT");
      return null;
    }
    const customer = await client.query(
      `SELECT email, first_name, last_name FROM users WHERE id = $1`,
      [rows[0].user_id],
    );
    await client.query("COMMIT");
    return { ...rows[0], ...customer.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function dispatchPendingQuotaAlertEmails({ limit = 10 } = {}) {
  const recipients = getAdminAlertRecipients();
  if (!hasSmtpConfig() || recipients.length === 0) {
    return { sent: 0, skipped: true };
  }

  let sent = 0;
  for (let index = 0; index < limit; index += 1) {
    const alert = await claimNextEmailAlert();
    if (!alert) break;
    try {
      await sendQuotaAdminAlertEmail({ recipients, alert });
      await pool.query(
        `UPDATE quota_admin_alerts
         SET email_status = 'sent', email_sent_at = NOW(),
             email_locked_until = NULL, email_last_error = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [alert.id],
      );
      sent += 1;
    } catch (error) {
      const retryMinutes = Math.min(60, 2 ** Math.max(0, alert.email_attempts - 1));
      await pool.query(
        `UPDATE quota_admin_alerts
         SET email_status = 'failed', email_locked_until = NULL,
             next_email_attempt_at = NOW() + ($2::text || ' minutes')::interval,
             email_last_error = $3, updated_at = NOW()
         WHERE id = $1`,
        [alert.id, retryMinutes, String(error.message || "Email failed").slice(0, 500)],
      );
    }
  }
  return { sent, skipped: false };
}

async function reconcileQuotaAlerts() {
  const limit = getEnvInt("QUOTA_ALERT_RECONCILE_USER_LIMIT", 5000, 50000);
  const { rows } = await pool.query(
    `SELECT id FROM users
     WHERE account_status = 'active'
     ORDER BY id ASC
     LIMIT $1`,
    [limit],
  );
  const { getQuotaStatus } = require("./quotaService");
  let nextIndex = 0;
  let updated = 0;

  async function worker() {
    while (nextIndex < rows.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const userId = rows[currentIndex].id;
      try {
        const quota = await getQuotaStatus(userId);
        const result = await syncQuotaAlertState({
          userId,
          quota,
          source: "quota_reconcile",
        });
        if (result.created) updated += 1;
      } catch (error) {
        console.error(`Quota alert reconcile failed for user ${userId}:`, error.message);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(5, rows.length) }, worker));
  return { checked: rows.length, created: updated };
}

function startQuotaAlertDispatcher() {
  if (dispatcherTimer || reconcileTimer) return;
  const emailEnabled = process.env.QUOTA_ALERT_EMAIL_ENABLED !== "false";
  const intervalMs = getEnvInt("QUOTA_ALERT_EMAIL_INTERVAL_SECONDS", 30, 3600) * 1000;
  const dispatch = () =>
    void dispatchPendingQuotaAlertEmails().catch((error) => {
      console.error("Quota alert email dispatcher error:", error.message);
    });
  void reconcileQuotaAlerts()
    .then(() => {
      if (emailEnabled) dispatch();
    })
    .catch((error) => {
      console.error("Quota alert startup reconcile error:", error.message);
    });
  if (emailEnabled) {
    dispatcherTimer = setInterval(dispatch, intervalMs);
    dispatcherTimer.unref?.();
  }
  const reconcileIntervalMs =
    getEnvInt("QUOTA_ALERT_RECONCILE_INTERVAL_MINUTES", 15, 1440) * 60 * 1000;
  reconcileTimer = setInterval(
    () => void reconcileQuotaAlerts().catch((error) => {
      console.error("Quota alert reconcile error:", error.message);
    }),
    reconcileIntervalMs,
  );
  reconcileTimer.unref?.();
}

module.exports = {
  LEVEL_CONFIG,
  dispatchPendingQuotaAlertEmails,
  getQuotaAlertLevel,
  reconcileQuotaAlerts,
  resolveActiveQuotaAlerts,
  startQuotaAlertDispatcher,
  syncQuotaAlertState,
};
