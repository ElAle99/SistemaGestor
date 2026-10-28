// Explicit recovery CLI. Never runs as part of server startup.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Client, escapeIdentifier: qi, escapeLiteral: ql } = require('../backend/node_modules/pg');
const { initialize, root, local } = require('./local-postgres.cjs');
const backupDir = path.join(root, 'backend/db/backups');
const migrations = [
  '20261014_rls_hardening.sql', '20261014_auth_capabilities.sql',
  '20261014_file_references.sql', '20261014_capability_scope.sql',
  '20261014_bootstrap_guard.sql', '20261014_financial_references.sql'
];
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function serialize(row, columns) {
  return JSON.stringify(canonical(Object.fromEntries(columns.map(k => [k, row[k]]))));
}
function columnType(c) {
  if (!/^[a-z0-9_]+$/.test(c.udt_name)) throw new Error('Tipo de columna no soportado.');
  let type = qi(c.udt_name);
  if (c.udt_name === 'varchar' && c.character_maximum_length) type += `(${Number(c.character_maximum_length)})`;
  if (c.udt_name === 'numeric' && c.numeric_precision) type += `(${Number(c.numeric_precision)},${Number(c.numeric_scale)})`;
  return type;
}
async function restoreSchema(db, backup) {
  await db.query('CREATE ROLE sistema_gestor_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS');
  await db.query('CREATE ROLE sistema_gestor_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE');
  await db.query('SET LOCAL check_function_bodies = off');
  for (const fn of backup.schema.functions) await db.query(fn.definition);
  for (const s of backup.schema.sequences) {
    await db.query(`CREATE SEQUENCE ${qi(s.sequencename)} AS ${s.data_type} START ${s.start_value} INCREMENT ${s.increment_by} MINVALUE ${s.min_value} MAXVALUE ${s.max_value} CACHE ${s.cache_size} ${s.cycle ? 'CYCLE' : 'NO CYCLE'}`);
  }
  for (const table of Object.keys(backup.tables)) {
    const columns = backup.schema.columns.filter(c => c.table_name === table).sort((a,b) => a.ordinal_position - b.ordinal_position);
    assert.ok(columns.length, 'Falta esquema de ' + table);
    assert.ok(columns.every(c => c.is_generated === 'NEVER' && c.is_identity === 'NO'), 'El esquema base requiere restauración de columnas especiales.');
    await db.query(`CREATE TABLE ${qi(table)} (${columns.map(c => `${qi(c.column_name)} ${columnType(c)}${c.column_default ? ' DEFAULT ' + c.column_default : ''}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}`).join(',')})`);
    for (const c of columns) {
      const seq = c.column_default?.match(/^nextval\('([^']+)'::regclass\)$/)?.[1];
      if (seq) await db.query(`ALTER SEQUENCE ${qi(seq)} OWNED BY ${qi(table)}.${qi(c.column_name)}`);
    }
    // JSON record conversion preserves jsonb arrays/objects and SQL NULLs.
    const records = backup.tables[table].map(row => {
      const copy = { ...row };
      for (const column of columns.filter(c => c.udt_name === 'timestamp')) {
        const value = copy[column.column_name];
        if (!value) continue;
        // pg exports a timestamp without zone as a local Date. Reverse that
        // conversion before JSON record input, which otherwise discards its Z.
        const date = new Date(value);
        copy[column.column_name] = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
      }
      return copy;
    });
    if (records.length) await db.query(
      `INSERT INTO ${qi(table)} SELECT * FROM jsonb_populate_recordset(NULL::${qi(table)}, $1::jsonb)`,
      [JSON.stringify(records)]);
  }
  const constraints = backup.schema.constraints.filter(c => !c.definition.startsWith('NOT NULL'));
  for (const c of constraints.filter(c => !c.definition.startsWith('FOREIGN KEY'))) {
    await db.query(`ALTER TABLE ${qi(c.table_name)} ADD CONSTRAINT ${qi(c.conname)} ${c.definition}`);
  }
  const constraintNames = new Set(constraints.map(c => c.conname));
  for (const index of backup.schema.indexes) if (!constraintNames.has(index.indexname)) await db.query(index.indexdef);
  for (const c of constraints.filter(c => c.definition.startsWith('FOREIGN KEY'))) {
    await db.query(`ALTER TABLE ${qi(c.table_name)} ADD CONSTRAINT ${qi(c.conname)} ${c.definition}`);
  }
  for (const trigger of backup.schema.triggers) await db.query(trigger.definition);
  const policyTables = new Set();
  for (const p of backup.schema.policies) {
    assert.equal(p.roles, '{sistema_gestor_tenant}');
    assert.ok(['ALL','SELECT','INSERT','UPDATE','DELETE'].includes(p.cmd));
    if (!policyTables.has(p.tablename)) {
      await db.query(`ALTER TABLE ${qi(p.tablename)} ENABLE ROW LEVEL SECURITY`);
      await db.query(`ALTER TABLE ${qi(p.tablename)} FORCE ROW LEVEL SECURITY`);
      policyTables.add(p.tablename);
    }
    await db.query(`CREATE POLICY ${qi(p.policyname)} ON ${qi(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO sistema_gestor_tenant${p.qual ? ' USING (' + p.qual + ')' : ''}${p.with_check ? ' WITH CHECK (' + p.with_check + ')' : ''}`);
  }
  // Base v1 permissions; subsequent changes use the existing security migrations.
  await db.query('GRANT USAGE ON SCHEMA public TO sistema_gestor_tenant');
  await db.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sistema_gestor_tenant');
  for (const table of policyTables) {
    const permissions = table === 'negocios' ? 'SELECT' : table === 'negocio_logos' ? 'SELECT, INSERT' : 'SELECT, INSERT, UPDATE, DELETE';
    await db.query(`GRANT ${permissions} ON ${qi(table)} TO sistema_gestor_tenant`);
  }
  await db.query('REVOKE ALL ON FUNCTION initialize_business_config(), track_order_folio(), allocate_order_folio(INTEGER) FROM PUBLIC');
  await db.query('GRANT EXECUTE ON FUNCTION allocate_order_folio(INTEGER) TO sistema_gestor_tenant');
}
async function verify(db, expected) {
  const counts = {};
  for (const [table, original] of Object.entries(expected.tables)) {
    const actual = (await db.query(`SELECT * FROM ${qi(table)}`)).rows;
    const columns = expected.schema.columns.filter(c => c.table_name === table).map(c => c.column_name);
    const before = original.map(row => serialize(row, columns)).sort();
    const after = actual.map(row => serialize(row, columns)).sort();
    if (table === 'tenant_migraciones') for (const row of before) assert.ok(after.includes(row), 'Migración histórica alterada.');
    else assert.deepEqual(after, before, 'Diferencia en ' + table);
    counts[table] = actual.length;
  }
  return counts;
}
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('La recuperación local no se permite en producción.');
  const files = fs.readdirSync(backupDir).filter(f => /^full-before-rls-\d+\.json$/.test(f)).sort();
  assert.ok(files.length, 'No hay respaldos completos.');
  const base = JSON.parse(fs.readFileSync(path.join(backupDir, files[0]), 'utf8'));
  const latest = JSON.parse(fs.readFileSync(path.join(backupDir, files.at(-1)), 'utf8'));
  assert.deepEqual(base.tables.tenant_migraciones.map(r => r.version).sort(), ['20261013-v1','20261013-v2']);
  // The existing migrations reproduce the newer schema without rewriting history.
  // Refuse recovery if the latest snapshot has changed any original rows.
  for (const [table, rows] of Object.entries(base.tables)) {
    if (table === 'tenant_migraciones') continue;
    const columns = base.schema.columns.filter(c => c.table_name === table).map(c => c.column_name);
    assert.deepEqual(latest.tables[table].map(r => serialize(r, columns)).sort(), rows.map(r => serialize(r, columns)).sort(), 'Datos distintos entre respaldos: ' + table);
  }
  const settings = initialize();
  const adminUrl = new URL(settings.adminUrl);
  assert.equal(adminUrl.hostname, '127.0.0.1');
  assert.equal(adminUrl.pathname, '/allfix_local');
  const maintenanceUrl = new URL(adminUrl); maintenanceUrl.pathname = '/postgres';
  const maintenance = new Client({ connectionString: maintenanceUrl.toString() });
  await maintenance.connect();
  try {
    if (!(await maintenance.query("SELECT 1 FROM pg_database WHERE datname='allfix_local'")).rowCount) await maintenance.query('CREATE DATABASE allfix_local');
  } finally { await maintenance.end(); }
  const db = new Client({ connectionString: settings.adminUrl });
  await db.connect();
  let counts;
  try {
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0, 'La base local ya contiene tablas. No se sobrescribirá.');
    await db.query('BEGIN');
    await db.query("SET LOCAL TIME ZONE 'UTC'");
    console.log('Restaurando esquema y registros del respaldo...');
    await restoreSchema(db, base);
    for (const migration of migrations) {
      console.log('Aplicando ' + migration);
      await db.query(fs.readFileSync(path.join(root, 'backend/db/migrations', migration), 'utf8'));
    }
    for (const row of latest.tables.tenant_migraciones) await db.query(
      'UPDATE tenant_migraciones SET negocio_legacy=$2, configuracion_antes=$3, aplicada_en=$4 WHERE version=$1',
      [row.version, row.negocio_legacy, row.configuracion_antes, row.aplicada_en]);
    for (const s of latest.schema.sequences) await db.query('SELECT setval($1::regclass, $2::bigint, $3)',
      [s.sequencename, s.last_value || s.start_value, s.last_value !== null]);
    await db.query('ALTER ROLE sistema_gestor_app PASSWORD ' + ql(decodeURIComponent(new URL(settings.runtimeUrl).password)));
    counts = await verify(db, latest);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { await db.end(); }
  // Verify using the actual restricted login before switching the application.
  const runtime = new Client({ connectionString: settings.runtimeUrl });
  await runtime.connect();
  try {
    assert.equal((await runtime.query('SELECT runtime_schema_ready() AS ready')).rows[0].ready, true);
    assert.equal((await runtime.query('SELECT count(*)::int AS n FROM clientes')).rows[0].n, 0, 'El aislamiento sin tenant debe mantenerse.');
    await runtime.query('BEGIN');
    await runtime.query("SELECT set_config('app.negocio_id', $1, true)", [String(latest.tables.negocios[0].id)]);
    assert.equal((await runtime.query('SELECT count(*)::int AS n FROM clientes')).rows[0].n, counts.clientes);
    await runtime.query('ROLLBACK');
  } finally { await runtime.end(); }
  const envPath = path.join(root, 'backend/.env');
  const env = fs.readFileSync(envPath, 'utf8');
  const previous = path.join(local, 'backend.env.before-local');
  if (!fs.existsSync(previous)) fs.writeFileSync(previous, env, { flag: 'wx', mode: 0o600 });
  const updates = { DATABASE_URL: settings.runtimeUrl, MIGRATION_DATABASE_URL: settings.adminUrl, DB_SSL: 'false', DB_SSL_CA: '' };
  let updated = env;
  for (const [key, value] of Object.entries(updates)) {
    updated = updated.replace(new RegExp('^' + key + '=.*(?:\\r?\\n|$)', 'gm'), '');
    updated += '\n' + key + '=' + value + '\n';
  }
  fs.writeFileSync(envPath, updated, { mode: 0o600 });
  fs.writeFileSync(path.join(local, 'restore-report.json'), JSON.stringify({ backup: files.at(-1), created: latest.created, restored: new Date().toISOString(), allOriginalValuesPreserved: true, counts }, null, 2));
  console.log(JSON.stringify({ backup: files.at(-1), allOriginalValuesPreserved: true, clients: counts.clientes, orders: counts.ordenes_servicio, sales: counts.ventas }));
}
if (require.main === module) main().catch(error => {
  // Assertion details may contain customer data; keep diagnostics private.
  const message = error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.code || error.message;
  console.error('Recuperación local fallida:', message);
  process.exitCode = 1;
});
