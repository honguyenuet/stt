const test = require("node:test");
const assert = require("node:assert/strict");
const {
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
