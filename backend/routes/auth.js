require("../config/env");
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const passport = require('passport');
const passportConfig = require('../config/passport');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  loginLimiter,
  oauthLimiter,
  passwordLimiter,
  refreshLimiter,
  registrationLimiter,
} = require('../middleware/security');
const {
  FRONTEND_URL,
  IS_PRODUCTION,
  isTrustedOrigin,
} = require('../config/security');
const {
  clearRefreshCookie,
  issueSession,
  readCookie,
  revokeAllSessions,
  revokeRefreshToken,
  rotateSession,
} = require('../services/sessionService');
const { writeSecurityAudit } = require('../services/securityAuditService');
const {
  hasSmtpConfig,
  sendPasswordResetEmail,
} = require('../services/emailService');
const {
  normalizeReferralCode,
  registerReferralForNewUser,
} = require('../services/referralService');
const { getAdminSettings } = require('../services/adminSettingsService');
const {
  consumeOAuthState,
  createOAuthState,
  hashOAuthValue,
} = require('../services/oauthStateService');
const {
  findOrCreateSocialUser,
} = require('../services/socialIdentityService');
const {
  completeOnboarding,
} = require('../services/onboardingService');
const {
  executeOAuthCallback,
} = require('../services/oauthCallbackService');
const {
  createFacebookAuthorizationUrl,
  exchangeFacebookCode,
  hasFacebookOAuth,
} = require('../services/facebookOAuthService');
const {
  assertAppleNonce,
  createAppleAuthorizationUrl,
  exchangeAppleCode,
  hasAppleOAuth,
} = require('../services/appleOAuthService');

const router = express.Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

const PASSWORD_RESET_TTL_MINUTES = Math.max(
  10,
  Math.min(120, Number.parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '30', 10))
);
const PASSWORD_RESET_MESSAGE =
  'Nếu email tồn tại trong hệ thống, Vbee đã gửi hướng dẫn đặt lại mật khẩu.';
const OAUTH_STATE_COOKIE = IS_PRODUCTION
  ? '__Host-vbee_oauth_state'
  : 'vbee_oauth_state';
const OAUTH_REFERRAL_COOKIE = IS_PRODUCTION
  ? '__Host-vbee_oauth_referral'
  : 'vbee_oauth_referral';
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'vbee-dummy-password-used-only-for-timing',
  12
);

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizePlan(plan) {
  const clean = String(plan || '').trim().toLowerCase();
  if (clean === 'premium' || clean === 'pro' || clean === 'special')
    return 'special';
  if (clean === 'basic' || clean === 'standard') return 'standard';
  if (clean === 'business' || clean === 'enterprise') return 'business';
  return 'free';
}

function normalizeUser(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    avatar: row.avatar ?? null,
    plan: normalizePlan(row.plan),
    role: row.role || 'user',
    accountStatus: row.account_status || 'active',
    organization: row.organization || '',
    jobRole: row.job_role || '',
    usagePurpose: row.usage_purpose || '',
    preferredLanguage: row.preferred_language || 'vi',
    onboardingCompleted: Boolean(row.onboarding_completed_at),
  };
}

function requireTrustedOrigin(req, res, next) {
  if (!isTrustedOrigin(req.get('origin'))) {
    return res.status(403).json({ error: 'Nguồn yêu cầu không được phép' });
  }
  return next();
}

function validatePassword(password) {
  if (password.length < 12) return 'Mật khẩu phải có ít nhất 12 ký tự';
  if (password.length > 128) return 'Mật khẩu không được vượt quá 128 ký tự';
  const normalized = password.toLowerCase().replace(/\s+/g, '');
  const blocked = new Set([
    '123456789012',
    'password1234',
    'qwerty123456',
    'vbee12345678',
  ]);
  if (blocked.has(normalized)) return 'Mật khẩu này quá phổ biến';
  return '';
}

