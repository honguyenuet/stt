const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getWorkspaceSeatLimit,
  normalizeWorkspaceRole,
} = require("../services/workspaceTeamService");

test("workspace roles never escalate unknown input", () => {
  assert.equal(normalizeWorkspaceRole("admin"), "admin");
  assert.equal(normalizeWorkspaceRole("owner"), "member");
  assert.equal(normalizeWorkspaceRole("super_admin"), "member");
});

test("workspace seat limits follow the billing plan", () => {
  assert.equal(getWorkspaceSeatLimit("free"), 1);
  assert.equal(getWorkspaceSeatLimit("special"), 3);
  assert.equal(getWorkspaceSeatLimit("business"), 25);
});
