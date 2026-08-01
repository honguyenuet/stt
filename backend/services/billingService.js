const crypto = require("crypto");
const pool = require("../db");
const {
  PLAN_CONFIG,
  createHttpError,
  getPurchasedQuotaSeconds,
  getQuotaStatus,
  getRuntimePlanConfig,
  getRuntimePurchasedQuotaSeconds,
  normalizeBillingCycle,
  normalizePlan,
} = require("./quotaService");
const {
  createPaymentLink,
  getPaymentLinkInformation,
  verifyWebhook,
} = require("./payosService");
const { syncQuotaAlertState } = require("./quotaAlertService");

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const ORDER_TTL_MINUTES = Number.parseInt(
  process.env.BILLING_ORDER_TTL_MINUTES || "30",
  10,
);
const PAYMENT_PROVIDER = (process.env.PAYMENT_PROVIDER || "payos")
  .trim()
  .toLowerCase();
const ENABLE_DEMO_PAYMENTS = process.env.ENABLE_DEMO_PAYMENTS === "true";
const PAYOS_STATUS_CHECK_INTERVAL_SECONDS = Math.max(
  4,
  Number.parseInt(process.env.PAYOS_STATUS_CHECK_INTERVAL_SECONDS || "8", 10),
);
const BILLING_RECONCILE_INTERVAL_MS = Math.max(
  30_000,
  Number.parseInt(process.env.BILLING_RECONCILE_INTERVAL_MS || "60000", 10),
);
const BILLING_RECONCILE_BATCH_SIZE = Math.max(
  1,
  Math.min(
    100,
    Number.parseInt(process.env.BILLING_RECONCILE_BATCH_SIZE || "25", 10),
  ),
);
let billingReconcileTimer = null;
let billingReconcileRunning = false;

const PLAN_PRICES = {
  standard: {
    monthly: Number.parseInt(process.env.STANDARD_MONTHLY_PRICE_VND || "150000", 10),
    yearly: Number.parseInt(process.env.STANDARD_YEARLY_PRICE_VND || "1650000", 10),
  },
  special: {
    monthly: Number.parseInt(process.env.SPECIAL_MONTHLY_PRICE_VND || "449000", 10),
    yearly: Number.parseInt(process.env.SPECIAL_YEARLY_PRICE_VND || "4939000", 10),
  },
  business: {
    monthly: Number.parseInt(process.env.BUSINESS_MONTHLY_PRICE_VND || "799000", 10),
    yearly: Number.parseInt(process.env.BUSINESS_YEARLY_PRICE_VND || "8789000", 10),
  },
};

const TOP_UP_PRODUCTS = {
  topup_1h: {
    code: "topup_1h",
    label: "Mua theo lượt 1 giờ",
    quotaSeconds: 1 * 60 * 60,
    price: Number.parseInt(process.env.TOPUP_1H_PRICE_VND || "39000", 10),
    validDays: null,
  },
  topup_3h: {
    code: "topup_3h",
    label: "Mua theo lượt 3 giờ",
    quotaSeconds: 3 * 60 * 60,
    price: Number.parseInt(process.env.TOPUP_3H_PRICE_VND || "117000", 10),
    validDays: null,
  },
  topup_5h: {
    code: "topup_5h",
    label: "Mua theo lượt 5 giờ",
    quotaSeconds: 5 * 60 * 60,
    price: Number.parseInt(process.env.TOPUP_5H_PRICE_VND || "195000", 10),
    validDays: null,
  },
  topup_10h: {
    code: "topup_10h",
    label: "Mua theo lượt 10 giờ",
    quotaSeconds: 10 * 60 * 60,
    price: Number.parseInt(process.env.TOPUP_10H_PRICE_VND || "390000", 10),
    validDays: null,
  },
  topup_20h: {
    code: "topup_20h",
    label: "Mua theo lượt 20 giờ",
    quotaSeconds: 20 * 60 * 60,
    price: Number.parseInt(process.env.TOPUP_20H_PRICE_VND || "780000", 10),
    validDays: null,
  },
  topup_50h: {
    code: "topup_50h",
    label: "Mua theo lượt 50 giờ",
    quotaSeconds: 50 * 60 * 60,
    price: Number.parseInt(process.env.TOPUP_50H_PRICE_VND || "1950000", 10),
    validDays: null,
  },
  topup_100h: {
    code: "topup_100h",
    label: "Mua theo lượt 100 giờ",
    quotaSeconds: 100 * 60 * 60,
    price: Number.parseInt(process.env.TOPUP_100H_PRICE_VND || "3900000", 10),
    validDays: null,
  },
};

