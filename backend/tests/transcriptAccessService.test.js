const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getTranscriptAccessCondition,
  normalizeAccessMode,
  requireTranscriptAccess,
} = require("../services/transcriptAccessService");

test("transcript access defaults to view and validates SQL identifiers", () => {
  assert.equal(normalizeAccessMode("edit"), "edit");
  assert.equal(normalizeAccessMode("owner"), "view");
  assert.throws(
    () =>
      getTranscriptAccessCondition({ transcriptAlias: "x; DROP TABLE users" }),
    /alias/i,
  );
  assert.throws(
    () => getTranscriptAccessCondition({ userParameter: "1 OR TRUE" }),
    /parameter/i,
  );
});

test("view access requires active membership in the folder owner's workspace", () => {
  const condition = getTranscriptAccessCondition({ mode: "view" });
  assert.match(condition, /folder\.visibility = 'team'/i);
  assert.match(condition, /owner_member\.status = 'active'/i);
  assert.match(condition, /requester\.status = 'active'/i);
  assert.doesNotMatch(condition, /folder\.team_permission = 'edit'/i);
});

test("edit access additionally requires an editable team folder", () => {
  const condition = getTranscriptAccessCondition({
    transcriptAlias: "item",
    userParameter: "$3",
    mode: "edit",
  });
  assert.match(condition, /item\.user_id = \$3/i);
  assert.match(condition, /folder\.team_permission = 'edit'/i);
  assert.match(condition, /requester\.user_id = \$3/i);
});

test("resolved access keeps the transcript owner separate from the editor", async () => {
  let captured;
  const db = {
    async query(sql, values) {
      captured = { sql, values };
      return {
        rows: [
          {
            id: 42,
            owner_user_id: 7,
            folder_id: 9,
            visibility: "team",
            team_permission: "edit",
            can_edit: true,
          },
        ],
      };
    },
  };

  const access = await requireTranscriptAccess(11, 42, {
    db,
    mode: "edit",
    lock: true,
  });

  assert.deepEqual(captured.values, [42, 11]);
  assert.match(captured.sql, /FOR UPDATE OF transcript/i);
  assert.match(captured.sql, /folder\.team_permission = 'edit'/i);
  assert.deepEqual(access, {
    transcriptId: 42,
    ownerUserId: 7,
    folderId: 9,
    visibility: "team",
    teamPermission: "edit",
    canEdit: true,
  });
});

test("missing or unauthorized transcripts use the same not-found response", async () => {
  await assert.rejects(
    requireTranscriptAccess(11, 42, {
      db: { query: async () => ({ rows: [] }) },
      mode: "view",
    }),
    (error) =>
      error.statusCode === 404 &&
      /không tìm thấy transcript/i.test(error.message),
  );
});