async function completeOAuthLogin({
  provider,
  profile,
  referralCode,
  req,
  res,
}) {
  const { user, createdNewUser } = await findOrCreateSocialUser({
    provider,
    ...profile,
  });
  if (user.account_status !== 'active') {
    const error = new Error('Tài khoản đã bị khóa.');
    error.oauthCode = 'account_blocked';
    throw error;
  }

  let referralRegistration = null;
  if (createdNewUser && referralCode) {
    try {
      referralRegistration = await registerReferralForNewUser(
        user.id,
        referralCode,
      );
    } catch (referralError) {
      console.error(
        `${provider} referral registration error:`,
        referralError.message,
      );
    }
  }

  const session = await issueSession(user, req, res);
  await writeSecurityAudit({
    event: `auth.${provider}_login`,
    outcome: 'success',
    req,
    userId: user.id,
    sessionId: session.sessionId,
    metadata: {
      newUser: createdNewUser,
      referralRegistered: Boolean(referralRegistration?.registered),
    },
  });
  return res.redirect(`${FRONTEND_URL}/dashboard`);
}

async function handleOAuthFailure({ provider, error, req, res }) {
  console.error(`${provider} callback error:`, error.message);
  await writeSecurityAudit({
    event: `auth.${provider}_login`,
    outcome: 'failure',
    req,
    metadata: { reason: error.oauthCode || error.message },
  }).catch(() => {});
  const code =
    String(error.oauthCode || '').startsWith(`${provider}_`) ||
    error.oauthCode === 'account_blocked'
      ? error.oauthCode
      : `${provider}_failed`;
  return res.redirect(
    `${FRONTEND_URL}/login?error=${encodeURIComponent(code)}`,
  );
}

function executeProviderCallback({ provider, req, res, next, action }) {
  return executeOAuthCallback(action, (error) =>
    handleOAuthFailure({
      provider,
      error,
      req,
      res,
    })
  ).catch(next);
}

// Let the frontend hide OAuth options that cannot work on this deployment.
router.get('/providers', (_req, res) => {
  res.json({
    google: Boolean(passportConfig.hasGoogleOAuth),
    facebook: hasFacebookOAuth(),
    apple: hasAppleOAuth(),
  });
});

// GET /api/auth/google — khởi tạo OAuth với Google
router.get('/google', oauthLimiter, (req, res, next) => {
  if (!passportConfig.hasGoogleOAuth) {
    return res.redirect(`${FRONTEND_URL}/login?error=google_not_configured`);
  }

  const state = crypto.randomBytes(32).toString('base64url');
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60 * 1000,
  });
  const referralCode = normalizeReferralCode(req.query.ref);
  if (referralCode) {
    res.cookie(OAUTH_REFERRAL_COOKIE, referralCode, {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
  } else {
    res.clearCookie(OAUTH_REFERRAL_COOKIE, {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'lax',
      path: '/',
    });
  }
  return passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    state,
    prompt: 'select_account',
  })(req, res, next);
});

// GET /api/auth/google/callback — Google gọi về sau khi user đăng nhập
router.get(
  '/google/callback',
  (req, res, next) => {
    const expectedState = readCookie(req, OAUTH_STATE_COOKIE);
    const providedState = String(req.query.state || '');
    res.clearCookie(OAUTH_STATE_COOKIE, {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'lax',
      path: '/',
    });
    const expected = Buffer.from(expectedState);
    const provided = Buffer.from(providedState);
    if (
      expected.length < 32 ||
      expected.length !== provided.length ||
      !crypto.timingSafeEqual(expected, provided)
    ) {
      res.clearCookie(OAUTH_REFERRAL_COOKIE, {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: 'lax',
        path: '/',
      });
      return res.redirect(`${FRONTEND_URL}/login?error=google_failed`);
    }
    return next();
  },
  (req, res, next) => {
    if (!passportConfig.hasGoogleOAuth) {
      return res.redirect(`${FRONTEND_URL}/login?error=google_not_configured`);
    }

    return passport.authenticate('google', {
      session: false,
      failureRedirect: `${FRONTEND_URL}/login?error=google_failed`,
    })(req, res, next);
  },
  async (req, res, next) => {
    return executeProviderCallback({
      provider: 'google',
      req,
      res,
      next,
      action: async () => {
        const referralCode = readCookie(req, OAUTH_REFERRAL_COOKIE);
        res.clearCookie(OAUTH_REFERRAL_COOKIE, {
          httpOnly: true,
          secure: IS_PRODUCTION,
          sameSite: 'lax',
          path: '/',
        });
        const {
          googleId,
          email,
          emailVerified,
          firstName,
          lastName,
          photo,
        } = req.user;
        return completeOAuthLogin({
          provider: 'google',
          profile: {
            providerUserId: googleId,
            email,
            emailVerified,
            firstName,
            lastName,
            avatar: photo,
          },
          referralCode,
          req,
          res,
        });
      },
    });
  }
);

