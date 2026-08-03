const crypto = require("crypto");
const pool = require("../db");

const OAUTH_STATE_TTL_MINUTES = Math.max(
  5,
  Math.min(
    30,
    Number.parseInt(process.env.OAUTH_STATE_TTL_MINUTES || "10", 10) || 10,
  ),
);

function hashOAuthValue(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

async function createOAuthState({
  provider,
  referralCode = "",
  nonce = "",
}) {
  const state = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO oauth_login_states (
       state_hash, provider, nonce_hash, referral_code, expires_at
     )
     VALUES (
       $1, $2, $3, NULLIF($4, ''),
       NOW() + ($5 * INTERVAL '1 minute')
     )`,
    [
      hashOAuthValue(state),
      String(provider || "").trim().toLowerCase(),
      nonce ? hashOAuthValue(nonce) : null,
      String(referralCode || "").trim(),
      OAUTH_STATE_TTL_MINUTES,
    ],
  );
  return state;
}

async function consumeOAuthState({ provider, state }) {
  if (!state) return null;
  const { rows } = await pool.query(
    `UPDATE oauth_login_states
     SET consumed_at = NOW()
     WHERE state_hash = $1
       AND provider = $2
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING nonce_hash, referral_code`,
    [
      hashOAuthValue(state),
      String(provider || "").trim().toLowerCase(),
    ],
  );
  return rows[0] || null;
}

module.exports = {
  consumeOAuthState,
  createOAuthState,
  hashOAuthValue,
};
