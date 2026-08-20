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

test("transcript versions preserve the editor identity and expose a comparison endpoint", () => {
  const initSource = fs.readFileSync(path.join(backendRoot, "initDb.js"), "utf8");
  const transcriptRouteSource = fs.readFileSync(
    path.join(backendRoot, "routes", "transcribe.js"),
    "utf8",
  );
  const collaborationRouteSource = fs.readFileSync(
    path.join(backendRoot, "routes", "collaboration.js"),
    "utf8",
  );

  assert.match(initSource, /actor_user_id INTEGER REFERENCES users/);
  assert.match(initSource, /actor_name VARCHAR\(100\)/);
  assert.match(initSource, /change_source VARCHAR\(20\)/);
  assert.match(
    initSource,
    /ADD CONSTRAINT transcription_versions_change_source_check/,
  );
  assert.match(transcriptRouteSource, /versions\/:versionId\/compare/);
  assert.match(transcriptRouteSource, /actor_name/);
  assert.match(collaborationRouteSource, /source:\s*"shared"/);
  assert.match(
    collaborationRouteSource,
    /\$6::bigint[\s\S]*\$6::integer/,
    "owner comments must cast the shared timestamp parameter for both legacy columns",
  );
  assert.match(
    collaborationRouteSource,
    /\$5::bigint[\s\S]*\$5::integer/,
    "public comments must cast the shared timestamp parameter for both legacy columns",
  );
});
