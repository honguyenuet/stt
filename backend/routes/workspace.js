require("../config/env");
const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { billingLimiter } = require("../middleware/security");
const { writeSecurityAudit } = require("../services/securityAuditService");
const {
  addWorkspaceMember,
  acceptWorkspaceInvitation,
  getWorkspaceForUser,
  removeWorkspaceMember,
  transferWorkspaceOwner,
  updateWorkspaceInvoiceProfile,
  updateWorkspaceMemberRole,
  updateWorkspaceName,
} = require("../services/workspaceBillingService");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    res.json({ workspace: await getWorkspaceForUser(req.user.id) });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không tải được workspace" });
  }
});

router.patch("/", requireAuth, billingLimiter, async (req, res) => {
  try {
    const workspace = await updateWorkspaceName({
      userId: req.user.id,
      name: req.body.name,
    });
    await writeSecurityAudit({
      event: "workspace.updated",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { workspaceId: workspace.id },
    });
    res.json({ workspace });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không cập nhật được workspace" });
  }
});

router.post("/members", requireAuth, billingLimiter, async (req, res) => {
  try {
    const workspace = await addWorkspaceMember({
      userId: req.user.id,
      email: req.body.email,
      role: req.body.role,
    });
    await writeSecurityAudit({
      event: "workspace.member_added",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { email: req.body.email, role: req.body.role },
    });
    res.status(201).json({ workspace });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không thêm được thành viên" });
  }
});

router.patch("/invoice-profile", requireAuth, billingLimiter, async (req, res) => {
  try {
    const workspace = await updateWorkspaceInvoiceProfile({
      userId: req.user.id,
      invoiceProfile: req.body.invoiceProfile || req.body,
    });
    await writeSecurityAudit({
      event: "workspace.invoice_profile_updated",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { workspaceId: workspace.id },
    });
    res.json({ workspace });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không cập nhật được thông tin hóa đơn" });
  }
});

router.patch("/members/:memberId", requireAuth, billingLimiter, async (req, res) => {
  try {
    const workspace = await updateWorkspaceMemberRole({
      userId: req.user.id,
      memberId: req.params.memberId,
      role: req.body.role,
    });
    await writeSecurityAudit({
      event: "workspace.member_role_updated",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { memberId: req.params.memberId, role: req.body.role },
    });
    res.json({ workspace });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không cập nhật được thành viên" });
  }
});

router.post("/members/:memberId/transfer-owner", requireAuth, billingLimiter, async (req, res) => {
  try {
    const workspace = await transferWorkspaceOwner({
      userId: req.user.id,
      memberId: req.params.memberId,
    });
    await writeSecurityAudit({
      event: "workspace.owner_transferred",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { memberId: req.params.memberId },
    });
    res.json({ workspace });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không chuyển owner được" });
  }
});

router.delete("/members/:memberId", requireAuth, billingLimiter, async (req, res) => {
  try {
    const workspace = await removeWorkspaceMember({
      userId: req.user.id,
      memberId: req.params.memberId,
    });
    await writeSecurityAudit({
      event: "workspace.member_removed",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { memberId: req.params.memberId },
    });
    res.json({ workspace });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không gỡ được thành viên" });
  }
});

router.post("/invitations/accept", requireAuth, billingLimiter, async (req, res) => {
  try {
    const workspace = await acceptWorkspaceInvitation({
      userId: req.user.id,
      token: req.body.token,
    });
    await writeSecurityAudit({
      event: "workspace.invitation_accepted",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { workspaceId: workspace.id },
    });
    res.json({ workspace });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Không chấp nhận được lời mời" });
  }
});

module.exports = router;
