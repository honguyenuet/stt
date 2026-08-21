const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { getQuotaStatus } = require("../services/quotaService");
const {
  ensureUserWorkspace,
  getWorkspaceSeatLimit,
  normalizeWorkspaceRole,
} = require("../services/workspaceTeamService");

const router = express.Router();

async function loadMembership(userId, db = pool) {
  const workspace = await ensureUserWorkspace(userId, db);
  if (!workspace) return null;
  const members = await db.query(
    `SELECT member.user_id AS id, member.role, member.joined_at,
            account.first_name, account.last_name, account.email, account.avatar,
            account.plan
     FROM workspace_members member
     JOIN users account ON account.id = member.user_id
     WHERE member.workspace_id = $1
     ORDER BY CASE member.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
              member.joined_at ASC`,
    [workspace.id],
  );
  return { workspace, members: members.rows };
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const team = await loadMembership(req.user.id);
    if (!team) return res.status(404).json({ error: "Không tìm thấy nhóm" });
    const quota = await getQuotaStatus(req.user.id);
    return res.json({
      ...team,
      seatLimit: getWorkspaceSeatLimit(quota.plan),
      quota,
    });
  } catch (error) {
    console.error("Load team error:", error.message);
    return res.status(500).json({ error: "Không tải được nhóm làm việc" });
  }
});

router.patch("/", requireAuth, async (req, res) => {
  const name = String(req.body.name || "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 160) {
    return res.status(400).json({ error: "Tên nhóm phải có từ 1 đến 160 ký tự" });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE workspaces workspace SET name = $1, updated_at = NOW()
       FROM workspace_members member
       WHERE workspace.id = member.workspace_id AND member.user_id = $2
         AND member.role IN ('owner', 'admin')
       RETURNING workspace.id, workspace.name, workspace.owner_user_id, workspace.updated_at`,
      [name, req.user.id],
    );
    if (!rows[0]) return res.status(403).json({ error: "Bạn không có quyền đổi tên nhóm" });
    return res.json({ workspace: rows[0] });
  } catch (error) {
    console.error("Rename team error:", error.message);
    return res.status(500).json({ error: "Không đổi được tên nhóm" });
  }
});

router.post("/members", requireAuth, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const role = normalizeWorkspaceRole(req.body.role);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    return res.status(400).json({ error: "Email thành viên không hợp lệ" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const team = await loadMembership(req.user.id, client);
    const requester = team?.members.find((member) => member.id === req.user.id);
    if (!team || !requester || !["owner", "admin"].includes(requester.role)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Bạn không có quyền thêm thành viên" });
    }
    const owner = team.members.find((member) => member.role === "owner");
    const seatLimit = getWorkspaceSeatLimit(owner?.plan || "free");
    if (team.members.length >= seatLimit) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Gói hiện tại chỉ hỗ trợ ${seatLimit} thành viên` });
    }
    const account = await client.query(
      `SELECT id, first_name, last_name, email, avatar, plan
       FROM users WHERE LOWER(email) = $1 AND account_status = 'active' AND status = 'active'`,
      [email],
    );
    if (!account.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Email này chưa có tài khoản Vbee" });
    }
    const membership = await client.query(
      `SELECT workspace_id FROM workspace_members WHERE user_id = $1`,
      [account.rows[0].id],
    );
    if (membership.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Người dùng đã thuộc một nhóm làm việc" });
    }
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)`,
      [team.workspace.id, account.rows[0].id, role],
    );
    await client.query("COMMIT");
    return res.status(201).json({ member: { ...account.rows[0], role } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Add team member error:", error.message);
    return res.status(500).json({ error: "Không thêm được thành viên" });
  } finally {
    client.release();
  }
});

router.patch("/members/:userId", requireAuth, async (req, res) => {
  const memberId = Number.parseInt(req.params.userId, 10);
  const role = normalizeWorkspaceRole(req.body.role);
  if (!Number.isInteger(memberId)) return res.status(400).json({ error: "ID không hợp lệ" });
  try {
    const { rows } = await pool.query(
      `UPDATE workspace_members target SET role = $1
       FROM workspace_members requester
       WHERE requester.user_id = $2 AND requester.role = 'owner'
         AND target.workspace_id = requester.workspace_id
         AND target.user_id = $3 AND target.role <> 'owner'
       RETURNING target.user_id AS id, target.role`,
      [role, req.user.id, memberId],
    );
    if (!rows[0]) return res.status(403).json({ error: "Không thể đổi vai trò này" });
    return res.json({ member: rows[0] });
  } catch (error) {
    console.error("Update team role error:", error.message);
    return res.status(500).json({ error: "Không đổi được vai trò" });
  }
});

router.delete("/members/:userId", requireAuth, async (req, res) => {
  const memberId = Number.parseInt(req.params.userId, 10);
  if (!Number.isInteger(memberId)) return res.status(400).json({ error: "ID không hợp lệ" });
  try {
    const { rows } = await pool.query(
      `DELETE FROM workspace_members target
       USING workspace_members requester
       WHERE requester.user_id = $1 AND requester.role IN ('owner', 'admin')
         AND target.workspace_id = requester.workspace_id
         AND target.user_id = $2 AND target.role <> 'owner'
         AND (requester.role = 'owner' OR target.role = 'member')
       RETURNING target.user_id`,
      [req.user.id, memberId],
    );
    if (!rows[0]) return res.status(403).json({ error: "Không thể xóa thành viên này" });
    return res.json({ success: true });
  } catch (error) {
    console.error("Remove team member error:", error.message);
    return res.status(500).json({ error: "Không xóa được thành viên" });
  }
});

router.get("/invoices", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT billing.id, billing.product_type, billing.product_code, billing.plan,
              billing.billing_cycle, billing.amount, billing.currency, billing.status,
              billing.provider, billing.created_at, billing.paid_at
       FROM billing_orders billing
       JOIN workspaces workspace ON workspace.owner_user_id = billing.user_id
       JOIN workspace_members member ON member.workspace_id = workspace.id
       WHERE member.user_id = $1
       ORDER BY billing.created_at DESC LIMIT 100`,
      [req.user.id],
    );
    return res.json({ invoices: rows });
  } catch (error) {
    console.error("List team invoices error:", error.message);
    return res.status(500).json({ error: "Không tải được hóa đơn" });
  }
});

module.exports = router;
