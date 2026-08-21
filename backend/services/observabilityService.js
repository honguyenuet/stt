const crypto = require("crypto");
const os = require("os");
const pool = require("../db");
const { getTranscriptionProviderStatus } = require("./transcriptionService");
const {
  hasSmtpConfig,
  sendOperationalAlertEmail,
} = require("./emailService");

const startedAt = new Date();
const MAX_LOG_PATH_LENGTH = 1200;
const MAX_USER_AGENT_LENGTH = 500;
const OPTIONAL_SCHEMA_ERRORS = new Set(["42P01", "42703"]);
const HTTP_5XX_ALERT_THRESHOLD = Number.parseInt(
  process.env.OBS_HTTP_5XX_ALERT_THRESHOLD || "5",
  10,
);
const FAILED_JOB_ALERT_THRESHOLD = Number.parseInt(
  process.env.OBS_FAILED_JOB_ALERT_THRESHOLD || "3",
  10,
);
const OBSERVABILITY_LOG_RETENTION_DAYS = Math.max(
  1,
  Number.parseInt(process.env.OBSERVABILITY_LOG_RETENTION_DAYS || "30", 10),
);

function hashIp(value) {
  const salt = process.env.REQUEST_LOG_IP_SALT || process.env.JWT_SECRET || "dev";
  return crypto
    .createHash("sha256")
    .update(`${salt}:${String(value || "")}`)
    .digest("hex");
}