// GET /api/auth/facebook — bắt đầu Facebook Login.
router.get('/facebook', oauthLimiter, async (req, res) => {
  try {
    if (!hasFacebookOAuth()) {
      return res.redirect(
        `${FRONTEND_URL}/login?error=facebook_not_configured`,
      );
    }
    const state = await createOAuthState({
      provider: 'facebook',
      referralCode: normalizeReferralCode(req.query.ref),
    });
    return res.redirect(createFacebookAuthorizationUrl(state));
  } catch (error) {
    return handleOAuthFailure({
      provider: 'facebook',
      error,
      req,
      res,
    });
  }
});

// GET /api/auth/facebook/callback — Facebook trả authorization code.
router.get('/facebook/callback', oauthLimiter, async (req, res, next) => {
  return executeProviderCallback({
    provider: 'facebook',
    req,
    res,
    next,
    action: async () => {
      if (!hasFacebookOAuth()) {
        const error = new Error('Facebook OAuth chưa được cấu hình.');
        error.oauthCode = 'facebook_not_configured';
        throw error;
      }
      if (req.query.error || !req.query.code) {
        const error = new Error('Người dùng hủy hoặc Facebook từ chối đăng nhập.');
        error.oauthCode = 'facebook_failed';
        throw error;
      }
      const state = await consumeOAuthState({
        provider: 'facebook',
        state: String(req.query.state || ''),
      });
      if (!state) {
        const error = new Error('Facebook OAuth state không hợp lệ.');
        error.oauthCode = 'facebook_failed';
        throw error;
      }
      const profile = await exchangeFacebookCode(req.query.code);
      return completeOAuthLogin({
        provider: 'facebook',
        profile,
        referralCode: state.referral_code,
        req,
        res,
      });
    },
  });
});

// GET /api/auth/apple — bắt đầu Sign in with Apple.
router.get('/apple', oauthLimiter, async (req, res) => {
  try {
    if (!hasAppleOAuth()) {
      return res.redirect(`${FRONTEND_URL}/login?error=apple_not_configured`);
    }
    const nonce = crypto.randomBytes(32).toString('base64url');
    const state = await createOAuthState({
      provider: 'apple',
      referralCode: normalizeReferralCode(req.query.ref),
      nonce,
    });
    return res.redirect(createAppleAuthorizationUrl({ state, nonce }));
  } catch (error) {
    return handleOAuthFailure({
      provider: 'apple',
      error,
      req,
      res,
    });
  }
});

