// Run manually with administrative credentials. Never run inside the HTTP server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { pool } = require('../config/migrationDb');
const { initTenancy } = require('../db/initTenancy');
const { backupDatabase } = require('./backup-db');
async function run() {
  await require('./check-migration-capabilities').checkMigrationCapabilities(pool);
  const filename = path.join(__dirname,'../.env');
  const local = process.env.NODE_ENV!=='production' && fs.existsSync(filename);
  const configured=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
  const suppliedRuntime=configured && /^sistema_gestor_app(?:\.|$)/.test(decodeURIComponent(configured.username)) && configured.password;
  if(!local && !suppliedRuntime)throw new Error('Configura DATABASE_URL de sistema_gestor_app mediante el gestor de secretos antes de migrar en produccion.');
  const backup = await backupDatabase(pool);
  const before = (await pool.query("SELECT (SELECT count(*) FROM ordenes_servicio) orders,(SELECT count(*) FROM ventas) sales,(SELECT md5(string_agg((to_jsonb(c)-'archivo_logo'-'archivo_logo_ticket')::text,'|' ORDER BY id)) FROM configuracion c) config")).rows[0];
  await initTenancy(pool);
  const db = await pool.connect();
  const password = suppliedRuntime?decodeURIComponent(configured.password):crypto.randomBytes(36).toString('base64url');
  try {
    await db.query('BEGIN'); await db.query('SELECT pg_advisory_xact_lock(261014,1)');
    if (!(await db.query("SELECT 1 FROM tenant_migraciones WHERE version='20261014-v3'")).rowCount) await db.query(fs.readFileSync(path.join(__dirname,'../db/migrations/20261014_rls_hardening.sql'),'utf8'));
    if (!(await db.query("SELECT 1 FROM tenant_migraciones WHERE version='20261014-v4'")).rowCount) await db.query(fs.readFileSync(path.join(__dirname,'../db/migrations/20261014_auth_capabilities.sql'),'utf8'));
    if (!(await db.query("SELECT 1 FROM tenant_migraciones WHERE version='20261014-v5'")).rowCount) await db.query(fs.readFileSync(path.join(__dirname,'../db/migrations/20261014_file_references.sql'),'utf8'));
    if (!(await db.query("SELECT 1 FROM tenant_migraciones WHERE version='20261014-v6'")).rowCount) await db.query(fs.readFileSync(path.join(__dirname,'../db/migrations/20261014_capability_scope.sql'),'utf8'));
    if (!(await db.query("SELECT 1 FROM tenant_migraciones WHERE version='20261014-v7'")).rowCount) await db.query(fs.readFileSync(path.join(__dirname,'../db/migrations/20261014_bootstrap_guard.sql'),'utf8'));
    if (!(await db.query("SELECT 1 FROM tenant_migraciones WHERE version='20261014-v8'")).rowCount) await db.query(fs.readFileSync(path.join(__dirname,'../db/migrations/20261014_financial_references.sql'),'utf8'));
    // Random server-generated value, never from an HTTP parameter and never logged.
    await db.query('ALTER ROLE sistema_gestor_app PASSWORD ' + require('pg').escapeLiteral(password));
    const after = (await db.query("SELECT (SELECT count(*) FROM ordenes_servicio) orders,(SELECT count(*) FROM ventas) sales,(SELECT md5(string_agg((to_jsonb(c)-'archivo_logo'-'archivo_logo_ticket')::text,'|' ORDER BY id)) FROM configuracion c) config")).rows[0];
    assert.deepEqual(after, before);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
  const runtime = new URL(process.env.MIGRATION_DATABASE_URL); runtime.username='sistema_gestor_app'; runtime.password=password;
  if(local){
    let env=fs.readFileSync(filename,'utf8');
    env=env.replace(/^DATABASE_URL=.*(?:\r?\n|$)/gm,'').replace(/^SUPABASE_DATABASE_URL=.*(?:\r?\n|$)/gm,'');
    fs.writeFileSync(filename,env+'\nDATABASE_URL='+runtime.toString()+'\n',{mode:0o600});
  }
  console.log(JSON.stringify({ backup:path.relative(path.join(__dirname,'..'),backup), runtime:'sistema_gestor_app', retained:{orders:before.orders,sales:before.sales,configurationUnchanged:true} }));
}
run().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
