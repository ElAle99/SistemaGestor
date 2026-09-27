const fs = require('node:fs');
const path = require('node:path');
const seed = require('./catalogSeed');
const key = text => text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

async function initCatalog(pool) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(260926, 1)");
    await db.query(fs.readFileSync(path.join(__dirname, 'migrations/20260926_catalogos.sql'), 'utf8'));
    const applied = await db.query("SELECT version FROM catalogo_migraciones WHERE version = '20260926-v1'");
    if (!applied.rows.length) {
      async function insert(table, name, parentColumn, parent) {
        const columns = parentColumn ? `nombre, clave, ${parentColumn}` : 'nombre, clave';
        const values = parentColumn ? [name, key(name), parent] : [name, key(name)];
        const result = await db.query(`INSERT INTO ${table} (${columns}) VALUES (${values.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT DO NOTHING RETURNING id`, values);
        if (result.rows[0]) return result.rows[0].id;
        const existing = await db.query(`SELECT id FROM ${table} WHERE negocio_id IS NULL AND clave = $1 ${parentColumn ? `AND ${parentColumn} = $2` : ''}`, parentColumn ? [key(name), parent] : [key(name)]);
        return existing.rows[0].id;
      }
      for (const [type, brands] of Object.entries(seed.brands)) {
        const typeId = await insert('tipos_equipo', type);
        for (const brand of seed.split(brands)) {
          const brandId = await insert('marcas', brand, 'tipo_equipo_id', typeId);
          for (const model of seed.models[type]?.[brand] || []) await insert('modelos_equipo', model, 'marca_id', brandId);
        }
        for (const fault of seed.split(seed.faults[type])) {
          const faultId = await insert('fallas_catalogo', fault, 'tipo_equipo_id', typeId);
          for (const repair of seed.suggestedRepairs(type, fault)) {
            const repairId = await insert('reparaciones_catalogo', repair, 'tipo_equipo_id', typeId);
            await db.query('INSERT INTO falla_reparaciones (falla_id, reparacion_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [faultId, repairId]);
          }
        }
      }
      await db.query("INSERT INTO catalogo_migraciones (version) VALUES ('20260926-v1')");
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}
module.exports = { initCatalog, key };