// POST /api/auth/apple/callback — Apple dùng response_mode=form_post.
router.post('/apple/callback', oauthLimiter, async (req, res, next) => {
  return executeProviderCallback({
    provider: 'apple',
    req,
    res,
    next,
    action: async () => {
      if (!hasAppleOAuth()) {
        const error = new Error('Apple OAuth chưa được cấu hình.');
        error.oauthCode = 'apple_not_configured';
        throw error;
      }
      if (req.body.error || !req.body.code) {
        const error = new Error('Người dùng hủy hoặc Apple từ chối đăng nhập.');
        error.oauthCode = 'apple_failed';
        throw error;
      }
      const state = await consumeOAuthState({
        provider: 'apple',
        state: String(req.body.state || ''),
      });
      if (!state?.nonce_hash) {
        const error = new Error('Apple OAuth state không hợp lệ.');
        error.oauthCode = 'apple_failed';
        throw error;
      }

      const profile = await exchangeAppleCode(req.body.code);
      assertAppleNonce(profile.nonce, state.nonce_hash, hashOAuthValue);
      let firstName = '';
      let lastName = '';
      if (req.body.user) {
        try {
          const appleUser = JSON.parse(String(req.body.user));
          firstName = appleUser.name?.firstName || '';
          lastName = appleUser.name?.lastName || '';
          if (!profile.email) profile.email = appleUser.email || '';
        } catch {
          // Apple chỉ gửi user object ở lần cấp quyền đầu tiên.
        }
      }
      return completeOAuthLogin({
        provider: 'apple',
        profile: {
          ...profile,
          firstName,
          lastName,
        },
        referralCode: state.referral_code,
        req,
        res,
      });
    },
  });
});

