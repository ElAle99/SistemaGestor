const { pool } = require('../config/db');
const { key } = require('../db/initCatalog');
const definitions = {
  tipos: { table: 'tipos_equipo', max: 50 },
  marcas: { table: 'marcas', parent: 'tipos', column: 'tipo_equipo_id', max: 100 },
  modelos: { table: 'modelos_equipo', parent: 'marcas', column: 'marca_id', max: 100 },
  fallas: { table: 'fallas_catalogo', parent: 'tipos', column: 'tipo_equipo_id', max: 250 },
  reparaciones: { table: 'reparaciones_catalogo', parent: 'tipos', column: 'tipo_equipo_id', max: 250 }
};
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function scopeForUser(user = {}) {
  // A DB-owned tenant always wins; no body, query-string or JWT tenant claims.
  // Legacy single-business installs must opt in with a server-side setting.
  const raw = user.tiene_negocio ? user.negocio_id : process.env.CATALOGO_NEGOCIO_ID;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function definition(kind) {
  if (!Object.hasOwn(definitions, kind)) throw error('Catálogo inválido.');
  return definitions[kind];
}
function cleanName(name, max) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > max) throw error(`Nombre obligatorio, máximo ${max} caracteres.`);
  return name.trim().replace(/\s+/g, ' ');
}
async function visible(kind, id, scope, db = pool) {
  const def = definition(kind);
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw error('Referencia de catálogo inválida.');
  const result = await db.query(`SELECT * FROM ${def.table} WHERE id = $1 AND activo = true AND (negocio_id IS NULL OR negocio_id = $2)`, [id, scope]);
  const row = result.rows[0];
  if (!row) throw error('Elemento no disponible para este negocio.', 404);
  if (def.parent) await visible(def.parent, row[def.column], scope, db);
  return row;
}
async function getCatalog(scope) {
  const result = { puede_guardar: scope !== null };
  for (const kind of ['tipos', 'marcas', 'fallas', 'reparaciones']) {
    const def = definitions[kind];
    const rows = await pool.query(`SELECT * FROM ${def.table} WHERE activo = true AND (negocio_id IS NULL OR negocio_id = $1) ORDER BY nombre`, [scope]);
    result[kind] = rows.rows;
  }
  const types = new Set(result.tipos.map(row => row.id));
  for (const kind of ['marcas', 'fallas', 'reparaciones']) result[kind] = result[kind].filter(row => types.has(row.tipo_equipo_id));
  const links = await pool.query('SELECT falla_id, reparacion_id FROM falla_reparaciones WHERE negocio_id IS NULL OR negocio_id = $1', [scope]);
  const faults = new Set(result.fallas.map(row => row.id));
  const repairs = new Set(result.reparaciones.map(row => row.id));
  result.relaciones = links.rows.filter(row => faults.has(row.falla_id) && repairs.has(row.reparacion_id));
  return result;
}
async function getModels(scope, brand, query = '') {
  await visible('marcas', brand, scope);
  const search = key(String(query).slice(0, 100));
  const result = await pool.query(`SELECT * FROM modelos_equipo WHERE marca_id = $1 AND activo = true
    AND (negocio_id IS NULL OR negocio_id = $2) AND strpos(clave, $3) > 0 ORDER BY nombre LIMIT 50`, [brand, scope, search]);
  return result.rows;
}
async function addEntry(kind, data, scope, db = pool, verifiedParent = null) {
  if (!scope) throw error('Configura el negocio de esta instalación antes de guardar catálogos privados.', 409);
  const def = definition(kind);
  const name = cleanName(data.nombre, def.max);
  let parent = verifiedParent;
  if (def.parent && (!parent || Number(parent.id) !== Number(data.parent_id))) parent = await visible(def.parent, data.parent_id, scope, db);
  const params = [key(name), scope];
  const parentWhere = def.column ? `AND ${def.column} = $3` : '';
  if (def.column) params.push(Number(data.parent_id));
  const existing = await db.query(`SELECT * FROM ${def.table} WHERE clave = $1 AND (negocio_id IS NULL OR negocio_id = $2) ${parentWhere} ORDER BY negocio_id NULLS FIRST`, params);
  if (existing.rows.some(row => row.activo === false)) throw error('Este elemento está desactivado. Utiliza otro nombre o consulta al administrador.', 409);
  if (existing.rows[0]) return existing.rows[0];
  const values = [scope, name, key(name)];
  const parentScope = def.column?.replace(/_id$/, '_scope');
  if (def.column) values.push(Number(data.parent_id),Number(parent.negocio_id || 0));
  const inserted = await db.query(`INSERT INTO ${def.table} (negocio_id, nombre, clave${def.column ? `, ${def.column}, ${parentScope}` : ''})
    VALUES (${values.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT DO NOTHING RETURNING *`, values);
  if (inserted.rows[0]) return inserted.rows[0];
  const concurrent = await db.query(`SELECT * FROM ${def.table} WHERE clave = $1 AND negocio_id = $2 ${parentWhere}`, params);
  if (!concurrent.rows[0]?.activo) throw error('El catálogo cambió. Intenta nuevamente.', 409);
  return concurrent.rows[0];
}
async function linkRepair(data, scope, db = pool) {
  if (!scope) throw error('No hay negocio configurado.', 409);
  const fault = await visible('fallas', data.falla_id, scope, db);
  const repair = await visible('reparaciones', data.reparacion_id, scope, db);
  if (fault.tipo_equipo_id !== repair.tipo_equipo_id) throw error('La falla y la reparación deben pertenecer al mismo equipo.');
  await db.query('INSERT INTO falla_reparaciones (negocio_id, falla_id, reparacion_id,falla_scope,reparacion_scope) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [scope, fault.id, repair.id,Number(fault.negocio_id||0),Number(repair.negocio_id||0)]);
  return { success: true };
}
async function deactivate(kind, id, scope) {
  if (!scope) throw error('No hay negocio configurado.', 409);
  const def = definition(kind);
  const result = await pool.query(`UPDATE ${def.table} SET activo = false WHERE id = $1 AND negocio_id = $2 RETURNING id`, [id, scope]);
  if (!result.rows.length) throw error('Solo puedes modificar elementos privados de tu negocio.', 404);
  return { success: true };
}

async function learnOrder(data, scope, db) {
  const type = await addEntry('tipos', { nombre: data.deviceType }, scope, db);
  // Parents have already been resolved in this tenant and transaction. Reuse them
  // instead of fetching the same type/brand again for every selected tag.
  const brand = await addEntry('marcas', { nombre: data.brand, parent_id: type.id }, scope, db, type);
  await addEntry('modelos', { nombre: data.model, parent_id: brand.id }, scope, db, brand);
  for (const name of data.fallas || []) await addEntry('fallas', { nombre: name, parent_id: type.id }, scope, db, type);
  for (const name of data.reparaciones || []) await addEntry('reparaciones', { nombre: name, parent_id: type.id }, scope, db, type);
  // Never infer a many-to-many repair diagnosis from merely co-occurring tags.
}
module.exports = { scopeForUser, getCatalog, getModels, addEntry, linkRepair, deactivate, learnOrder };
