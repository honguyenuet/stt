const JOB_ROLES = new Set([
  "creator",
  "marketing",
  "education",
  "journalism",
  "business",
  "other",
]);

const USAGE_PURPOSES = new Set([
  "meeting",
  "content",
  "interview",
  "education",
  "subtitles",
  "other",
]);

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeOnboardingPayload(body = {}) {
  const firstName = cleanText(body.firstName, 100);
  const lastName = cleanText(body.lastName, 100);
  const organization = cleanText(body.organization, 160);
  const jobRole = cleanText(body.jobRole, 40).toLowerCase();
  const usagePurpose = cleanText(body.usagePurpose, 40).toLowerCase();
  const preferredLanguage = cleanText(
    body.preferredLanguage,
    20,
  ).toLowerCase();

  if (!firstName || !lastName) {
    throw createValidationError("Vui lòng nhập đầy đủ họ và tên");
  }
  if (!JOB_ROLES.has(jobRole)) {
    throw createValidationError("Vui lòng chọn vai trò công việc");
  }
  if (!USAGE_PURPOSES.has(usagePurpose)) {
    throw createValidationError("Vui lòng chọn mục đích sử dụng");
  }
  if (!/^[a-z]{2,3}(?:-[a-z]{2})?$|^auto$/.test(preferredLanguage)) {
    throw createValidationError("Ngôn ngữ mặc định không hợp lệ");
  }

  return {
    firstName,
    lastName,
    organization,
    jobRole,
    usagePurpose,
    preferredLanguage,
  };
}

async function completeOnboarding(db, userId, body) {
  const profile = normalizeOnboardingPayload(body);
  const { rows } = await db.query(
    `UPDATE users
     SET first_name = $1,
         last_name = $2,
         organization = $3,
         job_role = $4,
         usage_purpose = $5,
         preferred_language = $6,
         onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
     WHERE id = $7
     RETURNING id, first_name, last_name, email, avatar, plan, role,
       account_status, organization, job_role, usage_purpose,
       preferred_language, onboarding_completed_at`,
    [
      profile.firstName,
      profile.lastName,
      profile.organization || null,
      profile.jobRole,
      profile.usagePurpose,
      profile.preferredLanguage,
      userId,
    ],
  );
  return rows[0] || null;
}

module.exports = {
  JOB_ROLES,
  USAGE_PURPOSES,
  completeOnboarding,
  normalizeOnboardingPayload,
};
