const { test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../db");
const {
  isValidEmail,
  normalizeEmail,
  validatePassword,
  validateRegistrationSpamTrap,
} = require("../services/registrationValidation");

test("registration email normalization is case-insensitive", () => {
  assert.equal(normalizeEmail("  User.Name@Example.COM  "), "user.name@example.com");
  assert.equal(isValidEmail("user.name@example.com"), true);
  assert.equal(isValidEmail("bad@@example.com"), false);
  assert.equal(isValidEmail("missing-domain@"), false);
});

test("registration rejects weak or profile-derived passwords", () => {
  assert.match(validatePassword("password123456"), /quá phổ biến|dễ đoán/);
  assert.match(
    validatePassword("NguyenSecure123!", {
      email: "van@example.com",
      firstName: "Van",
      lastName: "Nguyen",
    }),
    /tên hoặc email/,
  );
  assert.equal(
    validatePassword("Vbee!Secure2026", {
      email: "owner@example.com",
      firstName: "Mai",
      lastName: "Tran",
    }),
    "",
  );
});

test("registration spam trap catches hidden-field bots and instant submits", () => {
  assert.match(validateRegistrationSpamTrap({ website: "bot" }), /tự động/);
  assert.match(
    validateRegistrationSpamTrap({ registerStartedAt: Date.now() }),
    /quá nhanh/,
  );
});

test.after(async () => {
  await pool.end();
});