function recordRequestMetric(req, res, durationMs) {
  if (!String(req.originalUrl || req.url || "").startsWith("/api")) return;
  const path = String(req.originalUrl || req.url || "").slice(0, MAX_LOG_PATH_LENGTH);
  const userAgent = String(req.get("user-agent") || "").slice(
    0,
    MAX_USER_AGENT_LENGTH,
  );
  const userId = req.user?.id || null;
  const apiKeyId = req.apiKey?.id || null;
  const requestId = req.requestId || res.getHeader("X-Request-Id") || "";

  void pool
    .query(
      `INSERT INTO http_request_logs (
         request_id, method, path, status_code, duration_ms,
         user_id, api_key_id, ip_hash, user_agent
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        String(requestId).slice(0, 100),
        String(req.method || "GET").slice(0, 12),
        path,
        Number(res.statusCode || 0),
        Math.max(0, Math.round(Number(durationMs || 0))),
        userId,
        apiKeyId,
        hashIp(req.ip),
        userAgent,
      ],
    )
    .catch((error) => {
      if (
        process.env.LOG_OBSERVABILITY_ERRORS === "true" &&
        !OPTIONAL_SCHEMA_ERRORS.has(error.code)
      ) {
        console.error("Request metric write failed:", error.message);
      }
    });
}

function requestMetrics() {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const elapsedNs = process.hrtime.bigint() - started;
      recordRequestMetric(req, res, Number(elapsedNs) / 1_000_000);
    });
    next();
  };
}

async function optionalQuery(db, sql) {
  try {
    return await db.query(sql);
  } catch (error) {
    if (OPTIONAL_SCHEMA_ERRORS.has(error.code)) {
      return { rows: [] };
    }
    throw error;
  }
}

async function optionalQueryParams(db, sql, params = []) {
  try {
    return await db.query(sql, params);
  } catch (error) {
    if (OPTIONAL_SCHEMA_ERRORS.has(error.code)) {
      return { rows: [] };
    }
    throw error;
  }
}

function getOperationalAlertRecipients() {
  return [
    ...new Set(
      String(process.env.OBSERVABILITY_ALERT_EMAILS || process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

async function syncOperationalAlertEvents(alerts, db = pool) {
  try {
    const activeCodes = alerts.map((alert) => alert.code);
    if (activeCodes.length > 0) {
      await optionalQueryParams(
        db,
        `UPDATE operational_alert_events
         SET status = 'resolved', resolved_at = NOW(), last_seen_at = NOW()
         WHERE status = 'active'
           AND NOT (code = ANY($1::text[]))`,
        [activeCodes],
      );
    } else {
      await optionalQuery(
        db,
        `UPDATE operational_alert_events
         SET status = 'resolved', resolved_at = NOW(), last_seen_at = NOW()
         WHERE status = 'active'`,
      );
    }

    const recipients = getOperationalAlertRecipients();
    const shouldEmail = recipients.length > 0 && hasSmtpConfig();
    for (const alert of alerts) {
      const { rows } = await optionalQueryParams(
        db,
        `INSERT INTO operational_alert_events (code, level, message, metadata)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (code) WHERE status = 'active'
         DO UPDATE SET
           level = EXCLUDED.level,
           message = EXCLUDED.message,
           last_seen_at = NOW(),
           metadata = EXCLUDED.metadata
         RETURNING *`,
        [
          alert.code,
          alert.level || "warning",
          alert.message || alert.code,
          JSON.stringify(alert),
        ],
      );
      const event = rows[0];
      if (shouldEmail && event && !event.notification_sent_at) {
        const sent = await sendOperationalAlertEmail({ recipients, alert });
        if (sent) {
          await optionalQueryParams(
            db,
            `UPDATE operational_alert_events
             SET notification_sent_at = NOW()
             WHERE id = $1`,
            [event.id],
          );
        }
      }
    }
  } catch (error) {
    if (
      process.env.LOG_OBSERVABILITY_ERRORS === "true" &&
      !OPTIONAL_SCHEMA_ERRORS.has(error.code)
    ) {
      console.error("Operational alert sync failed:", error.message);
    }
  }
}

async function listOperationalAlertEvents({ limit = 20 } = {}, db = pool) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const result = await optionalQueryParams(
    db,
    `SELECT id, code, level, message, status, first_seen_at, last_seen_at,
            resolved_at, notification_sent_at, metadata
     FROM operational_alert_events
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END,
              last_seen_at DESC
     LIMIT $1`,
    [safeLimit],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    level: row.level,
    message: row.message,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
    notificationSentAt: row.notification_sent_at,
    metadata: row.metadata || {},
  }));
}

async function cleanupObservabilityLogs({
  retentionDays = OBSERVABILITY_LOG_RETENTION_DAYS,
} = {}) {
  const days = Math.max(
    1,
    Math.min(3650, Number(retentionDays) || OBSERVABILITY_LOG_RETENTION_DAYS),
  );
  const [requests, webhooks, alerts] = await Promise.all([
    optionalQueryParams(
      pool,
      `DELETE FROM http_request_logs
       WHERE created_at < NOW() - ($1 * INTERVAL '1 day')
       RETURNING id`,
      [days],
    ),
    optionalQueryParams(
      pool,
      `DELETE FROM customer_webhook_deliveries
       WHERE created_at < NOW() - ($1 * INTERVAL '1 day')
       RETURNING id`,
      [days],
    ),
    optionalQueryParams(
      pool,
      `DELETE FROM operational_alert_events
       WHERE status = 'resolved'
         AND last_seen_at < NOW() - ($1 * INTERVAL '1 day')
       RETURNING id`,
      [days],
    ),
  ]);
  return {
    retentionDays: days,
    deletedRequestLogs: requests.rows.length,
    deletedWebhookDeliveries: webhooks.rows.length,
    deletedResolvedAlerts: alerts.rows.length,
  };
}

async function getOperationalMetrics(db = pool) {
  const [
    requests,
    slowRequests,
    queue,
    providerCircuits,
    providerAttempts,
  ] = await Promise.all([
    optionalQuery(db, `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status_code >= 500)::int AS server_errors,
        COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS client_errors,
        COALESCE(AVG(duration_ms), 0)::float AS avg_duration_ms,
        COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::float AS p95_duration_ms
      FROM http_request_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `),
    optionalQuery(db, `
      SELECT request_id, method, path, status_code, duration_ms, created_at
      FROM http_request_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY duration_ms DESC
      LIMIT 5
    `),
    optionalQuery(db, `
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
        COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
        COUNT(*) FILTER (WHERE status = 'failed' AND completed_at >= NOW() - INTERVAL '24 hours')::int AS failed_24h,
        COUNT(*) FILTER (WHERE dead_lettered = TRUE)::int AS dead_lettered,
        COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at))) FILTER (WHERE status = 'queued'), 0)::float AS avg_queue_age_seconds,
        MIN(created_at) FILTER (WHERE status = 'queued') AS oldest_queued_at
      FROM transcription_jobs
    `),
    optionalQuery(db, `
      SELECT provider, state, consecutive_failures, opened_count,
             last_error_code, last_error_message, last_failure_at,
             last_success_at, total_failures, total_successes, updated_at
      FROM transcription_provider_circuits
      ORDER BY provider ASC
    `),
    optionalQuery(db, `
      SELECT attempt->>'provider' AS provider,
             COUNT(*)::int AS attempts,
             COUNT(*) FILTER (WHERE COALESCE(attempt->>'status', '') = 'success')::int AS successes,
             COUNT(*) FILTER (WHERE COALESCE(attempt->>'status', '') <> 'success')::int AS failures
      FROM transcriptions transcript
      CROSS JOIN LATERAL jsonb_array_elements(transcript.provider_attempts) attempt
      WHERE transcript.created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY attempt->>'provider'
      ORDER BY attempt->>'provider'
    `),
  ]);

  const uptimeSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  const memory = process.memoryUsage();
  const requestSummary = requests.rows[0] || {};
  const queueSummary = queue.rows[0] || {};
  const providerCircuitRows = providerCircuits.rows;
  const serverErrors = Number(requestSummary.server_errors || 0);
  const failedJobs = Number(queueSummary.failed_24h || 0);
  const deadLetteredJobs = Number(queueSummary.dead_lettered || 0);
  const openProviders = providerCircuitRows.filter(
    (row) => String(row.state || "").toLowerCase() === "open",
  );
  const alerts = [
    ...(serverErrors >= HTTP_5XX_ALERT_THRESHOLD
      ? [
          {
            code: "http_5xx_spike",
            level: "critical",
            message: `${serverErrors} lỗi HTTP 5xx trong 24 giờ qua`,
          },
        ]
      : []),
    ...(failedJobs >= FAILED_JOB_ALERT_THRESHOLD
      ? [
          {
            code: "failed_jobs_spike",
            level: "warning",
            message: `${failedJobs} job thất bại trong 24 giờ qua`,
          },
        ]
      : []),
    ...(deadLetteredJobs > 0
      ? [
          {
            code: "dead_letter_jobs",
            level: "critical",
            message: `${deadLetteredJobs} job đang nằm trong dead-letter`,
          },
        ]
      : []),
    ...openProviders.map((provider) => ({
      code: "provider_circuit_open",
      level: "critical",
      message: `Provider ${provider.provider} đang mở circuit`,
    })),
  ];
  await syncOperationalAlertEvents(alerts, db);
  const alertEvents = await listOperationalAlertEvents({ limit: 20 }, db);

  return {
    generatedAt: new Date().toISOString(),
    uptimeSeconds,
    alerts,
    alertEvents,
    logRetentionDays: OBSERVABILITY_LOG_RETENTION_DAYS,
    process: {
      startedAt: startedAt.toISOString(),
      pid: process.pid,
      node: process.version,
      host: os.hostname(),
      memoryRssMb: Math.round(memory.rss / 1024 / 1024),
      memoryHeapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    },
    requests24h: {
      total: Number(requestSummary.total || 0),
      serverErrors,
      clientErrors: Number(requestSummary.client_errors || 0),
      avgDurationMs: Math.round(Number(requestSummary.avg_duration_ms || 0)),
      p95DurationMs: Math.round(Number(requestSummary.p95_duration_ms || 0)),
      slowest: slowRequests.rows.map((row) => ({
        requestId: row.request_id,
        method: row.method,
        path: row.path,
        statusCode: Number(row.status_code),
        durationMs: Number(row.duration_ms),
        createdAt: row.created_at,
      })),
    },
    queue: {
      queued: Number(queueSummary.queued || 0),
      processing: Number(queueSummary.processing || 0),
      failed24h: failedJobs,
      deadLettered: deadLetteredJobs,
      avgQueueAgeSeconds: Math.round(
        Number(queueSummary.avg_queue_age_seconds || 0),
      ),
      oldestQueuedAt: queueSummary.oldest_queued_at || null,
    },
    providers: {
      configured: getTranscriptionProviderStatus(),
      circuits: providerCircuitRows,
      attempts24h: providerAttempts.rows.map((row) => ({
        provider: row.provider || "unknown",
        attempts: Number(row.attempts || 0),
        successes: Number(row.successes || 0),
        failures: Number(row.failures || 0),
      })),
    },
  };
}

module.exports = {
  cleanupObservabilityLogs,
  getOperationalMetrics,
  listOperationalAlertEvents,
  recordRequestMetric,
  requestMetrics,
  syncOperationalAlertEvents,
};
