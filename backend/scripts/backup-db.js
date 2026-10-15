const fs = require('node:fs');
const path = require('node:path');
async function backupDatabase(pool) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    const backup = { created: new Date().toISOString(), tables: {}, schema: {} };
    for (const { tablename } of tables) backup.tables[tablename] = (await db.query('SELECT * FROM public."' + tablename.replace(/"/g,'""') + '"')).rows;
    for (const [name, sql] of Object.entries({
      columns: "SELECT * FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
      constraints: "SELECT c.conrelid::regclass::text table_name,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'",
      functions: "SELECT pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'",
      triggers: "SELECT pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal",
      indexes: "SELECT * FROM pg_indexes WHERE schemaname='public'",
      policies: "SELECT * FROM pg_policies WHERE schemaname='public'",
      sequences: "SELECT * FROM pg_sequences WHERE schemaname='public'"
    })) backup.schema[name] = (await db.query(sql)).rows;
    await db.query('COMMIT');
    const directory = path.join(__dirname, '../db/backups'); fs.mkdirSync(directory, { recursive: true });
    const filename = path.join(directory, 'full-before-rls-' + Date.now() + '.json');
    fs.writeFileSync(filename, JSON.stringify(backup, null, 2), { flag: 'wx', mode: 0o600 });
    return filename;
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
module.exports = { backupDatabase };
if (require.main === module) {
  const { pool } = require('../config/migrationDb');
  backupDatabase(pool).then(file => console.log('Respaldo completo: ' + path.relative(path.join(__dirname,'..'),file))).catch(error => { console.error(error.message); process.exitCode=1; }).finally(() => pool.end());
}
