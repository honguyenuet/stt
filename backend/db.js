require("./config/env");
const { Pool } = require('pg');
const { IS_PRODUCTION } = require('./config/security');

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getSslConfig() {
  if (process.env.DB_SSL !== 'true') return undefined;
  const ca = String(process.env.DB_SSL_CA || '').replace(/\\n/g, '\n').trim();
  return {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    ...(ca ? { ca } : {}),
  };
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'golden_voice',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: getSslConfig(),
  max: positiveInt(process.env.DB_POOL_MAX, IS_PRODUCTION ? 20 : 10),
  connectionTimeoutMillis: positiveInt(process.env.DB_CONNECT_TIMEOUT_MS, 10000),
  idleTimeoutMillis: positiveInt(process.env.DB_IDLE_TIMEOUT_MS, 30000),
  statement_timeout: positiveInt(process.env.DB_STATEMENT_TIMEOUT_MS, 30000),
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Lỗi kết nối PostgreSQL:', err.message);
  } else {
    console.log('Đã kết nối PostgreSQL thành công');
    release();
  }
});

module.exports = pool;
