const test = require("node:test");
const assert = require("node:assert/strict");

const {
  insertTranscriptVersion,
  normalizeVersionActor,
} = require("../services/transcriptVersionService");

test("version actors are normalized without trusting public display names", () => {
  assert.deepEqual(
    normalizeVersionActor({
      actorUserId: "17",
      actorName: "  Lan <script>  ",
      source: "shared",
    }),
    { actorUserId: 17, actorName: "Lan script", source: "shared" },
  );
  assert.deepEqual(normalizeVersionActor({ source: "unknown" }), {
    actorUserId: null,
    actorName: "Người dùng",
    source: "owner",
  });
});

test("version snapshots persist actor metadata and enforce the retention limit", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };

  await insertTranscriptVersion(
    client,
    {
      id: 9,
      user_id: 3,
      text: "Bản cũ",
      words: [{ text: "Bản", start: 0, end: 300 }],
      speaker_names: { 0: "Lan" },
    },
    {
      actorUserId: 17,
      actorName: "Lan",
      source: "shared",
      label: "Chỉnh sửa qua liên kết",
      maxVersions: 50,
    },
  );

  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /actor_user_id/);
  assert.match(calls[0].sql, /actor_name/);
  assert.match(calls[0].sql, /change_source/);
  assert.deepEqual(calls[0].values.slice(-4), [
    "Chỉnh sửa qua liên kết",
    17,
    "Lan",
    "shared",
  ]);
  assert.deepEqual(calls[1].values, [9, 50]);
});
