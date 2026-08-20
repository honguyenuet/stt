const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { shareLimiter } = require("../middleware/security");
const {
  createShareToken,
  hashShareToken,
  normalizeAuthorName,
  normalizeComment,
  normalizeShareExpiry,
  normalizeSharePermission,
} = require("../services/transcriptCollaborationService");

const router = express.Router();

function parseId(value) {
  const id = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanToken(value) {
  const token = String(value || "").trim();
  return /^[A-Za-z0-9_-]{40,100}$/.test(token) ? token : "";
}

async function findActiveShare(token, { lock = false, db = pool } = {}) {
  if (!cleanToken(token)) return null;
  const { rows } = await db.query(
    `SELECT share.id AS share_id, share.permission, share.expires_at,
            transcript.id, transcript.filename, transcript.text, transcript.words,
            transcript.speaker_names, transcript.duration, transcript.source_language,
            transcript.transcript_template, transcript.insights, transcript.tags
     FROM transcript_public_links share
     JOIN transcriptions transcript ON transcript.id = share.transcription_id
     WHERE share.token_hash = $1
       AND share.revoked_at IS NULL
       AND share.expires_at > NOW()
     ${lock ? "FOR UPDATE OF transcript" : ""}`,
    [hashShareToken(token)],
  );
  return rows[0] || null;
}

router.get("/transcripts/:id/shares", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID không hợp lệ" });
  try {
    const { rows } = await pool.query(
      `SELECT share.id, share.token_prefix, share.permission, share.expires_at,
              share.revoked_at, share.created_at
       FROM transcript_public_links share
       JOIN transcriptions transcript ON transcript.id = share.transcription_id
       WHERE share.transcription_id = $1 AND transcript.user_id = $2
       ORDER BY share.created_at DESC LIMIT 50`,
      [id, req.user.id],
    );
    return res.json({ shares: rows });
  } catch (error) {
    console.error("List transcript shares error:", error.message);
    return res.status(500).json({ error: "Không tải được liên kết chia sẻ" });
  }
});

router.post("/transcripts/:id/shares", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID không hợp lệ" });
  const permission = normalizeSharePermission(req.body.permission);
  const expiresInDays = normalizeShareExpiry(req.body.expiresInDays);
  const token = createShareToken();
  try {
    const { rows } = await pool.query(
      `INSERT INTO transcript_public_links (
         transcription_id, created_by, token_hash, token_prefix, permission, expires_at
       )
       SELECT transcript.id, $2, $3, $4, $5,
              NOW() + ($6::int * INTERVAL '1 day')
       FROM transcriptions transcript
       WHERE transcript.id = $1 AND transcript.user_id = $2
       RETURNING id, token_prefix, permission, expires_at, created_at`,
      [id, req.user.id, hashShareToken(token), token.slice(0, 10), permission, expiresInDays],
    );
    if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy bản ghi" });
    return res.status(201).json({ ...rows[0], token });
  } catch (error) {
    console.error("Create transcript share error:", error.message);
    return res.status(500).json({ error: "Không tạo được liên kết chia sẻ" });
  }
});

router.delete("/transcripts/:id/shares/:shareId", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  const shareId = parseId(req.params.shareId);
  if (!id || !shareId) return res.status(400).json({ error: "ID không hợp lệ" });
  try {
    const { rows } = await pool.query(
      `UPDATE transcript_public_links share SET revoked_at = NOW()
       FROM transcriptions transcript
       WHERE share.id = $1 AND share.transcription_id = $2
         AND transcript.id = share.transcription_id AND transcript.user_id = $3
       RETURNING share.id`,
      [shareId, id, req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy liên kết" });
    return res.json({ success: true });
  } catch (error) {
    console.error("Revoke transcript share error:", error.message);
    return res.status(500).json({ error: "Không thu hồi được liên kết" });
  }
});

router.get("/transcripts/:id/comments", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID không hợp lệ" });
  try {
    const { rows } = await pool.query(
      `SELECT comment.id, comment.author_name, comment.body, comment.mentions,
              comment.timestamp_ms, comment.created_at
       FROM transcript_comments comment
       JOIN transcriptions transcript ON transcript.id = comment.transcription_id
       WHERE comment.transcription_id = $1 AND transcript.user_id = $2
       ORDER BY comment.created_at ASC LIMIT 500`,
      [id, req.user.id],
    );
    return res.json({ comments: rows });
  } catch (error) {
    console.error("List transcript comments error:", error.message);
    return res.status(500).json({ error: "Không tải được bình luận" });
  }
});

