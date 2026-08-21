const crypto = require("crypto");
const dns = require("dns");
const net = require("net");
const pool = require("../db");
const { IS_PRODUCTION } = require("../config/security");
const {
  decryptProviderSecret,
  encryptProviderSecret,
} = require("./providerSecrets");

const WEBHOOK_TIMEOUT_MS = Math.max(
  2_000,
  Number.parseInt(process.env.CUSTOMER_WEBHOOK_TIMEOUT_MS || "8000", 10),
);
const WEBHOOK_RETRY_ATTEMPTS = Math.min(
  3,
  Math.max(
    1,
    Number.parseInt(process.env.CUSTOMER_WEBHOOK_RETRY_ATTEMPTS || "2", 10),
  ),
);

function createWebhookError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some(
      (part) => !Number.isInteger(part) || part < 0 || part > 255,
    )
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 &&
      (parts[1] === 0 ||
        parts[1] === 2 ||
        parts[1] === 168 ||
        (parts[1] === 88 && parts[2] === 99))) ||
    (parts[0] === 198 &&
      (parts[1] === 18 ||
        parts[1] === 19 ||
        (parts[1] === 51 && parts[2] === 100))) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
    parts[0] === 0 ||
    parts[0] >= 224
  );
}

function isPrivateWebhookHost(hostname) {
  const host = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  if (net.isIPv4(host)) return isPrivateIpv4(host);
  if (net.isIPv6(host)) {
    return (
      host === "::1" ||
      host === "::" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      /^fe[89ab]/.test(host) ||
      host.startsWith("ff") ||
      host.startsWith("2001:db8:") ||
      host.startsWith("::ffff:") ||
      host.startsWith("64:ff9b:")
    );
  }
  return false;
}

async function assertPublicWebhookDestination(
  rawUrl,
  lookup = (hostname) =>
    dns.promises.lookup(hostname, { all: true, verbatim: true }),
) {
  const url = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl));
  if (isPrivateWebhookHost(url.hostname)) {
    throw createWebhookError("Webhook không được trỏ vào mạng nội bộ");
  }
  if (net.isIP(url.hostname)) return;

  const addresses = await lookup(url.hostname);
  const records = Array.isArray(addresses) ? addresses : [addresses];
  if (
    records.length === 0 ||
    records.some((record) => isPrivateWebhookHost(record?.address))
  ) {
    throw createWebhookError("Webhook không được trỏ vào mạng nội bộ");
  }
}

function normalizeCustomerWebhook(
  value,
  { production = IS_PRODUCTION } = {},
) {
  const rawUrl = String(value?.url || "").trim();
  const secret = String(value?.secret || "").trim();
  if (!rawUrl && !secret) return null;
  if (!rawUrl) throw createWebhookError("Webhook thiếu callback URL");
  if (rawUrl.length > 2048) throw createWebhookError("Webhook URL quá dài");
  if (secret.length < 16 || secret.length > 256) {
    throw createWebhookError("Webhook secret phải có từ 16 đến 256 ký tự");
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw createWebhookError("Webhook URL không hợp lệ");
  }
  if (url.username || url.password) {
    throw createWebhookError("Webhook URL không được chứa thông tin đăng nhập");
  }
  if (production && url.protocol !== "https:") {
    throw createWebhookError("Webhook production bắt buộc dùng HTTPS");
  }
  if (!production && !["http:", "https:"].includes(url.protocol)) {
    throw createWebhookError("Webhook chỉ hỗ trợ HTTP hoặc HTTPS");
  }
  if (isPrivateWebhookHost(url.hostname)) {
    throw createWebhookError("Webhook không được trỏ vào mạng nội bộ");
  }
  url.hash = "";
  return { url: url.toString(), secret };
}

function protectCustomerWebhook(value, options) {
  const webhook = normalizeCustomerWebhook(value, options);
  if (!webhook) return null;
  return {
    url: webhook.url,
    secretEncrypted: encryptProviderSecret(webhook.secret),
  };
}

function createWebhookSignature(body, secret) {
  const digest = crypto
    .createHmac("sha256", String(secret))
    .update(String(body))
    .digest("hex");
  return `sha256=${digest}`;
}

