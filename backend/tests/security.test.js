const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  isGlobalApiLimitExempt,
  securityHeaders,
} = require("../middleware/security");

function request(originalUrl) {
  return { originalUrl, url: originalUrl };
}

after(async () => {
  await pool.end();
});

test("health checks bypass the coarse global API limiter", () => {
  assert.equal(isGlobalApiLimitExempt(request("/api/health")), true);
  assert.equal(isGlobalApiLimitExempt(request("/api/health?probe=ready")), true);
});

test("PayOS webhooks use only their dedicated limiter", () => {
  assert.equal(
    isGlobalApiLimitExempt(request("/api/billing/payos/webhook")),
    true,
  );
});

test("login endpoints use their dedicated brute-force limiter", () => {
  assert.equal(isGlobalApiLimitExempt(request("/api/auth/login")), true);
  assert.equal(isGlobalApiLimitExempt(request("/api/admin/auth/login")), true);
});

test("normal API requests remain globally rate limited", () => {
  assert.equal(isGlobalApiLimitExempt(request("/api/transcribe/jobs/12")), false);
});

test("API responses include a restrictive content security policy", async () => {
  const headers = new Map();
  const response = {
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    removeHeader(name) {
      headers.delete(String(name).toLowerCase());
    },
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
  };

  await new Promise((resolve, reject) => {
    securityHeaders({}, response, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const policy = String(headers.get("content-security-policy") || "");
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
});
