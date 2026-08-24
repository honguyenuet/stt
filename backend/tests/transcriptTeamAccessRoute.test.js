const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "routes", "transcribe.js"),
  "utf8",
);

test("history and detail routes expose team transcript permissions", () => {
  assert.match(source, /TRANSCRIPT_VIEW_CONDITION/);
  assert.match(source, /AS owner_user_id/i);
  assert.match(source, /AS can_edit/i);
  assert.match(
    source,
    /requireTranscriptAccess\(req\.user\.id, id, \{\s*mode: "view"/,
  );
});

test("team mutations require edit access while deletion stays owner-scoped", () => {
  const editChecks = source.match(/mode: "edit"/g) || [];
  assert.ok(
    editChecks.length >= 5,
    "expected edit checks on transcript mutations",
  );
  assert.match(
    source,
    /DELETE FROM transcriptions WHERE id = \$1 AND user_id = \$2/,
  );
  assert.match(source, /\[id, req\.user\.id\]/);
});
