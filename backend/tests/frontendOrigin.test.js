const assert = require("node:assert/strict");
const test = require("node:test");

function loadSecurity(overrides) {
  const securityPath = require.resolve("../config/security");
  delete require.cache[securityPath];
  const previousEnv = { ...process.env };
  Object.assign(process.env, overrides);
  const security = require("../config/security");
  process.env = previousEnv;
  delete require.cache[securityPath];
  return security;
}

function loadSessionService(overrides) {
  const securityPath = require.resolve("../config/security");
  const sessionPath = require.resolve("../services/sessionService");
  delete require.cache[securityPath];
  delete require.cache[sessionPath];
  const previousEnv = { ...process.env };
  Object.assign(process.env, overrides);
  const sessionService = require("../services/sessionService");
  process.env = previousEnv;
  delete require.cache[sessionPath];
  delete require.cache[securityPath];
  return sessionService;
}

test("development allows localhost frontend alongside configured public origin", () => {
  const { getAllowedOrigins } = loadSecurity({
    NODE_ENV: "development",
    FRONTEND_URL: "https://app.example.com",
    CORS_ALLOWED_ORIGINS: "https://app.example.com",
  });

  assert.deepEqual(getAllowedOrigins(), [
    "https://app.example.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
});

test("request frontend URL follows trusted localhost origin in development", () => {
  const { getRequestFrontendUrl } = loadSecurity({
    NODE_ENV: "development",
    FRONTEND_URL: "https://app.example.com",
    CORS_ALLOWED_ORIGINS: "https://app.example.com",
  });

  assert.equal(
    getRequestFrontendUrl({
      get: (name) => (name === "origin" ? "http://localhost:3000" : ""),
    }),
    "http://localhost:3000",
  );
});

test("request frontend URL falls back to configured domain without trusted origin", () => {
  const { getRequestFrontendUrl } = loadSecurity({
    NODE_ENV: "development",
    FRONTEND_URL: "https://app.example.com",
    CORS_ALLOWED_ORIGINS: "https://app.example.com",
  });

  assert.equal(
    getRequestFrontendUrl({
      get: () => "",
    }),
    "https://app.example.com",
  );
});

test("OAuth callback URL follows the backend host that starts the flow", () => {
  const { getOAuthCallbackUrl } = loadSecurity({
    NODE_ENV: "development",
    FRONTEND_URL: "https://app.example.com",
  });

  assert.equal(
    getOAuthCallbackUrl(
      {
        protocol: "http",
        get: (name) => (name === "host" ? "localhost:3001" : ""),
      },
      "google",
    ),
    "http://localhost:3001/api/auth/google/callback",
  );

  assert.equal(
    getOAuthCallbackUrl(
      {
        protocol: "https",
        get: (name) => (name === "host" ? "api.example.com" : ""),
      },
      "facebook",
    ),
    "https://api.example.com/api/auth/facebook/callback",
  );
});

test("OAuth callback URL follows localhost when the initiating frontend origin is localhost", () => {
  const { getOAuthCallbackUrl } = loadSecurity({
    NODE_ENV: "development",
    FRONTEND_URL: "https://app.example.com",
  });

  assert.equal(
    getOAuthCallbackUrl(
      {
        protocol: "https",
        query: { frontendOrigin: "http://localhost:3000" },
        get: (name) => (name === "host" ? "api.example.com" : ""),
      },
      "google",
    ),
    "http://localhost:3001/api/auth/google/callback",
  );
});

test("refresh cookie stays strict for same-site localhost development", () => {
  const { getRefreshCookieOptions } = loadSessionService({
    NODE_ENV: "development",
    FRONTEND_URL: "http://localhost:3000",
  });

  assert.deepEqual(
    getRefreshCookieOptions({
      protocol: "http",
      secure: false,
      get: (name) => (name === "host" ? "localhost:3001" : ""),
    }),
    {
      httpOnly: true,
      path: "/",
      sameSite: "strict",
      secure: false,
    },
  );
});

test("refresh cookie uses SameSite=None for cross-site HTTPS deployments", () => {
  const { getRefreshCookieOptions } = loadSessionService({
    NODE_ENV: "production",
    FRONTEND_URL: "https://app.example.com",
    JWT_SECRET: "0123456789abcdef0123456789abcdef",
  });

  assert.deepEqual(
    getRefreshCookieOptions({
      protocol: "https",
      secure: true,
      get: (name) => (name === "host" ? "api.example.net" : ""),
    }),
    {
      httpOnly: true,
      path: "/",
      sameSite: "none",
      secure: true,
    },
  );
});
