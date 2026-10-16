const test = require('node:test');
const assert = require('node:assert/strict');
const { checkMigrationCapabilities } = require('../scripts/check-migration-capabilities');
test('migration preflight rejects managed non-superuser before any writes', async () => {
  const statements = [];
  await assert.rejects(checkMigrationCapabilities({ query: async sql => {
    statements.push(sql);
    return { rows: [{ current_user: 'managed_owner', rolsuper: false, rolcreaterole: true }] };
  } }), /Render Managed PostgreSQL/);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^SELECT/);
});
test('migration preflight accepts the existing administrative architecture', async () => {
  const role = { current_user: 'migration_admin', rolsuper: true };
  assert.equal(await checkMigrationCapabilities({ query: async () => ({ rows: [role] }) }), role);
});
test('administrative BYPASSRLS with CREATEROLE also supports definer ownership without requiring superuser', async () => {
  const role = { current_user: 'migration_owner', rolsuper: false, rolbypassrls: true, rolcreaterole: true };
  assert.equal(await checkMigrationCapabilities({ query: async () => ({ rows: [role] }) }), role);
});
test('empty database initializer provides all tables needed by tenant migrations', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const db = new PGlite();
  const pool = {
    query: (sql, params) => params ? db.query(sql, params) : db.exec(sql).then(result => result.at(-1)),
    connect: async () => ({ query: pool.query, release() {} })
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../config/db.js'), 'utf8'), {
    module, console: { log() {}, warn() {} }, process: { env: { INITIAL_BUSINESS_NAME: 'Negocio nuevo' } },
    require(name) {
      if (name === 'pg') return { Pool: class {} };
      if (name === './env') return {};
      if (name === './pgConfig') return { getPgPoolConfig: () => ({}) };
      if (name === './tenantContext') return { createTenantPool: value => value };
      return require(name);
    }
  });
  try {
    await module.exports.initLegacySchema(pool);
    await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/20260718_garantias.sql'), 'utf8'));
    await require('../db/initTenancy').initTenancy(pool);
    await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/20261014_rls_hardening.sql'), 'utf8'));
    const { rows: [config] } = await db.query('SELECT nombre, negocio_id FROM configuracion');
    assert.equal(config.nombre, 'Negocio nuevo');
    assert.ok(Number(config.negocio_id) > 0);
    assert.equal((await db.query('SELECT count(*) n FROM ordenes_servicio')).rows[0].n, 0);
  } finally { await db.close(); }
});
