require("../config/env");
const express = require("express");
const pool = require("../db");
const { optionalAuth, requireAuth } = require("../middleware/auth");
const { supportLimiter } = require("../middleware/security");

const router = express.Router();

function normalizeTicket(row) {
  return {
    id: row.id,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    email: row.email,
    name: row.name,
    pageUrl: row.page_url,
    userPlan: row.user_plan,
    latestMessage: row.latest_message || "",
    adminMessageCount: Number(row.admin_message_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMessage(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    sender: row.sender === "admin" ? "admin" : "user",
    message: row.message,
    createdAt: row.created_at,
  };
}

router.get("/tickets", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*,
              (
                SELECT m.message
                FROM support_messages m
                WHERE m.ticket_id = t.id
                ORDER BY m.created_at DESC
                LIMIT 1
              ) AS latest_message,
              (
                SELECT COUNT(*)::int
                FROM support_messages m
                WHERE m.ticket_id = t.id AND m.sender = 'admin'
              ) AS admin_message_count
       FROM support_tickets t
       WHERE t.user_id = $1
       ORDER BY t.updated_at DESC
       LIMIT 25`,
      [req.user.id],
    );

    return res.json({ tickets: rows.map(normalizeTicket) });
  } catch (error) {
    console.error("Support tickets error:", error);
    return res.status(500).json({ error: "Không tải được danh sách hỗ trợ" });
  }
});

router.post("/tickets", supportLimiter, optionalAuth, async (req, res) => {
  const message = String(req.body.message || "").trim();
  const category = String(req.body.category || "general").trim().slice(0, 60);
  const subject = String(req.body.subject || "Yêu cầu hỗ trợ Vbee")
    .trim()
    .slice(0, 200);
  const pageUrl = String(req.body.pageUrl || "").trim().slice(0, 1000);
  const email = String(req.body.email || req.user?.email || "")
    .trim()
    .toLowerCase()
    .slice(0, 255);
  const name = String(
    req.body.name ||
      [req.user?.first_name, req.user?.last_name].filter(Boolean).join(" ") ||
      "",
  )
    .trim()
    .slice(0, 255);
  const priority = String(req.body.priority || "normal").trim().slice(0, 20);
  const metadata =
    req.body.metadata && typeof req.body.metadata === "object"
      ? req.body.metadata
      : {};

  if (message.length < 2 || message.length > 10_000) {
    return res.status(400).json({ error: "Vui lòng nhập nội dung cần hỗ trợ" });
  }
  if (JSON.stringify(metadata).length > 20_000) {
    return res.status(400).json({ error: "Metadata hỗ trợ quá lớn" });
  }

  if (!req.user && !email) {
    return res
      .status(400)
      .json({ error: "Vui lòng nhập email để Vbee liên hệ lại" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ticketResult = await client.query(
      `INSERT INTO support_tickets
        (user_id, email, name, subject, category, priority, page_url, user_plan, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.user?.id || null,
        email || null,
        name || null,
        subject,
        category || "general",
        priority || "normal",
        pageUrl || null,
        req.user?.plan || null,
        metadata,
      ],
    );

    const messageResult = await client.query(
      `INSERT INTO support_messages (ticket_id, sender, message)
       VALUES ($1, 'user', $2)
       RETURNING *`,
      [ticketResult.rows[0].id, message],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      ticket: normalizeTicket({
        ...ticketResult.rows[0],
        latest_message: message,
        admin_message_count: 0,
      }),
      message: messageResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create support ticket error:", error);
    return res.status(500).json({ error: "Không gửi được yêu cầu hỗ trợ" });
  } finally {
    client.release();
  }
});

router.get("/tickets/:id/messages", requireAuth, async (req, res) => {
  const ticketId = Number(req.params.id);

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: "Ticket không hợp lệ" });
  }

  try {
    const owner = await pool.query(
      "SELECT id FROM support_tickets WHERE id = $1 AND user_id = $2",
      [ticketId, req.user.id],
    );
    if (owner.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy ticket" });
    }

    const { rows } = await pool.query(
      `SELECT id, ticket_id, sender, message, created_at
       FROM support_messages
       WHERE ticket_id = $1
       ORDER BY created_at ASC`,
      [ticketId],
    );

    return res.json({ messages: rows.map(normalizeMessage) });
  } catch (error) {
    console.error("Support messages error:", error);
    return res.status(500).json({ error: "Không tải được tin nhắn hỗ trợ" });
  }
});

router.post("/tickets/:id/messages", requireAuth, supportLimiter, async (req, res) => {
  const message = String(req.body.message || "").trim();
  const ticketId = Number(req.params.id);

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: "Ticket không hợp lệ" });
  }

  if (message.length < 2 || message.length > 10_000) {
    return res.status(400).json({ error: "Vui lòng nhập nội dung tin nhắn" });
  }

  try {
    const owner = await pool.query(
      "SELECT id FROM support_tickets WHERE id = $1 AND user_id = $2",
      [ticketId, req.user.id],
    );
    if (owner.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy ticket" });
    }

    const { rows } = await pool.query(
      `INSERT INTO support_messages (ticket_id, sender, message)
       VALUES ($1, 'user', $2)
       RETURNING *`,
      [ticketId, message],
    );
    await pool.query(
      "UPDATE support_tickets SET updated_at = NOW(), status = 'open' WHERE id = $1",
      [ticketId],
    );

    return res.status(201).json({ message: normalizeMessage(rows[0]) });
  } catch (error) {
    console.error("Support message error:", error);
    return res.status(500).json({ error: "Không gửi được tin nhắn" });
  }
});

module.exports = router;
