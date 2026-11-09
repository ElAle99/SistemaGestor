const test = require('node:test');
const assert = require('node:assert/strict');

test('real Express serves frontend, bundles and protected APIs; health recovers after DB outage', async () => {
  // Isolated test process: never connect to the configured production database.
  process.env.PORT = '0';
  process.env.JWT_SECRET = 'http-fixture-only';
  process.env.DATABASE_URL = 'postgresql://sistema_gestor_app:fixture@localhost/fixture';
  delete process.env.ANDROID_OFFLINE_ENABLED;
  let unavailable = false;
  const dbPath = require.resolve('../config/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    initDB: async () => {},
    pool: { on() {}, end: async () => {}, query: async () => {
      if (unavailable) throw Object.assign(new Error('fixture-secret'), { code: 'ECONNRESET' });
      return { rows: [{ ok: 1, allowed: false }], rowCount: 1 };
    } }
  } };
  const { start } = require('../server');
  const server = await start();
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(origin); assert.equal(home.status, 200); assert.match(await home.text(), /<!doctype html/i);
    for (const file of ['/dist/order-catalog.js', '/dist/printer-service.js', '/dist/share-ticket.js', '/vendor/jsbarcode/JsBarcode.all.min.js']) {
      const response = await fetch(origin + file); assert.equal(response.status, 200, file);
      assert.match(response.headers.get('content-type'), /javascript/);
    }
    assert.equal((await fetch(origin + '/healthz')).status, 200);
    // Publishing the routes cannot enable offline implicitly or access new tables.
    for (const route of ['capabilities','orders','operations','session','refresh','logout']) {
      const response=await fetch(origin+'/api/android/'+route,{
        method:['capabilities','orders'].includes(route)?'GET':'POST',
        headers:{'Content-Type':'application/json'},
        ...(['capabilities','orders'].includes(route)?{}:{body:'{}'})
      });
      assert.equal(response.status,501,route+' must remain disabled by default');
    }
    for (const route of ['users', 'clientes', 'ordenes', 'inventario', 'pos/ventas', 'caja/activa', 'reportes/ingresos', 'configuracion/negocio', 'garantias', 'dashboard/stats']) {
      const response = await fetch(`${origin}/api/${route}`);
      assert.equal(response.status, 401, route);
    }
    const unknown = await fetch(origin + '/api/not-a-route'); assert.equal(unknown.status, 404); assert.match(unknown.headers.get('content-type'), /json/);
    assert.equal((await fetch(origin + '/uploads/private-fixture.png')).status, 401);
    unavailable = true;
    const health = await fetch(origin + '/healthz'); assert.equal(health.status, 503);
    assert.ok(!(await health.text()).includes('fixture-secret'));
    unavailable = false; assert.equal((await fetch(origin + '/healthz')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
