-- Tạo database nếu chưa có:
-- CREATE DATABASE golden_voice;
-- Sau đó kết nối vào database:
-- \c golden_voice

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  google_id   VARCHAR(255) UNIQUE,
  first_name  VARCHAR(255) NOT NULL,
  last_name   VARCHAR(255) NOT NULL,
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    VARCHAR(255),
  avatar      TEXT,
  plan        VARCHAR(20) NOT NULL DEFAULT 'free',
  quota_seconds INTEGER NOT NULL DEFAULT 1800,
  quota_alert_seconds INTEGER NOT NULL DEFAULT 300,
  plan_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  plan_expires_at TIMESTAMP WITH TIME ZONE,
  email_verified BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified_at TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS user_auth_identities (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(30) NOT NULL
    CHECK (provider IN ('google', 'facebook', 'apple')),
  provider_user_id VARCHAR(255) NOT NULL,
  provider_email VARCHAR(255),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user
ON user_auth_identities(user_id);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_created
ON email_verification_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expiry
ON email_verification_tokens(expires_at)
WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  replaced_by UUID,
  ip_hash VARCHAR(64),
  user_agent VARCHAR(500),
  device_name VARCHAR(120),
  browser_name VARCHAR(120),
  os_name VARCHAR(120),
  last_seen_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_user_active
ON auth_refresh_tokens(user_id, expires_at)
WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_refresh_cleanup
ON auth_refresh_tokens(expires_at, revoked_at);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_user_seen
ON auth_refresh_tokens(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS oauth_login_states (
  state_hash CHAR(64) PRIMARY KEY,
  provider VARCHAR(30) NOT NULL
    CHECK (provider IN ('facebook', 'apple')),
  nonce_hash CHAR(64),
  referral_code VARCHAR(32),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_login_states_expiry
ON oauth_login_states(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS transcription_folders (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transcription_folders_user_name
ON transcription_folders(user_id, LOWER(name));

CREATE TABLE IF NOT EXISTS transcriptions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id      BIGINT REFERENCES transcription_folders(id) ON DELETE SET NULL,
  filename       VARCHAR(255) NOT NULL,
  file_size      BIGINT,
  duration       NUMERIC,
  processing_seconds NUMERIC,
  text           TEXT NOT NULL,
  words          JSONB DEFAULT '[]'::jsonb,
  segments       JSONB NOT NULL DEFAULT '[]'::jsonb,
  speaker_names  JSONB NOT NULL DEFAULT '{}'::jsonb,
  audio_filename VARCHAR(255),
  source_language VARCHAR(20),
  translated_text TEXT,
  translation_target_language VARCHAR(20),
  translation_provider VARCHAR(40),
  translation_error TEXT,
  transcription_provider VARCHAR(40),
  provider_request_id VARCHAR(255),
  provider_attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  error_message TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_user_created
ON transcriptions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transcriptions_folder_created
ON transcriptions(folder_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transcription_batches (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id BIGINT REFERENCES transcription_folders(id) ON DELETE SET NULL,
  kind VARCHAR(30) NOT NULL DEFAULT 'multitrack',
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  expected_tracks SMALLINT NOT NULL CHECK (expected_tracks BETWEEN 2 AND 5),
  output_transcription_id INTEGER REFERENCES transcriptions(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_transcription_batches_user_created
ON transcription_batches(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transcription_versions (
  id BIGSERIAL PRIMARY KEY,
  transcription_id INTEGER NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  words JSONB NOT NULL DEFAULT '[]'::jsonb,
  speaker_names JSONB NOT NULL DEFAULT '{}'::jsonb,
  label VARCHAR(120),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcription_versions_transcription_created
ON transcription_versions(transcription_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transcription_jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transcription_id INTEGER NOT NULL UNIQUE REFERENCES transcriptions(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  progress SMALLINT NOT NULL DEFAULT 0,
  progress_stage VARCHAR(60) NOT NULL DEFAULT 'queued',
  source VARCHAR(20) NOT NULL DEFAULT 'upload',
  language VARCHAR(20) NOT NULL DEFAULT 'auto',
  audio_mode VARCHAR(20) NOT NULL DEFAULT 'speech',
  translate_to VARCHAR(20),
  speaker_labels BOOLEAN NOT NULL DEFAULT FALSE,
  expected_duration_seconds NUMERIC,
  upload_fingerprint VARCHAR(128),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  retry_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  timeout_seconds INTEGER NOT NULL DEFAULT 3600,
  dead_lettered BOOLEAN NOT NULL DEFAULT FALSE,
  dead_letter_reason TEXT,
  recovered_at TIMESTAMP WITH TIME ZONE,
  timed_out_at TIMESTAMP WITH TIME ZONE,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  available_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMP WITH TIME ZONE,
  lock_token VARCHAR(64),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_ready
ON transcription_jobs(status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_user_status
ON transcription_jobs(user_id, status);

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_user_fingerprint
ON transcription_jobs(user_id, upload_fingerprint)
WHERE upload_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_dead_letter
ON transcription_jobs(dead_lettered, completed_at DESC)
WHERE dead_lettered = TRUE;

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  custom_dictionary TEXT NOT NULL DEFAULT '',
  transcription_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(80) NOT NULL DEFAULT 'Default API key',
  key_prefix   VARCHAR(40) NOT NULL,
  key_hash     VARCHAR(64) UNIQUE NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at   TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_created
ON api_keys(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash
ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS api_key_usage_events (
  id                 BIGSERIAL PRIMARY KEY,
  api_key_id         INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event              VARCHAR(30) NOT NULL,
  job_id             INTEGER,
  transcription_id   INTEGER,
  duration_seconds   INTEGER NOT NULL DEFAULT 0,
  status             VARCHAR(20),
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_created
ON api_key_usage_events(api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_user_created
ON api_key_usage_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_event_created
ON api_key_usage_events(event, created_at DESC);

CREATE TABLE IF NOT EXISTS transcription_provider_circuits (
  provider VARCHAR(40) PRIMARY KEY,
  state VARCHAR(20) NOT NULL DEFAULT 'closed'
    CHECK (state IN ('closed', 'open', 'half_open')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  opened_count INTEGER NOT NULL DEFAULT 0,
  open_until TIMESTAMP WITH TIME ZONE,
  probe_locked_until TIMESTAMP WITH TIME ZONE,
  last_error_code VARCHAR(80),
  last_error_message VARCHAR(500),
  last_failure_at TIMESTAMP WITH TIME ZONE,
  last_success_at TIMESTAMP WITH TIME ZONE,
  total_failures BIGINT NOT NULL DEFAULT 0,
  total_successes BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_circuits_state
ON transcription_provider_circuits(state, open_until);

CREATE TABLE IF NOT EXISTS quota_admin_alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan VARCHAR(20) NOT NULL,
  period_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  level VARCHAR(20) NOT NULL
    CHECK (level IN ('warning', 'critical', 'exhausted')),
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  quota_seconds INTEGER NOT NULL CHECK (quota_seconds >= 0),
  used_seconds INTEGER NOT NULL CHECK (used_seconds >= 0),
  remaining_seconds INTEGER NOT NULL CHECK (remaining_seconds >= 0),
  percent_remaining NUMERIC(6, 2) NOT NULL DEFAULT 0,
  threshold_percent INTEGER NOT NULL DEFAULT 20,
  source VARCHAR(40) NOT NULL DEFAULT 'transcription',
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolution_note VARCHAR(500),
  state_cleared_at TIMESTAMP WITH TIME ZONE,
  email_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  email_attempts INTEGER NOT NULL DEFAULT 0,
  email_sent_at TIMESTAMP WITH TIME ZONE,
  email_locked_until TIMESTAMP WITH TIME ZONE,
  next_email_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  email_last_error VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quota_alerts_one_active_level
ON quota_admin_alerts(user_id, period_started_at, level)
WHERE status IN ('open', 'acknowledged');

CREATE INDEX IF NOT EXISTS idx_quota_alerts_admin_inbox
ON quota_admin_alerts(status, level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quota_alerts_email_dispatch
ON quota_admin_alerts(email_status, next_email_attempt_at)
WHERE status IN ('open', 'acknowledged');
