require("../config/env");
const express = require("express");
const { requireAuth } = require("../middleware/auth");
const {
  billingLimiter,
  webhookLimiter,
} = require("../middleware/security");
const { writeSecurityAudit } = require("../services/securityAuditService");
const { getRequestFrontendUrl } = require("../config/security");
const {
  cancelActivePlan,
  cancelPendingOrder,
  confirmDemoPayment,
  createCheckoutOrder,
  getOrderForUser,
  handlePayosWebhook,
  listPlans,
  listTopUps,
  listUserOrders,
  resumeActivePlan,
} = require("../services/billingService");

const router = express.Router();

router.get("/plans", async (_req, res) => {
  const plans = await listPlans();
  res.json({ plans, topUps: listTopUps() });
});

// PayOS calls this endpoint directly. Do not require a user token here: the
// HMAC signature is verified before any payment or quota state is changed.
router.post("/payos/webhook", webhookLimiter, async (req, res) => {
  try {
    const result = await handlePayosWebhook(req.body);
    await writeSecurityAudit({
      event: "billing.payos_webhook",
      outcome: "success",
      req,
      metadata: { orderId: result.order?.id },
    });
    res.status(200).json({ code: "00", desc: "success" });
  } catch (error) {
    console.error("PayOS webhook rejected:", error.message);
    await writeSecurityAudit({
      event: "billing.payos_webhook",
      outcome: "rejected",
      req,
      metadata: { reason: error.message },
    });
    res
      .status(error.statusCode || 500)
      .json({ code: "01", desc: error.message || "Webhook không hợp lệ" });
  }
});

router.get("/orders", requireAuth, billingLimiter, async (req, res) => {
  try {
    res.json({ orders: await listUserOrders(req.user.id) });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không tải được đơn hàng" });
  }
});

router.get("/orders/:orderId", requireAuth, billingLimiter, async (req, res) => {
  try {
    res.json({ order: await getOrderForUser(req.user.id, req.params.orderId) });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không tải được đơn hàng" });
  }
});

router.post("/orders/:orderId/cancel", requireAuth, billingLimiter, async (req, res) => {
  try {
    const order = await cancelPendingOrder({
      userId: req.user.id,
      orderId: req.params.orderId,
    });
    await writeSecurityAudit({
      event: "billing.order_cancelled",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { orderId: order.id },
    });
    res.json({ order });
  } catch (error) {
    await writeSecurityAudit({
      event: "billing.order_cancelled",
      outcome: "rejected",
      req,
      userId: req.user.id,
      metadata: { orderId: req.params.orderId, reason: error.message },
    });
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không hủy được đơn hàng" });
  }
});

router.post("/checkout", requireAuth, billingLimiter, async (req, res) => {
  try {
    const checkout = await createCheckoutOrder({
      userId: req.user.id,
      plan: req.body.plan,
      billingCycle: req.body.billingCycle,
      productType: req.body.productType,
      productCode: req.body.productCode,
      frontendUrl: getRequestFrontendUrl(req),
    });
    await writeSecurityAudit({
      event: "billing.checkout_created",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { orderId: checkout.order?.id, plan: checkout.order?.plan },
    });
    res.status(201).json(checkout);
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không tạo được đơn hàng" });
  }
});

router.post("/subscription/cancel", requireAuth, billingLimiter, async (req, res) => {
  try {
    const quota = await cancelActivePlan(req.user.id);
    await writeSecurityAudit({
      event: "billing.subscription_cancel_requested",
      outcome: "success",
      req,
      userId: req.user.id,
    });
    res.json({ quota });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không hủy được gói cước" });
  }
});

router.post("/subscription/resume", requireAuth, billingLimiter, async (req, res) => {
  try {
    const quota = await resumeActivePlan(req.user.id);
    await writeSecurityAudit({
      event: "billing.subscription_resumed",
      outcome: "success",
      req,
      userId: req.user.id,
    });
    res.json({ quota });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không hoàn tác được yêu cầu hủy" });
  }
});

router.post("/demo/confirm", requireAuth, billingLimiter, async (req, res) => {
  try {
    const result = await confirmDemoPayment({
      userId: req.user.id,
      orderId: req.body.orderId,
    });
    res.json(result);
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không xác nhận được thanh toán" });
  }
});

module.exports = router;