// POST /api/auth/register — đăng ký tài khoản mới bằng email/password
router.post('/register', requireTrustedOrigin, registrationLimiter, async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    const referralCode = normalizeReferralCode(
      req.body.referralCode || req.body.ref,
    );
    const cleanFirstName = String(firstName || '').trim().slice(0, 100);
    const cleanLastName = String(lastName || '').trim().slice(0, 100);
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');

    if (!cleanFirstName || !cleanLastName || !cleanEmail || !cleanPassword) {
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin' });
    }
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Email không hợp lệ' });
    }
    const passwordError = validatePassword(cleanPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email này đã được đăng ký' });
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 12);
    const adminSettings = await getAdminSettings();
    const defaultQuotaSeconds = adminSettings.default_quota_minutes * 60;

    const { rows } = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password, quota_seconds)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, first_name, last_name, email, avatar, plan, auth_version,
                 role, account_status`,
      [
        cleanFirstName,
        cleanLastName,
        cleanEmail,
        hashedPassword,
        defaultQuotaSeconds,
      ]
    );

    const user = rows[0];
    let referralRegistration = null;
    if (referralCode) {
      try {
        referralRegistration = await registerReferralForNewUser(
          user.id,
          referralCode,
        );
      } catch (referralError) {
        console.error('Referral registration error:', referralError.message);
      }
    }
    const session = await issueSession(user, req, res);
    await writeSecurityAudit({
      event: 'auth.register',
      outcome: 'success',
      req,
      userId: user.id,
      sessionId: session.sessionId,
      metadata: {
        referralRegistered: Boolean(referralRegistration?.registered),
      },
    });

    return res.status(201).json({
      token: session.token,
      expiresIn: session.expiresIn,
      user: normalizeUser(user),
      referral: referralRegistration,
    });
  } catch (error) {
    console.error('Register error:', error);
    await writeSecurityAudit({
      event: 'auth.register',
      outcome: 'failure',
      req,
      metadata: { reason: error.code === '23505' ? 'duplicate' : error.message },
    });
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email này đã được đăng ký' });
    }
    return res.status(500).json({ error: 'Lỗi server, vui lòng thử lại' });
  }
});

// POST /api/auth/login — đăng nhập bằng email/password
router.post('/login', requireTrustedOrigin, loginLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password || email.length > 254 || password.length > 128) {
      return res.status(400).json({ error: 'Vui lòng nhập email và mật khẩu' });
    }

    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, password, avatar, plan,
              auth_version, role, account_status, organization, job_role,
              usage_purpose, preferred_language, onboarding_completed_at
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    const matched = await bcrypt.compare(
      password,
      rows[0]?.password || DUMMY_PASSWORD_HASH
    );
    if (rows.length === 0 || !rows[0].password || !matched) {
      await writeSecurityAudit({
        event: 'auth.login',
        outcome: 'failure',
        req,
        metadata: { reason: 'invalid_credentials' },
      });
      return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
    }

    const user = rows[0];
    if (user.account_status !== 'active') {
      await writeSecurityAudit({
        event: 'auth.login',
        outcome: 'failure',
        req,
        userId: user.id,
        metadata: { reason: 'account_blocked' },
      });
      return res.status(403).json({ error: 'Tài khoản đã bị khóa' });
    }
    const session = await issueSession(user, req, res);
    await writeSecurityAudit({
      event: 'auth.login',
      outcome: 'success',
      req,
      userId: user.id,
      sessionId: session.sessionId,
    });

    return res.json({
      token: session.token,
      expiresIn: session.expiresIn,
      user: normalizeUser(user),
    });
  } catch (error) {
    console.error('Login error:', error);
    await writeSecurityAudit({
      event: 'auth.login',
      outcome: 'failure',
      req,
      metadata: { reason: error.message },
    });
    return res.status(500).json({ error: 'Lỗi server, vui lòng thử lại' });
  }
});

// POST /api/auth/forgot-password — luôn dùng thông báo chung để tránh lộ email đã đăng ký.
router.post('/forgot-password', requireTrustedOrigin, passwordLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const isLocalRequest = ['localhost', '127.0.0.1', '::1'].includes(
      String(req.hostname || '').toLowerCase()
    );
    if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Email không hợp lệ' });
    }

    const { rows } = await pool.query(
      `SELECT id, first_name, email
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    const user = rows[0];
    if (!user) {
      await writeSecurityAudit({
        event: 'auth.password_reset_requested',
        outcome: 'accepted',
        req,
      });
      return res.json({ message: PASSWORD_RESET_MESSAGE });
    }

    if (hasSmtpConfig()) {
      const recent = await pool.query(
        `SELECT id FROM password_reset_tokens
         WHERE user_id = $1 AND used_at IS NULL
           AND created_at > NOW() - INTERVAL '60 seconds'
         LIMIT 1`,
        [user.id]
      );
      if (recent.rows[0]) {
        return res.json({ message: PASSWORD_RESET_MESSAGE });
      }
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000
    );

    await pool.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );
    const inserted = await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [user.id, tokenHash, expiresAt]
    );

    const resetUrl = `${FRONTEND_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(rawToken)}`;
    if (hasSmtpConfig()) {
      try {
        await sendPasswordResetEmail({
          to: user.email,
          firstName: user.first_name,
          resetUrl,
          expiresMinutes: PASSWORD_RESET_TTL_MINUTES,
        });
      } catch (error) {
        await pool.query(
          'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
          [inserted.rows[0].id]
        );
        console.error('Password reset email error:', error.message);
        return res.status(503).json({
          error: 'Chưa thể gửi email đặt lại mật khẩu. Vui lòng thử lại sau.',
        });
      }
    } else if (!isLocalRequest) {
      await pool.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
        [inserted.rows[0].id]
      );
      return res.status(503).json({
        error: 'Dịch vụ email đặt lại mật khẩu chưa được cấu hình.',
      });
    }

    await writeSecurityAudit({
      event: 'auth.password_reset_requested',
      outcome: 'accepted',
      req,
      userId: user.id,
    });
    return res.json({
      message: PASSWORD_RESET_MESSAGE,
      resetUrl: hasSmtpConfig() || !isLocalRequest ? undefined : resetUrl,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Không tạo được yêu cầu đặt lại mật khẩu' });
  }
});

