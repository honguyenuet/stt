const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanupManagedStorage,
} = require("../services/transcriptionQueue");
const pool = require("../db");

test.after(() => pool.end());

test("managed storage cleanup applies the CMS queue retention window", async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT value FROM admin_settings/i.test(sql)) {
        return {
          rows: [
            {
              value: {
                storage_policy: "keep_transcripts_and_media",
                data_retention_days: 30,
                system_parameters: {
                  queue_concurrency: 2,
                  queue_retention_ms: 7_200_000,
                },
              },
            },
          ],
        };
      }
      if (/WITH expired_audio AS/i.test(sql)) return { rows: [] };
      if (/DELETE FROM transcription_jobs/i.test(sql)) return { rowCount: 4 };
      if (/DELETE FROM transcriptions transcript/i.test(sql)) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await cleanupManagedStorage({ db });
  const jobCleanup = calls.find(({ sql }) =>
    /DELETE FROM transcription_jobs/i.test(sql),
  );

  assert.deepEqual(jobCleanup.params, [7_200_000]);
  assert.match(jobCleanup.sql, /status IN \('completed', 'failed', 'cancelled'\)/i);
  assert.match(
    jobCleanup.sql,
    /job\.status <> 'failed' OR transcript\.audio_filename IS NULL/i,
  );
  assert.deepEqual(result, {
    deletedMedia: 0,
    deletedJobs: 4,
    deletedTranscripts: 0,
  });
});
