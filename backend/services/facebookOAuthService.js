const crypto = require("crypto");

function isConfiguredSecret(value) {
  const clean = String(value || "").trim().toLowerCase();
  return Boolean(clean) && !clean.includes("your_") && !clean.includes("_here");
}

function getFacebookConfig() {
  const version = /^v\d+\.\d+$/.test(
    String(process.env.FACEBOOK_GRAPH_API_VERSION || "v23.0").trim(),
  )
    ? String(process.env.FACEBOOK_GRAPH_API_VERSION || "v23.0").trim()
    : "v23.0";
  const config = {
    appId: String(process.env.FACEBOOK_APP_ID || "").trim(),
    appSecret: String(process.env.FACEBOOK_APP_SECRET || "").trim(),
    callbackUrl: String(
      process.env.FACEBOOK_CALLBACK_URL ||
        "http://localhost:3001/api/auth/facebook/callback",
    ).trim(),
    version,
  };
  if (
    !isConfiguredSecret(config.appId) ||
    !isConfiguredSecret(config.appSecret) ||
    !config.callbackUrl
  ) {
    const error = new Error("Facebook OAuth chưa được cấu hình.");
    error.oauthCode = "facebook_not_configured";
    throw error;
  }
  return config;
}

function hasFacebookOAuth() {
  try {
    getFacebookConfig();
    return true;
  } catch {
    return false;
  }
}

function createFacebookAuthorizationUrl(state, callbackUrl) {
  const config = getFacebookConfig();
  const redirectUri = String(callbackUrl || config.callbackUrl).trim();
  const url = new URL(
    `https://www.facebook.com/${config.version}/dialog/oauth`,
  );
  url.search = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "public_profile,email",
    state,
  }).toString();
  return url.toString();
}

async function readJsonResponse(response, fallbackMessage) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const error = new Error(
      body.error?.message || body.error_description || fallbackMessage,
    );
    error.oauthCode = "facebook_failed";
    throw error;
  }
  return body;
}

async function exchangeFacebookCode(code, callbackUrl) {
  const config = getFacebookConfig();
  const redirectUri = String(callbackUrl || config.callbackUrl).trim();
  const tokenResponse = await fetch(
    `https://graph.facebook.com/${config.version}/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.appId,
        client_secret: config.appSecret,
        redirect_uri: redirectUri,
        code: String(code || ""),
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const token = await readJsonResponse(
    tokenResponse,
    "Facebook không cấp access token.",
  );
  if (!token.access_token) {
    const error = new Error("Facebook không cấp access token.");
    error.oauthCode = "facebook_failed";
    throw error;
  }

  const proof = crypto
    .createHmac("sha256", config.appSecret)
    .update(token.access_token)
    .digest("hex");
  const profileUrl = new URL(
    `https://graph.facebook.com/${config.version}/me`,
  );
  profileUrl.search = new URLSearchParams({
    fields: "id,first_name,last_name,name,email,picture.type(large)",
    appsecret_proof: proof,
  }).toString();
  const profileResponse = await fetch(profileUrl, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const profile = await readJsonResponse(
    profileResponse,
    "Facebook không trả về hồ sơ người dùng.",
  );

  return {
    providerUserId: profile.id,
    email: profile.email || "",
    emailVerified: Boolean(profile.email),
    firstName: profile.first_name || profile.name || "",
    lastName: profile.last_name || "Facebook",
    avatar: profile.picture?.data?.url || "",
  };
}

module.exports = {
  createFacebookAuthorizationUrl,
  exchangeFacebookCode,
  hasFacebookOAuth,
};
