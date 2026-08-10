const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const {
  ACCESS_TOKEN_TTL_SECONDS,
  FRONTEND_URL,
  IS_PRODUCTION,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET,
  getRequestBackendUrl,
  getRequestFrontendUrl,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_TTL_DAYS,
} = require("../config/security");

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function hashRequestValue(value) {
  return crypto
    .createHmac(
      "sha256",
      process.env.AUDIT_HASH_SECRET || JWT_SECRET,
    )
    .update(String(value || "unknown"))
    .digest("hex");
}

function getRequestMetadata(req) {
  const userAgent = String(req.get?.("user-agent") || "").slice(0, 500);
  return {
    ipHash: hashRequestValue(req.ip || req.socket?.remoteAddress),
    userAgent,
    ...describeUserAgent(userAgent),
  };
}

function describeUserAgent(userAgent) {
  const ua = String(userAgent || "");
  const browserName =
    /Edg\//.test(ua)
      ? "Microsoft Edge"
      : /OPR\//.test(ua)
        ? "Opera"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Trình duyệt không xác định";
  const osName =
    /Windows/i.test(ua)
      ? "Windows"
      : /iPhone|iPad|iOS/i.test(ua)
        ? "iOS"
      : /Mac OS X|Macintosh/i.test(ua)
        ? "macOS"
      : /Android/i.test(ua)
        ? "Android"
            : /Linux/i.test(ua)
              ? "Linux"
              : "Thiết bị không xác định";
  const deviceName = /Mobile|Android|iPhone|iPad/i.test(ua)
    ? `${osName} mobile`
    : `${osName} desktop`;
  return { browserName, osName, deviceName };
}

function normalizeSession(row, currentSessionId = "") {
  return {
    id: row.id,
    current: row.id === currentSessionId,
    deviceName: row.device_name || describeUserAgent(row.user_agent).deviceName,
    browserName: row.browser_name || describeUserAgent(row.user_agent).browserName,
    osName: row.os_name || describeUserAgent(row.user_agent).osName,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at || row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
  };
}

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    const key = cookie.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function readRefreshToken(req) {
  return readCookie(req, REFRESH_COOKIE_NAME);
}

function getCookieSite(urlValue) {
  try {
    const url = new URL(urlValue);
    const hostname = url.hostname.toLowerCase();
    const parts = hostname.split(".");
    const site =
      hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
        ? hostname
        : parts.slice(-2).join(".");
    return `${url.protocol}//${site}`;
  } catch {
    return "";
  }
}

function getRefreshCookieOptions(req = null) {
  const frontendUrl = req ? getRequestFrontendUrl(req) : FRONTEND_URL;
  const backendUrl = req
    ? getRequestBackendUrl(req)
    : String(process.env.PUBLIC_BACKEND_URL || "").trim();
  const frontendSite = getCookieSite(frontendUrl);
  const backendSite = getCookieSite(backendUrl || frontendUrl);
  const crossSite = Boolean(
    frontendSite && backendSite && frontendSite !== backendSite,
  );
  const secure =
    IS_PRODUCTION ||
    String(backendUrl || "").startsWith("https://") ||
    req?.secure === true ||
    req?.protocol === "https";

  return {
    httpOnly: true,
    secure,
    sameSite: crossSite && secure ? "none" : "strict",
    path: "/",
  };
}

function setRefreshCookie(req, res, rawToken) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    ...getRefreshCookieOptions(req),
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res, req = null) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    ...getRefreshCookieOptions(req),
  });
}

function createAccessToken(user, sessionId) {
  return jwt.sign(
    {
      email: user.email,
      sid: sessionId,
      ver: Number(user.auth_version || 0),
    },
    JWT_SECRET,
    {
      algorithm: "HS256",
      audience: JWT_AUDIENCE,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      issuer: JWT_ISSUER,
      jwtid: crypto.randomUUID(),
      subject: String(user.id),
    },
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
  });
}

function makeRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

async function insertSession(db, { userId, sessionId, rawToken, req }) {
  const metadata = getRequestMetadata(req);
  await db.query(
    `INSERT INTO auth_refresh_tokens (
       id, user_id, token_hash, expires_at, ip_hash, user_agent,
       device_name, browser_name, os_name, last_seen_at
     )
     VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 day'), $5, $6, $7, $8, $9, NOW())`,
    [
      sessionId,
      userId,
      hashToken(rawToken),
      REFRESH_TOKEN_TTL_DAYS,
      metadata.ipHash,
      metadata.userAgent,
      metadata.deviceName,
      metadata.browserName,
      metadata.osName,
    ],
  );
  return metadata;
}

async function issueSession(user, req, res, db = pool) {
  const sessionId = crypto.randomUUID();
  const rawToken = makeRefreshToken();
  const metadata = await insertSession(db, { userId: user.id, sessionId, rawToken, req });
  setRefreshCookie(req, res, rawToken);
  return {
    token: createAccessToken(user, sessionId),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    sessionId,
    metadata,
  };
}

