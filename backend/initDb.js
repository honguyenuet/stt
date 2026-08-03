const bcrypt = require('bcryptjs');
const pool = require('./db');
const { IS_PRODUCTION } = require('./config/security');
const { normalizeFilename } = require('./services/filenameEncoding');
const { encryptProviderSecret } = require('./services/providerSecrets');

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const FREE_PLAN_SECONDS = positiveInt(process.env.FREE_PLAN_SECONDS, 30 * 60);
const DEFAULT_QUOTA_ALERT_SECONDS = positiveInt(
  process.env.DEFAULT_QUOTA_ALERT_SECONDS,
  5 * 60,
);
const SECURITY_AUDIT_RETENTION_DAYS = Math.max(
  30,
  positiveInt(process.env.SECURITY_AUDIT_RETENTION_DAYS, 180),
);
const ADMIN_AUDIT_RETENTION_DAYS = Math.max(
  90,
  positiveInt(process.env.ADMIN_AUDIT_RETENTION_DAYS, 365),
);

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id VARCHAR(255) UNIQUE,
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255),
      avatar TEXT,
      referral_code VARCHAR(32) UNIQUE,
      plan VARCHAR(20) NOT NULL DEFAULT 'free',
      quota_seconds INTEGER NOT NULL DEFAULT ${FREE_PLAN_SECONDS},
      quota_alert_seconds INTEGER NOT NULL DEFAULT ${DEFAULT_QUOTA_ALERT_SECONDS},
      plan_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      plan_expires_at TIMESTAMP WITH TIME ZONE,
      free_trial_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      plan_cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      plan_cancellation_requested_at TIMESTAMP WITH TIME ZONE,
      role VARCHAR(30) NOT NULL DEFAULT 'user',
      account_status VARCHAR(20) NOT NULL DEFAULT 'active',
      admin_note TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(255);`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(255);`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS password VARCHAR(255);`,
  );
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;`);
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'free';`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_seconds INTEGER NOT NULL DEFAULT ${FREE_PLAN_SECONDS};`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_alert_seconds INTEGER NOT NULL DEFAULT ${DEFAULT_QUOTA_ALERT_SECONDS};`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_alert_daily_seconds INTEGER NOT NULL DEFAULT 0;`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_alert_date DATE NOT NULL DEFAULT CURRENT_DATE;`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_alert_required BOOLEAN NOT NULL DEFAULT FALSE;`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_alert_token VARCHAR(255);`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_alert_sent_at TIMESTAMP WITH TIME ZONE;`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_alert_confirmed_at TIMESTAMP WITH TIME ZONE;`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMP WITH TIME ZONE;`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role VARCHAR(20) NOT NULL DEFAULT 'none';`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';`,
  );
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;`,
  );
  await pool.query(`
    UPDATE users
    SET usage_alert_daily_seconds = COALESCE(usage_alert_daily_seconds, 0),
        usage_alert_date = COALESCE(usage_alert_date, CURRENT_DATE),
        usage_alert_required = COALESCE(usage_alert_required, FALSE),
        admin_role = COALESCE(admin_role, 'none'),
        status = COALESCE(status, 'active')
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(32);`);
  await pool.query(`
    UPDATE users
    SET referral_code = 'VBEE-' || LPAD(id::text, GREATEST(6, LENGTH(id::text)), '0')
    WHERE referral_code IS NULL OR BTRIM(referral_code) = '';
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'free';`);
  await pool.query(`UPDATE users SET plan = 'special' WHERE LOWER(BTRIM(plan)) = 'premium';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_seconds INTEGER NOT NULL DEFAULT ${FREE_PLAN_SECONDS};`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_alert_seconds INTEGER NOT NULL DEFAULT ${DEFAULT_QUOTA_ALERT_SECONDS};`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_trial_started_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`UPDATE users SET free_trial_started_at = COALESCE(free_trial_started_at, created_at, plan_started_at, NOW()) WHERE free_trial_started_at IS NULL;`);
  await pool.query(`ALTER TABLE users ALTER COLUMN free_trial_started_at SET DEFAULT NOW();`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_cancellation_requested_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(30) NOT NULL DEFAULT 'user';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'active';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_note TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`
    UPDATE users
    SET admin_role = role
    WHERE admin_role = 'none'
      AND role IN ('admin', 'super_admin');
  `);
  await pool.query(`
    UPDATE users
    SET status = CASE
      WHEN account_status = 'active' THEN 'active'
      ELSE 'suspended'
    END
    WHERE status IS DISTINCT FROM CASE
      WHEN account_status = 'active' THEN 'active'
      ELSE 'suspended'
    END;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, account_status);`);

  await pool.query(`
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
  `);
  await pool.query(`
    INSERT INTO user_auth_identities (
      user_id, provider, provider_user_id, provider_email,
      email_verified, last_login_at
    )
    SELECT id, 'google', google_id, email, TRUE, created_at
    FROM users
    WHERE google_id IS NOT NULL AND BTRIM(google_id) <> ''
    ON CONFLICT (provider, provider_user_id) DO NOTHING;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user ON user_auth_identities(user_id);`);

  await pool.query(`
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
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oauth_login_states_expiry ON oauth_login_states(expires_at, consumed_at);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transcriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      file_size BIGINT,
      duration NUMERIC,
      processing_seconds NUMERIC,
      text TEXT NOT NULL,
      words JSONB DEFAULT '[]'::jsonb,
      audio_filename VARCHAR(255),
      source_language VARCHAR(20),
      translated_text TEXT,
      translation_target_language VARCHAR(20),
      translation_provider VARCHAR(40),
      translation_error TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'completed',
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS file_size BIGINT;`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS duration NUMERIC;`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS processing_seconds NUMERIC;`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS words JSONB DEFAULT '[]'::jsonb;`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS segments JSONB DEFAULT '[]'::jsonb;`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS speaker_names JSONB DEFAULT '{}'::jsonb;`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS audio_filename VARCHAR(255);`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS source_language VARCHAR(20);`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS translated_text TEXT;`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS translation_target_language VARCHAR(20);`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS translation_provider VARCHAR(40);`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'completed';`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS error_message TEXT;`,
  );
  await pool.query(
    `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;`,
  );
  await pool.query(`
    UPDATE transcriptions
    SET status = COALESCE(status, 'completed'),
        completed_at = COALESCE(completed_at, created_at)
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_transcriptions_user_created ON transcriptions(user_id, created_at DESC);`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`,
  );
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS file_size BIGINT;`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS duration NUMERIC;`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS processing_seconds NUMERIC;`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS words JSONB DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS audio_filename VARCHAR(255);`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS source_language VARCHAR(20);`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS translated_text TEXT;`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS translation_target_language VARCHAR(20);`);
  await pool.query(`UPDATE transcriptions SET translation_target_language = NULL WHERE LOWER(BTRIM(COALESCE(translation_target_language, ''))) = 'none';`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS translation_provider VARCHAR(40);`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS translation_error TEXT;`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS transcription_provider VARCHAR(40);`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS provider_request_id VARCHAR(255);`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS provider_attempts JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'completed';`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS error_message TEXT;`);
  await pool.query(`ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transcriptions_user_created ON transcriptions(user_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transcriptions_user_status ON transcriptions(user_id, status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      id UUID PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      revoked_at TIMESTAMP WITH TIME ZONE,
      replaced_by UUID,
      ip_hash VARCHAR(64),
      user_agent VARCHAR(500),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_refresh_user_active ON auth_refresh_tokens(user_id, expires_at) WHERE revoked_at IS NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auth_refresh_cleanup ON auth_refresh_tokens(expires_at, revoked_at);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_audit_events (
      id BIGSERIAL PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      outcome VARCHAR(20) NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      session_id VARCHAR(100),
      request_id VARCHAR(100),
      ip_hash VARCHAR(64),
      user_agent VARCHAR(500),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_events(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_audit_user_created ON security_audit_events(user_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_audit_event_created ON security_audit_events(event_type, created_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(100) NOT NULL,
      target_type VARCHAR(60) NOT NULL,
      target_id VARCHAR(120),
      reason VARCHAR(500),
      before_data JSONB,
      after_data JSONB,
      request_id VARCHAR(100),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_created ON admin_audit_logs(actor_user_id, created_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rate_limit_counters (
      namespace VARCHAR(80) NOT NULL,
      key_hash CHAR(64) NOT NULL,
      window_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
      reset_at TIMESTAMP WITH TIME ZONE NOT NULL,
      total_hits INTEGER NOT NULL DEFAULT 0 CHECK (total_hits >= 0),
      PRIMARY KEY (namespace, key_hash, window_started_at)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rate_limit_cleanup ON rate_limit_counters(reset_at);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      used_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_created ON password_reset_tokens(user_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry ON password_reset_tokens(expires_at) WHERE used_at IS NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transcription_jobs (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      transcription_id INTEGER NOT NULL UNIQUE REFERENCES transcriptions(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'queued',
      progress SMALLINT NOT NULL DEFAULT 0,
      source VARCHAR(20) NOT NULL DEFAULT 'upload',
      language VARCHAR(20) NOT NULL DEFAULT 'auto',
      audio_mode VARCHAR(20) NOT NULL DEFAULT 'speech',
      translate_to VARCHAR(20),
      speaker_labels BOOLEAN NOT NULL DEFAULT FALSE,
      expected_duration_seconds NUMERIC,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 2,
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
  `);

  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS progress SMALLINT NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'upload';`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS language VARCHAR(20) NOT NULL DEFAULT 'auto';`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS audio_mode VARCHAR(20) NOT NULL DEFAULT 'speech';`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS translate_to VARCHAR(20);`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS speaker_labels BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS expected_duration_seconds NUMERIC;`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 2;`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS error_message TEXT;`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS available_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS lock_token VARCHAR(64);`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);
  await pool.query(`ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);
  await pool.query(`
    DO $$
    DECLARE
      id_type text;
      has_legacy_uuid boolean;
    BEGIN
      SELECT data_type INTO id_type
      FROM information_schema.columns
      WHERE table_name = 'transcription_jobs'
        AND column_name = 'id';

      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transcription_jobs'
          AND column_name = 'legacy_uuid'
      ) INTO has_legacy_uuid;

      IF id_type = 'uuid' THEN
        ALTER TABLE transcription_jobs DROP CONSTRAINT IF EXISTS transcription_jobs_pkey;
        IF NOT has_legacy_uuid THEN
          ALTER TABLE transcription_jobs RENAME COLUMN id TO legacy_uuid;
        ELSE
          ALTER TABLE transcription_jobs DROP COLUMN id;
        END IF;
        ALTER TABLE transcription_jobs ADD COLUMN id BIGSERIAL PRIMARY KEY;
      END IF;
    END
    $$;
  `);
  await pool.query(`
    DO $$
    DECLARE
      legacy_column text;
    BEGIN
      FOREACH legacy_column IN ARRAY ARRAY[
        'assemblyai_id',
        'filename',
        'file_size',
        'audio_filename',
        'legacy_uuid'
      ]
      LOOP
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'transcription_jobs'
            AND column_name = legacy_column
        ) THEN
          EXECUTE format(
            'ALTER TABLE transcription_jobs ALTER COLUMN %I DROP NOT NULL',
            legacy_column
          );
        END IF;
      END LOOP;
    END
    $$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transcription_jobs_ready ON transcription_jobs(status, available_at, created_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transcription_jobs_user_status ON transcription_jobs(user_id, status);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transcription_provider_circuits (
      provider VARCHAR(40) PRIMARY KEY,
      state VARCHAR(20) NOT NULL DEFAULT 'closed'
        CHECK (state IN ('closed', 'open', 'half_open')),
      consecutive_failures INTEGER NOT NULL DEFAULT 0
        CHECK (consecutive_failures >= 0),
      opened_count INTEGER NOT NULL DEFAULT 0 CHECK (opened_count >= 0),
      open_until TIMESTAMP WITH TIME ZONE,
      probe_locked_until TIMESTAMP WITH TIME ZONE,
      last_error_code VARCHAR(80),
      last_error_message VARCHAR(500),
      last_failure_at TIMESTAMP WITH TIME ZONE,
      last_success_at TIMESTAMP WITH TIME ZONE,
      total_failures BIGINT NOT NULL DEFAULT 0 CHECK (total_failures >= 0),
      total_successes BIGINT NOT NULL DEFAULT 0 CHECK (total_successes >= 0),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_provider_circuits_state ON transcription_provider_circuits(state, open_until);`);
  await pool.query(`
    UPDATE transcriptions transcript
    SET translation_target_language = COALESCE(
          transcript.translation_target_language,
          NULLIF(job.translate_to, 'none')
        ),
        translation_error = COALESCE(
          transcript.translation_error,
          'Bản dịch không được lưu trong lần xử lý trước. Vui lòng chạy chuyển đổi lại.'
        )
    FROM transcription_jobs job
    WHERE job.transcription_id = transcript.id
      AND job.status = 'completed'
      AND job.translate_to IS NOT NULL
      AND job.translate_to NOT IN ('', 'none')
      AND COALESCE(transcript.translated_text, '') = '';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS realtime_sessions (
      id UUID PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      max_seconds INTEGER NOT NULL CHECK (max_seconds > 0),
      transcription_id INTEGER REFERENCES transcriptions(id) ON DELETE SET NULL,
      started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      ended_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_realtime_one_active_user ON realtime_sessions(user_id) WHERE status = 'active';`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_realtime_expiry ON realtime_sessions(status, expires_at);`);
  await pool.query(`UPDATE realtime_sessions SET status = 'expired', ended_at = COALESCE(ended_at, expires_at) WHERE status = 'active' AND expires_at <= NOW();`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quota_usage_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      transcription_id INTEGER UNIQUE REFERENCES transcriptions(id) ON DELETE SET NULL,
      seconds INTEGER NOT NULL CHECK (seconds > 0),
      period_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
      period_ends_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE quota_usage_ledger ALTER COLUMN transcription_id DROP NOT NULL;`);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'quota_usage_ledger_transcription_id_fkey'
          AND confdeltype <> 'n'
      ) THEN
        ALTER TABLE quota_usage_ledger
          DROP CONSTRAINT quota_usage_ledger_transcription_id_fkey;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'quota_usage_ledger_transcription_id_fkey'
      ) THEN
        ALTER TABLE quota_usage_ledger
          ADD CONSTRAINT quota_usage_ledger_transcription_id_fkey
          FOREIGN KEY (transcription_id) REFERENCES transcriptions(id) ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_quota_usage_user_period ON quota_usage_ledger(user_id, period_started_at);`);
  await pool.query(`
    INSERT INTO quota_usage_ledger (
      user_id, transcription_id, seconds, period_started_at, period_ends_at, created_at
    )
    SELECT transcript.user_id, transcript.id, CEIL(transcript.duration)::integer,
           account.plan_started_at, account.plan_expires_at, transcript.created_at
    FROM transcriptions transcript
    JOIN users account ON account.id = transcript.user_id
    WHERE transcript.status = 'completed'
      AND transcript.duration > 0
      AND (
        transcript.created_at >= account.plan_started_at
        OR (
          account.plan_started_at <= account.created_at + INTERVAL '1 second'
          AND transcript.created_at >= account.created_at
        )
      )
      AND (account.plan_expires_at IS NULL OR transcript.created_at < account.plan_expires_at)
    ON CONFLICT (transcription_id) DO NOTHING;
  `);

  await pool.query(`
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
  `);
  await pool.query(`ALTER TABLE quota_admin_alerts ADD COLUMN IF NOT EXISTS state_cleared_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_quota_alerts_one_active_level
    ON quota_admin_alerts(user_id, period_started_at, level)
    WHERE status IN ('open', 'acknowledged');
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_quota_alerts_admin_inbox
    ON quota_admin_alerts(status, level, created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_quota_alerts_email_dispatch
    ON quota_admin_alerts(email_status, next_email_attempt_at)
    WHERE status IN ('open', 'acknowledged');
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      custom_dictionary TEXT NOT NULL DEFAULT '',
      transcription_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(
    `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS custom_dictionary TEXT NOT NULL DEFAULT '';`,
  );
  await pool.query(
    `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS transcription_settings JSONB NOT NULL DEFAULT '{}'::jsonb;`,
  );
  await pool.query(
    `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );
  await pool.query(
    `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL DEFAULT 'Default API key',
      key_prefix VARCHAR(40) NOT NULL,
      key_hash VARCHAR(64) UNIQUE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      last_used_at TIMESTAMP WITH TIME ZONE,
      revoked_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_api_keys_user_created ON api_keys(user_id, created_at DESC);`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_orders (
      id VARCHAR(36) PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan VARCHAR(20) NOT NULL,
      product_type VARCHAR(20) NOT NULL DEFAULT 'subscription',
      product_code VARCHAR(40),
      billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
      amount INTEGER NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'VND',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      provider VARCHAR(40) NOT NULL DEFAULT 'demo',
      provider_order_id VARCHAR(120),
      payment_url TEXT,
      payment_code VARCHAR(50),
      payment_qr_code TEXT,
      payment_link_id VARCHAR(120),
      payment_checked_at TIMESTAMP WITH TIME ZONE,
      raw_request JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      paid_at TIMESTAMP WITH TIME ZONE,
      expires_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'standard';`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly';`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS amount INTEGER NOT NULL DEFAULT 0;`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'VND';`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS provider VARCHAR(40) NOT NULL DEFAULT 'demo';`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(120);`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS payment_url TEXT;`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS raw_request JSONB NOT NULL DEFAULT '{}'::jsonb;`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;`,
  );
  await pool.query(
    `ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_billing_orders_user_created ON billing_orders(user_id, created_at DESC);`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_billing_orders_status ON billing_orders(status);`,
  );
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'standard';`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) NOT NULL DEFAULT 'subscription';`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS product_code VARCHAR(40);`);
  await pool.query(`UPDATE billing_orders SET product_code = plan WHERE product_code IS NULL AND product_type = 'subscription';`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly';`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS amount INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'VND';`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS provider VARCHAR(40) NOT NULL DEFAULT 'demo';`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(120);`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS payment_url TEXT;`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS payment_code VARCHAR(50);`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS payment_qr_code TEXT;`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS payment_link_id VARCHAR(120);`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS payment_checked_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS raw_request JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_billing_orders_user_created ON billing_orders(user_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_billing_orders_status ON billing_orders(status);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_orders_provider_order_id ON billing_orders(provider, provider_order_id) WHERE provider_order_id IS NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      id BIGSERIAL PRIMARY KEY,
      referrer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      referral_code VARCHAR(32) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'rewarded', 'cancelled')),
      reward_seconds INTEGER NOT NULL CHECK (reward_seconds > 0),
      rewarded_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      CHECK (referrer_id <> referred_user_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_referrals_referrer_created ON referrals(referrer_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS top_up_credits (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      billing_order_id VARCHAR(36) UNIQUE REFERENCES billing_orders(id) ON DELETE RESTRICT,
      referral_id BIGINT UNIQUE REFERENCES referrals(id) ON DELETE SET NULL,
      product_code VARCHAR(40) NOT NULL,
      seconds_granted INTEGER NOT NULL CHECK (seconds_granted > 0),
      remaining_seconds INTEGER NOT NULL CHECK (remaining_seconds >= 0),
      starts_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE top_up_credits ALTER COLUMN billing_order_id DROP NOT NULL;`);
  await pool.query(`ALTER TABLE top_up_credits ALTER COLUMN expires_at DROP NOT NULL;`);
  await pool.query(`ALTER TABLE top_up_credits ADD COLUMN IF NOT EXISTS referral_id BIGINT;`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'top_up_credits_referral_id_fkey'
      ) THEN
        ALTER TABLE top_up_credits
          ADD CONSTRAINT top_up_credits_referral_id_fkey
          FOREIGN KEY (referral_id) REFERENCES referrals(id) ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_top_up_credits_referral_id_unique ON top_up_credits(referral_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_top_up_credits_user_expiry ON top_up_credits(user_id, expires_at) WHERE remaining_seconds > 0;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      order_id VARCHAR(36) NOT NULL REFERENCES billing_orders(id) ON DELETE CASCADE,
      provider VARCHAR(40) NOT NULL,
      provider_transaction_id VARCHAR(120),
      amount INTEGER NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'VND',
      status VARCHAR(20) NOT NULL,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      paid_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider VARCHAR(40) NOT NULL DEFAULT 'demo';`,
  );
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_transaction_id VARCHAR(120);`,
  );
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount INTEGER NOT NULL DEFAULT 0;`,
  );
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'VND';`,
  );
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'paid';`,
  );
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb;`,
  );
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      email VARCHAR(255),
      name VARCHAR(255),
      subject VARCHAR(200) NOT NULL,
      category VARCHAR(60) NOT NULL DEFAULT 'general',
      priority VARCHAR(20) NOT NULL DEFAULT 'normal',
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      page_url TEXT,
      user_plan VARCHAR(20),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      resolved_at TIMESTAMP WITH TIME ZONE
    );
  `);

  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS email VARCHAR(255);`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS name VARCHAR(255);`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS subject VARCHAR(200) NOT NULL DEFAULT 'Yêu cầu hỗ trợ Vbee';`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS category VARCHAR(60) NOT NULL DEFAULT 'general';`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal';`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open';`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS page_url TEXT;`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS user_plan VARCHAR(20);`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );
  await pool.query(
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_support_tickets_user_updated ON support_tickets(user_id, updated_at DESC);`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender VARCHAR(20) NOT NULL DEFAULT 'user',
      message TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await pool.query(
    `ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sender VARCHAR(20) NOT NULL DEFAULT 'user';`,
  );
  await pool.query(
    `ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';`,
  );
  await pool.query(
    `ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created ON support_messages(ticket_id, created_at DESC);`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor VARCHAR(255) NOT NULL,
      action VARCHAR(80) NOT NULL,
      target_type VARCHAR(40) NOT NULL,
      target_id VARCHAR(120) NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key VARCHAR(80) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  await pool.query(
    `INSERT INTO admin_settings (key, value)
     VALUES ('global', $1::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [
      JSON.stringify({
        max_file_size_mb: Number.parseInt(
          process.env.MAX_UPLOAD_MB || "102400",
          10,
        ),
        max_file_duration_minutes: 44640,
        supported_formats: ["mp3", "wav", "m4a", "mp4", "mov"],
        supported_languages: ["vi", "en", "ja", "ko", "zh"],
        max_retry_attempts: 3,
        default_quota_minutes: Math.ceil(FREE_PLAN_SECONDS / 60),
        storage_policy: "keep_transcripts_and_media",
        data_retention_days: 365,
        system_parameters: {
          queue_concurrency: Number.parseInt(
            process.env.TRANSCRIPTION_QUEUE_CONCURRENCY || "1",
            10,
          ),
          queue_retention_ms: Number.parseInt(
            process.env.TRANSCRIPTION_QUEUE_RETENTION_MS || "3600000",
            10,
          ),
        },
        notification_config: {
          usage_alert_email: true,
          failure_alert_email: false,
        },
      }),
    ],
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_plans (
      id SERIAL PRIMARY KEY,
      code VARCHAR(40) UNIQUE NOT NULL,
      name VARCHAR(120) NOT NULL,
      quota_minutes INTEGER NOT NULL DEFAULT 0,
      price_vnd INTEGER NOT NULL DEFAULT 0,
      billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
      max_upload_mb INTEGER NOT NULL DEFAULT 200,
      max_file_duration_minutes INTEGER NOT NULL DEFAULT 120,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  await pool.query(
    `INSERT INTO service_plans (code, name, quota_minutes, price_vnd, billing_cycle, max_upload_mb, max_file_duration_minutes)
     VALUES
       ('free', 'Theo lượt', $1, 0, 'monthly', $2, $3),
       ('standard', 'Tiêu chuẩn', CEIL($4::numeric / 60), $5, 'monthly', $6, CEIL($7::numeric / 60)),
       ('special', 'Đặc biệt', CEIL($8::numeric / 60), $9, 'monthly', $10, CEIL($11::numeric / 60)),
       ('business', 'Chuyên nghiệp', CEIL($12::numeric / 60), $13, 'monthly', $14, CEIL($15::numeric / 60))
     ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           quota_minutes = EXCLUDED.quota_minutes,
           price_vnd = EXCLUDED.price_vnd,
           billing_cycle = EXCLUDED.billing_cycle,
           max_upload_mb = EXCLUDED.max_upload_mb,
           max_file_duration_minutes = EXCLUDED.max_file_duration_minutes,
           updated_at = NOW()`,
    [
      Math.ceil(FREE_PLAN_SECONDS / 60),
      Number.parseInt(process.env.FREE_MAX_UPLOAD_MB || "100", 10),
      Math.ceil(
        Number.parseInt(process.env.FREE_MAX_FILE_SECONDS || "1800", 10) / 60,
      ),
      Number.parseInt(process.env.STANDARD_MONTHLY_SECONDS || "18000", 10),
      Number.parseInt(process.env.STANDARD_MONTHLY_PRICE_VND || "149000", 10),
      Number.parseInt(process.env.STANDARD_MAX_UPLOAD_MB || "300", 10),
      Number.parseInt(process.env.STANDARD_MAX_FILE_SECONDS || "10800", 10),
      Number.parseInt(process.env.SPECIAL_MONTHLY_SECONDS || "72000", 10),
      Number.parseInt(process.env.SPECIAL_MONTHLY_PRICE_VND || "499000", 10),
      Number.parseInt(process.env.SPECIAL_MAX_UPLOAD_MB || "1024", 10),
      Number.parseInt(process.env.SPECIAL_MAX_FILE_SECONDS || "14400", 10),
      Number.parseInt(process.env.BUSINESS_MONTHLY_SECONDS || "144000", 10),
      Number.parseInt(process.env.BUSINESS_MONTHLY_PRICE_VND || "799000", 10),
      Number.parseInt(process.env.BUSINESS_MAX_UPLOAD_MB || "2048", 10),
      Number.parseInt(process.env.BUSINESS_MAX_FILE_SECONDS || "36000", 10),
    ],
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stt_providers (
      id SERIAL PRIMARY KEY,
      code VARCHAR(40) UNIQUE NOT NULL,
      name VARCHAR(120) NOT NULL,
      api_key_encrypted TEXT,
      endpoint TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      routing_mode VARCHAR(20) NOT NULL DEFAULT 'auto',
      routing_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
      failover_provider_id INTEGER REFERENCES stt_providers(id) ON DELETE SET NULL,
      health_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
      success_rate NUMERIC NOT NULL DEFAULT 0,
      avg_latency_ms INTEGER NOT NULL DEFAULT 0,
      cost_per_minute_usd NUMERIC NOT NULL DEFAULT 0,
      monthly_cost_usd NUMERIC NOT NULL DEFAULT 0,
      last_checked_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  await pool.query(
    `INSERT INTO stt_providers (code, name, api_key_encrypted, endpoint, enabled, is_default, routing_mode, health_status, cost_per_minute_usd)
     VALUES
       ('deepgram', 'Deepgram', NULLIF($1, ''), $2, TRUE, $3, 'auto', 'unknown', 0.0043),
       ('sonix', 'Sonix.ai', NULLIF($4, ''), $5, TRUE, $6, 'manual', 'unknown', 0.0167),
       ('assemblyai', 'AssemblyAI', NULLIF($7, ''), $8, TRUE, $9, 'rule_based', 'unknown', 0.0060),
       ('vbee', 'Vbee STT', NULLIF($10, ''), $11, TRUE, $12, 'manual', 'unknown', 0)
     ON CONFLICT (code) DO UPDATE
       SET api_key_encrypted = COALESCE(stt_providers.api_key_encrypted, EXCLUDED.api_key_encrypted),
           endpoint = COALESCE(NULLIF(stt_providers.endpoint, ''), EXCLUDED.endpoint),
           updated_at = NOW()`,
    [
      encryptProviderSecret(process.env.DEEPGRAM_API_KEY),
      process.env.DEEPGRAM_API_BASE_URL || "https://api.deepgram.com/v1",
      process.env.TRANSCRIPTION_PROVIDER === "deepgram",
      encryptProviderSecret(process.env.SONIX_API_KEY),
      process.env.SONIX_API_BASE_URL || "https://api.sonix.ai/v1",
      process.env.TRANSCRIPTION_PROVIDER === "sonix",
      encryptProviderSecret(process.env.ASSEMBLYAI_API_KEY),
      "https://api.assemblyai.com/v2",
      process.env.TRANSCRIPTION_PROVIDER === "assemblyai",
      encryptProviderSecret(process.env.VBEE_API_KEY || process.env.AIMP_API_KEY),
      process.env.VBEE_API_BASE_URL || "https://api-voice-uat.vbeelabs.ai",
      process.env.TRANSCRIPTION_PROVIDER === "vbee",
    ],
  );

  const adminSeedEmail = String(process.env.ADMIN_SEED_EMAIL || "")
    .trim()
    .toLowerCase();
  const adminSeedPassword = String(process.env.ADMIN_SEED_PASSWORD || "");
  if (Boolean(adminSeedEmail) !== Boolean(adminSeedPassword)) {
    throw new Error(
      "ADMIN_SEED_EMAIL và ADMIN_SEED_PASSWORD phải được cấu hình cùng nhau.",
    );
  }
  if (adminSeedEmail && adminSeedPassword) {
    if (adminSeedPassword.length < 12) {
      throw new Error("ADMIN_SEED_PASSWORD phải có ít nhất 12 ký tự.");
    }
    const adminPassword = await bcrypt.hash(adminSeedPassword, 12);
    const shouldSyncAdminPassword =
      process.env.ADMIN_SEED_SYNC_PASSWORD === "true";
    await pool.query(
      `INSERT INTO users (
         first_name, last_name, email, password, admin_role, status, role, account_status
       )
       VALUES ($1, $2, $3, $4, 'admin', 'active', 'admin', 'active')
       ON CONFLICT (email) DO UPDATE
         SET password = CASE
           WHEN $5::boolean OR users.password IS NULL THEN EXCLUDED.password
           ELSE users.password
         END,
         admin_role = 'admin',
         status = 'active',
         role = 'admin',
         account_status = 'active'`,
      [
        process.env.ADMIN_SEED_FIRST_NAME || "Vbee",
        process.env.ADMIN_SEED_LAST_NAME || "Admin",
        adminSeedEmail,
        adminPassword,
        shouldSyncAdminPassword,
      ],
    );
  }

  console.log("Đã kiểm tra/tạo bảng PostgreSQL thành công");
  if (process.env.CREATE_DEMO_USER === 'true' && !IS_PRODUCTION) {
    const demoPassword = await bcrypt.hash('123456', 12);
    await pool.query(
      `INSERT INTO users (first_name, last_name, email, password)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      ['Demo', 'User', 'demo@vbee.local', demoPassword]
    );
  }
  if (IS_PRODUCTION) {
    await pool.query("DELETE FROM users WHERE email = 'demo@vbee.local'");
  }

  const adminEmails = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const superAdminEmails = String(process.env.SUPER_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length > 0) {
    await pool.query(
      `UPDATE users SET role = 'admin', admin_role = 'admin'
       WHERE LOWER(email) = ANY($1::text[])`,
      [adminEmails],
    );
  }
  if (superAdminEmails.length > 0) {
    await pool.query(
      `UPDATE users SET role = 'admin', admin_role = 'admin'
       WHERE LOWER(email) = ANY($1::text[])`,
      [superAdminEmails],
    );
  }

  await pool.query(`DELETE FROM auth_refresh_tokens WHERE expires_at < NOW() - INTERVAL '7 days';`);
  await pool.query(`DELETE FROM oauth_login_states WHERE expires_at < NOW() - INTERVAL '1 day' OR consumed_at < NOW() - INTERVAL '1 day';`);
  await pool.query(`DELETE FROM rate_limit_counters WHERE reset_at < NOW() - INTERVAL '1 day';`);
  await pool.query(`DELETE FROM password_reset_tokens WHERE expires_at < NOW() - INTERVAL '7 days' OR used_at < NOW() - INTERVAL '30 days';`);
  await pool.query(`DELETE FROM realtime_sessions WHERE status <> 'active' AND ended_at < NOW() - INTERVAL '30 days';`);
  await pool.query(
    `DELETE FROM security_audit_events
     WHERE created_at < NOW() - ($1::text || ' days')::interval`,
    [String(SECURITY_AUDIT_RETENTION_DAYS)],
  );
  await pool.query(
    `DELETE FROM admin_audit_logs
     WHERE created_at < NOW() - ($1::text || ' days')::interval`,
    [String(ADMIN_AUDIT_RETENTION_DAYS)],
  );

  const { rows: storedFilenames } = await pool.query(
    'SELECT id, filename FROM transcriptions WHERE filename IS NOT NULL',
  );
  for (const item of storedFilenames) {
    const normalizedFilename = normalizeFilename(item.filename);
    if (normalizedFilename !== item.filename) {
      await pool.query('UPDATE transcriptions SET filename = $1 WHERE id = $2', [
        normalizedFilename,
        item.id,
      ]);
    }
  }

  console.log('Đã kiểm tra/tạo bảng PostgreSQL thành công');
}

module.exports = initDatabase;
