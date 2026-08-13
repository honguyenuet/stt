export type AdminRole = "user" | "supporter" | "admin";
export type AssignableAdminRole = AdminRole;
export type UserStatus = "active" | "suspended" | "deleted";
export type ManagedUserPlan = "free" | "standard" | "special" | "business";
export type BillingCycle = "monthly" | "yearly";
export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";
export type StorageStatus = "available" | "archived" | "missing" | "error";
export type FileType = "audio" | "video";
export type SupportTicketStatus = "open" | "pending" | "resolved" | "closed";
export type SupportMessageSender = "user" | "admin";
export type AuditAction =
  | "user.suspend"
  | "user.activate"
  | "user.delete"
  | "user.role_update"
  | "quota.adjust"
  | "transcription.retry"
  | "transcription.cancel"
  | "file.delete"
  | "settings.update"
  | "plan.update"
  | "provider.update"
  | "support.reply"
  | "support.status_update";

export type RoutingMode = "manual" | "auto" | "rule_based";

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface AdminSession {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: AdminRole;
  };
  expiresAt: number;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  status: UserStatus;
  plan: ManagedUserPlan;
  quota_minutes: number;
  used_minutes: number;
  plan_started_at: string | null;
  plan_expires_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface TranscriptionJob {
  job_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  file_id: string;
  file_name: string;
  language: string;
  duration: number;
  status: JobStatus;
  processing_time: number | null;
  created_at: string;
  completed_at: string | null;
  error_message?: string;
  queue_job_id?: number | null;
  progress?: number;
  progress_stage?: string;
  attempts?: number;
  max_attempts?: number;
  next_retry_at?: string | null;
  timeout_seconds?: number | null;
  dead_lettered?: boolean;
  dead_letter_reason?: string | null;
  recovered_at?: string | null;
  timed_out_at?: string | null;
  transcript?: string;
}

export interface ManagedFile {
  file_id: string;
  file_name: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  file_type: FileType;
  file_size: number;
  duration_seconds: number;
  storage_status: StorageStatus;
  transcription_status: JobStatus;
  created_at: string;
  media_url?: string;
  has_audio_track: boolean;
  metadata: Record<string, string | number | boolean>;
}

export interface AdminSupportTicket {
  id: string;
  user_id: string | null;
  user_name: string;
  user_email: string;
  subject: string;
  category: string;
  priority: string;
  status: SupportTicketStatus;
  page_url: string | null;
  user_plan: string | null;
  latest_message: string;
  created_at: string;
  updated_at: string;
}

export interface AdminSupportMessage {
  id: string;
  ticket_id: string;
  sender: SupportMessageSender;
  message: string;
  created_at: string;
}

export interface UsagePoint {
  date: string;
  web_minutes: number;
  api_minutes: number;
}

export interface DashboardSummary {
  total_users: number;
  total_files: number;
  total_jobs: number;
  processed_minutes: number;
  jobs_by_status: Record<JobStatus, number>;
  success_rate: number;
  failure_rate: number;
  average_processing_time: number;
  usage: UsagePoint[];
  recent_jobs: TranscriptionJob[];
  recent_failed_jobs: TranscriptionJob[];
}

export interface UsageSummary {
  total_processed_minutes: number;
  daily: UsagePoint[];
  by_user: Array<{
    user_id: string;
    name: string;
    email: string;
    used_minutes: number;
    quota_minutes: number;
  }>;
  low_quota_users: AdminUser[];
}

export interface AuditLog {
  id: string;
  actor: string;
  action: AuditAction;
  target_type:
    | "user"
    | "quota"
    | "transcription"
    | "file"
    | "settings"
    | "support";
  target_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AdminSettings {
  max_file_size_mb: number;
  max_file_duration_minutes: number;
  supported_formats: string[];
  supported_languages: string[];
  max_retry_attempts: number;
  default_quota_minutes: number;
  storage_policy: string;
  data_retention_days: number;
  system_parameters: Record<string, string | number | boolean>;
  notification_config: Record<string, string | number | boolean>;
}

export interface ServicePlan {
  id: string;
  code: string;
  name: string;
  quota_minutes: number;
  price_vnd: number;
  billing_cycle: "monthly" | "yearly" | "custom";
  max_upload_mb: number;
  max_file_duration_minutes: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SpeechProvider {
  id: string;
  name: string;
  code: string;
  api_key_masked: string;
  api_key?: string;
  endpoint: string;
  enabled: boolean;
  is_default: boolean;
  routing_mode: RoutingMode;
  routing_rules: Record<string, unknown>;
  failover_provider_id: string | null;
  health_status: "healthy" | "degraded" | "down" | "unknown";
  success_rate: number;
  avg_latency_ms: number;
  cost_per_minute_usd: number;
  monthly_cost_usd: number;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportSummary {
  users: { total: number; active: number; suspended: number };
  jobs: {
    total: number;
    completed: number;
    failed: number;
    success_rate: number;
  };
  audio: { processed_minutes: number; files: number };
  quota: { allocated_minutes: number; used_minutes: number };
  revenue: { total_vnd: number; paid_orders: number };
  performance: { average_processing_time: number; average_latency_ms: number };
  daily_usage: UsagePoint[];
  scope?: { date_from: string | null; date_to: string | null };
}

export interface SystemStatus {
  database: "ok" | "error";
  backend: "ok";
  transcription_queue: Record<string, unknown>;
  providers: Array<Pick<SpeechProvider, "code" | "health_status" | "enabled">>;
  generated_at: string;
}

export interface ListUsersParams extends PaginationParams {
  search?: string;
  role?: AssignableAdminRole | "all";
  status?: UserStatus | "all";
  plan?: ManagedUserPlan | "all";
  quotaStatus?: "all" | "low" | "exceeded";
  createdFrom?: string;
  createdTo?: string;
}

export interface ListJobsParams extends PaginationParams {
  search?: string;
  status?: JobStatus | "all";
  language?: string;
  source?: "all" | "upload" | "recording" | "api";
  deadLetter?: "all" | "true" | "false";
  createdFrom?: string;
  createdTo?: string;
}

export interface ListFilesParams extends PaginationParams {
  search?: string;
  fileType?: FileType | "all";
  storageStatus?: StorageStatus | "all";
  transcriptionStatus?: JobStatus | "all";
}

export interface ListSupportTicketsParams extends PaginationParams {
  search?: string;
  status?: SupportTicketStatus | "all";
  category?: string;
}

export interface ListAuditLogsParams extends PaginationParams {
  search?: string;
  action?: AuditAction | "all";
  actor?: string;
  targetType?: AuditLog["target_type"] | "all";
  dateFrom?: string;
  dateTo?: string;
}
