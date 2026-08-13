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
  IS_PRODUCTION,
  getOAuthCallbackUrl,
  getRequestFrontendUrl,
  isTrustedOrigin,
} = require('../config/security');
const {
  clearRefreshCookie,
  hasSimilarRecentSession,
  issueSession,
  listUserSessions,
  readCookie,
  revokeAllSessions,
  revokeOtherSessions,
  revokeRefreshToken,
  revokeUserSession,
  rotateSession,
} = require('../services/sessionService');
const { writeSecurityAudit } = require('../services/securityAuditService');
const {
  hasSmtpConfig,
  sendLoginAlertEmail,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
} = require('../services/emailService');
const {
  isValidEmail,
  normalizeEmail,
  validatePassword,
  validateRegistrationSpamTrap,
} = require('../services/registrationValidation');
const {
  normalizeReferralCode,
  registerReferralForNewUser,
} = require('../services/referralService');
const {
  consumeOAuthState,
  createOAuthState,
  hashOAuthValue,
} = require('../services/oauthStateService');
const {
  createSocialRegistrationUrl,
  findOrCreateSocialUser,
  verifySocialRegistrationToken,
} = require('../services/socialIdentityService');
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
const { normalizeRole } = require("../services/adminAccess");
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

router.get('/providers', (_req, res) => {
  res.json({
    google: Boolean(passportConfig.hasGoogleOAuth),
    facebook: hasFacebookOAuth(),
    apple: hasAppleOAuth(),
  });
});

const PASSWORD_RESET_TTL_MINUTES = Math.max(
  10,
  Math.min(120, Number.parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '30', 10))
);
const PASSWORD_RESET_MESSAGE =
  'Nếu email tồn tại trong hệ thống, Vbee đã gửi hướng dẫn đặt lại mật khẩu.';
const EMAIL_VERIFICATION_TTL_HOURS = Math.max(
  1,
  Math.min(72, Number.parseInt(process.env.EMAIL_VERIFICATION_TTL_HOURS || '24', 10))
);
const EMAIL_VERIFICATION_REQUIRED =
  process.env.EMAIL_VERIFICATION_REQUIRED !== 'false' && hasSmtpConfig();
const LOGIN_ALERT_EMAIL_ENABLED =
  process.env.LOGIN_ALERT_EMAIL_ENABLED !== 'false' && hasSmtpConfig();
const OAUTH_STATE_COOKIE = IS_PRODUCTION
  ? '__Host-vbee_oauth_state'
  : 'vbee_oauth_state';
const OAUTH_REFERRAL_COOKIE = IS_PRODUCTION
  ? '__Host-vbee_oauth_referral'
  : 'vbee_oauth_referral';
const OAUTH_MODE_COOKIE = IS_PRODUCTION
  ? '__Host-vbee_oauth_mode'
  : 'vbee_oauth_mode';
const OAUTH_FROM_COOKIE = IS_PRODUCTION
  ? '__Host-vbee_oauth_from'
  : 'vbee_oauth_from';
const OAUTH_FRONTEND_COOKIE = IS_PRODUCTION
  ? '__Host-vbee_oauth_frontend'
  : 'vbee_oauth_frontend';
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'vbee-dummy-password-used-only-for-timing',
  12
);

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashEmailVerificationToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizePlan(plan) {
  const clean = String(plan || '').trim().toLowerCase();
  if (
    clean === 'premium' ||
    clean === 'pro' ||
    clean === 'special' ||
    clean === 'professional' ||
    clean === 'chuyen_nghiep'
  )
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
    role: normalizeRole(row.role),
    accountStatus: row.account_status || 'active',
    emailVerified: row.email_verified !== false,
  };
}

function requireTrustedOrigin(req, res, next) {
  if (!isTrustedOrigin(req.get('origin'))) {
    return res.status(403).json({ error: 'Nguồn yêu cầu không được phép' });
  }
  return next();
}

function cleanOAuthMode(value) {
  return String(value || '').trim() === 'register' ? 'register' : 'login';
}

