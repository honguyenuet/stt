const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const COMMON_PASSWORDS = new Set([
  "123456789012",
  "1234567890ab",
  "password1234",
  "password123456",
  "qwerty123456",
  "vbee12345678",
  "vbeevoice123",
  "admin12345678",
]);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
  if (!email || email.length > 254) return false;
  if (!EMAIL_PATTERN.test(email)) return false;
  const [localPart, domain] = email.split("@");
  return Boolean(localPart && localPart.length <= 64 && domain && domain.length <= 253);
}

function passwordStrength(password, profile = {}) {
  const value = String(password || "");
  const compact = value.toLowerCase().replace(/\s+/g, "");
  const emailLocal = normalizeEmail(profile.email).split("@")[0] || "";
  const firstName = String(profile.firstName || "").trim().toLowerCase();
  const lastName = String(profile.lastName || "").trim().toLowerCase();
  const categories = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length;

  const errors = [];
  if (value.length < 12) errors.push("Mật khẩu phải có ít nhất 12 ký tự");
  if (value.length > 128) errors.push("Mật khẩu không được vượt quá 128 ký tự");
  if (COMMON_PASSWORDS.has(compact)) errors.push("Mật khẩu này quá phổ biến");
  if (categories < 3) {
    errors.push("Mật khẩu cần có ít nhất 3 nhóm: chữ thường, chữ hoa, số, ký tự đặc biệt");
  }
  if (/^(.)\1{7,}$/.test(value)) {
    errors.push("Mật khẩu không được lặp lại một ký tự quá nhiều");
  }
  if (/012345|123456|234567|abcdef|qwerty|password/i.test(value)) {
    errors.push("Mật khẩu không nên chứa chuỗi dễ đoán");
  }
  for (const part of [emailLocal, firstName, lastName]) {
    if (part && part.length >= 3 && compact.includes(part.replace(/\s+/g, ""))) {
      errors.push("Mật khẩu không nên chứa tên hoặc email của bạn");
      break;
    }
  }

  let score = Math.min(4, Math.floor(value.length / 4));
  score += Math.max(0, categories - 1);
  score -= errors.length;
  return { score: Math.max(0, Math.min(4, score)), errors };
}

function validatePassword(password, profile = {}) {
  return passwordStrength(password, profile).errors[0] || "";
}

function validateRegistrationSpamTrap({ website, registerStartedAt }) {
  if (String(website || "").trim()) {
    return "Không thể xử lý đăng ký tự động";
  }
  const startedAt = Number(registerStartedAt);
  if (Number.isFinite(startedAt) && startedAt > 0) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > -5_000 && elapsedMs < 2_000) {
      return "Bạn thao tác quá nhanh. Vui lòng kiểm tra lại thông tin và thử lại.";
    }
  }
  return "";
}

module.exports = {
  isValidEmail,
  normalizeEmail,
  passwordStrength,
  validatePassword,
  validateRegistrationSpamTrap,
};
