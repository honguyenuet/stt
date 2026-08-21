require("../config/env");
const express = require("express");
const { requireAuth } = require("../middleware/auth");
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
    const settings = await savePrivacySettings(req.user.id, req.body || {});
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

module.exports = router;
