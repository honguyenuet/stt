const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createShareToken,
  hashShareToken,
  normalizeComment,
  normalizeSharePermission,
} = require("../services/transcriptCollaborationService");

test("share tokens are random and only the hash is stored", () => {
  const first = createShareToken();
  const second = createShareToken();
  assert.match(first, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(first, second);
  assert.equal(hashShareToken(first).length, 64);
  assert.notEqual(hashShareToken(first), first);
});

test("share permission and comments are normalized at the boundary", () => {
  assert.equal(normalizeSharePermission("edit"), "edit");
  assert.equal(normalizeSharePermission("admin"), "view");
  assert.deepEqual(normalizeComment({ body: "  Xin chào   @Lan  ", timestampMs: 1250 }), {
    body: "Xin chào @Lan",
    mentions: ["Lan"],
    timestampMs: 1250,
  });
  assert.throws(() => normalizeComment({ body: "   " }), /nội dung/i);
});
