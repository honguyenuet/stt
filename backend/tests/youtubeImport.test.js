const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");

const {
  assertPublicMediaMetadata,
  getMediaImportEgressProxy,
  getYoutubeAttemptProfiles,
  isYoutubeVerificationError,
  normalizeMediaUrl,
  runYoutubeDlWithFallback,
} = require("../services/youtubeImportService");

after(() => pool.end());

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

test("uses supported anonymous clients as YouTube verification fallbacks", () => {
  withEnv(
    {
      YOUTUBE_COOKIES_FILE: undefined,
      YOUTUBE_FALLBACK_PLAYER_CLIENTS: undefined,
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

test("accepts supported public media platforms and removes URL fragments", () => {
  assert.equal(
    normalizeMediaUrl("https://soundcloud.com/artist/track#comments"),
    "https://soundcloud.com/artist/track",
  );
  assert.equal(
    normalizeMediaUrl("https://vt.tiktok.com/ZSExample/"),
    "https://vt.tiktok.com/ZSExample/",
  );
});

test("rejects Spotify with an actionable explanation", () => {
  assert.throws(
    () => normalizeMediaUrl("https://open.spotify.com/track/example"),
    (error) => error.statusCode === 422 && /Spotify|DRM/i.test(error.message),
  );
});

test("blocks unsafe or unsupported media URLs", () => {
  assert.throws(
    () => normalizeMediaUrl("http://soundcloud.com/artist/track"),
    (error) => error.statusCode === 400 && /HTTPS/i.test(error.message),
  );
  assert.throws(
    () => normalizeMediaUrl("https://localhost/audio.mp3"),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => normalizeMediaUrl("https://example.com/audio.mp3"),
    (error) => error.statusCode === 400 && /chưa được hỗ trợ/i.test(error.message),
  );
});

test("blocks private media URLs returned by an extractor", async () => {
  await assert.rejects(
    () =>
      assertPublicMediaMetadata({
        webpage_url: "https://soundcloud.com/artist/track",
        formats: [{ url: "https://127.0.0.1/internal-audio" }],
      }),
    (error) => error.statusCode === 400 && /mạng nội bộ/i.test(error.message),
  );
});

test("production media imports require an SSRF-filtering egress proxy", () => {
  withEnv({ MEDIA_IMPORT_EGRESS_PROXY_URL: undefined }, () => {
    assert.throws(
      () => getMediaImportEgressProxy({ production: true }),
      (error) => error.statusCode === 503 && /egress proxy/i.test(error.message),
    );
  });

  withEnv(
    { MEDIA_IMPORT_EGRESS_PROXY_URL: "http://127.0.0.1:8080" },
    () => {
      assert.equal(
        getMediaImportEgressProxy({ production: true }),
        "http://127.0.0.1:8080/",
      );
    },
  );
});

test("non-YouTube imports never use YouTube fallback clients", () => {
  withEnv(
    {
      YOUTUBE_COOKIES_FILE: "C:\\secrets\\youtube-cookies.txt",
      YOUTUBE_FALLBACK_PLAYER_CLIENTS: "android_vr",
    },
    () => {
      assert.deepEqual(getYoutubeAttemptProfiles(false), [null]);
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

test("retries YouTube HTTP 403 downloads with public clients", async (t) => {
  const previousCookies = process.env.YOUTUBE_COOKIES_FILE;
  const previousClients = process.env.YOUTUBE_FALLBACK_PLAYER_CLIENTS;
  delete process.env.YOUTUBE_COOKIES_FILE;
  process.env.YOUTUBE_FALLBACK_PLAYER_CLIENTS =
    "android_vr,web_embedded";
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
    const profile = flags.extractorArgs || "default";
    attempts.push(profile);
    if (profile !== "youtube:player_client=web_embedded") {
      const error = new Error(
        "ERROR: unable to download video data: HTTP Error 403: Forbidden",
      );
      error.stderr = error.message;
      throw error;
    }
    return "audio";
  });

  assert.equal(result, "audio");
  assert.deepEqual(attempts, [
    "default",
    "youtube:player_client=android_vr",
    "youtube:player_client=web_embedded",
  ]);
});
