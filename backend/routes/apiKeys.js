require("../config/env");
const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { writeSecurityAudit } = require('../services/securityAuditService');
const { getQuotaStatus } = require('../services/quotaService');
const { getApiKeyUsageSummary } = require('../services/apiUsageService');

const router = express.Router();

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateApiKey() {
  return `vbee_sk_${crypto.randomBytes(32).toString('base64url')}`;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, key_prefix, created_at, last_used_at
       FROM api_keys
       WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (error) {
    console.error('List API keys error:', error);
    return res.status(500).json({ error: 'Không thể lấy danh sách API key' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const quota = await getQuotaStatus(req.user.id, { db: client });
    if (quota.plan === 'free') {
      const error = new Error('API chỉ khả dụng từ gói Tiêu chuẩn trở lên');
      error.statusCode = 403;
      throw error;
    }
    const name = String(req.body.name || 'Default API key').trim().slice(0, 80) || 'Default API key';
    const rawKey = generateApiKey();
    const keyPrefix = `${rawKey.slice(0, 14)}...${rawKey.slice(-4)}`;
    const keyHash = hashApiKey(rawKey);

    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const activeKeys = await client.query(
      'SELECT COUNT(*)::integer AS count FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL',
      [req.user.id]
    );
    if (Number(activeKeys.rows[0]?.count || 0) >= 10) {
      const error = new Error('Mỗi tài khoản chỉ được có tối đa 10 API key đang hoạt động');
      error.statusCode = 409;
      throw error;
    }

    const { rows } = await client.query(
      `INSERT INTO api_keys (user_id, name, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, key_prefix, created_at, last_used_at`,
      [req.user.id, name, keyPrefix, keyHash]
    );
    await client.query('COMMIT');

    await writeSecurityAudit({
      event: 'api_key.created',
      outcome: 'success',
      req,
      userId: req.user.id,
      metadata: { keyId: rows[0].id, name },
    });
    return res.status(201).json({ ...rows[0], key: rawKey });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Create API key error:', error);
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Không thể tạo API key',
    });
  } finally {
    client.release();
  }
});

router.get('/usage', requireAuth, async (req, res) => {
  try {
    const usage = await getApiKeyUsageSummary(req.user.id);
    return res.json(usage);
  } catch (error) {
    console.error('API key usage summary error:', error);
    return res.status(500).json({ error: 'Không thể lấy thống kê API key' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID không hợp lệ' });

  try {
    const { rowCount } = await pool.query(
      `UPDATE api_keys
       SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [id, req.user.id]
    );

    if (rowCount === 0) return res.status(404).json({ error: 'Không tìm thấy API key' });
    await writeSecurityAudit({
      event: 'api_key.revoked',
      outcome: 'success',
      req,
      userId: req.user.id,
      metadata: { keyId: id },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Revoke API key error:', error);
    return res.status(500).json({ error: 'Không thể thu hồi API key' });
  }
});

module.exports = router;
module.exports.hashApiKey = hashApiKey;
