const nodemailer = require("nodemailer");
const { IS_PRODUCTION } = require("../config/security");

let transporter;

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && (process.env.SMTP_FROM || process.env.SMTP_USER));
}

function getTransporter() {
  if (transporter) return transporter;
  if (!hasSmtpConfig()) return null;

  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "");
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    requireTLS: IS_PRODUCTION && process.env.SMTP_SECURE !== "true",
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return transporter;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendPasswordResetEmail({ to, firstName, resetUrl, expiresMinutes }) {
  const mailer = getTransporter();
  if (!mailer) return false;

  const safeName = escapeHtml(firstName || "bạn");
  const safeUrl = escapeHtml(resetUrl);
  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: "Đặt lại mật khẩu Vbee AIVoice",
    text: `Xin chào ${firstName || "bạn"},\n\nMở liên kết sau để đặt lại mật khẩu: ${resetUrl}\n\nLiên kết hết hạn sau ${expiresMinutes} phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#21104a;line-height:1.6">
        <h2>Đặt lại mật khẩu Vbee AIVoice</h2>
        <p>Xin chào <strong>${safeName}</strong>,</p>
        <p>Bạn vừa yêu cầu đặt lại mật khẩu. Nhấn nút bên dưới để tiếp tục:</p>
        <p style="margin:28px 0">
          <a href="${safeUrl}" style="background:#ffcb05;color:#21104a;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">Đặt lại mật khẩu</a>
        </p>
        <p>Liên kết hết hạn sau ${expiresMinutes} phút và chỉ sử dụng được một lần.</p>
        <p style="color:#756894;font-size:13px">Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.</p>
      </div>
    `,
  });
  return true;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours} giờ ${minutes} phút` : `${minutes} phút`;
}

async function sendQuotaAdminAlertEmail({ recipients, alert }) {
  const mailer = getTransporter();
  if (!mailer) return false;

  const levelLabels = {
    warning: "Sắp hết quota",
    critical: "Quota ở mức khẩn cấp",
    exhausted: "Đã hết quota",
  };
  const levelLabel = levelLabels[alert.level] || "Cảnh báo quota";
  const customerName = `${alert.first_name || ""} ${alert.last_name || ""}`.trim();
  const safeName = escapeHtml(customerName || "Khách hàng");
  const safeEmail = escapeHtml(alert.email || "-");
  const safePlan = escapeHtml(alert.plan || "free");
  const remaining = formatDuration(alert.remaining_seconds);
  const used = formatDuration(alert.used_seconds);
  const quota = formatDuration(alert.quota_seconds);

  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipients,
    subject: `[Vbee CMS] ${levelLabel}: ${alert.email || customerName || `user #${alert.user_id}`}`,
    text: `${levelLabel}\nKhách hàng: ${customerName || "-"} (${alert.email || "-"})\nGói: ${alert.plan}\nĐã dùng: ${used} / ${quota}\nCòn lại: ${remaining}\nNguồn: ${alert.source || "transcription"}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#21104a;line-height:1.6">
        <div style="border-top:6px solid #ffcb05;border-radius:12px;border-left:1px solid #e5deef;border-right:1px solid #e5deef;border-bottom:1px solid #e5deef;padding:24px">
          <p style="margin:0;color:#9a7b00;font-size:12px;font-weight:700;text-transform:uppercase">Vbee CMS</p>
          <h2 style="margin:8px 0 18px">${escapeHtml(levelLabel)}</h2>
          <p><strong>Khách hàng:</strong> ${safeName} (${safeEmail})</p>
          <p><strong>Gói:</strong> ${safePlan}</p>
          <p><strong>Đã dùng:</strong> ${escapeHtml(used)} / ${escapeHtml(quota)}</p>
          <p><strong>Còn lại:</strong> ${escapeHtml(remaining)}</p>
          <p style="margin-top:20px;color:#756894;font-size:13px">Mở Vbee CMS → Cảnh báo quota để xác nhận hoặc xử lý cảnh báo này.</p>
        </div>
      </div>
    `,
  });
  return true;
}

module.exports = {
  hasSmtpConfig,
  sendPasswordResetEmail,
  sendQuotaAdminAlertEmail,
};
