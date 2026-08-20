function normalizeWorkspaceRole(value) {
  return value === "admin" ? "admin" : "member";
}

function getWorkspaceSeatLimit(plan) {
  if (plan === "business") return 25;
  if (plan === "special") return 3;
  return 1;
}

async function ensureUserWorkspace(userId, db = require("../db")) {
  const existing = await db.query(
    `SELECT workspace.id, workspace.name, workspace.owner_user_id,
            member.role, workspace.created_at
     FROM workspace_members member
     JOIN workspaces workspace ON workspace.id = member.workspace_id
     WHERE member.user_id = $1`,
    [userId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const account = await db.query(
    `SELECT id, first_name, last_name FROM users WHERE id = $1`,
    [userId],
  );
  if (!account.rows[0]) return null;
  const displayName = `${account.rows[0].first_name || ""} ${account.rows[0].last_name || ""}`.trim();
  const created = await db.query(
    `INSERT INTO workspaces (owner_user_id, name)
     VALUES ($1, $2)
     RETURNING id, name, owner_user_id, created_at`,
    [userId, displayName ? `Nhóm của ${displayName}` : "Nhóm của tôi"],
  );
  await db.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [created.rows[0].id, userId],
  );
  return { ...created.rows[0], role: "owner" };
}

async function resolveQuotaScope(userId, db = require("../db")) {
  try {
    const { rows } = await db.query(
      `SELECT workspace.owner_user_id,
              ARRAY_AGG(member.user_id ORDER BY member.user_id)::integer[] AS member_ids,
              workspace.id AS workspace_id,
              workspace.name AS workspace_name
       FROM workspace_members requester
       JOIN workspaces workspace ON workspace.id = requester.workspace_id
       JOIN workspace_members member ON member.workspace_id = workspace.id
       JOIN users account ON account.id = member.user_id
         AND account.account_status = 'active' AND account.status = 'active'
       WHERE requester.user_id = $1
       GROUP BY workspace.id`,
      [userId],
    );
    if (rows[0]) {
      return {
        billingOwnerUserId: Number(rows[0].owner_user_id),
        memberIds: (rows[0].member_ids || []).map(Number).filter(Number.isInteger),
        workspaceId: Number(rows[0].workspace_id),
        workspaceName: rows[0].workspace_name,
      };
    }
  } catch (error) {
    if (error.code !== "42P01") throw error;
  }
  return {
    billingOwnerUserId: Number(userId),
    memberIds: [Number(userId)],
    workspaceId: null,
    workspaceName: null,
  };
}

module.exports = {
  ensureUserWorkspace,
  getWorkspaceSeatLimit,
  normalizeWorkspaceRole,
  resolveQuotaScope,
};