async function getPlanPrice(plan, billingCycle, db = pool) {
  const planName = normalizePlan(plan);
  const cycle = normalizeBillingCycle(billingCycle);
  const config = await getRuntimePlanConfig(planName, db);
  if (!config.enabled) return null;
  const monthlyPrice =
    Number.isSafeInteger(config.priceVnd) && config.priceVnd > 0
      ? config.priceVnd
      : PLAN_PRICES[planName]?.monthly;
  if (!Number.isSafeInteger(monthlyPrice) || monthlyPrice <= 0) return null;
  return cycle === "yearly" ? monthlyPrice * 11 : monthlyPrice;
}

function serializeOrder(row) {
  if (!row) return null;
  const productType = row.product_type === "top_up" ? "top_up" : "subscription";
  const topUp = productType === "top_up" ? TOP_UP_PRODUCTS[row.product_code] : null;
  const planName = normalizePlan(row.plan);
  const cycle = normalizeBillingCycle(row.billing_cycle);
  const config = PLAN_CONFIG[planName] || PLAN_CONFIG.free;
  const snapshot = row.raw_request?.planSnapshot || {};
  return {
    id: row.id,
    userId: row.user_id,
    plan: planName,
    productType,
    productCode: row.product_code || planName,
    label: topUp?.label || snapshot.label || config.label,
    billingCycle: cycle,
    quotaSeconds:
      topUp?.quotaSeconds ||
      Number(snapshot.quotaSeconds) ||
      getPurchasedQuotaSeconds(planName, cycle),
    validDays: topUp ? topUp.validDays : cycle === "yearly" ? 365 : 30,
    amount: Number(row.amount || 0),
    currency: row.currency || "VND",
    status: row.status,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    paymentUrl: row.payment_url,
    paymentCode: row.payment_code,
    paymentQrCode: row.payment_qr_code,
    paymentLinkId: row.payment_link_id,
    paymentCheckedAt: row.payment_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at,
    expiresAt: row.expires_at,
  };
}

function normalizePaymentCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function descriptionContainsPaymentCode(description, paymentCode) {
  const normalizedCode = normalizePaymentCode(paymentCode);
  return Boolean(
    normalizedCode && normalizePaymentCode(description).includes(normalizedCode),
  );
}

function createPayosOrderCode() {
  // A 15-digit integer stays within JavaScript's safe integer range and PayOS orderCode constraints.
  return Math.floor(Date.now() / 1000) * 100000 + crypto.randomInt(10000, 100000);
}

function createPaymentCode(orderCode) {
  return `VBE${String(orderCode).slice(-10)}`;
}

function getProvider() {
  if (PAYMENT_PROVIDER === "payos") return "payos";
  if (PAYMENT_PROVIDER === "demo" && ENABLE_DEMO_PAYMENTS) return "demo";
  throw createHttpError(
    503,
    "Cổng thanh toán chưa được cấu hình. Hãy đặt PAYMENT_PROVIDER=payos và thêm khóa PayOS vào backend/.env.",
  );
}

function getCheckoutUrl(orderId, result) {
  return `${FRONTEND_URL}/checkout/${orderId}?payment=${result}`;
}

function getPaymentLabel({
  plan,
  cycle,
  productType,
  productCode,
  planLabel,
}) {
  if (productType === "top_up") {
    return `${TOP_UP_PRODUCTS[productCode].label} Vbee`;
  }
  const cycleLabel = cycle === "yearly" ? "năm" : "tháng";
  return `Gói ${planLabel || PLAN_CONFIG[plan].label} Vbee ${cycleLabel}`;
}

