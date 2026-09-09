const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real modules with isolated database/HTTP boundaries, without a live database.
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const filename = path.join(__dirname, '..', file);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console: { log() {}, error() {} }, process,
    setInterval, clearInterval, URL, __dirname: path.dirname(filename),
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    }
  }, { filename });
  return module.exports;
}
function response() {
  return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, set(key, value) { this.headers[key] = value; } };
}
function routerMock() {
  const routes = {};
  const router = {};
  for (const method of ['get', 'post', 'put', 'delete', 'patch', 'use']) {
    router[method] = (url, ...handlers) => { routes[`${method} ${url}`] = handlers; };
  }
  return { routes, express: { Router: () => router } };
}
function saleHarness(stock = 5) {
  const calls = [];
  const movements = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id, stock')) return { rows: [{ id: 1, stock, nombre: 'Producto', precio: '10.00' }] };
      if (sql.includes('INSERT INTO ventas\n')) return { rows: [{ id: 7 }] };
      if (sql.startsWith('SELECT * FROM ventas')) return { rows: [{ id: 7, total: '20.00' }] };
      return { rows: [] };
    }, release() { calls.push({ sql: 'RELEASE' }); }
  };
  const service = load('services/ordenService.js', {
    '../config/db': { pool: { connect: async () => client } },
    './cajaService': { ensurePaymentAllowed: async () => {}, registerMovimiento: async value => movements.push(value) },
    './garantiaService': {}
  });
  return { service, calls, movements };
}
const sale = overrides => ({ metodo_pago: 'Tarjeta', usuario_id: 1,
  items: [{ producto_id: 1, cantidad: 2, precio_unitario: 10 }], ...overrides });

test('sale calculates totals from catalog and ignores forged totals', async () => {
  const { service, calls, movements } = saleHarness();
  await service.createVenta(sale({ total: 1, subtotal: 1, cambio: 999 }));
  const insert = calls.find(call => call.sql.includes('INSERT INTO ventas\n'));
  assert.equal(insert.params[1], 20);
  assert.equal(insert.params[3], 20);
  assert.equal(movements[0].monto, 20);
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
});

for (const [name, data, message] of [
  ['duplicate products exceeding stock', { items: [{ producto_id: 1, cantidad: 4 }, { producto_id: 1, cantidad: 4 }] }, /duplicado/],
  ['negative quantity', { items: [{ producto_id: 1, cantidad: -1 }] }, /invalida/],
  ['fractional quantity', { items: [{ producto_id: 1, cantidad: 1.5 }] }, /invalida/],
  ['insufficient stock', { items: [{ producto_id: 1, cantidad: 6 }] }, /Stock insuficiente/],
  ['forged price', { items: [{ producto_id: 1, cantidad: 1, precio_unitario: 0.01 }] }, /precio/],
  ['unknown payment method', { metodo_pago: 'Otro' }, /Metodo/],
  ['negative cash', { efectivo_recibido: -1 }, /Importe/],
  ['nonfinite payment', { transferencia_recibida: 'Infinity' }, /Importe/],
  ['excessive discount', { descuento: 21 }, /descuento/],
  ['insufficient cash', { metodo_pago: 'Efectivo', efectivo_recibido: 1 }, /menor/]
]) {
  test(`sale rolls back ${name}`, async () => {
    const { service, calls } = saleHarness();
    await assert.rejects(service.createVenta(sale(data)), message);
    assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
    assert.ok(!calls.some(call => call.sql === 'COMMIT'));
    assert.equal(calls.at(-1).sql, 'RELEASE');
  });
}

