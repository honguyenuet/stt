const assert = require("node:assert/strict");
const test = require("node:test");
const pool = require("../db");

const {
  createAppleAuthorizationUrl,
  assertAppleNonce,
} = require("../services/appleOAuthService");
const {
  createFacebookAuthorizationUrl,
} = require("../services/facebookOAuthService");
const {
  createSocialIdentityError,
  createSocialRegistrationUrl,
  verifySocialRegistrationToken,
} = require("../services/socialIdentityService");
const { hashOAuthValue } = require("../services/oauthStateService");

test.after(async () => {
  await pool.end();
});

function withEnvironment(values, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Facebook authorization URL carries state and requests email", () => {
  withEnvironment(
    {
      FACEBOOK_APP_ID: "facebook-app-id",
      FACEBOOK_APP_SECRET: "facebook-app-secret",
      FACEBOOK_CALLBACK_URL:
        "https://voice.example.com/api/auth/facebook/callback",
      FACEBOOK_GRAPH_API_VERSION: "v23.0",
    },
    () => {
      const url = new URL(createFacebookAuthorizationUrl("state-value"));
      assert.equal(url.hostname, "www.facebook.com");
      assert.equal(url.searchParams.get("client_id"), "facebook-app-id");
      assert.equal(url.searchParams.get("state"), "state-value");
      assert.equal(url.searchParams.get("scope"), "public_profile,email");
    },
  );
});

test("Apple authorization URL uses form_post, state and nonce", () => {
  withEnvironment(
    {
      APPLE_CLIENT_ID: "com.example.voice.web",
      APPLE_TEAM_ID: "TEAM123456",
      APPLE_KEY_ID: "KEY1234567",
      APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
      APPLE_CALLBACK_URL: "https://voice.example.com/api/auth/apple/callback",
    },
    () => {
      const url = new URL(
        createAppleAuthorizationUrl({
          state: "state-value",
          nonce: "nonce-value",
        }),
      );
      assert.equal(url.hostname, "appleid.apple.com");
      assert.equal(url.searchParams.get("response_mode"), "form_post");
      assert.equal(url.searchParams.get("state"), "state-value");
      assert.equal(url.searchParams.get("nonce"), "nonce-value");
      assert.equal(url.searchParams.get("scope"), "name email");
    },
  );
});

test("Apple nonce rejects a replayed or mismatched callback", () => {
  const expectedHash = hashOAuthValue("correct-nonce");
  assert.doesNotThrow(() =>
    assertAppleNonce("correct-nonce", expectedHash, hashOAuthValue),
  );
  assert.throws(
    () => assertAppleNonce("wrong-nonce", expectedHash, hashOAuthValue),
    (error) => error.oauthCode === "apple_failed",
  );
});

test("social identity errors preserve the public OAuth error code", () => {
  const error = createSocialIdentityError(
    "facebook_email_exists",
    "Email đã được dùng.",
    409,
  );
  assert.equal(error.oauthCode, "facebook_email_exists");
  assert.equal(error.statusCode, 409);
});

test("unknown Google login can redirect to register with verified profile details", () => {
  const url = new URL(
    createSocialRegistrationUrl("https://voice.example.com", {
      provider: "google",
      providerUserId: "google-user-123",
      email: "  LINH@example.com ",
      firstName: " Linh ",
      lastName: " Tran ",
      from: "/upload",
    }),
  );

  assert.equal(url.origin, "https://voice.example.com");
  assert.equal(url.pathname, "/register");
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.get("email"), "linh@example.com");
  assert.equal(url.searchParams.get("firstName"), "Linh");
  assert.equal(url.searchParams.get("lastName"), "Tran");
  assert.equal(url.searchParams.get("from"), "/upload");

  const profile = verifySocialRegistrationToken(
    url.searchParams.get("oauthToken"),
  );
  assert.equal(profile.provider, "google");
  assert.equal(profile.providerUserId, "google-user-123");
  assert.equal(profile.email, "linh@example.com");
});
