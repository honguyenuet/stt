const pool = require("../db");

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const FAILURE_THRESHOLD = positiveInt(
  process.env.PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
  3,
);
const OPEN_SECONDS = positiveInt(
  process.env.PROVIDER_CIRCUIT_OPEN_SECONDS,
  120,
);
const MAX_OPEN_SECONDS = Math.max(
  OPEN_SECONDS,
  positiveInt(process.env.PROVIDER_CIRCUIT_MAX_OPEN_SECONDS, 1800),
);
const PROBE_LOCK_SECONDS = positiveInt(
  process.env.PROVIDER_CIRCUIT_PROBE_SECONDS,
  90,
);

function isCircuitBreakerEnabled() {
  return !["false", "0", "off", "no"].includes(
    String(process.env.PROVIDER_CIRCUIT_BREAKER_ENABLED || "true")
      .trim()
      .toLowerCase(),
  );
}

function cleanProvider(provider) {
  return String(provider || "")
    .trim()
    .toLowerCase()
    .slice(0, 40);
}

function cleanErrorCode(error) {
  const status = Number(error?.statusCode || error?.status);
  if (Number.isInteger(status) && status > 0) return `HTTP_${status}`;
  return String(error?.code || error?.name || "PROVIDER_ERROR")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "_")
    .slice(0, 80);
}

function cleanErrorMessage(error) {
  return String(error?.message || "Provider không phản hồi")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

async function ensureCircuitRow(client, provider) {
  await client.query(
    `INSERT INTO transcription_provider_circuits (provider)
     VALUES ($1)
     ON CONFLICT (provider) DO NOTHING`,
    [provider],
  );
}

async function acquireProviderPermit(providerValue) {
  if (!isCircuitBreakerEnabled()) {
    return { allowed: true, state: "disabled", retryAfter: null };
  }

  const provider = cleanProvider(providerValue);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureCircuitRow(client, provider);
    const { rows } = await client.query(
      `SELECT *, NOW() AS database_now
       FROM transcription_provider_circuits
       WHERE provider = $1
       FOR UPDATE`,
      [provider],
    );
    const circuit = rows[0];
    const now = new Date(circuit.database_now);
    const openUntil = circuit.open_until
      ? new Date(circuit.open_until)
      : null;
    const probeLockedUntil = circuit.probe_locked_until
      ? new Date(circuit.probe_locked_until)
      : null;

    if (
      circuit.state === "open" &&
      openUntil &&
      openUntil.getTime() > now.getTime()
    ) {
      await client.query("COMMIT");
      return {
        allowed: false,
        state: "open",
        retryAfter: openUntil.toISOString(),
      };
    }

    if (
      circuit.state === "half_open" &&
      probeLockedUntil &&
      probeLockedUntil.getTime() > now.getTime()
    ) {
      await client.query("COMMIT");
      return {
        allowed: false,
        state: "half_open",
        retryAfter: probeLockedUntil.toISOString(),
      };
    }

    if (circuit.state !== "closed") {
      const { rows: updatedRows } = await client.query(
        `UPDATE transcription_provider_circuits
         SET state = 'half_open',
             probe_locked_until = NOW() + ($2::text || ' seconds')::interval,
             updated_at = NOW()
         WHERE provider = $1
         RETURNING probe_locked_until`,
        [provider, String(PROBE_LOCK_SECONDS)],
      );
      await client.query("COMMIT");
      return {
        allowed: true,
        state: "half_open",
        retryAfter: updatedRows[0].probe_locked_until,
      };
    }

    await client.query("COMMIT");
    return { allowed: true, state: "closed", retryAfter: null };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recordProviderSuccess(providerValue) {
  if (!isCircuitBreakerEnabled()) return;
  const provider = cleanProvider(providerValue);
  await pool.query(
    `INSERT INTO transcription_provider_circuits (
       provider, state, consecutive_failures, total_successes, last_success_at
     )
     VALUES ($1, 'closed', 0, 1, NOW())
     ON CONFLICT (provider) DO UPDATE
     SET state = 'closed',
         consecutive_failures = 0,
         open_until = NULL,
         probe_locked_until = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         last_success_at = NOW(),
         total_successes = transcription_provider_circuits.total_successes + 1,
         updated_at = NOW()`,
    [provider],
  );
}

async function recordProviderFailure(providerValue, error) {
  if (!isCircuitBreakerEnabled()) return;
  const provider = cleanProvider(providerValue);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureCircuitRow(client, provider);
    const { rows } = await client.query(
      `SELECT * FROM transcription_provider_circuits
       WHERE provider = $1
       FOR UPDATE`,
      [provider],
    );
    const circuit = rows[0];
    const failures = Number(circuit.consecutive_failures || 0) + 1;
    const shouldOpen =
      circuit.state !== "closed" || failures >= FAILURE_THRESHOLD;
    const openedCount =
      circuit.state === "open"
        ? Number(circuit.opened_count || 0)
        : Number(circuit.opened_count || 0) + (shouldOpen ? 1 : 0);
    const openSeconds = Math.min(
      MAX_OPEN_SECONDS,
      OPEN_SECONDS * Math.pow(2, Math.max(0, openedCount - 1)),
    );

    await client.query(
      `UPDATE transcription_provider_circuits
       SET state = $2::varchar(20),
           consecutive_failures = $3,
           opened_count = $4,
           open_until = CASE
             WHEN $2::varchar(20) = 'open' THEN GREATEST(
               COALESCE(open_until, NOW()),
               NOW() + ($5::text || ' seconds')::interval
             )
             ELSE NULL
           END,
           probe_locked_until = NULL,
           last_error_code = $6,
           last_error_message = $7,
           last_failure_at = NOW(),
           total_failures = total_failures + 1,
           updated_at = NOW()
       WHERE provider = $1`,
      [
        provider,
        shouldOpen ? "open" : "closed",
        failures,
        openedCount,
        String(openSeconds),
        cleanErrorCode(error),
        cleanErrorMessage(error),
      ],
    );
    await client.query("COMMIT");
  } catch (failureError) {
    await client.query("ROLLBACK").catch(() => {});
    throw failureError;
  } finally {
    client.release();
  }
}

async function getProviderCircuitStates() {
  if (!isCircuitBreakerEnabled()) return [];
  const { rows } = await pool.query(
    `SELECT provider, state, consecutive_failures, opened_count,
            open_until, probe_locked_until, last_error_code,
            last_error_message, last_failure_at, last_success_at,
            total_failures, total_successes, updated_at
     FROM transcription_provider_circuits
     ORDER BY provider`,
  );
  return rows;
}

module.exports = {
  acquireProviderPermit,
  getProviderCircuitStates,
  isCircuitBreakerEnabled,
  recordProviderFailure,
  recordProviderSuccess,
};
