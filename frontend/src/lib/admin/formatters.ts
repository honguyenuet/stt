import type {
  AdminRole,
  AuditAction,
  JobStatus,
  StorageStatus,
  UserStatus,
} from "./types";

export function formatDateTime(value?: string | null) {
  if (!value) return "Chưa có";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDuration(seconds?: number | null) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function formatFileSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatMinutes(minutes: number) {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(minutes))} phút`;
}

export const jobStatusLabel: Record<JobStatus, string> = {
  uploaded: "Đã tải lên",
  queued: "Đang chờ",
  processing: "Đang xử lý",
  completed: "Hoàn tất",
  failed: "Thất bại",
  cancelled: "Đã hủy",
};

export const userStatusLabel: Record<UserStatus, string> = {
  active: "Đang hoạt động",
  suspended: "Đã khóa",
  deleted: "Đã xóa",
};

export const roleLabel: Record<AdminRole, string> = {
  admin: "Quản trị viên",
  support: "Hỗ trợ viên",
  viewer: "Chỉ xem",
  user: "Người dùng",
};

export const storageStatusLabel: Record<StorageStatus, string> = {
  available: "Có sẵn",
  archived: "Đã lưu trữ",
  missing: "Thiếu tệp",
  error: "Lỗi",
};

export const auditActionLabel: Record<AuditAction, string> = {
  "user.suspend": "Khóa người dùng",
  "user.activate": "Mở khóa người dùng",
  "user.delete": "Xóa người dùng",
  "user.role_update": "Cập nhật vai trò",
  "quota.adjust": "Điều chỉnh thời lượng",
  "transcription.retry": "Chạy lại chuyển giọng nói",
  "transcription.cancel": "Hủy chuyển giọng nói",
  "file.delete": "Xóa tệp",
  "settings.update": "Cập nhật cài đặt",
  "plan.update": "Cập nhật gói",
  "provider.update": "Cập nhật nhà cung cấp",
  "support.reply": "Phản hồi hỗ trợ",
  "support.status_update": "Cập nhật trạng thái hỗ trợ",
};

export function validateQuotaAdjustment(currentQuota: number, delta: number) {
  if (!Number.isFinite(delta) || delta === 0)
    return "Thời lượng thay đổi phải khác 0";
  if (currentQuota + delta < 0) return "Thời lượng không được âm";
  return "";
}

export function validateQuotaMinutes(quotaMinutes: number) {
  if (!Number.isFinite(quotaMinutes)) return "Quota không hợp lệ";
  if (quotaMinutes < 0) return "Quota không được âm";
  return "";
}
