const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { getReservedSeconds } = require("../services/quotaService");

test("a multitrack batch reserves only its longest track", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query(
      `INSERT INTO users (first_name, last_name, email, password)
       VALUES ('Quota', 'Test', $1, 'unused')
       RETURNING id`,
      [`quota-${crypto.randomUUID()}@example.test`],
    );
    const userId = account.rows[0].id;
    const batchId = crypto.randomUUID();
    await client.query(
      `INSERT INTO transcription_batches (
         id, user_id, kind, name, status, expected_tracks
       )
       VALUES ($1, $2, 'multitrack', 'Quota test', 'processing', 2)`,
      [batchId, userId],
    );

    async function addJob({
      expectedSeconds,
      batch = null,
      status = "queued",
    }) {
      const transcript = await client.query(
        `INSERT INTO transcriptions (user_id, filename, text, status)
         VALUES ($1, 'quota-test.wav', '', $2)
         RETURNING id`,
        [userId, status === "completed" ? "completed" : "queued"],
      );
      await client.query(
        `INSERT INTO transcription_jobs (
           user_id, transcription_id, status, expected_duration_seconds, payload
         )
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          userId,
          transcript.rows[0].id,
          status,
          expectedSeconds,
          JSON.stringify(
            batch
              ? { batchId: batch, batchKind: "multitrack" }
              : {},
          ),
        ],
      );
    }

    await addJob({ expectedSeconds: 600, batch: batchId });
    await addJob({ expectedSeconds: 540, batch: batchId });
    await addJob({ expectedSeconds: 120 });

    assert.equal(await getReservedSeconds(userId, null, client), 720);
    assert.equal(
      await getReservedSeconds(userId, null, client, batchId),
      120,
    );

    await client.query(
      `UPDATE transcription_jobs
       SET status = 'completed'
       WHERE user_id = $1
         AND payload->>'batchId' = $2
         AND expected_duration_seconds = 600`,
      [userId, batchId],
    );
    assert.equal(await getReservedSeconds(userId, null, client), 720);

    await client.query(
      `UPDATE transcription_batches SET status = 'completed' WHERE id = $1`,
      [batchId],
    );
    assert.equal(await getReservedSeconds(userId, null, client), 120);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
});
