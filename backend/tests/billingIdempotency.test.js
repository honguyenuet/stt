const test = require("node:test");
const assert = require("node:assert/strict");

function loadBillingService({ initialStatus = "pending" } = {}) {
  const dbPath = require.resolve("../db");
  const quotaPath = require.resolve("../services/quotaService");
  const payosPath = require.resolve("../services/payosService");
  const alertPath = require.resolve("../services/quotaAlertService");
  const workspacePath = require.resolve("../services/workspaceBillingService");
  const servicePath = require.resolve("../services/billingService");
  const originalEntries = new Map(
    [dbPath, quotaPath, payosPath, alertPath, workspacePath, servicePath].map(
      (key) => [key, require.cache[key]],
    ),
  );

  const counters = {
    commits: 0,
    rollbacks: 0,
    paymentRows: 0,
    topUpRows: 0,
  };
  const order = {
    id: "order-1",
    user_id: 3,
    workspace_id: 8,
    plan: "standard",
    product_type: "top_up",
    product_code: "topup_1h",
    billing_cycle: "monthly",
    amount: 39_000,
    currency: "VND",
    status: initialStatus,
    provider: "payos",
    provider_order_id: "123456",
    payment_code: "VBE123456",
    raw_request: {},
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  const client = {
    async query(sql) {
      if (/^BEGIN$/i.test(sql)) return { rows: [] };
      if (/^COMMIT$/i.test(sql)) {
        counters.commits += 1;
        return { rows: [] };
      }
      if (/^ROLLBACK$/i.test(sql)) {
        counters.rollbacks += 1;
        return { rows: [] };
      }
      if (/SELECT \* FROM billing_orders/i.test(sql)) {
        return { rows: [{ ...order }] };
      }
      if (/INSERT INTO top_up_credits/i.test(sql)) {
        counters.topUpRows += 1;
        return { rows: [] };
      }
      if (/UPDATE billing_orders[\s\S]*status = 'paid'/i.test(sql)) {
        order.status = "paid";
        order.paid_at = new Date().toISOString();
        return { rows: [{ ...order }] };
      }
      if (/INSERT INTO payments/i.test(sql)) {
        counters.paymentRows += 1;
        return { rows: [] };
      }
      throw new Error(`Unexpected billing query: ${sql}`);
    },
    release() {},
  };
  const fakePool = {
    connect: async () => client,
    query: async () => ({ rows: [] }),
  };

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: fakePool,
  };
  require.cache[quotaPath] = {
    id: quotaPath,
    filename: quotaPath,
    loaded: true,
    exports: {
      PLAN_CONFIG: {
        free: { label: "Miễn phí" },
        standard: { label: "Tiêu chuẩn" },
      },
      createHttpError(statusCode, message) {
        const error = new Error(message);
        error.statusCode = statusCode;
        return error;
      },
      getPurchasedQuotaSeconds: () => 3_600,
      getQuotaStatus: async () => ({ remainingSeconds: 3_600 }),
      getRuntimePlanConfig: async () => ({ enabled: true, priceVnd: 149_000 }),
      getRuntimePurchasedQuotaSeconds: async () => 3_600,
      normalizeBillingCycle: (value) =>
        value === "yearly" ? "yearly" : "monthly",
      normalizePlan: (value) => String(value || "free"),
    },
  };
  require.cache[payosPath] = {
    id: payosPath,
    filename: payosPath,
    loaded: true,
    exports: {
      createPaymentLink: async () => ({}),
      getPaymentLinkInformation: async () => ({}),
      verifyWebhook: (value) => value,
    },
  };
  require.cache[alertPath] = {
    id: alertPath,
    filename: alertPath,
    loaded: true,
    exports: { syncQuotaAlertState: async () => {} },
  };
  require.cache[workspacePath] = {
    id: workspacePath,
    filename: workspacePath,
    loaded: true,
    exports: {
      requireWorkspaceBillingRole: async () => ({ id: 8 }),
      resolveUserWorkspace: async () => ({ id: 8 }),
    },
  };
  delete require.cache[servicePath];
  const service = require(servicePath);

  return {
    counters,
    service,
    restore() {
      for (const [key, entry] of originalEntries) {
        if (entry) require.cache[key] = entry;
        else delete require.cache[key];
      }
    },
  };
}

test("a repeated paid callback cannot grant quota or insert payment twice", async () => {
  const fixture = loadBillingService();
  try {
    const webhook = {
      orderCode: "123456",
      amount: 39_000,
      description: "VBE123456",
      reference: "payos-ref-1",
    };
    const first = await fixture.service.handlePayosWebhook(webhook);
    const repeated = await fixture.service.handlePayosWebhook(webhook);

    assert.equal(first.order.status, "paid");
    assert.equal(repeated.order.status, "paid");
    assert.equal(fixture.counters.topUpRows, 1);
    assert.equal(fixture.counters.paymentRows, 1);
    assert.equal(fixture.counters.commits, 2);
    assert.equal(fixture.counters.rollbacks, 0);
  } finally {
    fixture.restore();
  }
});

test("a mismatched payment rolls back before changing quota", async () => {
  const fixture = loadBillingService();
  try {
    await assert.rejects(
      fixture.service.handlePayosWebhook({
        orderCode: "123456",
        amount: 1,
        description: "VBE123456",
        reference: "payos-ref-invalid",
      }),
      (error) => error.statusCode === 400 && /số tiền/i.test(error.message),
    );
    assert.equal(fixture.counters.topUpRows, 0);
    assert.equal(fixture.counters.paymentRows, 0);
    assert.equal(fixture.counters.rollbacks, 1);
  } finally {
    fixture.restore();
  }
});
