const assert = require("node:assert/strict");
const test = require("node:test");
const { createZipBuffer } = require("../services/zipExportService");

test("creates a valid uncompressed zip archive", () => {
  const archive = createZipBuffer([
    { name: "transcript.txt", data: "Xin chào" },
    { name: "metadata.json", data: JSON.stringify({ ok: true }) },
  ]);

  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.includes(Buffer.from("transcript.txt")), true);
  assert.equal(archive.includes(Buffer.from("metadata.json")), true);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
});
