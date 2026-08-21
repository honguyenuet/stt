const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const adminRouter = require("../routes/admin");

test.after(() => pool.end());

function registeredMethods(path) {
  const layer = adminRouter.stack.find((item) => item.route?.path === path);
  return Object.keys(layer?.route?.methods || {}).sort();
}

test("CMS exposes the user plan and account deletion routes used by the frontend", () => {
  assert.deepEqual(registeredMethods("/users/:id/plan"), ["patch"]);
  assert.deepEqual(registeredMethods("/users/:id"), ["delete"]);
});
