const crypto = require("crypto");

function createShareToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashShareToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeSharePermission(value) {
  return value === "edit" ? "edit" : "view";
}

function normalizeShareExpiry(value) {
  const days = Number.parseInt(String(value || ""), 10);
  return [1, 7, 30, 90].includes(days) ? days : 7;
}

function normalizeAuthorName(value) {
  const authorName = String(value || "Khách")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return authorName || "Khách";
}

function normalizeComment(value = {}) {
  const body = String(value.body || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!body || body.length > 2_000) {
    const error = new Error("Nội dung bình luận không hợp lệ");
    error.statusCode = 400;
    throw error;
  }
  const timestamp = Number(value.timestampMs);
  const mentions = [
    ...new Set(
      [...body.matchAll(/@([\p{L}\p{N}_.-]{1,40})/gu)].map((match) => match[1]),
    ),
  ].slice(0, 20);
  return {
    body,
    mentions,
    timestampMs:
      Number.isFinite(timestamp) && timestamp >= 0
        ? Math.min(Math.round(timestamp), 86_400_000)
        : null,
  };
}

module.exports = {
  createShareToken,
  hashShareToken,
  normalizeAuthorName,
  normalizeComment,
  normalizeShareExpiry,
  normalizeSharePermission,
};
