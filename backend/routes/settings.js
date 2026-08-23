require("../config/env");
const express = require("express");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { resolveStoredAudioPath } = require("../services/transcriptionService");
const {
  getUserSettings,
  normalizeDictionaryText,
  saveCustomDictionary,
  savePrivacySettings,
  saveTranscriptionSettings,
} = require("../services/userSettingsService");
const {
  buildUserDataExport,
  deleteAllUserTranscriptionData,
  deleteTranscriptMedia,
  getPrivacySettings,
  savePrivacySettings,
} = require("../services/privacyCenterService");
const { writeSecurityAudit } = require("../services/securityAuditService");

const router = express.Router();

function countDictionaryEntries(text) {
  return normalizeDictionaryText(text).split("\n").filter(Boolean).length;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const settings = await getUserSettings(req.user.id);
    return res.json({
      ...settings,
      entriesCount: countDictionaryEntries(settings.customDictionary),
    });
  } catch (error) {
    console.error("Settings load error:", error);
    return res.status(500).json({ error: "Không tải được cài đặt" });
  }
});

router.patch("/dictionary", requireAuth, async (req, res) => {
  try {
    const dictionaryText =
      req.body.customDictionary ?? req.body.dictionaryText ?? "";
    const settings = await saveCustomDictionary(req.user.id, dictionaryText);
    return res.json({
      ...settings,
      entriesCount: countDictionaryEntries(settings.customDictionary),
    });
  } catch (error) {
    console.error("Dictionary save error:", error);
    return res.status(500).json({ error: "Không lưu được custom dictionary" });
  }
});

router.patch("/transcription", requireAuth, async (req, res) => {
  try {
    const transcriptionSettings =
      req.body.transcriptionSettings ?? req.body.settings ?? {};
    const settings = await saveTranscriptionSettings(
      req.user.id,
      transcriptionSettings,
    );
    return res.json({
      ...settings,
      entriesCount: countDictionaryEntries(settings.customDictionary),
    });
  } catch (error) {
    console.error("Transcription settings save error:", error);
    return res
      .status(500)
      .json({ error: "Không lưu được transcription settings" });
  }
});

router.patch("/privacy", requireAuth, async (req, res) => {
  try {
    const settings = await savePrivacySettings(
      req.user.id,
      req.body.privacySettings ?? req.body.settings ?? {},
    );
    return res.json(settings);
  } catch (error) {
    console.error("Privacy settings save error:", error.message);
    return res.status(500).json({ error: "Không lưu được cài đặt quyền riêng tư" });
  }
});

router.get("/privacy/export", requireAuth, async (req, res) => {
  try {
    const [account, settings, transcripts, folders] = await Promise.all([
      pool.query(
        `SELECT id, first_name, last_name, email, avatar, plan, role,
                account_status, email_verified, created_at
         FROM users WHERE id = $1`,
        [req.user.id],
      ),
      getUserSettings(req.user.id),
      pool.query(
        `SELECT id, folder_id, filename, file_size, duration, processing_seconds,
                text, words, segments, speaker_names, source_language,
                translated_text, translation_target_language,
                transcript_template, insights, reviewed_word_indexes, tags,
                status, error_message, created_at, completed_at
         FROM transcriptions WHERE user_id = $1 ORDER BY created_at ASC`,
        [req.user.id],
      ),
      pool.query(
        `SELECT id, name, created_at, updated_at
         FROM transcription_folders WHERE user_id = $1 ORDER BY created_at ASC`,
        [req.user.id],
      ),
    ]);
    const payload = {
      exportedAt: new Date().toISOString(),
      account: account.rows[0] || null,
      settings,
      folders: folders.rows,
      transcripts: transcripts.rows,
    };
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vbee-data-${date}.json"`,
    );
    return res.json(payload);
  } catch (error) {
    console.error("Privacy export error:", error.message);
    return res.status(500).json({ error: "Không thể xuất dữ liệu tài khoản" });
  }
});

router.delete("/privacy/media", requireAuth, async (req, res) => {
  if (String(req.body.confirmation || "").trim() !== "XOA AM THANH") {
    return res.status(400).json({ error: "Hãy nhập đúng XOA AM THANH để xác nhận" });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE transcriptions
       SET audio_filename = NULL
       WHERE user_id = $1 AND audio_filename IS NOT NULL
       RETURNING audio_filename`,
      [req.user.id],
    );
    await Promise.all(
      rows.map(({ audio_filename: filename }) =>
        fs.promises.unlink(resolveStoredAudioPath(filename)).catch(() => {}),
      ),
    );
    return res.json({ success: true, deletedFiles: rows.length });
  } catch (error) {
    console.error("Privacy media deletion error:", error.message);
    return res.status(500).json({ error: "Không thể xóa dữ liệu âm thanh" });
  }
});

router.delete("/privacy/account", requireAuth, async (req, res) => {
  if (String(req.body.confirmation || "").trim() !== "XOA TAI KHOAN") {
    return res.status(400).json({ error: "Hãy nhập đúng XOA TAI KHOAN để xác nhận" });
  }
  const client = await pool.connect();
  let audioFiles = [];
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, password, role FROM users WHERE id = $1 FOR UPDATE`,
      [req.user.id],
    );
    const user = rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Tài khoản không tồn tại" });
    }
    if (user.password) {
      const valid = await bcrypt.compare(String(req.body.password || ""), user.password);
      if (!valid) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Mật khẩu không chính xác" });
      }
    }
    if (user.role === "super_admin") {
      const adminCount = await client.query(
        `SELECT COUNT(*)::int AS count FROM users
         WHERE role = 'super_admin' AND account_status = 'active'`,
      );
      if (adminCount.rows[0].count <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Không thể xóa quản trị viên cao nhất cuối cùng" });
      }
    }
    const media = await client.query(
      `SELECT audio_filename FROM transcriptions
       WHERE user_id = $1 AND audio_filename IS NOT NULL`,
      [req.user.id],
    );
    audioFiles = media.rows.map((row) => row.audio_filename);
    await client.query("DELETE FROM users WHERE id = $1", [req.user.id]);
    await client.query("COMMIT");
    await Promise.all(
      audioFiles.map((filename) =>
        fs.promises.unlink(resolveStoredAudioPath(filename)).catch(() => {}),
      ),
    );
    return res.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Privacy account deletion error:", error.message);
    return res.status(500).json({ error: "Không thể xóa tài khoản" });
  } finally {
    client.release();
  }
});

module.exports = router;
