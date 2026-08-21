const crypto = require("crypto");
const pool = require("../db");
const { sendWorkspaceInviteEmail } = require("./emailService");

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const INVITE_EXPIRES_DAYS = Math.max(
  1,
  Number.parseInt(process.env.WORKSPACE_INVITE_EXPIRES_DAYS || "14", 10),
);

const WORKSPACE_ROLES = new Set(["owner", "admin", "member"]);
const BILLING_ROLES = new Set(["owner", "admin"]);

function createWorkspaceError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeWorkspaceRole(value) {
  return WORKSPACE_ROLES.has(String(value || "").toLowerCase())
    ? String(value).toLowerCase()
    : "member";
}

function normalizeWorkspaceName(value, fallback) {
  const clean = String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);
  return clean || fallback || "Workspace cá nhân";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 255);
}

function normalizeNullableText(value, maxLength) {
  const clean = String(value || "").trim().replace(/\s+/g, " ");
  return clean ? clean.slice(0, maxLength) : null;
}

function hashInviteToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function resolveUserWorkspace(userId, db = pool) {
  const existing = await db.query(
    `SELECT workspace.*, member.role AS member_role,
            COALESCE(member_counts.active_members, 1)::int AS active_members
     FROM workspace_members member
     JOIN workspaces workspace ON workspace.id = member.workspace_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS active_members
       FROM workspace_members active_member
       WHERE active_member.workspace_id = workspace.id
         AND active_member.status = 'active'
     ) member_counts ON TRUE
     WHERE member.user_id = $1
       AND member.status = 'active'
       AND workspace.status = 'active'
     ORDER BY
       COALESCE(member_counts.active_members, 1) DESC,
       CASE member.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
       workspace.created_at ASC
     LIMIT 1`,
    [userId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const userResult = await db.query(
    `SELECT id, first_name, last_name, email, plan, quota_seconds,
            quota_alert_seconds, plan_started_at, plan_expires_at,
            plan_cancel_at_period_end, plan_cancellation_requested_at
     FROM users
     WHERE id = $1`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) throw createWorkspaceError(404, "Không tìm thấy người dùng");

  const workspace = await db.query(
    `INSERT INTO workspaces (
       name, owner_user_id, plan, quota_seconds, quota_alert_seconds,
       plan_started_at, plan_expires_at, plan_cancel_at_period_end,
       plan_cancellation_requested_at
     )
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()), $7, $8, $9)
     RETURNING *`,
    [
      normalizeWorkspaceName(
        `${user.first_name || ""} ${user.last_name || ""}`.trim(),
        user.email,
      ),
      user.id,
      user.plan || "free",
      Number(user.quota_seconds || 0),
      Number(user.quota_alert_seconds || 0),
      user.plan_started_at,
      user.plan_expires_at,
      Boolean(user.plan_cancel_at_period_end),
      user.plan_cancellation_requested_at,
    ],
  );
  await db.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, status)
     VALUES ($1, $2, 'owner', 'active')
     ON CONFLICT (workspace_id, user_id) DO UPDATE
       SET role = 'owner', status = 'active', updated_at = NOW()`,
    [workspace.rows[0].id, user.id],
  );
  return { ...workspace.rows[0], member_role: "owner" };
}

async function requireWorkspaceBillingRole(userId, db = pool) {
  const workspace = await resolveUserWorkspace(userId, db);
  if (!BILLING_ROLES.has(workspace.member_role)) {
    throw createWorkspaceError(
      403,
      "Chỉ owner hoặc admin workspace được quản lý billing",
    );
  }
  return workspace;
}

async function listWorkspaceMemberIds(workspaceId, db = pool) {
  const { rows } = await db.query(
    `SELECT user_id FROM workspace_members
     WHERE workspace_id = $1 AND status = 'active'`,
    [workspaceId],
  );
  return rows.map((row) => Number(row.user_id)).filter(Number.isFinite);
}

function serializeWorkspace(row, members = []) {
  return {
    id: Number(row.id),
    name: row.name,
    ownerUserId: Number(row.owner_user_id),
    role: row.member_role || row.role || "member",
    plan: row.plan,
    quotaSeconds: Number(row.quota_seconds || 0),
    quotaAlertSeconds: Number(row.quota_alert_seconds || 0),
    planStartedAt: row.plan_started_at,
    planExpiresAt: row.plan_expires_at,
    cancelAtPeriodEnd: Boolean(row.plan_cancel_at_period_end),
    cancellationRequestedAt: row.plan_cancellation_requested_at,
    invoiceProfile: {
      companyName: row.invoice_company_name || "",
      taxCode: row.invoice_tax_code || "",
      address: row.invoice_address || "",
      invoiceEmail: row.invoice_email || "",
      billingContactEmail: row.billing_contact_email || "",
    },
    members,
    pendingInvites: row.pending_invites || [],
  };
}

async function getWorkspaceForUser(userId, db = pool) {
  const workspace = await resolveUserWorkspace(userId, db);
  const { rows } = await db.query(
    `SELECT member.id, member.user_id, member.role, member.status,
            member.created_at, account.first_name, account.last_name,
            account.email, account.avatar
     FROM workspace_members member
     JOIN users account ON account.id = member.user_id
     WHERE member.workspace_id = $1
       AND member.status = 'active'
     ORDER BY CASE member.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
              account.email ASC`,
    [workspace.id],
  );
  const invites = await db.query(
    `SELECT id, email, role, status, expires_at, created_at
     FROM workspace_invitations
     WHERE workspace_id = $1
       AND status = 'pending'
       AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [workspace.id],
  );
  return {
    ...serializeWorkspace(
      workspace,
      rows.map((row) => ({
        id: Number(row.id),
        userId: Number(row.user_id),
        role: row.role,
        status: row.status,
        name:
          `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
        email: row.email,
        avatar: row.avatar || null,
        joinedAt: row.created_at,
      })),
    ),
    pendingInvites: invites.rows.map((row) => ({
      id: Number(row.id),
      email: row.email,
      role: row.role,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })),
  };
}

async function createWorkspaceInvitation({ userId, workspace, email, role }) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `INSERT INTO workspace_invitations (
       workspace_id, email, role, token_hash, invited_by_user_id, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, role, expires_at`,
    [workspace.id, email, role, hashInviteToken(token), userId, expiresAt],
  );
  const inviter = await pool.query(
    `SELECT first_name, last_name, email FROM users WHERE id = $1`,
    [userId],
  );
  const inviterName =
    `${inviter.rows[0]?.first_name || ""} ${inviter.rows[0]?.last_name || ""}`.trim() ||
    inviter.rows[0]?.email ||
    "";
  await sendWorkspaceInviteEmail({
    to: email,
    inviterName,
    workspaceName: workspace.name,
    inviteUrl: `${FRONTEND_URL}/register?workspaceInvite=${encodeURIComponent(token)}`,
    role,
    expiresAt,
  }).catch((error) => {
    console.error("Workspace invite email failed:", error.message);
  });
  return { ...rows[0], token };
}

async function updateWorkspaceName({ userId, name }) {
  const workspace = await requireWorkspaceBillingRole(userId);
  const cleanName = normalizeWorkspaceName(name, workspace.name);
  const { rows } = await pool.query(
    `UPDATE workspaces SET name = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [workspace.id, cleanName],
  );
  return getWorkspaceForUser(userId, pool).then((summary) => ({
    ...summary,
    name: rows[0]?.name || cleanName,
  }));
}

async function addWorkspaceMember({ userId, email, role = "member" }) {
  const workspace = await requireWorkspaceBillingRole(userId);
  const memberRole = normalizeWorkspaceRole(role);
  if (memberRole === "owner") {
    throw createWorkspaceError(400, "Không thể mời thêm owner thứ hai");
  }
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !cleanEmail.includes("@")) {
    throw createWorkspaceError(400, "Email thành viên không hợp lệ");
  }
  const target = await pool.query(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [cleanEmail],
  );
  if (!target.rows[0]) {
    await createWorkspaceInvitation({
      userId,
      workspace,
      email: cleanEmail,
      role: memberRole,
    });
    return getWorkspaceForUser(userId);
  }
  if (Number(target.rows[0].id) === Number(workspace.owner_user_id)) {
    throw createWorkspaceError(400, "Người này đã là owner workspace");
  }
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (workspace_id, user_id) DO UPDATE
       SET role = EXCLUDED.role, status = 'active', updated_at = NOW()`,
    [workspace.id, target.rows[0].id, memberRole],
  );
  return getWorkspaceForUser(userId);
}

async function updateWorkspaceMemberRole({ userId, memberId, role }) {
  const workspace = await requireWorkspaceBillingRole(userId);
  const memberRole = normalizeWorkspaceRole(role);
  if (memberRole === "owner") {
    throw createWorkspaceError(400, "Chuyển owner chưa được hỗ trợ");
  }
  const { rows } = await pool.query(
    `UPDATE workspace_members
     SET role = $3, updated_at = NOW()
     WHERE id = $1
       AND workspace_id = $2
       AND role <> 'owner'
     RETURNING id`,
    [memberId, workspace.id, memberRole],
  );
  if (!rows[0]) throw createWorkspaceError(404, "Không tìm thấy thành viên");
  return getWorkspaceForUser(userId);
}

async function transferWorkspaceOwner({ userId, memberId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workspace = await resolveUserWorkspace(userId, client);
    if (workspace.member_role !== "owner") {
      throw createWorkspaceError(403, "Chỉ owner hiện tại được chuyển owner");
    }
    const target = await client.query(
      `SELECT id, user_id
       FROM workspace_members
       WHERE id = $1
         AND workspace_id = $2
         AND status = 'active'
         AND role <> 'owner'
       FOR UPDATE`,
      [memberId, workspace.id],
    );
    if (!target.rows[0]) {
      throw createWorkspaceError(404, "Không tìm thấy thành viên để chuyển owner");
    }
    await client.query(
      `UPDATE workspace_members
       SET role = CASE
         WHEN user_id = $2 THEN 'owner'
         WHEN user_id = $3 THEN 'admin'
         ELSE role
       END,
       updated_at = NOW()
       WHERE workspace_id = $1`,
      [workspace.id, target.rows[0].user_id, userId],
    );
    await client.query(
      `UPDATE workspaces
       SET owner_user_id = $2, updated_at = NOW()
       WHERE id = $1`,
      [workspace.id, target.rows[0].user_id],
    );
    await client.query("COMMIT");
    return getWorkspaceForUser(userId);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateWorkspaceInvoiceProfile({ userId, invoiceProfile = {} }) {
  const workspace = await requireWorkspaceBillingRole(userId);
  await pool.query(
    `UPDATE workspaces
     SET invoice_company_name = $2,
         invoice_tax_code = $3,
         invoice_address = $4,
         invoice_email = $5,
         billing_contact_email = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [
      workspace.id,
      normalizeNullableText(invoiceProfile.companyName, 200),
      normalizeNullableText(invoiceProfile.taxCode, 80),
      normalizeNullableText(invoiceProfile.address, 1000),
      normalizeEmail(invoiceProfile.invoiceEmail) || null,
      normalizeEmail(invoiceProfile.billingContactEmail) || null,
    ],
  );
  return getWorkspaceForUser(userId);
}

async function acceptWorkspaceInvitation({ userId, token }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query(
      `SELECT id, email FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const user = userResult.rows[0];
    if (!user) throw createWorkspaceError(404, "Không tìm thấy người dùng");
    const invitation = await client.query(
      `SELECT *
       FROM workspace_invitations
       WHERE token_hash = $1
         AND status = 'pending'
       FOR UPDATE`,
      [hashInviteToken(token)],
    );
    const invite = invitation.rows[0];
    if (!invite) throw createWorkspaceError(404, "Lời mời không hợp lệ");
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE workspace_invitations
         SET status = 'expired', updated_at = NOW()
         WHERE id = $1`,
        [invite.id],
      );
      throw createWorkspaceError(410, "Lời mời đã hết hạn");
    }
    if (normalizeEmail(user.email) !== normalizeEmail(invite.email)) {
      throw createWorkspaceError(403, "Lời mời này dành cho email khác");
    }
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, status = 'active', updated_at = NOW()`,
      [invite.workspace_id, userId, invite.role],
    );
    await client.query(
      `UPDATE workspace_invitations
       SET status = 'accepted',
           accepted_by_user_id = $2,
           accepted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [invite.id, userId],
    );
    await client.query("COMMIT");
    return getWorkspaceForUser(userId);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function removeWorkspaceMember({ userId, memberId }) {
  const workspace = await requireWorkspaceBillingRole(userId);
  const { rows } = await pool.query(
    `UPDATE workspace_members
     SET status = 'removed', updated_at = NOW()
     WHERE id = $1
       AND workspace_id = $2
       AND role <> 'owner'
     RETURNING id`,
    [memberId, workspace.id],
  );
  if (!rows[0]) throw createWorkspaceError(404, "Không tìm thấy thành viên");
  return getWorkspaceForUser(userId);
}

module.exports = {
  addWorkspaceMember,
  acceptWorkspaceInvitation,
  createWorkspaceError,
  getWorkspaceForUser,
  listWorkspaceMemberIds,
  requireWorkspaceBillingRole,
  resolveUserWorkspace,
  transferWorkspaceOwner,
  updateWorkspaceInvoiceProfile,
  updateWorkspaceMemberRole,
  updateWorkspaceName,
  removeWorkspaceMember,
};
