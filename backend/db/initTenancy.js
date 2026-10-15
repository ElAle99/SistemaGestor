const fs = require('node:fs');
const path = require('node:path');
const { withSystemContext } = require('../config/tenantContext');
async function isLegacyBusiness(pool, negocioId) {
  return (await pool.query('SELECT is_legacy_business($1) AS legacy',[negocioId])).rows[0]?.legacy === true;
}
async function initTenancy(pool) {
  return withSystemContext(async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(261013, 1)');
      await db.query('CREATE TABLE IF NOT EXISTS tenant_migraciones (version TEXT PRIMARY KEY, negocio_legacy BIGINT, configuracion_antes JSONB, aplicada_en TIMESTAMPTZ DEFAULT now())');
      const applied = await db.query("SELECT version FROM tenant_migraciones WHERE version='20261013-v1'");
      if (!applied.rows.length) {
        const audit = new Map();
        for (const table of ['configuracion','usuarios','ordenes_servicio','ventas']) {
          const exists = await db.query('SELECT to_regclass($1) AS table_name', ['public.'+table]);
          if (!exists.rows[0].table_name) continue;
          const digest = await db.query(`SELECT count(*) AS count, md5(string_agg((to_jsonb(t)-'negocio_id')::text, '|' ORDER BY id)) AS digest FROM ${table} t`);
          audit.set(table, digest.rows[0]);
        }
        await db.query(fs.readFileSync(path.join(__dirname, 'migrations/20261013_tenants.sql'), 'utf8'));
        for (const [table, before] of audit) {
          const after = await db.query(`SELECT count(*) AS count, md5(string_agg((to_jsonb(t)-'negocio_id')::text, '|' ORDER BY id)) AS digest FROM ${table} t`);
          if (before.count !== after.rows[0].count || before.digest !== after.rows[0].digest) throw new Error('La migración alteró datos existentes de '+table+'. Se revirtió.');
        }
      }
      const uniqueness = await db.query("SELECT version FROM tenant_migraciones WHERE version='20261013-v2'");
      if (!uniqueness.rows.length) await db.query(fs.readFileSync(path.join(__dirname, 'migrations/20261013_tenant_uniqueness.sql'), 'utf8'));
      const role = (await db.query("SELECT rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname='sistema_gestor_tenant'")).rows[0];
      const parents = await db.query("SELECT count(*) AS count FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='sistema_gestor_tenant')");
      if (!role || role.rolsuper || role.rolbypassrls || role.rolcanlogin || Number(parents.rows[0].count)) throw new Error('El rol tenant tiene privilegios inseguros. No se inicia el servidor.');
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  });
}
module.exports = { initTenancy, isLegacyBusiness };
