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

CREATE TABLE IF NOT EXISTS transcriptions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename       VARCHAR(255) NOT NULL,
  file_size      BIGINT,
  duration       NUMERIC,
  processing_seconds NUMERIC,
  text           TEXT NOT NULL,
  words          JSONB DEFAULT '[]'::jsonb,
  audio_filename VARCHAR(255),
  source_language VARCHAR(20),
  translated_text TEXT,
  translation_target_language VARCHAR(20),
  translation_provider VARCHAR(40),
  translation_error TEXT,
  transcription_provider VARCHAR(40),
  provider_request_id VARCHAR(255),
  provider_attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_user_created
ON transcriptions(user_id, created_at DESC);

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
