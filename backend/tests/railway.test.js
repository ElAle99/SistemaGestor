const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { getPgPoolConfig } = require('../config/pgConfig');
const { retryStartup, safeCode, handlePoolErrors, installShutdown } = require('../config/dbLifecycle');

function configured(values, callback) {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (/^(DATABASE_URL|PG[A-Z_]+|DB_[A-Z_]+)$/.test(key)) delete process.env[key];
  Object.assign(process.env, values);
  try { return callback(); }
  finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
}
test('URL takes precedence and blank DB_SSL does not disable URL TLS verification', () => {
  configured({ DATABASE_URL: 'postgresql://sistema_gestor_app:fixture@localhost/railway?sslmode=require', PGUSER: 'postgres', DB_SSL: '' }, () => {
    const config = getPgPoolConfig();
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.ok(!config.connectionString.includes('sslmode'));
    assert.equal(config.keepAlive, true);
  });
});
test('private PG fields preserve restricted login; reject administrative and insecure TLS settings', () => {
  configured({ PGHOST: 'postgres.railway.internal', PGUSER: 'sistema_gestor_app', PGDATABASE: 'railway', PGPASSWORD: 'fixture', DB_SSL: 'false' }, () => {
    assert.equal(getPgPoolConfig().host, 'postgres.railway.internal');
    assert.equal(getPgPoolConfig().ssl, false);
    process.env.PGUSER = 'postgres'; assert.throws(getPgPoolConfig, /no administrativa/);
    process.env.PGUSER = 'sistema_gestor_app'; process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';
    assert.throws(getPgPoolConfig, /verificación/);
  });
});
test('startup retries only transient checks, with a finite limit and sanitized logs', async () => {
  let calls = 0; const logs = [];
  await assert.rejects(retryStartup(async () => { calls++; throw Object.assign(new Error('password-secret'), { code: 'ECONNRESET' }); }, { sleep: async () => {}, log: (...args) => logs.push(args.join(' ')) }));
  assert.equal(calls, 3); assert.ok(!logs.join().includes('password-secret'));
  calls = 0;
  await assert.rejects(retryStartup(async () => { calls++; throw Object.assign(new Error(), { code: '28P01' }); }, { log() {} }));
  assert.equal(calls, 1); assert.equal(safeCode(new Error('secret')), 'DB_UNAVAILABLE');
  calls = 0;
  await retryStartup(async () => { if (++calls === 1) throw Object.assign(new Error(), { code: '57P03' }); }, { sleep: async () => {}, log() {} });
  assert.equal(calls, 2);
});
test('idle pool errors have a listener and SIGTERM drains HTTP before closing PostgreSQL once', async () => {
  const pool = new EventEmitter(); handlePoolErrors(pool); assert.equal(pool.listenerCount('error'), 1);
  const signals = new EventEmitter(); const events = []; let complete;
  const done = new Promise(resolve => { complete = resolve; });
  installShutdown({ close(callback) { events.push('http'); queueMicrotask(callback); } }, { async end() { events.push('pool'); complete(); } }, { signalSource: signals });
  signals.emit('SIGTERM'); signals.emit('SIGINT'); await done;
  assert.deepEqual(events, ['http', 'pool']);
});
