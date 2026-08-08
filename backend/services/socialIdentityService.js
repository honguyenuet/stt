const crypto = require("crypto");
const pool = require("../db");
const { getAdminSettings } = require("./adminSettingsService");
const { JWT_SECRET } = require("../config/security");

const SOCIAL_PROVIDERS = new Set(["google", "facebook", "apple"]);
const USER_COLUMNS = `
  id, first_name, last_name, email, avatar, plan, auth_version,
  role, account_status, organization, job_role, usage_purpose,
  preferred_language, onboarding_completed_at
`;
const ACCOUNT_USER_COLUMNS = `
  account.id, account.first_name, account.last_name, account.email,
  account.avatar, account.plan, account.auth_version, account.role,
  account.account_status, account.organization, account.job_role,
  account.usage_purpose, account.preferred_language,
  account.onboarding_completed_at
`;

function createSocialIdentityError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.oauthCode = code;
  error.statusCode = statusCode;
  return error;
}

function cleanProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!SOCIAL_PROVIDERS.has(provider)) {
    throw createSocialIdentityError(
      "oauth_provider_invalid",
      "Nhà cung cấp đăng nhập không hợp lệ.",
    );
  }
  return provider;
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(email) && email.length <= 254 ? email : "";
}

function cleanName(value, fallback) {
  return String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 100);
}

function cleanAvatar(value) {
  const avatar = String(value || "").trim();
  return /^https:\/\//i.test(avatar) ? avatar.slice(0, 2000) : null;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signSocialRegistrationPayload(payload) {
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(payload)
    .digest("base64url");
}

function createSocialRegistrationToken(profile) {
  const provider = cleanProvider(profile.provider);
  const providerUserId = String(profile.providerUserId || "")
    .trim()
    .slice(0, 255);
  const email = cleanEmail(profile.email);
  if (!providerUserId || !email) return "";

  const payload = base64UrlJson({
    provider,
    providerUserId,
    email,
    emailVerified: profile.emailVerified !== false,
    avatar: cleanAvatar(profile.avatar),
    exp: Date.now() + 10 * 60 * 1000,
  });
  return `${payload}.${signSocialRegistrationPayload(payload)}`;
}

function verifySocialRegistrationToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = signSocialRegistrationPayload(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const profile = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (!profile || profile.exp < Date.now()) return null;
    return {
      provider: cleanProvider(profile.provider),
      providerUserId: String(profile.providerUserId || "").trim().slice(0, 255),
      email: cleanEmail(profile.email),
      emailVerified: profile.emailVerified !== false,
      avatar: cleanAvatar(profile.avatar),
    };
  } catch {
    return null;
  }
}

function cleanSafePath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path.startsWith("//")) return "";
  return path.slice(0, 500);
}

function createSocialRegistrationUrl(frontendUrl, profile) {
  const origin = String(frontendUrl || "").trim().replace(/\/$/, "");
  const url = new URL("/register", `${origin}/`);
  const provider = cleanProvider(profile.provider);
  const email = cleanEmail(profile.email);
  const firstName = cleanName(profile.firstName, "");
  const lastName = cleanName(profile.lastName, "");
  const from = cleanSafePath(profile.from);
  const token = createSocialRegistrationToken(profile);

  url.searchParams.set("provider", provider);
  if (email) url.searchParams.set("email", email);
  if (firstName) url.searchParams.set("firstName", firstName);
  if (lastName) url.searchParams.set("lastName", lastName);
  if (from) url.searchParams.set("from", from);
  if (token) url.searchParams.set("oauthToken", token);
  return url.toString();
}

async function findIdentityUser(db, provider, providerUserId) {
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_USER_COLUMNS}, identity.id AS identity_id
     FROM user_auth_identities identity
     JOIN users account ON account.id = identity.user_id
     WHERE identity.provider = $1 AND identity.provider_user_id = $2
     FOR UPDATE OF identity, account`,
    [provider, providerUserId],
  );
  return rows[0] || null;
}

async function touchIdentity(db, identityId, email) {
  await db.query(
    `UPDATE user_auth_identities
     SET provider_email = COALESCE(NULLIF($2, ''), provider_email),
         last_login_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [identityId, email],
  );
}

