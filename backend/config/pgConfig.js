require('dotenv').config();

function readBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'require'].includes(String(value).toLowerCase());
}

function shouldUseSsl(connectionString = '') {
  if (process.env.DB_SSL !== undefined) return readBoolean(process.env.DB_SSL);
  if (!connectionString) return false;

  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get('sslmode');
    return sslMode === 'require'
      || url.hostname.includes('supabase.co')
      || url.hostname.includes('supabase.com')
      || url.hostname.includes('pooler.supabase');
  } catch (error) {
    return false;
  }
}

function getPgPoolConfig() {
  const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  const rejectUnauthorized = readBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED, false);

  if (connectionString) {
    const config = {
      connectionString,
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000)
    };

    if (shouldUseSsl(connectionString)) {
      config.ssl = { rejectUnauthorized };
    }

    return config;
  }

  const config = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 5432),
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000)
  };

  if (readBoolean(process.env.DB_SSL, false)) {
    config.ssl = { rejectUnauthorized };
  }

  return config;
}

module.exports = {
  getPgPoolConfig
};
