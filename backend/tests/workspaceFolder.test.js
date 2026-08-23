const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_FOLDER_NAME,
  listUserFolders,
  normalizeFolderName,
} = require("../services/workspaceFolderService");

test("folder names are trimmed and default to the workspace folder", () => {
  assert.equal(
    normalizeFolderName("  Phỏng vấn tháng 7  "),
    "Phỏng vấn tháng 7",
  );
  assert.equal(
    normalizeFolderName(undefined, { allowDefault: true }),
    DEFAULT_FOLDER_NAME,
  );
});

test("folder names reject empty, control characters, and overly long values", () => {
  assert.throws(() => normalizeFolderName("   "), /tên thư mục/i);
  assert.throws(() => normalizeFolderName("Dự án\u0000ẩn"), /ký tự/i);
  assert.throws(() => normalizeFolderName("a".repeat(161)), /160/);
});

test("team folders count every transcript visible in the shared project", async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      if (/SELECT id, user_id AS owner_user_id/i.test(sql)) {
        return {
          rows: [
            {
              id: 1,
              owner_user_id: 5,
              name: DEFAULT_FOLDER_NAME,
              visibility: "private",
              team_permission: "edit",
            },
          ],
        };
      }
      if (/SELECT folder\.id/i.test(sql)) return { rows: [] };
      return { rows: [], rowCount: 1 };
    },
  };

  await listUserFolders(5, { db });

  const listQuery = calls.find((sql) => /COUNT\(transcript\.id\)/i.test(sql));
  assert.ok(listQuery);
  assert.doesNotMatch(listQuery, /FILTER\s*\(WHERE transcript\.user_id/i);
  assert.match(listQuery, /requester\.status = 'active'/i);
  assert.match(listQuery, /owner_member\.status = 'active'/i);
});