async function listPlans(db = pool) {
  return Promise.all(
    ["free", "standard", "special", "business"].map(async (planName) => {
    const config = await getRuntimePlanConfig(planName, db);
    const monthlyPrice =
      planName === "free"
        ? 0
        : Number.isSafeInteger(config.priceVnd) && config.priceVnd > 0
          ? config.priceVnd
          : PLAN_PRICES[planName]?.monthly ?? null;
    return {
      code: planName,
      label: config.label,
      enabled: config.enabled,
      monthly: {
        price: monthlyPrice,
        quotaSeconds: config.quotaSeconds,
      },
      yearly: {
        price:
          planName === "free" || monthlyPrice === null
            ? monthlyPrice
            : monthlyPrice * 11,
        quotaSeconds:
          planName === "free"
            ? config.quotaSeconds
            : config.quotaSeconds * 12,
      },
      limits: {
        maxUploadMb: config.maxUploadMb,
        maxRecordSeconds: config.maxRecordSeconds,
        maxFileSeconds: config.maxFileSeconds,
      },
      queueWeight: config.queueWeight,
      seats: config.seats,
      retentionDays: config.retentionDays,
      apiAccess: config.apiAccess,
    };
  }),
  );
}

function listTopUps() {
  return Object.values(TOP_UP_PRODUCTS).map((product) => ({ ...product }));
}

async function createPendingOrder({
  userId,
  plan,
  productType,
  productCode,
  billingCycle,
  amount,
  provider,
  productSnapshot,
}) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ORDER_TTL_MINUTES * 60 * 1000);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const orderCode = provider === "payos" ? createPayosOrderCode() : crypto.randomUUID();
    const paymentCode =
      provider === "payos" ? createPaymentCode(orderCode) : `DEMO-${id.slice(0, 8)}`;

    try {
      const { rows } = await pool.query(
        `INSERT INTO billing_orders (
           id, user_id, plan, product_type, product_code, billing_cycle, amount, currency, status,
           provider, provider_order_id, payment_code, raw_request, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'VND', 'pending', $8, $9, $10, $11::jsonb, $12)
         RETURNING *`,
        [
          id,
          userId,
          plan,
          productType,
          productCode,
          billingCycle,
          amount,
          provider,
          String(orderCode),
          paymentCode,
          JSON.stringify({
            plan,
            productType,
            productCode,
            billingCycle,
            provider,
            orderCode: String(orderCode),
            paymentCode,
            ...(productSnapshot ? { planSnapshot: productSnapshot } : {}),
          }),
          expiresAt,
        ],
      );
      return rows[0];
    } catch (error) {
      if (error.code !== "23505" || attempt === 2) throw error;
    }
  }

  throw createHttpError(500, "Không thể tạo mã đơn hàng duy nhất");
}

