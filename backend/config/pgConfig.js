require('./env');

function positiveInt(name, fallback, maximum = 2147483647) {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Variable inválida: ${name}`);
  return value;
}
function parseUrl(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error();
    return url;
  } catch { throw new Error('URL PostgreSQL inválida; revisa la variable sin publicarla.'); }
}
function tlsConfig(url) {
  const mode = url?.searchParams.get('sslmode');
  const explicit = process.env.DB_SSL?.trim().toLowerCase();
  if (explicit && !['true', 'false', '1', '0', 'yes', 'no', 'require'].includes(explicit)) throw new Error('DB_SSL inválido.');
  if (process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim() && !['true', '1', 'yes'].includes(process.env.DB_SSL_REJECT_UNAUTHORIZED.toLowerCase())) throw new Error('No se permite desactivar la verificación de certificados PostgreSQL.');
  if (mode && !['disable', 'require', 'verify-ca', 'verify-full'].includes(mode)) throw new Error('sslmode no soportado; usa disable o verify-full.');
  if (url && ['sslcert', 'sslkey', 'sslrootcert', 'ssl'].some(key => url.searchParams.has(key))) throw new Error('Configura TLS mediante DB_SSL y DB_SSL_CA, sin parámetros SSL adicionales en la URL.');
  const enabled = explicit ? ['true', '1', 'yes', 'require'].includes(explicit) : !!mode && mode !== 'disable';
  if (mode && explicit && enabled !== (mode !== 'disable')) throw new Error('DB_SSL contradice sslmode.');
  url?.searchParams.delete('sslmode');
  return enabled ? { rejectUnauthorized: true, ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) } : false;
}
function getPgPoolConfig() {
  const raw = process.env.DATABASE_URL?.trim();
  const url = raw ? parseUrl(raw) : null;
  const user = url ? decodeURIComponent(url.username) : process.env.PGUSER || process.env.DB_USER;
  if (!user || /^(postgres|supabase_admin)(\.|$)/i.test(user)) throw new Error('Configura una credencial de runtime no administrativa en DATABASE_URL, PGUSER o DB_USER.');
  const ssl = tlsConfig(url);
  return {
    ...(url ? { connectionString: url.toString() } : {
      user, host: process.env.PGHOST || process.env.DB_HOST,
      port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
      password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
      database: process.env.PGDATABASE || process.env.DB_NAME
    }),
    ssl, max: positiveInt('DB_POOL_MAX', 10, 100),
    idleTimeoutMillis: positiveInt('DB_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: positiveInt('DB_CONNECTION_TIMEOUT_MS', 5000),
    statement_timeout: positiveInt('DB_STATEMENT_TIMEOUT_MS', 30000),
    query_timeout: positiveInt('DB_QUERY_TIMEOUT_MS', 35000),
    keepAlive: true, keepAliveInitialDelayMillis: 10000, application_name: 'allfix-runtime'
  };
}
function getMigrationPoolConfig() {
  if (!process.env.MIGRATION_DATABASE_URL?.trim()) throw new Error('MIGRATION_DATABASE_URL es obligatorio para migraciones.');
  const url = parseUrl(process.env.MIGRATION_DATABASE_URL);
  const ssl = tlsConfig(url);
  return { connectionString: url.toString(), ssl, max: 1, connectionTimeoutMillis: 5000 };
}
module.exports = { getPgPoolConfig, getMigrationPoolConfig, positiveInt };
