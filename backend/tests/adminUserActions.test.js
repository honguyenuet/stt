const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  deleteManagedUserAccount,
  normalizeManagedUser,
  updateManagedUserPlan,
  updateManagedUserRole,
  updateManagedUserStatus,
} = require("../services/adminUserService");

test("CMS updates user status and role with PostgreSQL-safe parameters", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO users (first_name, last_name, email)
       VALUES ('CMS', 'Permission Test', $1)
       RETURNING id`,
      [`cms-permission-${Date.now()}@test.local`],
    );
    const userId = rows[0].id;

    const suspended = await updateManagedUserStatus(
      client,
      userId,
      "suspended",
    );
    assert.equal(suspended.status, "suspended");
    assert.equal(suspended.account_status, "blocked");

    const active = await updateManagedUserStatus(client, userId, "active");
    assert.equal(active.status, "active");
    assert.equal(active.account_status, "active");

    const admin = await updateManagedUserRole(client, userId, "admin");
    assert.equal(admin.admin_role, "admin");
    assert.equal(admin.role, "admin");

    const supporter = await updateManagedUserRole(client, userId, "supporter");
    assert.equal(supporter.admin_role, "supporter");
    assert.equal(supporter.role, "supporter");

    const normalUser = await updateManagedUserRole(client, userId, "user");
    assert.equal(normalUser.admin_role, "none");
    assert.equal(normalUser.role, "user");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("CMS returns plan metadata and preserves the deleted status", () => {
  const user = normalizeManagedUser({
    id: 42,
    first_name: "CMS",
    last_name: "User",
    email: "cms-user@test.local",
    admin_role: "viewer",
    role: "user",
    status: "deleted",
    account_status: "blocked",
    plan: "standard",
    quota_seconds: 7_200,
    used_seconds: 600,
    plan_started_at: "2026-08-01T00:00:00.000Z",
    plan_expires_at: "2026-09-01T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    last_login_at: null,
  });

  assert.equal(user.status, "deleted");
  assert.equal(user.plan, "standard");
  assert.equal(user.plan_started_at, "2026-08-01T00:00:00.000Z");
  assert.equal(user.plan_expires_at, "2026-09-01T00:00:00.000Z");
});

test("CMS can assign a runtime plan and then safely delete the managed account", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO users (first_name, last_name, email)
       VALUES ('CMS', 'Lifecycle Test', $1)
       RETURNING id`,
      [`cms-lifecycle-${Date.now()}@test.local`],
    );
    const userId = rows[0].id;
    const transcription = await client.query(
      `INSERT INTO transcriptions (user_id, filename, text, status)
       VALUES ($1, 'cms-lifecycle.wav', '', 'queued')
       RETURNING id`,
      [userId],
    );
    await client.query(
      `INSERT INTO transcription_jobs (user_id, transcription_id, status)
       VALUES ($1, $2, 'queued')`,
      [userId, transcription.rows[0].id],
    );

    const planned = await updateManagedUserPlan(
      client,
      userId,
      "standard",
      "yearly",
    );
    assert.equal(planned.plan, "standard");
    assert.ok(Number(planned.quota_seconds) > 0);
    assert.ok(planned.plan_expires_at);

    const deleted = await deleteManagedUserAccount(client, userId);
    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.account_status, "blocked");

    const queue = await client.query(
      "SELECT status, cancel_requested FROM transcription_jobs WHERE user_id = $1",
      [userId],
    );
    assert.equal(queue.rows[0].status, "cancelled");
    assert.equal(queue.rows[0].cancel_requested, true);

    assert.equal(await updateManagedUserStatus(client, userId, "active"), null);
    assert.equal(await updateManagedUserRole(client, userId, "admin"), null);
    assert.equal(
      await updateManagedUserPlan(client, userId, "standard", "monthly"),
      null,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