for (const [name, user, version, expected] of [
  ['disabled account', { activo: false, session_version: 0 }, 0, 401],
  ['deleted account', undefined, 0, 401],
  ['revoked token', { activo: true, session_version: 1 }, 0, 401],
  ['legacy token', { activo: true, session_version: 0 }, undefined, 401],
  ['current role from database', { id: 1, activo: true, rol: 'Recepcionista', session_version: 1 }, 1, 200]
]) {
  test(`authentication: ${name}`, async () => {
    const { authMiddleware } = load('middleware/auth.js', {
      jsonwebtoken: { verify: () => ({ id: 1, rol: 'Administrador', sessionVersion: version }) },
      '../config/db': { pool: { query: async () => ({ rows: user ? [user] : [] }) } }, '../config/env': {}
    });
    const req = { header: () => 'Bearer test' };
    const res = response();
    let next = false;
    await authMiddleware(req, res, () => { next = true; });
    assert.equal(res.statusCode, expected);
    assert.equal(next, expected === 200);
    if (next) assert.equal(req.user.rol, 'Recepcionista');
  });
}

test('rate limit cannot be bypassed with query strings', () => {
  const { rateLimit } = load('middleware/rateLimit.js');
  const limiter = rateLimit({ windowMs: 60000, max: 1, keyPrefix: 'test' });
  limiter({ method: 'POST', ip: '127.0.0.1', originalUrl: '/login?a=1' }, response(), () => {});
  const res = response();
  limiter({ method: 'POST', ip: '127.0.0.1', originalUrl: '/login?a=2' }, res, () => assert.fail('limit bypassed'));
  assert.equal(res.statusCode, 429);
  assert.ok(Number(res.headers['Retry-After']) > 0);
});

test('database outage does not masquerade as invalid credentials', async () => {
  const { authMiddleware } = load('middleware/auth.js', {
    jsonwebtoken: { verify: () => ({ id: 1, sessionVersion: 0 }) },
    '../config/db': { pool: { query: async () => { throw new Error('offline'); } } }, '../config/env': {}
  });
  const res = response();
  await authMiddleware({ header: () => 'Bearer test' }, res, () => assert.fail('authorized'));
  assert.equal(res.statusCode, 503);
});

test('invalid JWT is rejected before accessing the database', async () => {
  const { authMiddleware } = load('middleware/auth.js', {
    jsonwebtoken: { verify: () => { const error = new Error('invalid'); error.name = 'JsonWebTokenError'; throw error; } },
    '../config/db': { pool: { query: async () => assert.fail('database accessed') } }, '../config/env': {}
  });
  const res = response();
  await authMiddleware({ header: () => 'Bearer bad' }, res, () => assert.fail('authorized'));
  assert.equal(res.statusCode, 401);
});

for (const endpoint of ['/create-admin', '/admin', '/register-user']) {
  test(`public ${endpoint} rejects an administrator when registration is enabled`, async () => {
    const { routes, express } = routerMock();
    const client = { query: async sql => ({ rows: sql.includes('SELECT EXISTS') ? [{ exists: true }] : [] }), release() {} };
    load('routes/setup.js', {
      express, '../config/db': { pool: { connect: async () => client } },
      '../middleware/rateLimit': { rateLimit: () => (_req, _res, next) => next() },
      '../services/systemConfigService': { isUserCreationAllowed: async () => true },
      '../services/userService': { VALID_ROLES: ['Administrador', 'Recepcionista'], createUser: async () => assert.fail('created privileged account') }
    });
    const res = response();
    await routes[`post ${endpoint}`].at(-1)({ body: { rol: 'Administrador' } }, res);
    assert.equal(res.statusCode, 403);
  });
}

test('legacy sales route delegates to the same validated service and uses authenticated user', async () => {
  const { routes, express } = routerMock();
  let payload;
  load('routes/ventas.js', { express, '../config/db': { pool: {} },
    '../middleware/auth': { authMiddleware() {} },
    '../services/ordenService': { createVenta: async data => { payload = data; return { id: 7 }; } }
  });
  const res = response();
  await routes['post /'].at(-1)({ body: sale({ usuario_id: 999 }), user: { id: 1 } }, res);
  assert.equal(payload.usuario_id, 1);
  assert.equal(res.statusCode, 201);
});
