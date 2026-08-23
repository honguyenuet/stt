const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const examplePath = path.join(__dirname, "..", ".env.example");

function activeEnvironmentKeys(source) {
  return source
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/u)?.[1])
    .filter(Boolean);
}

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "tests"
        ? []
        : javascriptFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [entryPath] : [];
  });
}

test("backend .env.example declares each active variable only once", () => {
  const source = fs.readFileSync(examplePath, "utf8");
  const keys = activeEnvironmentKeys(source);
  const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];

  assert.deepEqual(
    duplicates,
    [],
    `Duplicate environment variables make dotenv silently use the last value: ${duplicates.join(", ")}`,
  );
});

test("backend .env.example documents every directly configurable runtime variable", () => {
  const source = fs.readFileSync(examplePath, "utf8");
  const documented = new Set(activeEnvironmentKeys(source));
  const referenced = new Set();
  const directReference = /process\.env\.([A-Z][A-Z0-9_]*)/gu;

  for (const file of javascriptFiles(path.join(__dirname, ".."))) {
    const code = fs.readFileSync(file, "utf8");
    for (const match of code.matchAll(directReference)) referenced.add(match[1]);
  }

  // PROCESS_ROLE is assigned by index.js/worker.js. The VBEE_AUTH_* names are
  // retained only as backwards-compatible aliases for the documented API key names.
  const internalOrLegacy = new Set([
    "PROCESS_ROLE",
    "VBEE_AUTH_HEADER",
    "VBEE_AUTH_SCHEME",
  ]);
  const missing = [...referenced]
    .filter((key) => !documented.has(key) && !internalOrLegacy.has(key))
    .sort();

  assert.deepEqual(
    missing,
    [],
    `Runtime environment variables missing from .env.example: ${missing.join(", ")}`,
  );
});
