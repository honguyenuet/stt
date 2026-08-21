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

router.get("/privacy", requireAuth, async (req, res) => {
  try {
    const settings = await getPrivacySettings(req.user.id);
    return res.json({ privacy: settings });
  } catch (error) {
    console.error("Privacy settings load error:", error);
    return res.status(500).json({ error: "Không tải được privacy center" });
  }
});

router.patch("/privacy", requireAuth, async (req, res) => {
  try {
    const settings = await savePrivacySettings(
      req.user.id,
      req.body?.privacySettings ?? req.body?.settings ?? req.body ?? {},
    );
    await writeSecurityAudit({
      event: "privacy.settings_updated",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { privacy: settings },
    });
    return res.json({ privacy: settings });
  } catch (error) {
    console.error("Privacy settings save error:", error);
    return res.status(500).json({ error: "Không lưu được privacy center" });
  }
});

router.get("/privacy/export", requireAuth, async (req, res) => {
  try {
    const archive = await buildUserDataExport(req.user.id);
    await writeSecurityAudit({
      event: "privacy.data_exported",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: { bytes: archive.length },
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vbee-data-export-${req.user.id}.zip"`,
    );
    return res.send(archive);
  } catch (error) {
    console.error("Privacy export error:", error);
    return res.status(500).json({ error: "Không export được dữ liệu" });
  }
});

router.delete("/privacy/media", requireAuth, async (req, res) => {
  try {
    const result = await deleteTranscriptMedia(req.user.id, {
      olderThanDays: req.query.olderThanDays,
    });
    await writeSecurityAudit({
      event: "privacy.media_deleted",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: result,
    });
    return res.json(result);
  } catch (error) {
    console.error("Privacy media delete error:", error);
    return res.status(500).json({ error: "Không xóa được media" });
  }
});

router.delete("/privacy/transcripts", requireAuth, async (req, res) => {
  const confirmation = String(req.body?.confirmation || "");
  if (confirmation !== "DELETE") {
    return res.status(400).json({
      error: "Nhập confirmation=DELETE để xác nhận xóa vĩnh viễn.",
    });
  }
  try {
    const result = await deleteAllUserTranscriptionData(req.user.id);
    await writeSecurityAudit({
      event: "privacy.transcripts_deleted",
      outcome: "success",
      req,
      userId: req.user.id,
      metadata: result,
    });
    return res.json(result);
  } catch (error) {
    console.error("Privacy transcript delete error:", error);
    return res.status(500).json({ error: "Không xóa được dữ liệu" });
  }
});

router.delete("/privacy/account", requireAuth, async (req, res) => {
  if (String(req.body?.confirmation || "").trim() !== "XOA TAI KHOAN") {
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
      const valid = await bcrypt.compare(String(req.body?.password || ""), user.password);
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
