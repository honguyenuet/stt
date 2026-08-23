const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const {
  assertPublicWebhookDestination,
  createWebhookSignature,
  deliverCustomerWebhook,
  normalizeCustomerWebhook,
  protectCustomerWebhook,
} = require("../services/customerWebhookService");

test("customer webhook accepts a public HTTPS callback and encrypt-ready secret", () => {
  const webhook = normalizeCustomerWebhook(
    {
      url: " https://hooks.example.com/vbee/transcription ",
      secret: "a-secure-customer-secret",
    },
    { production: true },
  );

  assert.deepEqual(webhook, {
    url: "https://hooks.example.com/vbee/transcription",
    secret: "a-secure-customer-secret",
  });
});

test("customer webhook blocks local and private network targets", () => {
  for (const url of [
    "http://localhost:3000/hook",
    "https://127.0.0.1/hook",
    "https://10.0.0.5/hook",
    "https://192.168.1.10/hook",
    "https://[::1]/hook",
    "https://[fc00::1]/hook",
    "https://[::ffff:127.0.0.1]/hook",
    "https://service.local/hook",
  ]) {
    assert.throws(
      () =>
        normalizeCustomerWebhook(
          { url, secret: "a-secure-customer-secret" },
          { production: true },
        ),
      /webhook/i,
    );
  }
});

test("customer webhook blocks public hostnames that resolve to a private address", async () => {
  await assert.rejects(
    () =>
      assertPublicWebhookDestination(
        "https://hooks.example.com/result",
        async () => [{ address: "10.20.30.40", family: 4 }],
      ),
    /mạng nội bộ/i,
  );
});

test("customer webhook requires HTTPS in production and a sufficiently long secret", () => {
  assert.throws(
    () =>
      normalizeCustomerWebhook(
        { url: "http://hooks.example.com/result", secret: "a-secure-customer-secret" },
        { production: true },
      ),
    /HTTPS/i,
  );
  assert.throws(
    () =>
      normalizeCustomerWebhook(
        { url: "https://hooks.example.com/result", secret: "short" },
        { production: true },
      ),
    /secret/i,
  );
});

test("webhook signature is an HMAC SHA-256 over the exact request body", () => {
  const body = JSON.stringify({ event: "transcription.completed", id: 42 });
  const secret = "a-secure-customer-secret";
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(createWebhookSignature(body, secret), `sha256=${expected}`);
});

test("customer webhook delivery posts signed event data", async () => {
  const secret = "a-secure-customer-secret";
  const webhook = protectCustomerWebhook(
    { url: "https://93.184.216.34/hooks/vbee", secret },
    { production: true },
  );
  let request = null;

  const result = await deliverCustomerWebhook({
    webhook,
    event: "transcription.completed",
    payload: {
      jobId: 42,
      transcriptionId: 156,
      status: "completed",
      text: "Xin chào",
      words: [{ text: "Xin", start: 0, end: 300 }],
    },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 204 };
    },
  });

  assert.deepEqual(result, { delivered: true, status: 204, attempts: 1 });
  assert.equal(request.url, "https://93.184.216.34/hooks/vbee");
  assert.equal(request.options.method, "POST");
  assert.equal(
    request.options.headers["X-Vbee-Event"],
    "transcription.completed",
  );
  assert.equal(
    request.options.headers["X-Vbee-Signature"],
    createWebhookSignature(request.options.body, secret),
  );
  const body = JSON.parse(request.options.body);
  assert.equal(body.event, "transcription.completed");
  assert.equal(body.data.jobId, 42);
  assert.equal(body.data.words[0].text, "Xin");
});
