const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backendRoot = path.join(__dirname, "..");

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "uploads") return [];
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? listJavaScriptFiles(absolutePath)
      : entry.isFile() && entry.name.endsWith(".js")
        ? [absolutePath]
        : [];
  });
}

test("every backend JavaScript module parses before deployment", () => {
  const failures = [];
  for (const filename of listJavaScriptFiles(backendRoot)) {
    try {
      new vm.Script(fs.readFileSync(filename, "utf8"), { filename });
    } catch (error) {
      failures.push(`${path.relative(backendRoot, filename)}: ${error.message}`);
    }
  }
  assert.deepEqual(failures, []);
});
