const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  updateAdminSupportTicketStatus,
} = require("../services/adminSupportService");

test.after(() => pool.end());

test("CMS updates a support ticket status without PostgreSQL type ambiguity", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO support_tickets (subject, status)
       VALUES ($1, 'open')
       RETURNING id`,
      [`CMS support status ${Date.now()}`],
    );

    const updated = await updateAdminSupportTicketStatus(
      client,
      rows[0].id,
      "resolved",
    );

    assert.equal(updated.status, "resolved");
    assert.ok(updated.resolved_at);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
