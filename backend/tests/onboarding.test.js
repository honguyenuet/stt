const assert = require("node:assert/strict");
const test = require("node:test");
const {
  completeOnboarding,
  normalizeOnboardingPayload,
} = require("../services/onboardingService");

test("normalizes a valid onboarding profile", () => {
  assert.deepEqual(
    normalizeOnboardingPayload({
      firstName: "  Hồ  ",
      lastName: " Mạnh ",
      organization: " Vbee ",
      jobRole: "BUSINESS",
      usagePurpose: "meeting",
      preferredLanguage: "vi",
    }),
    {
      firstName: "Hồ",
      lastName: "Mạnh",
      organization: "Vbee",
      jobRole: "business",
      usagePurpose: "meeting",
      preferredLanguage: "vi",
    },
  );
});

test("rejects unsupported onboarding choices", () => {
  assert.throws(
    () =>
      normalizeOnboardingPayload({
        firstName: "Hồ",
        lastName: "Mạnh",
        jobRole: "invalid",
        usagePurpose: "meeting",
        preferredLanguage: "vi",
      }),
    /vai trò công việc/,
  );
});

test("persists onboarding and returns the updated user", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [
          {
            id: 7,
            first_name: params[0],
            last_name: params[1],
            email: "user@example.com",
            organization: params[2],
            job_role: params[3],
            usage_purpose: params[4],
            preferred_language: params[5],
            onboarding_completed_at: new Date(),
          },
        ],
      };
    },
  };

  const user = await completeOnboarding(db, 7, {
    firstName: "Hồ",
    lastName: "Mạnh",
    organization: "Vbee",
    jobRole: "business",
    usagePurpose: "content",
    preferredLanguage: "vi",
  });

  assert.equal(user.id, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.at(-1), 7);
  assert.match(calls[0].sql, /onboarding_completed_at/);
});
