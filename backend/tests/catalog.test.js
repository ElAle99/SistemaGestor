const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const { initCatalog, key } = require('../db/initCatalog');

test('catalog migration and tenant isolation on embedded PostgreSQL', async t => {
  const pg = new PGlite();
  const db = {
    query: async (sql, params) => sql.includes('CREATE TABLE') ? (await pg.exec(sql), { rows: [] }) : pg.query(sql, params),
    release() {}
  };
  const pool = { ...db, connect: async () => db };
  const env = { CATALOGO_NEGOCIO_ID: '1' };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/catalogService.js'), 'utf8'), {
    module, process: { env }, require(name) {
      if (name === '../config/db') return { pool };
      if (name === '../db/initCatalog') return { key };
      throw new Error(name);
    }
  });
  const service = module.exports;
  try {
    await initCatalog(pool);
    const initial = await service.getCatalog(1);
    const phone = initial.tipos.find(row => row.nombre === 'Celular');
    const samsung = initial.marcas.find(row => row.nombre === 'Samsung' && row.tipo_equipo_id === phone.id);
    await t.test('seed includes requested types, complete fault lists and searchable A55', async () => {
      assert.equal(initial.tipos.length, 8);
      assert.equal(initial.fallas.filter(row => row.tipo_equipo_id === phone.id).length, 40);
      assert.ok(initial.relaciones.length > 100);
      assert.equal((await service.getModels(1, samsung.id, 'a55'))[0].nombre, 'Samsung Galaxy A55 5G');
    });
    await t.test('migration can run twice without changing catalog identities or counts', async () => {
      await initCatalog(pool);
      const again = await service.getCatalog(1);
      assert.deepEqual(again, initial);
    });
    await t.test('database tenant overrides installation scope and null tenant cannot write', () => {
      assert.equal(service.scopeForUser({ tiene_negocio: true, negocio_id: '2' }), 2);
      assert.equal(service.scopeForUser({ tiene_negocio: true, negocio_id: null }), null);
      assert.equal(service.scopeForUser({ tiene_negocio: false }), 1);
      env.CATALOGO_NEGOCIO_ID = '';
      assert.equal(service.scopeForUser({}), null);
      env.CATALOGO_NEGOCIO_ID = '1';
    });
    let customModel;
    await t.test('new model appears immediately, ignores submitted tenant and normalizes duplicates', async () => {
      customModel = await service.addEntry('modelos', { nombre: 'Red Magic 9 Pro', parent_id: samsung.id, negocio_id: 2 }, 1);
      assert.equal(Number(customModel.negocio_id), 1);
      const duplicate = await service.addEntry('modelos', { nombre: '  RED MAGIC 9 PRO ', parent_id: samsung.id }, 1);
      assert.equal(duplicate.id, customModel.id);
      assert.equal((await service.getModels(1, samsung.id, 'magic'))[0].id, customModel.id);
      assert.equal((await service.getModels(2, samsung.id, 'magic')).length, 0);
    });
    await t.test('global entries are reusable but cannot be deleted even by private administrators', async () => {
      assert.equal((await service.addEntry('marcas', { nombre: 'Samsung', parent_id: phone.id }, 1)).id, samsung.id);
      await assert.rejects(service.deactivate('marcas', samsung.id, 1), e => e.statusCode === 404);
      await assert.rejects(service.deactivate('modelos', customModel.id, 2), e => e.statusCode === 404);
    });
    await t.test('foreign parents cannot be enumerated, reused or linked', async () => {
      const privateType = await service.addEntry('tipos', { nombre: 'Equipo privado' }, 2);
      await assert.rejects(service.addEntry('marcas', { nombre: 'Secret', parent_id: privateType.id }, 1), e => e.statusCode === 404);
      const privateBrand = await service.addEntry('marcas', { nombre: 'Marca privada', parent_id: privateType.id }, 2);
      await assert.rejects(service.getModels(1, privateBrand.id, ''), e => e.statusCode === 404);
      const privateFault = await service.addEntry('fallas', { nombre: 'Falla privada', parent_id: phone.id }, 2);
      const repair = initial.reparaciones.find(row => row.tipo_equipo_id === phone.id);
      await assert.rejects(service.linkRepair({ falla_id: privateFault.id, reparacion_id: repair.id }, 1), e => e.statusCode === 404);
      assert.ok(!(await service.getCatalog(1)).tipos.some(row => row.id === privateType.id));
    });
    await t.test('repair links remain scoped and require the same equipment type', async () => {
      const fault = await service.addEntry('fallas', { nombre: 'Falla propia', parent_id: phone.id }, 1);
      const repair = await service.addEntry('reparaciones', { nombre: 'Reparación propia', parent_id: phone.id }, 1);
      await service.linkRepair({ falla_id: fault.id, reparacion_id: repair.id }, 1);
      assert.ok((await service.getCatalog(1)).relaciones.some(row => row.falla_id === fault.id));
      assert.ok(!(await service.getCatalog(2)).relaciones.some(row => row.falla_id === fault.id));
      const otherRepair = initial.reparaciones.find(row => row.tipo_equipo_id !== phone.id);
      await assert.rejects(service.linkRepair({ falla_id: fault.id, reparacion_id: otherRepair.id }, 1), /mismo equipo/);
    });
    await t.test('learning participates in caller transaction and rolls back all new values', async () => {
      await db.query('BEGIN');
      await service.learnOrder({ deviceType: 'Celular', brand: 'Samsung', model: 'Rollback model', fallas: ['Rollback fault'], reparaciones: ['Rollback repair'] }, 1, db);
      await db.query('ROLLBACK');
      assert.equal((await service.getModels(1, samsung.id, 'Rollback')).length, 0);
      assert.ok(!(await service.getCatalog(1)).fallas.some(row => row.nombre === 'Rollback fault'));
    });
    await t.test('deactivated parent hides descendants, without deleting historic strings', async () => {
      const brand = await service.addEntry('marcas', { nombre: 'Temporal', parent_id: phone.id }, 1);
      await service.addEntry('modelos', { nombre: 'Modelo temporal', parent_id: brand.id }, 1);
      await service.deactivate('marcas', brand.id, 1);
      await assert.rejects(service.getModels(1, brand.id), e => e.statusCode === 404);
    });
  } finally { await pg.close(); }
});
