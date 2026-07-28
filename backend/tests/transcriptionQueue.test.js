const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanupExpiredAudioFiles,
} = require("../services/transcriptionQueue");
const pool = require("../db");

test.after(() => pool.end());

test("audio retention cleanup keeps the old filename and skips invalid paths", async () => {
  const queries = [];
  const deletedPaths = [];
  const warnings = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      return {
        rows: [
          { audio_filename: "queue-valid.mp3" },
          { audio_filename: null },
          { audio_filename: "../outside.mp3" },
        ],
      };
    },
  };

  const cleaned = await cleanupExpiredAudioFiles({
    db,
    resolveAudioPath(filename) {
      if (!filename || filename.includes("..")) {
        throw new Error("Đường dẫn file âm thanh không hợp lệ");
      }
      return `C:\\uploads\\${filename}`;
    },
    async unlink(filePath) {
      deletedPaths.push(filePath);
    },
    warn(message) {
      warnings.push(message);
    },
  });

  assert.equal(cleaned, 3);
  assert.match(queries[0], /WITH expired_audio AS/i);
  assert.match(queries[0], /RETURNING expired_audio\.audio_filename/i);
  assert.deepEqual(deletedPaths, ["C:\\uploads\\queue-valid.mp3"]);
  assert.equal(warnings.length, 2);
});
