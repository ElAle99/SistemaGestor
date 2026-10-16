// Explicit opt-in, empty databases only. Never invoked by the HTTP server.
require('../config/env');
const { pool } = require('../config/migrationDb');
const { checkMigrationCapabilities } = require('./check-migration-capabilities');
async function run() {
  await checkMigrationCapabilities(pool);
  if (process.env.CONFIRM_EMPTY_DATABASE !== 'yes') throw new Error('Para inicializar una base vacía configura CONFIRM_EMPTY_DATABASE=yes.');
  for (const name of ['INITIAL_BUSINESS_NAME','ADMIN_USERNAME','ADMIN_PASSWORD','ADMIN_NAME']) {
    if (!process.env[name]?.trim()) throw new Error(`${name} es obligatorio para inicializar una base vacía.`);
  }
  if (process.env.ADMIN_PASSWORD.length < 16) throw new Error('ADMIN_PASSWORD requiere al menos 16 caracteres.');
  // Forces pgConfig to validate the intended runtime login before any DDL.
  const runtimeUrl = new URL(process.env.DATABASE_URL || '');
  if (decodeURIComponent(runtimeUrl.username) !== 'sistema_gestor_app' || !runtimeUrl.password) throw new Error('Configura DATABASE_URL de sistema_gestor_app antes del bootstrap.');
  const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  if (rows.length) throw new Error('La base contiene tablas: bootstrap rechazado. Para una base existente usa migrate:security con respaldo.');
  process.env.SEED_DEFAULT_ADMIN = 'true';
  process.env.DB_RUN_LEGACY_CLEANUP = 'false';
  const runtime = require('../config/db');
  try {
    // Reuse the existing base schema/catalog initializer exclusively in this CLI.
    await runtime.initLegacySchema(pool);
    await pool.query(require('node:fs').readFileSync(require('node:path').join(__dirname, '../db/migrations/20260718_garantias.sql'), 'utf8'));
    console.log('Esquema inicial creado. Ejecuta migrate:security antes de iniciar el servidor.');
  } finally { await runtime.pool.end(); }
}
run().catch(error => {
  console.error(['INITIAL_BUSINESS_NAME','ADMIN_USERNAME','ADMIN_PASSWORD','ADMIN_NAME','Para inicializar','La base contiene','Configura DATABASE_URL'].some(prefix => error.message.startsWith(prefix)) ? error.message : 'Falló el bootstrap administrativo. Revisa la conexión y los permisos sin publicar credenciales.');
  process.exitCode = 1;
}).finally(() => pool.end());