async function createCheckoutOrder({
  userId,
  plan,
  billingCycle = "monthly",
  productType = "subscription",
  productCode = null,
}) {
  const normalizedProductType = productType === "top_up" ? "top_up" : "subscription";
  let planName = normalizePlan(plan);
  const cycle = normalizeBillingCycle(billingCycle);
  const topUp =
    normalizedProductType === "top_up" ? TOP_UP_PRODUCTS[productCode] : null;
  const runtimePlan =
    normalizedProductType === "subscription"
      ? await getRuntimePlanConfig(planName)
      : null;
  if (normalizedProductType === "top_up") {
    const currentPlan = await pool.query("SELECT plan FROM users WHERE id = $1", [userId]);
    if (!currentPlan.rows[0]) throw createHttpError(404, "Không tìm thấy người dùng");
    planName = normalizePlan(currentPlan.rows[0].plan);
  }
  const amount =
    topUp?.price ?? (await getPlanPrice(planName, cycle));

  if (normalizedProductType === "top_up" && !topUp) {
    throw createHttpError(400, "Gói mua thêm không hợp lệ");
  }
  if (normalizedProductType === "subscription" && planName === "free") {
    throw createHttpError(400, "Gói Free không cần thanh toán");
  }
  if (normalizedProductType === "subscription" && !runtimePlan?.enabled) {
    throw createHttpError(400, "Gói cước này hiện không nhận đăng ký mới");
  }
  if (amount === null) {
    throw createHttpError(400, "Gói cước không hợp lệ");
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw createHttpError(503, "Giá gói cước trên server chưa được cấu hình hợp lệ");
  }

  const provider = getProvider();
  const order = await createPendingOrder({
    userId,
    plan: planName,
    productType: normalizedProductType,
    productCode: topUp?.code || planName,
    billingCycle: cycle,
    amount,
    provider,
    productSnapshot: runtimePlan
      ? {
          label: runtimePlan.label,
          quotaSeconds:
            cycle === "yearly"
              ? runtimePlan.quotaSeconds * 12
              : runtimePlan.quotaSeconds,
          maxUploadMb: runtimePlan.maxUploadMb,
          maxFileSeconds: runtimePlan.maxFileSeconds,
          billingCycle: cycle,
          priceVnd: amount,
          enabled: runtimePlan.enabled,
        }
      : null,
  });

  if (provider === "demo") {
    const paymentUrl = `${FRONTEND_URL}/checkout/${order.id}`;
    const { rows } = await pool.query(
      `UPDATE billing_orders SET payment_url = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [order.id, paymentUrl],
    );
    return { order: serializeOrder(rows[0]), paymentUrl };
  }

  try {
    const paymentLink = await createPaymentLink({
      orderCode: Number(order.provider_order_id),
      amount,
      description: order.payment_code,
      itemName: getPaymentLabel({
        plan: planName,
        cycle,
        productType: normalizedProductType,
        productCode: topUp?.code || planName,
        planLabel: runtimePlan?.label,
      }),
      returnUrl: getCheckoutUrl(order.id, "return"),
      cancelUrl: getCheckoutUrl(order.id, "cancel"),
      expiresAt: new Date(order.expires_at),
    });
    const { rows } = await pool.query(
      `UPDATE billing_orders
       SET payment_url = $2,
           payment_qr_code = $3,
           payment_link_id = $4,
           raw_request = raw_request || $5::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        order.id,
        paymentLink.checkoutUrl || null,
        paymentLink.qrCode || null,
        paymentLink.paymentLinkId || null,
        JSON.stringify({
          payos: {
            orderCode: String(order.provider_order_id),
            paymentLinkId: paymentLink.paymentLinkId || null,
            createdAt: new Date().toISOString(),
          },
        }),
      ],
    );
    return { order: serializeOrder(rows[0]), paymentUrl: rows[0].payment_url };
  } catch (error) {
    await pool.query(
      `UPDATE billing_orders
       SET status = 'failed',
           raw_request = raw_request || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        order.id,
        JSON.stringify({
          payosError: error.message || "Không tạo được link thanh toán",
          failedAt: new Date().toISOString(),
        }),
      ],
    );
    throw error;
  }
}

async function reconcilePayosOrder(row) {
  if (!row || row.provider !== "payos" || row.status !== "pending") {
    return serializeOrder(row);
  }

  const claim = await pool.query(
    `UPDATE billing_orders
     SET payment_checked_at = NOW()
     WHERE id = $1
       AND status = 'pending'
       AND (
         payment_checked_at IS NULL
         OR payment_checked_at < NOW() - ($2 * INTERVAL '1 second')
       )
     RETURNING *`,
    [row.id, PAYOS_STATUS_CHECK_INTERVAL_SECONDS],
  );
  const order = claim.rows[0];
  if (!order) return serializeOrder(row);

  const payment = await getPaymentLinkInformation(order.provider_order_id);
  if (String(payment.orderCode) !== String(order.provider_order_id)) {
    throw createHttpError(400, "Mã đơn PayOS không khớp với đơn hàng");
  }
  if (
    order.payment_link_id &&
    payment.id &&
    String(payment.id) !== String(order.payment_link_id)
  ) {
    throw createHttpError(400, "Mã link PayOS không khớp với đơn hàng");
  }
  if (Number(payment.amount) !== Number(order.amount)) {
    throw createHttpError(400, "Số tiền yêu cầu trên PayOS không khớp");
  }
  const paymentStatus = String(payment.status || "").toUpperCase();
  if (paymentStatus !== "PAID") {
    const expiresAt = order.expires_at ? new Date(order.expires_at) : null;
    const expiredLocally =
      expiresAt && expiresAt.getTime() + 5 * 60 * 1000 < Date.now();
    const terminalStatus =
      paymentStatus === "CANCELLED"
        ? "cancelled"
        : paymentStatus === "EXPIRED" || expiredLocally
          ? "expired"
          : null;
    if (!terminalStatus) return serializeOrder(order);

    const terminal = await pool.query(
      `UPDATE billing_orders
       SET status = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [order.id, terminalStatus],
    );
  return serializeOrder(terminal.rows[0] || { ...order, status: terminalStatus });
  }
  if (Number(payment.amountPaid || 0) < Number(order.amount)) {
    throw createHttpError(400, "PayOS chưa ghi nhận đủ số tiền của đơn hàng");
  }

  const transactions = Array.isArray(payment.transactions)
    ? payment.transactions
    : [];
  const matchingTransactions = transactions.filter((transaction) =>
    descriptionContainsPaymentCode(transaction.description, order.payment_code),
  );
  if (matchingTransactions.length === 0) {
    throw createHttpError(400, "Không tìm thấy đúng mã đơn trong giao dịch PayOS");
  }

  const matchedAmount = matchingTransactions.reduce(
    (total, transaction) => total + Number(transaction.amount || 0),
    0,
  );
  if (matchedAmount < Number(order.amount)) {
    throw createHttpError(400, "Các giao dịch đúng mã đơn chưa thanh toán đủ tiền");
  }

  const transaction = matchingTransactions[0];
  return completePaidOrder({
    provider: "payos",
    providerOrderId: order.provider_order_id,
    amount: order.amount,
    paymentCode: order.payment_code,
    transactionId: transaction.reference || payment.id,
    paidAt: transaction.transactionDateTime,
    rawPayload: {
      provider: "payos",
      source: "status_reconciliation",
      reconciledAt: new Date().toISOString(),
      paymentLinkId: payment.id || null,
      orderCode: payment.orderCode,
      status: payment.status,
      amount: payment.amount,
      amountPaid: payment.amountPaid,
      transaction: {
        reference: transaction.reference || null,
        amount: transaction.amount,
        description: transaction.description,
        transactionDateTime: transaction.transactionDateTime || null,
      },
    },
  });
}

