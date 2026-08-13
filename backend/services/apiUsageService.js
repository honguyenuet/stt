const pool = require("../db");

function toInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

async function recordApiUsage({
  apiKeyId,
  userId,
  event,
  jobId = null,
  transcriptionId = null,
  durationSeconds = 0,
  status = null,
  db = pool,
}) {
  if (!apiKeyId || !userId || !event) return;
  try {
    await db.query(
      `INSERT INTO api_key_usage_events (
         api_key_id, user_id, event, job_id, transcription_id, duration_seconds, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        apiKeyId,
        userId,
        event,
        jobId,
        transcriptionId,
        toInteger(durationSeconds),
        status,
      ],
    );
  } catch (error) {
    console.error("Record API usage error:", error.message);
  }
}

async function getApiKeyUsageSummary(userId, { db = pool } = {}) {
  const [summaryResult, keyResult, dailyResult] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE event IN ('queued', 'sync_completed', 'rejected'))::integer AS requests,
         COUNT(*) FILTER (WHERE event IN ('completed', 'sync_completed'))::integer AS completed,
         COUNT(*) FILTER (WHERE event IN ('failed', 'rejected'))::integer AS failed,
         COALESCE(SUM(duration_seconds) FILTER (WHERE event IN ('completed', 'sync_completed')), 0)::integer
           AS processed_seconds
       FROM api_key_usage_events
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [userId],
    ),
    db.query(
      `SELECT
         api_key.id,
         api_key.name,
         api_key.key_prefix,
         COUNT(event.id) FILTER (WHERE event.event IN ('queued', 'sync_completed', 'rejected'))::integer AS requests,
         COUNT(event.id) FILTER (WHERE event.event IN ('completed', 'sync_completed'))::integer AS completed,
         COUNT(event.id) FILTER (WHERE event.event IN ('failed', 'rejected'))::integer AS failed,
         COALESCE(SUM(event.duration_seconds) FILTER (WHERE event.event IN ('completed', 'sync_completed')), 0)::integer
           AS processed_seconds,
         MAX(event.created_at) AS last_event_at
       FROM api_keys api_key
       LEFT JOIN api_key_usage_events event
         ON event.api_key_id = api_key.id
        AND event.created_at >= NOW() - INTERVAL '30 days'
       WHERE api_key.user_id = $1
         AND api_key.revoked_at IS NULL
       GROUP BY api_key.id
       ORDER BY requests DESC, api_key.created_at DESC`,
      [userId],
    ),
    db.query(
      `SELECT
         TO_CHAR(day::date, 'YYYY-MM-DD') AS date,
         COUNT(event.id) FILTER (WHERE event.event IN ('queued', 'sync_completed', 'rejected'))::integer AS requests,
         COUNT(event.id) FILTER (WHERE event.event IN ('completed', 'sync_completed'))::integer AS completed,
         COUNT(event.id) FILTER (WHERE event.event IN ('failed', 'rejected'))::integer AS failed,
         COALESCE(SUM(event.duration_seconds) FILTER (WHERE event.event IN ('completed', 'sync_completed')), 0)::integer
           AS processed_seconds
       FROM GENERATE_SERIES(
         CURRENT_DATE - INTERVAL '29 days',
         CURRENT_DATE,
         INTERVAL '1 day'
       ) day
       LEFT JOIN api_key_usage_events event
         ON event.user_id = $1
        AND event.created_at >= day
        AND event.created_at < day + INTERVAL '1 day'
       GROUP BY day
       ORDER BY day ASC`,
      [userId],
    ),
  ]);

  const summary = summaryResult.rows[0] || {};
  return {
    rangeDays: 30,
    totals: {
      requests: Number(summary.requests || 0),
      completed: Number(summary.completed || 0),
      failed: Number(summary.failed || 0),
      processedSeconds: Number(summary.processed_seconds || 0),
    },
    keys: keyResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      keyPrefix: row.key_prefix,
      requests: Number(row.requests || 0),
      completed: Number(row.completed || 0),
      failed: Number(row.failed || 0),
      processedSeconds: Number(row.processed_seconds || 0),
      lastEventAt: row.last_event_at,
    })),
    daily: dailyResult.rows.map((row) => ({
      date: row.date,
      requests: Number(row.requests || 0),
      completed: Number(row.completed || 0),
      failed: Number(row.failed || 0),
      processedSeconds: Number(row.processed_seconds || 0),
    })),
  };
}

module.exports = {
  getApiKeyUsageSummary,
  recordApiUsage,
};
