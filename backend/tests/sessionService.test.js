const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const { getRequestMetadata } = require("../services/sessionService");

function fakeRequest(userAgent, ip = "127.0.0.1") {
  return {
    ip,
    get(name) {
      return name.toLowerCase() === "user-agent" ? userAgent : "";
    },
  };
}

test("session metadata names common desktop browsers", () => {
  const metadata = getRequestMetadata(
    fakeRequest(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
    ),
  );
  assert.equal(metadata.browserName, "Chrome");
  assert.equal(metadata.osName, "Windows");
  assert.equal(metadata.deviceName, "Windows desktop");
  assert.equal(metadata.ipHash.length, 64);
});

test("session metadata names common mobile browsers", () => {
  const metadata = getRequestMetadata(
    fakeRequest(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    ),
  );
  assert.equal(metadata.browserName, "Safari");
  assert.equal(metadata.osName, "iOS");
  assert.equal(metadata.deviceName, "iOS mobile");
});

after(async () => {
  await pool.end();
});