// POST /api/auth/reset-password — token được băm, hết hạn và chỉ dùng một lần.
router.post('/reset-password', requireTrustedOrigin, passwordLimiter, async (req, res) => {
  const rawToken = String(req.body.token || '').trim();
  const password = String(req.body.password || '');
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
    return res.status(400).json({ error: 'Liên kết đặt lại mật khẩu không hợp lệ' });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, user_id
       FROM password_reset_tokens
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > NOW()
       FOR UPDATE`,
      [hashResetToken(rawToken)]
    );
    const resetToken = rows[0];
    if (!resetToken) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Liên kết đã hết hạn hoặc đã được sử dụng',
      });
    }

    await client.query('UPDATE users SET password = $1, auth_version = auth_version + 1 WHERE id = $2', [
      passwordHash,
      resetToken.user_id,
    ]);
    await revokeAllSessions(resetToken.user_id, client);
    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [resetToken.user_id]
    );
    await client.query('COMMIT');
    await writeSecurityAudit({
      event: 'auth.password_reset_completed',
      outcome: 'success',
      req,
      userId: resetToken.user_id,
    });
    return res.json({ message: 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Không đặt lại được mật khẩu' });
  } finally {
    client.release();
  }
});

// POST /api/auth/refresh — rotate the HttpOnly refresh cookie.
router.post('/refresh', requireTrustedOrigin, refreshLimiter, async (req, res) => {
  try {
    const session = await rotateSession(req, res);
    if (session?.retry) {
      return res.status(409).json({ retry: true });
    }
    if (!session) {
      return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
    }
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, avatar, plan, role, account_status,
              organization, job_role, usage_purpose, preferred_language,
              onboarding_completed_at
       FROM users WHERE id = $1`,
      [session.userId]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Không tìm thấy tài khoản' });
    if (rows[0].account_status !== 'active') {
      return res.status(403).json({ error: 'Tài khoản đã bị khóa' });
    }
    return res.json({
      token: session.token,
      expiresIn: session.expiresIn,
      user: normalizeUser(rows[0]),
    });
  } catch (error) {
    console.error('Refresh session error:', error.message);
    return res.status(401).json({ error: 'Không thể làm mới phiên đăng nhập' });
  }
});

// GET /api/auth/me — lấy thông tin user hiện tại qua JWT
router.get('/me', requireAuth, (req, res) => {
  return res.json(normalizeUser(req.user));
});

// PATCH /api/auth/onboarding - hoàn tất thiết lập đăng nhập lần đầu.
router.patch('/onboarding', requireAuth, async (req, res) => {
  try {
    const user = await completeOnboarding(pool, req.user.id, req.body || {});
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    }
    await writeSecurityAudit({
      event: 'auth.onboarding_completed',
      outcome: 'success',
      req,
      userId: req.user.id,
      sessionId: req.auth?.sid,
      metadata: {
        jobRole: user.job_role,
        usagePurpose: user.usage_purpose,
        preferredLanguage: user.preferred_language,
      },
    });
    return res.json(normalizeUser(user));
  } catch (error) {
    console.error('Complete onboarding error:', error);
    return res.status(error.statusCode || 500).json({
      error:
        error.statusCode === 400
          ? error.message
          : 'Không lưu được thông tin thiết lập',
    });
  }
});

// POST /api/auth/logout — revoke this server-side session immediately.
router.post('/logout', requireTrustedOrigin, async (req, res) => {
  const revoked = await revokeRefreshToken(req, res);
  await writeSecurityAudit({
    event: 'auth.logout',
    outcome: 'success',
    req,
    userId: revoked?.user_id,
    sessionId: revoked?.id,
  });
  return res.json({ success: true });
});

