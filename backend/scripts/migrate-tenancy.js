const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pool } = require('../config/migrationDb');
const { withSystemContext } = require('../config/tenantContext');
const { initTenancy } = require('../db/initTenancy');

async function run() {
  await withSystemContext(async () => {
    const already = await pool.query("SELECT to_regclass('public.tenant_migraciones') AS applied");
    const configuration = await pool.query('SELECT to_jsonb(c) AS data FROM configuracion c ORDER BY id');
    const counts = await pool.query('SELECT (SELECT count(*) FROM usuarios) AS usuarios, (SELECT count(*) FROM ordenes_servicio) AS ordenes, (SELECT count(*) FROM ventas) AS ventas');
    const directory = path.join(__dirname, '../db/backups');
    fs.mkdirSync(directory, { recursive: true });
    const backup = path.join(directory, 'tenant-before-' + Date.now() + '.json');
    fs.writeFileSync(backup, JSON.stringify({ configuration: configuration.rows, counts: counts.rows, already: already.rows }, null, 2), { flag: 'wx' });
    await initTenancy(pool);
    const after = await pool.query('SELECT to_jsonb(c) AS data FROM configuracion c ORDER BY id');
    assert.deepEqual(after.rows.map(row => { const data={...row.data}; if (!Object.hasOwn(configuration.rows[0]?.data || {}, 'negocio_id')) delete data.negocio_id; return {data}; }), configuration.rows);
    assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM usuarios) AS usuarios, (SELECT count(*) FROM ordenes_servicio) AS ordenes, (SELECT count(*) FROM ventas) AS ventas')).rows, counts.rows);
    const migrated = await pool.query('SELECT id, negocio_id, nombre FROM configuracion ORDER BY id');
    console.log(JSON.stringify({ migrated: migrated.rows, retained: counts.rows[0], backup: path.relative(path.join(__dirname, '..'), backup) }));
  });
}
run().catch(error => { console.error(error.message); process.exitCode=1; }).finally(() => pool.end());
