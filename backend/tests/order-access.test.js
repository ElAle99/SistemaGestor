const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('general order list omits secrets while authenticated detail preserves them', async () => {
  const module = { exports: {} };
  const row = { id: 17, folio: 'AFB-2026-10043', estado: 'Recibido', clientname: 'Juan',
    lock_type: 'Patrón', lock_pin: '0012', lock_pass: 'private', lock_pattern: '1-2-5-8' };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/ordenService.js'), 'utf8'), {
    module, require(name) {
      if (name === '../config/db') return { pool: { query: async sql => ({ rows: sql.includes('SELECT o.*') ? [row] : [] }) } };
      if (name === './cajaService') return {};
      if (name === './garantiaService') return { getGarantiaByOrderId: async () => null };
      throw new Error(name);
    }
  });
  const [list] = await module.exports.getAllOrdenes();
  const detail = await module.exports.getOrdenById(17);
  for (const field of ['lock_pin', 'lock_pass', 'lock_pattern']) {
    assert.equal(Object.hasOwn(list, field), false);
    assert.equal(detail[field], row[field]);
  }
});

test('authenticated folio endpoint never serializes access credentials', async () => {
  const handlers = {};
  const router = Object.fromEntries(['get', 'post', 'put', 'delete', 'patch'].map(method => [method, (url, ...callbacks) => { handlers[`${method} ${url}`] = callbacks; }]));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../routes/ordenes.js'), 'utf8'), {
    module: { exports: {} }, console,
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === '../config/tenantContext') return require('../config/tenantContext');
      if (name === '../middleware/auth') return { authMiddleware() {}, adminOnly() {} };
      if (name === '../middleware/rateLimit') return { rateLimit: () => () => {} };
      if (name === '../config/db') return {pool:{query:async()=>({rows:[{data:{folio:'test',status:'Recibido'}}]})}};
      if (name === '../services/ordenService') return { getOrdenByFolio: async () => ({ folio: 'test', lock_pin: '0012', lock_pass: 'private', lock_pattern: '1-2-5-8' }) };
      return {};
    }
  });
  let body;
  await handlers['get /folio/:folio'].at(-1)({ params: { folio: 'test' } }, { json(value) { body = value; } });
  assert.equal(body.folio, 'test');
  for (const field of ['lock_pin', 'lock_pass', 'lock_pattern']) assert.equal(Object.hasOwn(body, field), false);
});
