const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ secret = 'test-only-secret', failDB = false, failWarranty = false, failTenant = false, env = {}, argv = [], dbCode } = {}) {
  const events = [];
  const app = { set() {}, disable() {}, use() {}, options() {}, get() {}, listen(port, host, callback) { events.push('listen'); queueMicrotask(callback); return { once() {} }; } };
  const express = () => app;
  express.static = express.json = express.urlencoded = () => () => {};
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
    module, __dirname: path.join(__dirname, '..'), console: { log() {}, error() {} },
    process: { env: { JWT_SECRET: secret, ...env }, argv }, URL,
    require(name) {
      if (name === 'express') return express;
      if (name === 'cors') return () => () => {};
      if (name === 'path') return path;
      if (name === './config/dbLifecycle') return require('../config/dbLifecycle');
      if (name === './config/tenantContext') return { withSystemContext: callback => callback() };
      if (name === './db/initTenancy') return { initTenancy: async () => { events.push('tenancy'); if(failTenant) throw new Error('tenant migration failed'); } };
      if (name === './config/env' || name.startsWith('./routes/')) return {};
      if (name === './config/db') return {
        initDB: async () => { events.push('database'); if (failDB) throw Object.assign(new Error('database unavailable'), { code: dbCode }); },
        pool: { query: async () => ({rows:[{ok:1}]}), end: async () => events.push('close') }
      };
      if (name === './services/garantiaService') return {
        initGarantiasDB: async () => { events.push('warranty'); if (failWarranty) throw new Error('warranty unavailable'); }
      };
      throw new Error(name);
    }
  });
  return { start: module.exports.start, events };
}

test('preview cannot bypass production connectivity or development schema validation', async () => {
  const cases = [
    { env: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://app:fixture@localhost/db' }, dbCode: 'ECONNRESET' },
    { env: { NODE_ENV: 'development' } }
  ];
  for (const options of cases) {
    const { start, events } = harness({ ...options, failDB: true, argv: ['--dev-preview'] });
    await assert.rejects(start());
    assert.ok(!events.includes('listen'));
    assert.equal(events.at(-1), 'close');
  }
});

test('production fails clearly without a runtime URL or secret and never echoes a malformed URL', () => {
  assert.throws(() => harness({ env: { NODE_ENV: 'production' } }), /DATABASE_URL de runtime es obligatorio/);
  assert.throws(() => harness({ secret: '', env: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://app:test@localhost/db' } }), /JWT_SECRET es obligatorio/);
  assert.throws(() => harness({ env: { NODE_ENV: 'production', DATABASE_URL: 'private-password-invalid-url' } }), error => {
    assert.match(error.message, /no es una URL PostgreSQL válida/);
    assert.ok(!error.message.includes('private-password'));
    return true;
  });
});
test('startup validates runtime without running privileged migrations', async () => {
  const { start, events } = harness();
  await start();
  assert.deepEqual(events, ['database', 'listen']);
});
test('production also accepts complete PG fields for restricted private connectivity', async () => {
  const { start, events } = harness({ env: { NODE_ENV: 'production', PGHOST: 'postgres.railway.internal', PGPORT: '5432', PGUSER: 'sistema_gestor_app', PGPASSWORD: 'fixture', PGDATABASE: 'railway' } });
  await start(); assert.deepEqual(events, ['database', 'listen']);
});
for (const options of [{ secret: '' }, { failDB: true }]) {
  test(`startup closes pool without accepting traffic on ${JSON.stringify(options)}`, async () => {
    const { start, events } = harness(options);
    await assert.rejects(start());
    assert.ok(!events.includes('listen'));
    assert.equal(events.at(-1), 'close');
  });
}
