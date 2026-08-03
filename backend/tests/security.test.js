const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  isGlobalApiLimitExempt,
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

test("normal API requests remain globally rate limited", () => {
  assert.equal(isGlobalApiLimitExempt(request("/api/transcribe/jobs/12")), false);
  assert.equal(isGlobalApiLimitExempt(request("/api/auth/login")), false);
});