router.post("/transcripts/:id/comments", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID không hợp lệ" });
  try {
    const comment = normalizeComment(req.body);
    const authorName = normalizeAuthorName(`${req.user.first_name} ${req.user.last_name}`);
    const { rows } = await pool.query(
      `INSERT INTO transcript_comments (
         transcription_id, user_id, content, position_ms,
         author_user_id, author_name, body, mentions, timestamp_ms
       )
       SELECT transcript.id, $2, $4, $6, $2, $3, $4, $5::jsonb, $6
       FROM transcriptions transcript
       WHERE transcript.id = $1 AND transcript.user_id = $2
       RETURNING id, author_name, body, mentions, timestamp_ms, created_at`,
      [id, req.user.id, authorName, comment.body, JSON.stringify(comment.mentions), comment.timestampMs],
    );
    if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy bản ghi" });
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Không thêm được bình luận" });
  }
});

router.get("/share/:token", shareLimiter, async (req, res) => {
  try {
    const transcript = await findActiveShare(req.params.token);
    if (!transcript) return res.status(404).json({ error: "Liên kết không tồn tại hoặc đã hết hạn" });
    const comments = await pool.query(
      `SELECT id, author_name, body, mentions, timestamp_ms, created_at
       FROM transcript_comments WHERE transcription_id = $1
       ORDER BY created_at ASC LIMIT 500`,
      [transcript.id],
    );
    return res.json({ transcript, comments: comments.rows });
  } catch (error) {
    console.error("Public transcript share error:", error.message);
    return res.status(500).json({ error: "Không tải được nội dung chia sẻ" });
  }
});

router.patch("/share/:token", shareLimiter, async (req, res) => {
  const text = String(req.body.text ?? "");
  const authorName = normalizeAuthorName(req.body.authorName);
  if (text.length > 2_000_000) return res.status(400).json({ error: "Nội dung quá dài" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transcript = await findActiveShare(req.params.token, { lock: true, db: client });
    if (!transcript) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Liên kết không tồn tại hoặc đã hết hạn" });
    }
    if (transcript.permission !== "edit") {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Liên kết này chỉ có quyền xem" });
    }
    if (String(transcript.text || "") !== text) {
      await client.query(
        `INSERT INTO transcription_versions (
           transcription_id, user_id, text, words, speaker_names, label
         )
         SELECT id, user_id, text, words, speaker_names, $2
         FROM transcriptions WHERE id = $1`,
        [transcript.id, `Chia sẻ: ${authorName}`.slice(0, 120)],
      );
      await client.query("UPDATE transcriptions SET text = $1 WHERE id = $2", [text, transcript.id]);
    }
    await client.query("COMMIT");
    return res.json({ id: transcript.id, text });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Shared transcript update error:", error.message);
    return res.status(500).json({ error: "Không lưu được nội dung" });
  } finally {
    client.release();
  }
});

router.post("/share/:token/comments", shareLimiter, async (req, res) => {
  try {
    const transcript = await findActiveShare(req.params.token);
    if (!transcript) return res.status(404).json({ error: "Liên kết không tồn tại hoặc đã hết hạn" });
    const comment = normalizeComment(req.body);
    const authorName = normalizeAuthorName(req.body.authorName);
    const { rows } = await pool.query(
      `INSERT INTO transcript_comments (
         transcription_id, content, position_ms, author_name, body, mentions, timestamp_ms
       ) VALUES ($1, $3, $5, $2, $3, $4::jsonb, $5)
       RETURNING id, author_name, body, mentions, timestamp_ms, created_at`,
      [transcript.id, authorName, comment.body, JSON.stringify(comment.mentions), comment.timestampMs],
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Không thêm được bình luận" });
  }
});

module.exports = router;
