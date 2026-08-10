const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_FOLDER_NAME,
  normalizeFolderName,
} = require("../services/workspaceFolderService");

test("folder names are trimmed and default to the workspace folder", () => {
  assert.equal(normalizeFolderName("  Phỏng vấn tháng 7  "), "Phỏng vấn tháng 7");
  assert.equal(normalizeFolderName(undefined, { allowDefault: true }), DEFAULT_FOLDER_NAME);
});

test("folder names reject empty, control characters, and overly long values", () => {
  assert.throws(() => normalizeFolderName("   "), /tên thư mục/i);
  assert.throws(() => normalizeFolderName("Dự án\u0000ẩn"), /ký tự/i);
  assert.throws(() => normalizeFolderName("a".repeat(161)), /160/);
});
