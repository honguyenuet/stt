const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const initDbSource = fs.readFileSync(
  path.join(__dirname, "..", "initDb.js"),
  "utf8",
);

test("workspace schema upgrades the legacy team tables before using new columns", () => {
  const workspacesUpgrade =
    "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan";
  const membersStatusUpgrade =
    "ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS status";
  const membersIndex =
    "CREATE INDEX IF NOT EXISTS idx_workspace_members_user_active";

  assert.ok(initDbSource.includes(workspacesUpgrade));
  assert.ok(initDbSource.includes(membersStatusUpgrade));
  assert.ok(
    initDbSource.indexOf(membersStatusUpgrade) < initDbSource.indexOf(membersIndex),
    "workspace_members.status must exist before its active-member index",
  );
  assert.match(
    initDbSource,
    /ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS id BIGSERIAL/,
  );
  assert.match(
    initDbSource,
    /DROP CONSTRAINT IF EXISTS workspace_members_user_id_key/,
  );
  assert.match(initDbSource, /index_metadata\.indisunique/);
  assert.match(initDbSource, /DROP INDEX idx_workspaces_owner/);
});
