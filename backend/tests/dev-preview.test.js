const test = require('node:test');
const assert = require('node:assert/strict');

test('development preview serves HTML but blocks health and APIs during a database outage', async () => {
  process.env.NODE_ENV = 'development';
  process.env.PORT = '0';
  process.env.JWT_SECRET = 'preview-fixture-only';
  process.argv.push('--dev-preview');
  let queries = 0;
  const dbPath = require.resolve('../config/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    initDB: async () => { throw new Error('Must not validate an unavailable database'); },
    pool: { on() {}, end: async () => {}, query: async () => {
      queries++;
      throw Object.assign(new Error('fixture-secret'), { code: 'ECONNRESET' });
    } }
  } };
  const { start } = require('../server');
  const server = await start();
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(server.address().address, '127.0.0.1');
    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<!doctype html/i);
    const before = queries;
    for (const route of ['/healthz', '/api/auth/login', '/api/clientes']) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 503);
      assert.ok(!(await response.text()).includes('fixture-secret'));
    }
    assert.equal(queries, before);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
