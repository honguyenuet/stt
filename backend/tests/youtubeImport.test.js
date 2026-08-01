const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getYoutubeAttemptProfiles,
  isYoutubeVerificationError,
  runYoutubeDlWithFallback,
} = require("../services/youtubeImportService");

function withEnv(values, callback) {
  const previous = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  try {
    callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test("detects YouTube server verification errors", () => {
  assert.equal(
    isYoutubeVerificationError({
      stderr: "Sign in to confirm you’re not a bot",
    }),
    true,
  );
  assert.equal(
    isYoutubeVerificationError({
      message: "Sign in to confirm you're not a bot",
    }),
    true,
  );
  assert.equal(
    isYoutubeVerificationError({ message: "Private video" }),
    false,
  );
});

test("uses android_vr as the anonymous fallback client", () => {
  withEnv(
    {
      YOUTUBE_COOKIES_FILE: undefined,
      YOUTUBE_FALLBACK_PLAYER_CLIENTS: undefined,
    },
    () => {
      assert.deepEqual(getYoutubeAttemptProfiles(), [null, "android_vr"]);
    },
  );
});

test("does not use anonymous clients when authenticated cookies are configured", () => {
  withEnv(
    {
      YOUTUBE_COOKIES_FILE: "C:\\secrets\\youtube-cookies.txt",
      YOUTUBE_FALLBACK_PLAYER_CLIENTS: "android_vr",
    },
    () => {
      assert.deepEqual(getYoutubeAttemptProfiles(), [null]);
    },
  );
});

test("ignores unsupported or duplicated fallback client names", () => {
  withEnv(
    {
      YOUTUBE_COOKIES_FILE: undefined,
      YOUTUBE_FALLBACK_PLAYER_CLIENTS:
        "android_vr,invalid client,web_embedded,android_vr",
    },
    () => {
      assert.deepEqual(getYoutubeAttemptProfiles(), [
        null,
        "android_vr",
        "web_embedded",
      ]);
    },
  );
});

test("retries a blocked anonymous request with the configured public client", async (t) => {
  const previousCookies = process.env.YOUTUBE_COOKIES_FILE;
  const previousClients = process.env.YOUTUBE_FALLBACK_PLAYER_CLIENTS;
  delete process.env.YOUTUBE_COOKIES_FILE;
  process.env.YOUTUBE_FALLBACK_PLAYER_CLIENTS = "android_vr";
  t.after(() => {
    if (previousCookies === undefined) delete process.env.YOUTUBE_COOKIES_FILE;
    else process.env.YOUTUBE_COOKIES_FILE = previousCookies;
    if (previousClients === undefined) {
      delete process.env.YOUTUBE_FALLBACK_PLAYER_CLIENTS;
    } else {
      process.env.YOUTUBE_FALLBACK_PLAYER_CLIENTS = previousClients;
    }
  });

  const attempts = [];
  const result = await runYoutubeDlWithFallback(async (flags) => {
    attempts.push(flags.extractorArgs || "default");
    if (!flags.extractorArgs) {
      const error = new Error("Sign in to confirm you're not a bot");
      error.stderr = error.message;
      throw error;
    }
    return "metadata";
  });

  assert.equal(result, "metadata");
  assert.deepEqual(attempts, [
    "default",
    "youtube:player_client=android_vr",
  ]);
});