async function rotateSession(req, res) {
  const rawToken = readRefreshToken(req);
  if (!rawToken) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT session.*, account.email, account.auth_version
       FROM auth_refresh_tokens session
       JOIN users account ON account.id = session.user_id
       WHERE session.token_hash = $1
       FOR UPDATE OF session, account`,
      [hashToken(rawToken)],
    );
    const current = rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      clearRefreshCookie(res, req);
      return null;
    }

    if (current.revoked_at) {
      const rotationAgeMs = Date.now() - new Date(current.revoked_at).getTime();
      if (current.replaced_by && rotationAgeMs >= 0 && rotationAgeMs <= 30_000) {
        await client.query("ROLLBACK");
        return { retry: true };
      }
      await client.query(
        "UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1",
        [current.user_id],
      );
      await client.query(
        "UPDATE users SET auth_version = auth_version + 1 WHERE id = $1",
        [current.user_id],
      );
      await client.query("COMMIT");
      clearRefreshCookie(res, req);
      return null;
    }

    if (new Date(current.expires_at).getTime() <= Date.now()) {
      await client.query(
        "UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE id = $1",
        [current.id],
      );
      await client.query("COMMIT");
      clearRefreshCookie(res, req);
      return null;
    }

    const nextRawToken = makeRefreshToken();
    await client.query(
      `UPDATE auth_refresh_tokens
       SET token_hash = $2,
           expires_at = NOW() + ($3 * INTERVAL '1 day'),
           ip_hash = $4,
           user_agent = $5,
           device_name = $6,
           browser_name = $7,
           os_name = $8,
           last_seen_at = NOW(),
           replaced_by = NULL
       WHERE id = $1`,
      [
        current.id,
        hashToken(nextRawToken),
        REFRESH_TOKEN_TTL_DAYS,
        getRequestMetadata(req).ipHash,
        getRequestMetadata(req).userAgent,
        getRequestMetadata(req).deviceName,
        getRequestMetadata(req).browserName,
        getRequestMetadata(req).osName,
      ],
    );
    await client.query("COMMIT");

    setRefreshCookie(req, res, nextRawToken);
    return {
      userId: current.user_id,
      token: createAccessToken(
        {
          id: current.user_id,
          email: current.email,
          auth_version: current.auth_version,
        },
        current.id,
      ),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      sessionId: current.id,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function revokeSession(sessionId, userId, res, req = null) {
  if (sessionId && userId) {
    await pool.query(
      `UPDATE auth_refresh_tokens
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE id = $1 AND user_id = $2`,
      [sessionId, userId],
    );
  }
  clearRefreshCookie(res, req);
}

async function revokeRefreshToken(req, res) {
  const rawToken = readRefreshToken(req);
  let revoked = null;
  if (rawToken) {
    const { rows } = await pool.query(
      `UPDATE auth_refresh_tokens
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE token_hash = $1
       RETURNING id, user_id`,
      [hashToken(rawToken)],
    );
    revoked = rows[0] || null;
  }
  clearRefreshCookie(res, req);
  return revoked;
}

async function revokeAllSessions(userId, db = pool) {
  await db.query(
    "UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1",
    [userId],
  );
}

async function listUserSessions(userId, currentSessionId) {
  const { rows } = await pool.query(
    `SELECT id, user_agent, device_name, browser_name, os_name,
            created_at, last_seen_at, expires_at, revoked_at
     FROM auth_refresh_tokens
     WHERE user_id = $1
       AND expires_at > NOW() - INTERVAL '7 days'
     ORDER BY revoked_at IS NULL DESC, last_seen_at DESC NULLS LAST, created_at DESC
     LIMIT 50`,
    [userId],
  );
  return rows.map((row) => normalizeSession(row, currentSessionId));
}

async function revokeUserSession({ userId, sessionId, currentSessionId }) {
  const { rows } = await pool.query(
    `UPDATE auth_refresh_tokens
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [sessionId, userId],
  );
  return {
    revoked: Boolean(rows[0]),
    revokedCurrent: rows[0]?.id === currentSessionId,
  };
}

async function revokeOtherSessions(userId, currentSessionId, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE auth_refresh_tokens
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE user_id = $1
       AND id <> $2
       AND revoked_at IS NULL`,
    [userId, currentSessionId],
  );
  return rowCount;
}

async function hasSimilarRecentSession(userId, req) {
  const metadata = getRequestMetadata(req);
  const { rows } = await pool.query(
    `SELECT id
     FROM auth_refresh_tokens
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND created_at > NOW() - INTERVAL '30 days'
       AND (ip_hash = $2 OR user_agent = $3)
     LIMIT 1`,
    [userId, metadata.ipHash, metadata.userAgent],
  );
  return Boolean(rows[0]);
}

module.exports = {
  clearRefreshCookie,
  getRefreshCookieOptions,
  getRequestMetadata,
  hashToken,
  hasSimilarRecentSession,
  issueSession,
  listUserSessions,
  readCookie,
  readRefreshToken,
  revokeAllSessions,
  revokeOtherSessions,
  revokeRefreshToken,
  revokeSession,
  revokeUserSession,
  rotateSession,
  verifyAccessToken,
};