// POST /api/auth/change-password — xác minh mật khẩu cũ và thu hồi mọi phiên cũ.
router.post('/change-password', requireTrustedOrigin, passwordLimiter, requireAuth, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới' });
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    const { rows } = await pool.query(
      'SELECT password FROM users WHERE id = $1',
      [req.user.id]
    );
    const currentHash = rows[0]?.password;
    if (!currentHash) {
      await writeSecurityAudit({
        event: 'auth.password_change',
        outcome: 'failure',
        req,
        userId: req.user.id,
        sessionId: req.auth?.sid,
        metadata: { reason: 'no_local_password' },
      });
      return res.status(400).json({
        error: 'Tài khoản này đăng nhập bằng mạng xã hội. Hãy dùng Quên mật khẩu để tạo mật khẩu mới.',
      });
    }

    const currentMatches = await bcrypt.compare(currentPassword, currentHash);
    if (!currentMatches) {
      await writeSecurityAudit({
        event: 'auth.password_change',
        outcome: 'failure',
        req,
        userId: req.user.id,
        sessionId: req.auth?.sid,
        metadata: { reason: 'invalid_current_password' },
      });
      return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
    }

    if (await bcrypt.compare(newPassword, currentHash)) {
      return res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại' });
    }

    const nextHash = await bcrypt.hash(newPassword, 12);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE users
         SET password = $1, auth_version = auth_version + 1
         WHERE id = $2 AND password = $3
         RETURNING id`,
        [nextHash, req.user.id, currentHash]
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Mật khẩu vừa được thay đổi ở phiên khác. Vui lòng đăng nhập lại.',
        });
      }
      await revokeAllSessions(req.user.id, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    clearRefreshCookie(res);
    await writeSecurityAudit({
      event: 'auth.password_change',
      outcome: 'success',
      req,
      userId: req.user.id,
      sessionId: req.auth?.sid,
    });
    return res.json({
      message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.',
      requiresLogin: true,
    });
  } catch (error) {
    console.error('Change password error:', error);
    await writeSecurityAudit({
      event: 'auth.password_change',
      outcome: 'failure',
      req,
      userId: req.user.id,
      sessionId: req.auth?.sid,
      metadata: { reason: 'server_error' },
    });
    return res.status(500).json({ error: 'Không đổi được mật khẩu. Vui lòng thử lại.' });
  }
});

// PATCH /api/auth/profile — cập nhật họ tên
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { firstName, lastName } = req.body;
    const cleanFirstName = String(firstName || '').trim().slice(0, 100);
    const cleanLastName = String(lastName || '').trim().slice(0, 100);
    if (!cleanFirstName || !cleanLastName) {
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ họ và tên' });
    }

    const { rows } = await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2
       WHERE id = $3
       RETURNING id, first_name, last_name, email, avatar, plan, role,
         account_status, organization, job_role, usage_purpose,
         preferred_language, onboarding_completed_at`,
      [cleanFirstName, cleanLastName, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    }

    return res.json(normalizeUser(rows[0]));
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Không cập nhật được thông tin' });
  }
});

// POST /api/auth/avatar — cập nhật ảnh đại diện (base64 data URL)
router.post('/avatar', requireAuth, async (req, res) => {
  try {
    const avatar = String(req.body.avatar || '');
    const match = avatar.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Ảnh không hợp lệ' });
    }
    const image = Buffer.from(match[2], 'base64');
    if (image.length <= 0 || image.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Ảnh quá lớn (tối đa 2MB)' });
    }
    const isPng = match[1] === 'png' && image.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    const isJpeg = match[1] === 'jpeg' && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    const isWebp = match[1] === 'webp' &&
      image.subarray(0, 4).toString('ascii') === 'RIFF' &&
      image.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!isPng && !isJpeg && !isWebp) {
      return res.status(400).json({ error: 'Nội dung ảnh không đúng định dạng' });
    }

    const { rows } = await pool.query(
      `UPDATE users SET avatar = $1
       WHERE id = $2
       RETURNING id, first_name, last_name, email, avatar, plan, role,
         account_status, organization, job_role, usage_purpose,
         preferred_language, onboarding_completed_at`,
      [avatar, req.user.id]
    );

    return res.json(normalizeUser(rows[0]));
  } catch (error) {
    console.error('Update avatar error:', error);
    return res.status(500).json({ error: 'Không cập nhật được ảnh đại diện' });
  }
});

module.exports = router;
