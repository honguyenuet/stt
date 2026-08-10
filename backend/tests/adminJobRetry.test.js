const test = require("node:test");
const assert = require("node:assert/strict");

const {
  retryTranscriptionJobForAdmin,
} = require("../services/transcriptionQueue");
const pool = require("../db");

test.after(() => pool.end());

function createDb(transcription) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (/SELECT t\.\*, q\.id AS queue_job_id/i.test(sql)) {
        return { rows: transcription ? [transcription] : [], rowCount: transcription ? 1 : 0 };
      }
      if (/INSERT INTO transcription_jobs/i.test(sql)) {
        return { rows: [{ id: 501 }], rowCount: 1 };
      }
      if (/UPDATE transcription_jobs/i.test(sql)) {
        return { rows: [{ id: transcription.queue_job_id }], rowCount: 1 };
      }
      if (/UPDATE transcriptions/i.test(sql)) {
        return {
          rows: [{ ...transcription, status: "queued", error_message: null }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  return {
    calls,
    db: {
      async connect() {
        return client;
      },
    },
  };
}

test("admin retry recreates a missing queue row when retained audio exists", async () => {
  const { db, calls } = createDb({
    id: 227,
    user_id: 5,
    filename: "Hãy Trao Cho Anh.mp3",
    file_size: 4_007_776,
    duration: null,
    audio_filename: "queue-song.mp3",
    source_language: "auto",
    translation_target_language: null,
    status: "failed",
    error_message: "Kết quả nhận dạng lời hát chưa đủ tin cậy.",
    queue_job_id: null,
  });
  const accessed = [];

  const result = await retryTranscriptionJobForAdmin(227, {
    db,
    resolveAudioPath: (filename) => `C:\\audio\\${filename}`,
    accessAudio: async (audioPath) => accessed.push(audioPath),
    loadSettings: async () => ({ max_retry_attempts: 4 }),
  });

  const insert = calls.find(({ sql }) =>
    /INSERT INTO transcription_jobs/i.test(sql),
  );
  assert.deepEqual(accessed, ["C:\\audio\\queue-song.mp3"]);
  assert.ok(insert);
  assert.equal(insert.params[0], 5);
  assert.equal(insert.params[1], 227);
  assert.equal(insert.params[2], "upload");
  assert.equal(insert.params[3], "auto");
  assert.equal(insert.params[4], "song");
  assert.equal(insert.params[8], 4);
  assert.equal(result.queueJobId, 501);
  assert.equal(result.recreatedQueueJob, true);
  assert.equal(result.transcription.status, "queued");
});

test("admin retry explains when the retained source audio is gone", async () => {
  const { db, calls } = createDb({
    id: 99,
    user_id: 5,
    filename: "Come My Way.mp3",
    audio_filename: null,
    source_language: "vi",
    status: "failed",
    error_message: "Không tìm thấy file",
    queue_job_id: null,
  });

  await assert.rejects(
    retryTranscriptionJobForAdmin(99, {
      db,
      loadSettings: async () => ({ max_retry_attempts: 3 }),
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /file nguồn đã hết thời gian lưu trữ/i);
      return true;
    },
  );

  assert.equal(
    calls.some(({ sql }) => /INSERT INTO transcription_jobs/i.test(sql)),
    false,
  );
  assert.equal(calls.some(({ sql }) => sql === "ROLLBACK"), true);
});