async function deliverCustomerWebhook({
  webhook,
  event,
  payload,
  fetchImpl = global.fetch,
}) {
  if (!webhook?.url || !webhook?.secretEncrypted) return { delivered: false };
  if (typeof fetchImpl !== "function") {
    throw createWebhookError("Runtime không hỗ trợ gửi webhook", 503);
  }
  const secret = decryptProviderSecret(webhook.secretEncrypted);
  await assertPublicWebhookDestination(webhook.url);
  const body = JSON.stringify({
    id: crypto.randomUUID(),
    event,
    createdAt: new Date().toISOString(),
    data: payload,
  });
  let lastError;

  for (let attempt = 1; attempt <= WEBHOOK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(webhook.url, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Vbee-Webhook/1.0",
          "X-Vbee-Event": event,
          "X-Vbee-Signature": createWebhookSignature(body, secret),
        },
        body,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (response.ok) {
        return { delivered: true, status: response.status, attempts: attempt };
      }
      lastError = new Error(`Webhook phản hồi HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < WEBHOOK_RETRY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError || new Error("Không gửi được webhook");
}

function serializeDelivery(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    apiKeyId: row.api_key_id ? Number(row.api_key_id) : null,
    jobId: row.job_id ? Number(row.job_id) : null,
    transcriptionId: row.transcription_id ? Number(row.transcription_id) : null,
    event: row.event,
    callbackUrl: row.callback_url,
    status: row.status,
    responseStatus: row.response_status ? Number(row.response_status) : null,
    attempts: Number(row.attempts || 0),
    errorMessage: row.error_message || null,
    deliveredAt: row.delivered_at || null,
    lastAttemptAt: row.last_attempt_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createWebhookDeliveryRecord({
  userId,
  apiKeyId = null,
  jobId = null,
  transcriptionId = null,
  webhook,
  event,
  payload,
}) {
  const { rows } = await pool.query(
    `INSERT INTO customer_webhook_deliveries (
       user_id, api_key_id, job_id, transcription_id, event,
       callback_url, webhook, payload
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
     RETURNING *`,
    [
      userId,
      apiKeyId || null,
      jobId || null,
      transcriptionId || null,
      event,
      webhook.url,
      JSON.stringify(webhook),
      JSON.stringify(payload || {}),
    ],
  );
  return rows[0];
}

async function updateWebhookDeliveryRecord(id, result) {
  const delivered = Boolean(result?.delivered);
  const { rows } = await pool.query(
    `UPDATE customer_webhook_deliveries
     SET status = $2,
         response_status = $3,
         attempts = GREATEST(attempts, $4),
         error_message = $5,
         delivered_at = CASE WHEN $2 = 'delivered' THEN NOW() ELSE delivered_at END,
         last_attempt_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      delivered ? "delivered" : "failed",
      result?.status || null,
      Number(result?.attempts || 1),
      delivered ? null : String(result?.error || "Không gửi được webhook").slice(0, 2000),
    ],
  );
  return rows[0];
}

async function deliverAndRecordCustomerWebhook({
  userId,
  apiKeyId = null,
  jobId = null,
  transcriptionId = null,
  webhook,
  event,
  payload,
}) {
  const delivery = await createWebhookDeliveryRecord({
    userId,
    apiKeyId,
    jobId,
    transcriptionId,
    webhook,
    event,
    payload,
  });
  try {
    const result = await deliverCustomerWebhook({ webhook, event, payload });
    return serializeDelivery(await updateWebhookDeliveryRecord(delivery.id, result));
  } catch (error) {
    await updateWebhookDeliveryRecord(delivery.id, {
      delivered: false,
      attempts: WEBHOOK_RETRY_ATTEMPTS,
      error: error.message || String(error),
    });
    throw error;
  }
}

async function listCustomerWebhookDeliveries(userId, { limit = 20 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const { rows } = await pool.query(
    `SELECT *
     FROM customer_webhook_deliveries
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, safeLimit],
  );
  return rows.map(serializeDelivery);
}

async function replayCustomerWebhookDelivery({ userId, deliveryId }) {
  const { rows } = await pool.query(
    `SELECT *
     FROM customer_webhook_deliveries
     WHERE id = $1 AND user_id = $2`,
    [deliveryId, userId],
  );
  const delivery = rows[0];
  if (!delivery) throw createWebhookError("Không tìm thấy webhook delivery", 404);

  return deliverAndRecordCustomerWebhook({
    userId,
    apiKeyId: delivery.api_key_id,
    jobId: delivery.job_id,
    transcriptionId: delivery.transcription_id,
    webhook: delivery.webhook,
    event: delivery.event,
    payload: {
      ...delivery.payload,
      replayOfDeliveryId: Number(delivery.id),
      replayedAt: new Date().toISOString(),
    },
  });
}

module.exports = {
  assertPublicWebhookDestination,
  createWebhookSignature,
  deliverAndRecordCustomerWebhook,
  deliverCustomerWebhook,
  isPrivateWebhookHost,
  listCustomerWebhookDeliveries,
  normalizeCustomerWebhook,
  protectCustomerWebhook,
  replayCustomerWebhookDelivery,
};
