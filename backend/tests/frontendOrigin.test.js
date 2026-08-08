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

test("development allows localhost frontend alongside configured ngrok origin", () => {
  const { getAllowedOrigins } = loadSecurity({
    NODE_ENV: "development",
    FRONTEND_URL: "https://myth-mowing-reliant.ngrok-free.dev",
    CORS_ALLOWED_ORIGINS: "https://myth-mowing-reliant.ngrok-free.dev",
  });

  assert.deepEqual(getAllowedOrigins(), [
    "https://myth-mowing-reliant.ngrok-free.dev",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
});

test("request frontend URL follows trusted localhost origin in development", () => {
  const { getRequestFrontendUrl } = loadSecurity({
    NODE_ENV: "development",
    FRONTEND_URL: "https://myth-mowing-reliant.ngrok-free.dev",
    CORS_ALLOWED_ORIGINS: "https://myth-mowing-reliant.ngrok-free.dev",
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
    FRONTEND_URL: "https://myth-mowing-reliant.ngrok-free.dev",
    CORS_ALLOWED_ORIGINS: "https://myth-mowing-reliant.ngrok-free.dev",
  });

  assert.equal(
    getRequestFrontendUrl({
      get: () => "",
    }),
    "https://myth-mowing-reliant.ngrok-free.dev",
  );
});

test("OAuth callback URL follows the backend host that starts the flow", () => {
  const { getOAuthCallbackUrl } = loadSecurity({
    NODE_ENV: "development",
    FRONTEND_URL: "https://myth-mowing-reliant.ngrok-free.dev",
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
        get: (name) => (name === "host" ? "myth-mowing-reliant.ngrok-free.dev" : ""),
      },
      "facebook",
    ),
    "https://myth-mowing-reliant.ngrok-free.dev/api/auth/facebook/callback",
  );
});

test("OAuth callback URL follows localhost when the initiating frontend origin is localhost", () => {
  const { getOAuthCallbackUrl } = loadSecurity({
    NODE_ENV: "development",
    FRONTEND_URL: "https://myth-mowing-reliant.ngrok-free.dev",
  });

  assert.equal(
    getOAuthCallbackUrl(
      {
        protocol: "https",
        query: { frontendOrigin: "http://localhost:3000" },
        get: (name) => (name === "host" ? "myth-mowing-reliant.ngrok-free.dev" : ""),
      },
      "google",
    ),
    "http://localhost:3001/api/auth/google/callback",
  );
});