async function findOrCreateSocialUser({
  provider: rawProvider,
  providerUserId: rawProviderUserId,
  email: rawEmail,
  emailVerified = true,
  firstName,
  lastName,
  avatar,
}) {
  const provider = cleanProvider(rawProvider);
  const providerUserId = String(rawProviderUserId || "").trim().slice(0, 255);
  if (!providerUserId) {
    throw createSocialIdentityError(
      `${provider}_failed`,
      "Nhà cung cấp không trả về mã người dùng.",
    );
  }

  const email = cleanEmail(rawEmail);
  const safeAvatar = cleanAvatar(avatar);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let user = await findIdentityUser(client, provider, providerUserId);

    if (!user && provider === "google") {
      const legacy = await client.query(
        `SELECT ${USER_COLUMNS} FROM users
         WHERE google_id = $1
         FOR UPDATE`,
        [providerUserId],
      );
      if (legacy.rows[0]) {
        await client.query(
          `INSERT INTO user_auth_identities (
             user_id, provider, provider_user_id, provider_email,
             email_verified, last_login_at
           )
           VALUES ($1, 'google', $2, $3, $4, NOW())
           ON CONFLICT (provider, provider_user_id)
           DO UPDATE SET last_login_at = NOW(), updated_at = NOW()`,
          [
            legacy.rows[0].id,
            providerUserId,
            email || legacy.rows[0].email,
            emailVerified !== false,
          ],
        );
        user = legacy.rows[0];
      }
    }

    if (user) {
      if (user.identity_id) {
        await touchIdentity(client, user.identity_id, email);
      }
      if (!user.avatar && safeAvatar) {
        const updated = await client.query(
          `UPDATE users SET avatar = $2 WHERE id = $1
           RETURNING ${USER_COLUMNS}`,
          [user.id, safeAvatar],
        );
        user = updated.rows[0];
      }
      await client.query("COMMIT");
      return { user, createdNewUser: false };
    }

    if (!email || emailVerified === false) {
      throw createSocialIdentityError(
        `${provider}_email_required`,
        "Nhà cung cấp chưa cung cấp email đã xác minh.",
      );
    }

    const emailOwner = await client.query(
      "SELECT id FROM users WHERE LOWER(email) = LOWER($1) FOR UPDATE",
      [email],
    );
    if (emailOwner.rows[0]) {
      throw createSocialIdentityError(
        `${provider}_email_exists`,
        "Email đã thuộc một tài khoản Vbee khác.",
        409,
      );
    }

    const adminSettings = await getAdminSettings(client);
    const inserted = await client.query(
      `INSERT INTO users (
         first_name, last_name, email, password, google_id, avatar,
         quota_seconds
       )
       VALUES ($1, $2, $3, NULL, $4, $5, $6)
       RETURNING ${USER_COLUMNS}`,
      [
        cleanName(firstName, "Người dùng"),
        cleanName(lastName, provider === "apple" ? "Apple" : provider),
        email,
        provider === "google" ? providerUserId : null,
        safeAvatar,
        adminSettings.default_quota_minutes * 60,
      ],
    );
    user = inserted.rows[0];

    await client.query(
      `INSERT INTO user_auth_identities (
         user_id, provider, provider_user_id, provider_email,
         email_verified, last_login_at
       )
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [user.id, provider, providerUserId, email, emailVerified !== false],
    );
    await client.query("COMMIT");
    return { user, createdNewUser: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505" && !error.oauthCode) {
      throw createSocialIdentityError(
        `${provider}_email_exists`,
        "Email hoặc tài khoản mạng xã hội đã được đăng ký.",
        409,
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createSocialIdentityError,
  createSocialRegistrationUrl,
  findOrCreateSocialUser,
  verifySocialRegistrationToken,
};