async function reconcileExpiredPendingOrders() {
  const { rows } = await pool.query(
    `SELECT *
     FROM billing_orders
     WHERE provider = 'payos'
       AND status = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at + INTERVAL '5 minutes' < NOW()
     ORDER BY expires_at ASC
     LIMIT $1`,
    [BILLING_RECONCILE_BATCH_SIZE],
  );

  let reconciled = 0;
  for (const order of rows) {
    try {
      await reconcilePayosOrder(order);
      reconciled += 1;
    } catch (error) {
      console.error(
        `PayOS background reconciliation failed for order ${order.id}:`,
        error.message,
      );
    }
  }
  return reconciled;
}

function startBillingReconciliationDispatcher() {
  if (billingReconcileTimer) return;

  const run = async () => {
    if (billingReconcileRunning) return;
    billingReconcileRunning = true;
    try {
      await reconcileExpiredPendingOrders();
    } catch (error) {
      console.error("PayOS background reconciliation failed:", error.message);
    } finally {
      billingReconcileRunning = false;
    }
  };

  void run();
  billingReconcileTimer = setInterval(
    () => void run(),
    BILLING_RECONCILE_INTERVAL_MS,
  );
  billingReconcileTimer.unref?.();
}

async function getOrderForUser(userId, orderId) {
  const { rows } = await pool.query(
    `SELECT * FROM billing_orders WHERE id = $1 AND user_id = $2`,
    [orderId, userId],
  );
  if (!rows[0]) throw createHttpError(404, "Không tìm thấy đơn hàng");

  try {
    return await reconcilePayosOrder(rows[0]);
  } catch (error) {
    console.error(`PayOS reconciliation failed for order ${orderId}:`, error.message);
    return serializeOrder(rows[0]);
  }
}