async function createEmailVerificationToken(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashEmailVerificationToken(rawToken);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
  await pool.query(
    `UPDATE email_verification_tokens
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
  return rawToken;
}

async function sendLoginAlertIfUnusual({ user, req, session, wasKnownDevice }) {
  if (!LOGIN_ALERT_EMAIL_ENABLED || wasKnownDevice) return;
  try {
    await sendLoginAlertEmail({
      to: user.email,
      firstName: user.first_name,
      session: session.metadata || {},
      loginTime: new Date().toLocaleString('vi-VN'),
    });
  } catch (error) {
    console.error('Login alert email error:', error.message);
  }
  await writeSecurityAudit({
    event: 'auth.login_alert',
    outcome: 'sent',
    req,
    userId: user.id,
    sessionId: session.sessionId,
    metadata: {
      deviceName: session.metadata?.deviceName,
      browserName: session.metadata?.browserName,
      wasKnownDevice,
    },
  });
}

function cleanOAuthFrom(value) {
  const from = String(value || '').trim();
  if (!from.startsWith('/') || from.startsWith('//')) return '';
  return from.slice(0, 500);
}

function cookieOptions(maxAge = 10 * 60 * 1000) {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    ...(maxAge ? { maxAge } : {}),
  };
}

function setOAuthFrontendCookie(req, res) {
  const frontendUrl = getRequestFrontendUrl(req);
  res.cookie(OAUTH_FRONTEND_COOKIE, frontendUrl, cookieOptions());
  return frontendUrl;
}

function getOAuthFrontendUrl(req) {
  const frontendUrl = String(readCookie(req, OAUTH_FRONTEND_COOKIE) || '').trim();
  return isTrustedOrigin(frontendUrl) ? frontendUrl.replace(/\/$/, '') : getRequestFrontendUrl(req);
}

function clearOAuthFrontendCookie(res) {
  res.clearCookie(OAUTH_FRONTEND_COOKIE, cookieOptions(0));
}

async function completeOAuthLogin({
  provider,
  profile,
  referralCode,
  mode = 'register',
  from,
  req,
  res,
}) {
  const frontendUrl = getOAuthFrontendUrl(req);
  let result;
  try {
    result = await findOrCreateSocialUser({
      provider,
      ...profile,
      createIfMissing: !(provider === 'google' && mode === 'login'),
    });
  } catch (error) {
    if (
      provider === 'google' &&
      error.oauthCode === 'google_account_not_registered'
    ) {
      return res.redirect(
        createSocialRegistrationUrl(frontendUrl, {
          ...error.registrationProfile,
          from,
        }),
      );
    }
    throw error;
  }

  const { user, createdNewUser } = result;
  if (user.account_status !== 'active' || user.status !== 'active') {
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

  const wasKnownDevice = await hasSimilarRecentSession(user.id, req);
  const session = await issueSession(user, req, res);
  await sendLoginAlertIfUnusual({ user, req, session, wasKnownDevice });
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
  clearOAuthFrontendCookie(res);
  return res.redirect(`${frontendUrl}/dashboard`);
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
  const frontendUrl = getOAuthFrontendUrl(req);
  clearOAuthFrontendCookie(res);
  return res.redirect(
    `${frontendUrl}/login?error=${encodeURIComponent(code)}`,
  );
}

// GET /api/auth/google — khởi tạo OAuth với Google
router.get('/google', oauthLimiter, (req, res, next) => {
  const frontendUrl = setOAuthFrontendCookie(req, res);
  const callbackURL = getOAuthCallbackUrl(req, 'google');
  if (!passportConfig.hasGoogleOAuth) {
    return res.redirect(`${frontendUrl}/login?error=google_not_configured`);
  }

  const state = crypto.randomBytes(32).toString('base64url');
  res.cookie(OAUTH_STATE_COOKIE, state, cookieOptions());
  const referralCode = normalizeReferralCode(req.query.ref);
  const oauthMode = cleanOAuthMode(req.query.mode);
  const oauthFrom = cleanOAuthFrom(req.query.from);
  res.cookie(OAUTH_MODE_COOKIE, oauthMode, cookieOptions());
  if (oauthFrom) {
    res.cookie(OAUTH_FROM_COOKIE, oauthFrom, cookieOptions());
  } else {
    res.clearCookie(OAUTH_FROM_COOKIE, cookieOptions(0));
  }
  if (referralCode) {
    res.cookie(OAUTH_REFERRAL_COOKIE, referralCode, cookieOptions());
  } else {
    res.clearCookie(OAUTH_REFERRAL_COOKIE, cookieOptions(0));
  }
  return passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    state,
    prompt: 'select_account',
    callbackURL,
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
      res.clearCookie(OAUTH_MODE_COOKIE, {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: 'lax',
        path: '/',
      });
      res.clearCookie(OAUTH_FROM_COOKIE, {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: 'lax',
        path: '/',
      });
      return res.redirect(`${getOAuthFrontendUrl(req)}/login?error=google_failed`);
    }
    return next();
  },
  (req, res, next) => {
    if (!passportConfig.hasGoogleOAuth) {
      return res.redirect(`${getOAuthFrontendUrl(req)}/login?error=google_not_configured`);
    }

    return passport.authenticate('google', {
      session: false,
      failureRedirect: `${getOAuthFrontendUrl(req)}/login?error=google_failed`,
      callbackURL: getOAuthCallbackUrl(req, 'google'),
    })(req, res, next);
  },
  async (req, res) => {
    try {
      const referralCode = readCookie(req, OAUTH_REFERRAL_COOKIE);
      const mode = cleanOAuthMode(readCookie(req, OAUTH_MODE_COOKIE));
      const from = cleanOAuthFrom(readCookie(req, OAUTH_FROM_COOKIE));
      res.clearCookie(OAUTH_REFERRAL_COOKIE, {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: 'lax',
        path: '/',
      });
      res.clearCookie(OAUTH_MODE_COOKIE, {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: 'lax',
        path: '/',
      });
      res.clearCookie(OAUTH_FROM_COOKIE, {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: 'lax',
        path: '/',
      });
      const { googleId, email, emailVerified, firstName, lastName, photo } = req.user;
      return await completeOAuthLogin({
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
        mode,
        from,
        req,
        res,
      });
    } catch (error) {
      return handleOAuthFailure({
        provider: 'google',
        error,
        req,
        res,
      });
    }
  }
);

// GET /api/auth/facebook — bắt đầu Facebook Login.
router.get('/facebook', oauthLimiter, async (req, res) => {
  try {
    const frontendUrl = setOAuthFrontendCookie(req, res);
    if (!hasFacebookOAuth()) {
      return res.redirect(
        `${frontendUrl}/login?error=facebook_not_configured`,
      );
    }
    const state = await createOAuthState({
      provider: 'facebook',
      referralCode: normalizeReferralCode(req.query.ref),
    });
    return res.redirect(
      createFacebookAuthorizationUrl(state, getOAuthCallbackUrl(req, 'facebook')),
    );
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
router.get('/facebook/callback', oauthLimiter, async (req, res) => {
  try {
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
    const profile = await exchangeFacebookCode(
      req.query.code,
      getOAuthCallbackUrl(req, 'facebook'),
    );
    return await completeOAuthLogin({
      provider: 'facebook',
      profile,
      referralCode: state.referral_code,
      req,
      res,
    });
  } catch (error) {
    return handleOAuthFailure({
      provider: 'facebook',
      error,
      req,
      res,
    });
  }
});

// GET /api/auth/apple — bắt đầu Sign in with Apple.
router.get('/apple', oauthLimiter, async (req, res) => {
  try {
    const frontendUrl = setOAuthFrontendCookie(req, res);
    if (!hasAppleOAuth()) {
      return res.redirect(`${frontendUrl}/login?error=apple_not_configured`);
    }
    const nonce = crypto.randomBytes(32).toString('base64url');
    const state = await createOAuthState({
      provider: 'apple',
      referralCode: normalizeReferralCode(req.query.ref),
      nonce,
    });
    return res.redirect(
      createAppleAuthorizationUrl({
        state,
        nonce,
        callbackUrl: getOAuthCallbackUrl(req, 'apple'),
      }),
    );
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
router.post('/apple/callback', oauthLimiter, async (req, res) => {
  try {
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

    const profile = await exchangeAppleCode(
      req.body.code,
      getOAuthCallbackUrl(req, 'apple'),
    );
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
    return await completeOAuthLogin({
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
  } catch (error) {
    return handleOAuthFailure({
      provider: 'apple',
      error,
      req,
      res,
    });
  }
});

// POST /api/auth/register — đăng ký tài khoản mới bằng email/password
router.post('/register', requireTrustedOrigin, registrationLimiter, async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    const referralCode = normalizeReferralCode(
      req.body.referralCode || req.body.ref,
    );
    const oauthProfile = req.body.oauthToken
      ? verifySocialRegistrationToken(req.body.oauthToken)
      : null;
    if (req.body.oauthToken && !oauthProfile) {
      return res.status(400).json({
        error: 'Phiên đăng ký Google đã hết hạn. Vui lòng đăng nhập Google lại.',
      });
    }
    const cleanFirstName = String(firstName || '').trim().slice(0, 100);
    const cleanLastName = String(lastName || '').trim().slice(0, 100);
    const cleanEmail = normalizeEmail(email);
    const cleanPassword = String(password || '');

    if (!cleanFirstName || !cleanLastName || !cleanEmail || !cleanPassword) {
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin' });
    }
    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Email không hợp lệ' });
    }
    const spamError = validateRegistrationSpamTrap({
      website: req.body.website,
      registerStartedAt: req.body.registerStartedAt,
    });
    if (spamError) {
      await writeSecurityAudit({
        event: 'auth.register',
        outcome: 'failure',
        req,
        metadata: { reason: 'spam_trap' },
      });
      return res.status(400).json({ error: spamError });
    }
    if (oauthProfile && oauthProfile.email !== cleanEmail) {
      return res.status(400).json({
        error: 'Email đăng ký phải trùng với email Google đã xác minh.',
      });
    }
    const passwordError = validatePassword(cleanPassword, {
      email: cleanEmail,
      firstName: cleanFirstName,
      lastName: cleanLastName,
    });
    if (passwordError) return res.status(400).json({ error: passwordError });

    const existing = await pool.query(
      'SELECT id, first_name, email, email_verified FROM users WHERE LOWER(email) = LOWER($1)',
      [cleanEmail],
    );
    if (existing.rows.length > 0) {
      const existingUser = existing.rows[0];
      if (EMAIL_VERIFICATION_REQUIRED && existingUser.email_verified === false) {
        const recentToken = await pool.query(
          `SELECT id FROM email_verification_tokens
           WHERE user_id = $1
             AND used_at IS NULL
             AND created_at > NOW() - INTERVAL '60 seconds'
           LIMIT 1`,
          [existingUser.id],
        );
        if (!recentToken.rows[0]) {
          const verificationToken = await createEmailVerificationToken(existingUser.id);
          const verificationUrl = `${getRequestFrontendUrl(req).replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(verificationToken)}`;
          await sendEmailVerificationEmail({
            to: existingUser.email,
            firstName: existingUser.first_name,
            verificationUrl,
            expiresHours: EMAIL_VERIFICATION_TTL_HOURS,
          });
        }
        return res.status(202).json({
          requiresEmailVerification: true,
          message: 'Email này đang chờ xác thực. Vbee đã gửi lại liên kết nếu bạn có thể nhận email mới.',
        });
      }
      return res.status(400).json({ error: 'Email này đã được đăng ký' });
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 12);
    const isEmailVerified = Boolean(oauthProfile?.emailVerified) || !EMAIL_VERIFICATION_REQUIRED;

    const { rows } = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password, email_verified, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END)
       RETURNING id, first_name, last_name, email, avatar, plan, auth_version,
                 role, account_status, email_verified`,
      [cleanFirstName, cleanLastName, cleanEmail, hashedPassword, isEmailVerified]
    );

    const user = rows[0];
    if (oauthProfile) {
      await pool.query(
        `INSERT INTO user_auth_identities (
           user_id, provider, provider_user_id, provider_email,
           email_verified, last_login_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (provider, provider_user_id)
         DO UPDATE SET
           user_id = EXCLUDED.user_id,
           provider_email = EXCLUDED.provider_email,
           email_verified = EXCLUDED.email_verified,
           last_login_at = NOW(),
           updated_at = NOW()`,
        [
          user.id,
          oauthProfile.provider,
          oauthProfile.providerUserId,
          oauthProfile.email,
          oauthProfile.emailVerified,
        ],
      );
      if (!user.avatar && oauthProfile.avatar) {
        await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [
          oauthProfile.avatar,
          user.id,
        ]);
        user.avatar = oauthProfile.avatar;
      }
    }
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
    if (!isEmailVerified) {
      const verificationToken = await createEmailVerificationToken(user.id);
      const verificationUrl = `${getRequestFrontendUrl(req).replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(verificationToken)}`;
      try {
        await sendEmailVerificationEmail({
          to: user.email,
          firstName: user.first_name,
          verificationUrl,
          expiresHours: EMAIL_VERIFICATION_TTL_HOURS,
        });
      } catch (emailError) {
        await pool.query('DELETE FROM users WHERE id = $1 AND email_verified = FALSE', [
          user.id,
        ]).catch(() => {});
        console.error('Email verification send error:', emailError.message);
        return res.status(503).json({
          error: 'Chưa thể gửi email xác thực. Vui lòng thử lại sau.',
        });
      }
      await writeSecurityAudit({
        event: 'auth.register',
        outcome: 'accepted',
        req,
        userId: user.id,
        metadata: {
          requiresEmailVerification: true,
          referralRegistered: Boolean(referralRegistration?.registered),
        },
      });
      return res.status(201).json({
        requiresEmailVerification: true,
        message: 'Tài khoản đã được tạo. Vui lòng kiểm tra email để xác thực trước khi đăng nhập.',
        referral: referralRegistration,
      });
    }
    const wasKnownDevice = await hasSimilarRecentSession(user.id, req);
    const session = await issueSession(user, req, res);
    await sendLoginAlertIfUnusual({ user, req, session, wasKnownDevice });
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
              auth_version, role, status, account_status, email_verified
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
    if (user.account_status !== 'active' || user.status !== 'active') {
      await writeSecurityAudit({
        event: 'auth.login',
        outcome: 'failure',
        req,
        userId: user.id,
        metadata: { reason: 'account_blocked' },
      });
      return res.status(403).json({ error: 'Tài khoản đã bị khóa' });
    }
    if (user.email_verified === false && EMAIL_VERIFICATION_REQUIRED) {
      await writeSecurityAudit({
        event: 'auth.login',
        outcome: 'failure',
        req,
        userId: user.id,
        metadata: { reason: 'email_unverified' },
      });
      return res.status(403).json({
        error: 'Vui lòng xác thực email trước khi đăng nhập.',
        requiresEmailVerification: true,
      });
    }
    const wasKnownDevice = await hasSimilarRecentSession(user.id, req);
    const session = await issueSession(user, req, res);
    await sendLoginAlertIfUnusual({ user, req, session, wasKnownDevice });
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

