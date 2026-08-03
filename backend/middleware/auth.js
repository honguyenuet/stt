const pool = require("../db");
const { verifyAccessToken } = require("../services/sessionService");

function readBearerToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) return "";
  return authHeader.slice("Bearer ".length).trim();
}

async function authenticate(req, res, next, optional) {
  const token = readBearerToken(req);
  if (!token) {
    if (optional) return next();
    return res.status(401).json({ error: "Chưa đăng nhập" });
  }

  try {
    const decoded = verifyAccessToken(token);
    const userId = Number(decoded.sub);
    const sessionId = String(decoded.sid || "");
    const authVersion = Number(decoded.ver);
    if (!Number.isInteger(userId) || !sessionId || !Number.isInteger(authVersion)) {
      throw new Error("Invalid access token claims");
    }

    const { rows } = await pool.query(
      `SELECT account.id, account.first_name, account.last_name, account.email,
              account.avatar, account.plan, account.role, account.account_status,
              account.status, account.auth_version
       FROM users account
       JOIN auth_refresh_tokens session
         ON session.id = $2 AND session.user_id = account.id
       WHERE account.id = $1
         AND account.auth_version = $3
         AND session.revoked_at IS NULL
         AND session.expires_at > NOW()`,
      [userId, sessionId, authVersion],
    );
    if (!rows[0]) throw new Error("Revoked or expired session");
    if (rows[0].account_status !== "active" || rows[0].status !== "active") {
      return res.status(403).json({ error: "Tài khoản đã bị khóa" });
    }

    req.auth = decoded;
    req.authToken = token;
    req.user = rows[0];
    return next();
  } catch {
    return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn" });
  }
}

function requireAuth(req, res, next) {
  return authenticate(req, res, next, false);
}

function optionalAuth(req, res, next) {
  return authenticate(req, res, next, true);
}

module.exports = { optionalAuth, readBearerToken, requireAuth };