async function listUserOrders(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM billing_orders
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [userId],
  );
  return rows.map(serializeOrder);
}

async function cancelActivePlan(userId) {
  const { rows } = await pool.query(
    `UPDATE users
     SET plan_cancel_at_period_end = TRUE,
         plan_cancellation_requested_at = NOW()
     WHERE id = $1
       AND plan <> 'free'
       AND (plan_expires_at IS NULL OR plan_expires_at > NOW())
     RETURNING id`,
    [userId],
  );
  if (!rows[0]) {
    throw createHttpError(400, "Tài khoản không có gói trả phí đang hoạt động");
  }
  return getQuotaStatus(userId);
}

async function resumeActivePlan(userId) {
  const { rows } = await pool.query(
    `UPDATE users
     SET plan_cancel_at_period_end = FALSE,
         plan_cancellation_requested_at = NULL
     WHERE id = $1
       AND plan <> 'free'
       AND plan_cancel_at_period_end = TRUE
       AND (plan_expires_at IS NULL OR plan_expires_at > NOW())
     RETURNING id`,
    [userId],
  );
  if (!rows[0]) {
    throw createHttpError(400, "Gói cước không có yêu cầu hủy cần hoàn tác");
  }
  return getQuotaStatus(userId);
}

async function completePaidOrder({
  provider,
  providerOrderId,
  amount,
  paymentCode,
  transactionId,
  paidAt = null,
  rawPayload,
}) {
  const client = await pool.connect();
  let transactionClosed = false;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT * FROM billing_orders
       WHERE provider = $1 AND provider_order_id = $2
       FOR UPDATE`,
      [provider, String(providerOrderId)],
    );
    const order = rows[0];
    if (!order) throw createHttpError(404, "Không tìm thấy đơn hàng thanh toán");

    if (order.status === "paid") {
      await client.query("COMMIT");
      transactionClosed = true;
      return serializeOrder(order);
    }

    if (order.status !== "pending") {
      throw createHttpError(400, `Đơn hàng đang ở trạng thái ${order.status}`);
    }

    const paidAtDate = paidAt ? new Date(paidAt) : null;
    const validPaidAt =
      paidAtDate && !Number.isNaN(paidAtDate.getTime()) ? paidAtDate : null;
    const expiresAt = order.expires_at ? new Date(order.expires_at) : null;
    const paidBeforeExpiry =
      validPaidAt &&
      expiresAt &&
      validPaidAt.getTime() <= expiresAt.getTime() + 5 * 60 * 1000;

    if (expiresAt && expiresAt.getTime() < Date.now() && !paidBeforeExpiry) {
      await client.query(
        `UPDATE billing_orders SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [order.id],
      );
      await client.query("COMMIT");
      transactionClosed = true;
      throw createHttpError(400, "Đơn hàng đã hết hạn");
    }

    if (!Number.isSafeInteger(Number(amount)) || Number(amount) !== Number(order.amount)) {
      throw createHttpError(400, "Số tiền thanh toán không khớp với đơn hàng");
    }

    if (
      order.payment_code &&
      normalizePaymentCode(paymentCode) !== normalizePaymentCode(order.payment_code)
    ) {
      throw createHttpError(400, "Nội dung chuyển khoản không khớp với đơn hàng");
    }

    const productType = order.product_type === "top_up" ? "top_up" : "subscription";
    const planName = normalizePlan(order.plan);
    const cycle = normalizeBillingCycle(order.billing_cycle);

    if (productType === "top_up") {
      const topUp = TOP_UP_PRODUCTS[order.product_code];
      if (!topUp) throw createHttpError(400, "Gói mua thêm không hợp lệ");
      const creditStartsAt = validPaidAt || new Date();
      const creditExpiresAt = topUp.validDays
        ? new Date(
            creditStartsAt.getTime() + topUp.validDays * 24 * 60 * 60 * 1000,
          )
        : null;
      await client.query(
        `INSERT INTO top_up_credits (
           user_id, billing_order_id, product_code, seconds_granted,
           remaining_seconds, starts_at, expires_at
         )
         VALUES ($1, $2, $3, $4, $4, $5, $6)
         ON CONFLICT (billing_order_id) DO NOTHING`,
        [
          order.user_id,
          order.id,
          topUp.code,
          topUp.quotaSeconds,
          creditStartsAt,
          creditExpiresAt,
        ],
      );
    } else {
      const snapshotQuotaSeconds = Number(
        order.raw_request?.planSnapshot?.quotaSeconds,
      );
      const quotaSeconds =
        Number.isSafeInteger(snapshotQuotaSeconds) && snapshotQuotaSeconds > 0
          ? snapshotQuotaSeconds
          : await getRuntimePurchasedQuotaSeconds(planName, cycle, client);
      const planExpiresAt = new Date(
        Date.now() + (cycle === "yearly" ? 365 : 30) * 24 * 60 * 60 * 1000,
      );

      await client.query(
        `UPDATE users
         SET plan = $1,
             quota_seconds = $2,
             plan_started_at = NOW(),
             plan_expires_at = $3,
             plan_cancel_at_period_end = FALSE,
             plan_cancellation_requested_at = NULL
         WHERE id = $4`,
        [planName, quotaSeconds, planExpiresAt, order.user_id],
      );
    }

    const paidOrder = await client.query(
      `UPDATE billing_orders
       SET status = 'paid',
           paid_at = COALESCE($2::timestamptz, NOW()),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [order.id, validPaidAt ? validPaidAt.toISOString() : null],
    );

    await client.query(
      `INSERT INTO payments (
         order_id, provider, provider_transaction_id, amount,
         currency, status, raw_payload, paid_at
       )
       VALUES (
         $1, $2, $3, $4, $5, 'paid', $6::jsonb,
         COALESCE($7::timestamptz, NOW())
       )`,
      [
        order.id,
        provider,
        transactionId || null,
        order.amount,
        order.currency,
        JSON.stringify(rawPayload || {}),
        validPaidAt ? validPaidAt.toISOString() : null,
      ],
    );

    await client.query("COMMIT");
    transactionClosed = true;

    try {
      const quota = await getQuotaStatus(order.user_id);
      await syncQuotaAlertState({
        userId: order.user_id,
        quota,
        source: productType === "top_up" ? "top_up_payment" : "plan_payment",
      });
    } catch (alertError) {
      console.error("Quota alert refresh after payment failed:", alertError.message);
    }

    return serializeOrder(paidOrder.rows[0]);
  } catch (error) {
    if (!transactionClosed) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function handlePayosWebhook(webhook) {
  const data = verifyWebhook(webhook);
  const order = await completePaidOrder({
    provider: "payos",
    providerOrderId: data.orderCode,
    amount: data.amount,
    paymentCode: data.description,
    transactionId: data.reference || data.paymentLinkId,
    paidAt: data.transactionDateTime,
    rawPayload: {
      provider: "payos",
      receivedAt: new Date().toISOString(),
      data,
    },
  });

  return { order };
}

async function confirmDemoPayment({ userId, orderId }) {
  if (!ENABLE_DEMO_PAYMENTS) {
    throw createHttpError(404, "Thanh toán demo đã được tắt");
  }

  const order = await getOrderForUser(userId, orderId);
  if (order.provider !== "demo") {
    throw createHttpError(400, "Đơn hàng này không sử dụng thanh toán demo");
  }

  const paidOrder = await completePaidOrder({
    provider: "demo",
    providerOrderId: order.providerOrderId,
    amount: order.amount,
    paymentCode: order.paymentCode,
    transactionId: `demo_txn_${crypto.randomUUID()}`,
    rawPayload: {
      provider: "demo",
      orderId,
      confirmedAt: new Date().toISOString(),
    },
  });

  return { order: paidOrder, quota: await getQuotaStatus(userId) };
}

module.exports = {
  cancelActivePlan,
  createCheckoutOrder,
  confirmDemoPayment,
  getOrderForUser,
  handlePayosWebhook,
  listPlans,
  listTopUps,
  listUserOrders,
  reconcileExpiredPendingOrders,
  resumeActivePlan,
  startBillingReconciliationDispatcher,
};
