const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.join(__dirname, "..");

test("completed uploads and browser transcripts persist insights automatically", () => {
  const queueSource = fs.readFileSync(
    path.join(backendRoot, "services", "transcriptionQueue.js"),
    "utf8",
  );
  const routeSource = fs.readFileSync(
    path.join(backendRoot, "routes", "transcribe.js"),
    "utf8",
  );

  assert.match(queueSource, /generateTranscriptInsights/);
  assert.match(queueSource, /insights\s*=\s*\$16::jsonb/);
  assert.match(queueSource, /insights_updated_at\s*=\s*NOW\(\)/);
  assert.match(routeSource, /automaticInsights/);
  assert.match(routeSource, /insights,\s*insights_updated_at/);
});
