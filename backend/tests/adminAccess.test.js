const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const {
  canReplySupportRole,
  canUpdateSupportStatusRole,
  createAdminSession,
  getEffectiveAdminRole,
  isAdminAccountActive,
} = require("../services/adminAccess");

test("legacy super_admin role is accepted by CMS", () => {
  assert.equal(
    getEffectiveAdminRole({ admin_role: "none", role: "super_admin" }),
    "super_admin",
  );
});

test("explicit CMS role takes precedence", () => {
  assert.equal(
    getEffectiveAdminRole({ admin_role: "viewer", role: "super_admin" }),
    "viewer",
  );
});

test("normal users cannot access CMS", () => {
  assert.equal(
    getEffectiveAdminRole({ admin_role: "none", role: "user" }),
    null,
  );
});

test("both account status fields must be active", () => {
  assert.equal(
    isAdminAccountActive({ status: "active", account_status: "active" }),
    true,
  );
  assert.equal(
    isAdminAccountActive({ status: "active", account_status: "blocked" }),
    false,
  );
  assert.equal(
    isAdminAccountActive({ status: "suspended", account_status: "active" }),
    false,
  );
});

test("creates scoped CMS session from an active admin-capable user", () => {
  const nowMs = 1_700_000_000_000;
  const session = createAdminSession(
    {
      id: 7,
      first_name: "Vbee",
      last_name: "Support",
      email: "support@vbee.local",
      admin_role: "support",
      role: "support",
    },
    { jwtSecret: "test-secret", nowMs },
  );

  assert.equal(session.expiresAt, nowMs + 8 * 60 * 60 * 1000);
  assert.deepEqual(session.user, {
    id: "7",
    name: "Vbee Support",
    email: "support@vbee.local",
    role: "support",
  });

  const payload = jwt.verify(session.token, "test-secret");
  assert.equal(payload.id, 7);
  assert.equal(payload.email, "support@vbee.local");
  assert.equal(payload.adminRole, "support");
  assert.equal(payload.scope, "admin");
});

test("support role can reply but cannot update support status", () => {
  assert.equal(canReplySupportRole("support"), true);
  assert.equal(canReplySupportRole("admin"), true);
  assert.equal(canReplySupportRole("viewer"), false);

  assert.equal(canUpdateSupportStatusRole("support"), false);
  assert.equal(canUpdateSupportStatusRole("admin"), true);
  assert.equal(canUpdateSupportStatusRole("super_admin"), true);
});
