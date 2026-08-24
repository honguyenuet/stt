const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.join(__dirname, "..");

test("API mounts the workspace route consumed by the dashboard", () => {
  const indexSource = fs.readFileSync(path.join(backendRoot, "index.js"), "utf8");
  const routeSource = fs.readFileSync(
    path.join(backendRoot, "routes", "workspace.js"),
    "utf8",
  );

  assert.match(
    indexSource,
    /const workspaceRoutes = require\("\.\/routes\/workspace"\);/,
  );
  assert.match(
    indexSource,
    /app\.use\("\/api\/workspace", workspaceRoutes\);/,
  );
  assert.match(routeSource, /router\.get\("\/", requireAuth/);
  assert.match(routeSource, /router\.post\("\/members", requireAuth/);
  assert.match(routeSource, /router\.patch\("\/invoice-profile", requireAuth/);
});
