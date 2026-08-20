const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");

test("public links stay separate from member grants and existing comments are migrated", () => {
  const initSource = fs.readFileSync(path.join(backendRoot, "initDb.js"), "utf8");
  const routeSource = fs.readFileSync(
    path.join(backendRoot, "routes", "collaboration.js"),
    "utf8",
  );

  assert.match(
    initSource,
    /CREATE TABLE IF NOT EXISTS transcript_public_links/,
  );
  assert.match(
    initSource,
    /ALTER TABLE transcript_public_links ADD COLUMN IF NOT EXISTS token_prefix/,
  );
  assert.match(
    initSource,
    /ALTER TABLE transcript_comments ADD COLUMN IF NOT EXISTS author_name/,
  );
  assert.doesNotMatch(
    routeSource,
    /(?:FROM|INTO|UPDATE) transcript_shares\b/,
  );
  assert.match(
    routeSource,
    /(?:FROM|INTO) transcript_comments\b/,
  );
});
