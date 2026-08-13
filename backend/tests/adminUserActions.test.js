const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
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
