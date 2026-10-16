const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ secret = 'test-only-secret', failDB = false, failWarranty = false, failTenant = false, env = {} } = {}) {
  const events = [];
  const app = { use() {}, options() {}, get() {}, listen() { events.push('listen'); return {}; } };
  const express = () => app;
  express.static = express.json = express.urlencoded = () => () => {};
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
    module, __dirname: path.join(__dirname, '..'), console: { log() {}, error() {} },
    process: { env: { JWT_SECRET: secret, ...env } }, URL,
    require(name) {
      if (name === 'express') return express;
      if (name === 'cors') return () => () => {};
      if (name === 'path') return path;
      if (name === './config/tenantContext') return { withSystemContext: callback => callback() };
      if (name === './db/initTenancy') return { initTenancy: async () => { events.push('tenancy'); if(failTenant) throw new Error('tenant migration failed'); } };
      if (name === './config/env' || name.startsWith('./routes/')) return {};
      if (name === './config/db') return {
        initDB: async () => { events.push('database'); if (failDB) throw new Error('database unavailable'); },
        pool: { end: async () => events.push('close') }
      };
      if (name === './services/garantiaService') return {
        initGarantiasDB: async () => { events.push('warranty'); if (failWarranty) throw new Error('warranty unavailable'); }
      };
      throw new Error(name);
    }
  });
  return { start: module.exports.start, events };
}

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
for (const options of [{ secret: '' }, { failDB: true }]) {
  test(`startup closes pool without accepting traffic on ${JSON.stringify(options)}`, async () => {
    const { start, events } = harness(options);
    await assert.rejects(start());
    assert.ok(!events.includes('listen'));
    assert.equal(events.at(-1), 'close');
  });
}
