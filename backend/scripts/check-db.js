// Read-only diagnostics: no administrative login, migrations or data writes.
require('../config/env');
const { Pool } = require('pg');
const { getPgPoolConfig } = require('../config/pgConfig');
const { safeCode, handlePoolErrors } = require('../config/dbLifecycle');
async function check() {
  const config = getPgPoolConfig();
  const url = config.connectionString ? new URL(config.connectionString) : null;
  const host = url?.hostname || config.host;
  console.log(JSON.stringify({ host, port: url?.port || config.port || 5432, database: url?.pathname.slice(1) || config.database,
    user: url ? decodeURIComponent(url.username) : config.user, tls: !!config.ssl,
    endpoint: host?.endsWith('.railway.internal') ? 'private' : host?.endsWith('.proxy.rlwy.net') ? 'public-proxy' : 'other',
    source: url ? 'DATABASE_URL (PG*/DB_* ignored)' : 'PG* then DB_*' }));
  const pool = new Pool(config);
  handlePoolErrors(pool);
  try {
    await pool.query('SELECT 1 AS ok');
    console.log('SELECT 1: OK');
    const runtime = require('../config/db');
    try { await runtime.initDB(); console.log('Credencial restringida y esquema: OK'); }
    finally { await runtime.pool.end(); }
  } finally { await pool.end(); }
}
check().catch(error => { console.error('Diagnóstico PostgreSQL fallido:', safeCode(error)); process.exitCode = 1; });