// POST /api/auth/verify-email — xác thực email bằng token một lần rồi đăng nhập.
router.post('/verify-email', requireTrustedOrigin, passwordLimiter, async (req, res) => {
  const rawToken = String(req.body.token || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
    return res.status(400).json({ error: 'Liên kết xác thực email không hợp lệ' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT token.id, token.user_id
       FROM email_verification_tokens token
       JOIN users account ON account.id = token.user_id
       WHERE token.token_hash = $1
         AND token.used_at IS NULL
         AND token.expires_at > NOW()
         AND account.email_verified = FALSE
       FOR UPDATE`,
      [hashEmailVerificationToken(rawToken)],
    );
    const verification = rows[0];
    if (!verification) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Liên kết đã hết hạn hoặc đã được sử dụng',
      });
    }

    const updated = await client.query(
      `UPDATE users
       SET email_verified = TRUE,
           email_verified_at = NOW()
       WHERE id = $1
       RETURNING id, first_name, last_name, email, avatar, plan,
                 auth_version, role, status, account_status, email_verified`,
      [verification.user_id],
    );
    await client.query(
      `UPDATE email_verification_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [verification.user_id],
    );
    await client.query('COMMIT');

    const user = updated.rows[0];
    if (user.account_status !== 'active' || user.status !== 'active') {
      await writeSecurityAudit({
        event: 'auth.email_verified',
        outcome: 'failure',
        req,
        userId: user.id,
        metadata: { reason: 'account_blocked' },
      });
      return res.status(403).json({ error: 'Tài khoản đã bị khóa' });
    }
    const wasKnownDevice = await hasSimilarRecentSession(user.id, req);
    const session = await issueSession(user, req, res);
    await sendLoginAlertIfUnusual({ user, req, session, wasKnownDevice });
    await writeSecurityAudit({
      event: 'auth.email_verified',
      outcome: 'success',
      req,
      userId: user.id,
      sessionId: session.sessionId,
    });
    return res.json({
      token: session.token,
      expiresIn: session.expiresIn,
      user: normalizeUser(user),
      message: 'Email đã được xác thực.',
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Verify email error:', error);
    return res.status(500).json({ error: 'Không xác thực được email' });
  } finally {
    client.release();
  }
});

// POST /api/auth/forgot-password — luôn dùng thông báo chung để tránh lộ email đã đăng ký.
router.post('/forgot-password', requireTrustedOrigin, passwordLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const isLocalRequest = ['localhost', '127.0.0.1', '::1'].includes(
      String(req.hostname || '').toLowerCase()
    );
    if (!isValidEmail(email)) {
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

    const resetUrl = `${getRequestFrontendUrl(req).replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(rawToken)}`;
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
      `SELECT id, first_name, last_name, email, avatar, plan, role, status, account_status, email_verified
       FROM users WHERE id = $1`,
      [session.userId]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Không tìm thấy tài khoản' });
    if (rows[0].account_status !== 'active' || rows[0].status !== 'active') {
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

// GET /api/auth/sessions — danh sách thiết bị/phiên đăng nhập gần đây.
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const sessions = await listUserSessions(req.user.id, req.auth?.sid);
    return res.json({ sessions });
  } catch (error) {
    console.error('List sessions error:', error.message);
    return res.status(500).json({ error: 'Không tải được danh sách phiên đăng nhập' });
  }
});

// DELETE /api/auth/sessions/:id — thu hồi một phiên đăng nhập.
router.delete('/sessions/:id', requireTrustedOrigin, requireAuth, async (req, res) => {
  const sessionId = String(req.params.id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ error: 'Phiên đăng nhập không hợp lệ' });
  }
  try {
    const result = await revokeUserSession({
      userId: req.user.id,
      sessionId,
      currentSessionId: req.auth?.sid,
    });
    if (!result.revoked) {
      return res.status(404).json({ error: 'Không tìm thấy phiên đăng nhập' });
    }
    if (result.revokedCurrent) clearRefreshCookie(res, req);
    await writeSecurityAudit({
      event: 'auth.session_revoked',
      outcome: 'success',
      req,
      userId: req.user.id,
      sessionId,
      metadata: { revokedCurrent: result.revokedCurrent },
    });
    return res.json({ success: true, revokedCurrent: result.revokedCurrent });
  } catch (error) {
    console.error('Revoke session error:', error.message);
    return res.status(500).json({ error: 'Không thu hồi được phiên đăng nhập' });
  }
});

// POST /api/auth/sessions/revoke-others — giữ phiên hiện tại, thu hồi mọi phiên khác.
router.post('/sessions/revoke-others', requireTrustedOrigin, requireAuth, async (req, res) => {
  try {
    const revokedCount = await revokeOtherSessions(req.user.id, req.auth?.sid);
    await writeSecurityAudit({
      event: 'auth.sessions_revoked_other',
      outcome: 'success',
      req,
      userId: req.user.id,
      sessionId: req.auth?.sid,
      metadata: { revokedCount },
    });
    return res.json({ success: true, revokedCount });
  } catch (error) {
    console.error('Revoke other sessions error:', error.message);
    return res.status(500).json({ error: 'Không thu hồi được các phiên khác' });
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
       RETURNING id, first_name, last_name, email, avatar, plan, role, account_status`,
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
       RETURNING id, first_name, last_name, email, avatar, plan, role, account_status`,
      [avatar, req.user.id]
    );

    return res.json(normalizeUser(rows[0]));
  } catch (error) {
    console.error('Update avatar error:', error);
    return res.status(500).json({ error: 'Không cập nhật được ảnh đại diện' });
  }
});

module.exports = router;
