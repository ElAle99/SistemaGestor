const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const valid = extra => ({ clientName: 'Juan Pérez', clientPhone: '9831909656',
  clientPhoneAlt1: '9831234567', deviceType: 'Celular', brand: 'Samsung', model: 'A55 5G',
  color: 'Azul', falla_reportada: 'No carga', servicio_solicitado: 'Cambio de centro de carga',
  costo_estimado: '1200', anticipo: '500', ...extra });

test('new customers without any phone save null contacts without matching other empty contacts', async () => {
  const h = harness({ duplicate: true });
  await h.createQuickOrder(valid({ clientPhone: '', clientPhoneAlt1: '', anticipo: 0 }), 7);
  const insert = h.calls.find(call => call.sql.includes('INSERT INTO clientes'));
  assert.equal(insert.params[1], null);
  assert.equal(insert.params[2], null);
  assert.ok(!h.calls.some(call => call.sql.includes('regexp_replace')));
  assert.ok(h.calls.some(call => call.sql === 'COMMIT'));
});

test('existing customer with no phone remains selectable', async () => {
  const h = harness({ existing: { id: 3, nombre: 'Juan Pérez', telefono_principal: null } });
  await h.createQuickOrder(valid({ clientId: 3, clientPhone: '', anticipo: 0 }), 7);
  assert.ok(!h.calls.some(call => call.sql.includes('INSERT INTO clientes')));
  assert.ok(h.calls.some(call => call.sql === 'COMMIT'));
});

function harness({ failAt, existing, duplicate = false, closedCash = false } = {}) {
  const calls = [];
  const movements = [];
  const customer = existing || { id: 3, nombre: 'Juan Pérez', telefono_principal: '9831909656' };
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (failAt && sql.includes(failAt)) throw new Error('database failure');
      if (sql.includes('SELECT * FROM clientes WHERE id')) return { rows: existing ? [existing] : [] };
      if (sql.includes('regexp_replace')) return { rows: duplicate ? [customer] : [] };
      if (sql.includes('INSERT INTO clientes')) return { rows: [customer] };
      if (sql.includes('allocate_order_folio')) return { rows: [{ folio: `AFB-${new Date().getFullYear()}-10043` }] };
      if (sql.includes('INSERT INTO ordenes_servicio')) return { rows: [{ id: 17 }] };
      if (sql.includes('INSERT INTO historial_estados')) return { rows: [{ id: 18 }] };
      return { rows: [] };
    }, release() { calls.push({ sql: 'RELEASE' }); }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/quickOrderService.js'), 'utf8'), {
    module, require(name) {
      if (name === './ordenService') {
        const evidenceModule = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/ordenService.js'), 'utf8'), {
          module: evidenceModule, require(dependency) {
            if (dependency === '../config/db') return { pool: { query: () => assert.fail('Evidence escaped the transaction') } };
            if (dependency === './cajaService' || dependency === './garantiaService') return {};
            throw new Error(dependency);
          }
        });
        return evidenceModule.exports;
      }
      if (name === '../config/db') return { pool: { connect: async () => { calls.push({ sql: 'CONNECT' }); return db; } } };
      if (name === './cajaService') return {
        ensurePaymentAllowed: async (payment, client) => {
          assert.equal(client, db);
          if (closedCash) throw Object.assign(new Error('Caja cerrada'), { statusCode: 400 });
        },
        registerMovimiento: async (payment, options) => {
          assert.equal(options.client, db);
          assert.equal(options.lock, true);
          movements.push(payment);
          if (failAt === 'payment') throw new Error('payment failure');
        }
      };
      throw new Error(name);
    }
  });
  return { ...module.exports, calls, movements };
}

test('quick reception commits customer, alternate phone, order, history, cash and audit using authenticated actor', async () => {
  const h = harness();
  const result = await h.createQuickOrder(valid({ usuario_creador_id: 999, status: 'Entregado', folio: 'fake' }), 7);
  assert.equal(result.folio, `AFB-${new Date().getFullYear()}-10043`);
  assert.equal(result.status, 'Recibido');
  const client = h.calls.find(c => c.sql.includes('INSERT INTO clientes'));
  assert.deepEqual(Array.from(client.params), ['Juan Pérez', '9831909656', '9831234567']);
  const order = h.calls.find(c => c.sql.includes('INSERT INTO ordenes_servicio'));
  assert.equal(order.params[2], 7);
  assert.equal(order.params[9], 1200);
  assert.equal(order.params[11], 500);
  assert.equal(h.movements[0].usuario_id, 7);
  assert.equal(h.movements[0].monto, 500);
  assert.equal(h.calls.find(c => c.sql.includes('INSERT INTO historial')).params[1], 7);
  assert.equal(h.calls.find(c => c.sql.includes('INSERT INTO auditoria')).params[1], 7);
  assert.equal(h.calls.at(-2).sql, 'COMMIT');
  assert.equal(h.calls.at(-1).sql, 'RELEASE');
});

for (const field of ['clientName', 'deviceType', 'brand', 'model', 'falla_reportada', 'servicio_solicitado']) {
  test(`rejects missing ${field} before touching the database`, async () => {
    const h = harness();
    await assert.rejects(h.createQuickOrder(valid({ [field]: ' ' }), 7), e => e.statusCode === 400);
    assert.equal(h.calls.length, 0);
  });
}

for (const extra of [
  { anticipo: 1201 }, { costo_estimado: null }, { anticipo: -1 }, { costo_estimado: -1 },
  { anticipo: 'Infinity' }, { costo_estimado: 'abc' }, { anticipo: true },
  { anticipo: '0.001' }, { costo_estimado: 100000000 }, { clientPhone: '---' }, { clientId: -1 }
]) {
  test(`rejects invalid input ${JSON.stringify(extra)} before writing`, async () => {
    const h = harness();
    await assert.rejects(h.createQuickOrder(valid(extra), 7), e => e.statusCode === 400);
    assert.equal(h.calls.length, 0);
  });
}

test('unknown budget stores null and pending status, empty advance becomes zero', async () => {
  const h = harness();
  await h.createQuickOrder(valid({ costo_estimado: '', anticipo: '', color: '', clientPhoneAlt1: '' }), 7);
  const order = h.calls.find(c => c.sql.includes('INSERT INTO ordenes_servicio'));
  assert.equal(order.params[9], null);
  assert.equal(order.params[11], 0);
  assert.equal(order.params[12], true);
  assert.equal(h.movements.length, 0);
});

test('explicit zero cost stays defined and a fully prepaid order is accepted', async () => {
  for (const amount of [0, 1200]) {
    const h = harness();
    await h.createQuickOrder(valid({ costo_estimado: amount, anticipo: amount }), 7);
    assert.equal(h.calls.find(c => c.sql.includes('INSERT INTO ordenes_servicio')).params[12], false);
  }
});

test('existing client keeps split surnames and advanced data', async () => {
  const h = harness({ existing: { id: 3, nombre: 'Juan', apellido_paterno: 'Pérez', telefono_principal: '9831909656', correo: 'kept@example.test' } });
  await h.createQuickOrder(valid({ clientId: 3 }), 7);
  assert.ok(!h.calls.some(c => c.sql.includes('INSERT INTO clientes')));
  const update = h.calls.find(c => c.sql.includes('UPDATE clientes'));
  assert.ok(!update.sql.includes('nombre ='));
  assert.ok(!update.sql.includes('correo ='));
});

for (const failAt of ['INSERT INTO clientes', 'INSERT INTO ordenes_servicio', 'INSERT INTO historial', 'payment', 'INSERT INTO auditoria']) {
  test(`rolls back the complete transaction when ${failAt} fails`, async () => {
    const h = harness({ failAt });
    await assert.rejects(h.createQuickOrder(valid(), 7));
    assert.ok(h.calls.some(c => c.sql === 'ROLLBACK'));
    assert.ok(!h.calls.some(c => c.sql === 'COMMIT'));
    assert.equal(h.calls.at(-1).sql, 'RELEASE');
  });
}

for (const options of [{ duplicate: true }, { closedCash: true }]) {
  test(`prevents orphan customers and orders: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    await assert.rejects(h.createQuickOrder(valid(), 7));
    assert.ok(!h.calls.some(c => c.sql.includes('INSERT INTO')));
    assert.ok(h.calls.some(c => c.sql === 'ROLLBACK'));
  });
}

test('deleted selected customer is rejected rather than recreated', async () => {
  const h = harness();
  await assert.rejects(h.createQuickOrder(valid({ clientId: 3 }), 7), /no está disponible/);
  assert.ok(!h.calls.some(c => c.sql.includes('INSERT INTO')));
});

test('multiple faults and repairs persist as readable legacy text without trusting forged text', async () => {
  const h = harness();
  await h.createQuickOrder(valid({ fallas: ['Pantalla rota', 'No carga', 'No carga'], reparaciones: ['Cambio de pantalla', 'Cambio centro de carga'], falla_reportada: 'forged' }), 7);
  const order = h.calls.find(c => c.sql.includes('INSERT INTO ordenes_servicio'));
  assert.equal(order.params[7], 'Pantalla rota\nNo carga');
  assert.equal(order.params[8], 'Cambio de pantalla\nCambio centro de carga');
});

for (const fallas of [[], [null], [''], Array(21).fill('No carga'), ['a'.repeat(251)]]) {
  test(`rejects malformed fault tags ${JSON.stringify(fallas).slice(0, 50)}`, async () => {
    const h = harness();
    await assert.rejects(h.createQuickOrder(valid({ fallas }), 7), e => e.statusCode === 400);
    assert.equal(h.calls.length, 0);
  });
}

for (const [lock_type, field, value, offset] of [
  ['PIN', 'lock_pin', '0012', 15], ['Contraseña', 'lock_pass', 'Clave con espacios', 16], ['Patrón', 'lock_pattern', '1-2-5-8', 17]
]) {
  test(`stores optional ${lock_type} in existing columns without logging the value`, async () => {
    const h = harness();
    await h.createQuickOrder(valid({ lock_type, [field]: value }), 7);
    const order = h.calls.find(c => c.sql.includes('INSERT INTO ordenes_servicio'));
    assert.equal(order.params[14], lock_type);
    assert.equal(order.params[offset], value);
    const audit = h.calls.find(c => c.sql.includes('INSERT INTO auditoria'));
    assert.ok(!audit.params[2].includes(value));
  });
}

test('blank optional access never blocks creation and ignores inactive secrets', async () => {
  for (const lock_type of ['Ninguno', 'PIN', 'Contraseña', 'Patrón']) {
    const h = harness();
    await h.createQuickOrder(valid({ lock_type }), 7);
    const params = h.calls.find(c => c.sql.includes('INSERT INTO ordenes_servicio')).params;
    assert.equal(params[14], 'Ninguno');
    assert.deepEqual(Array.from(params.slice(15)), [null, null, null]);
  }
  const h = harness();
  await h.createQuickOrder(valid({ lock_type: 'Ninguno', lock_pin: '0012', lock_pass: 'secret', lock_pattern: '1-2-5-8' }), 7);
  assert.deepEqual(Array.from(h.calls.find(c => c.sql.includes('INSERT INTO ordenes_servicio')).params.slice(15)), [null, null, null]);
});

test('photos reuse evidence helper with transaction, history, actor and private visibility', async () => {
  const h = harness();
  await h.createQuickOrder(valid({ evidenciasNuevas: ['data:image/png;base64,aGVsbG8=', 'data:image/jpeg;base64,aGVsbG8='] }), 7);
  const rows = h.calls.filter(c => c.sql.includes('INSERT INTO evidencias_orden'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].params[0], 17);
  assert.equal(rows[0].params[1], 18);
  assert.equal(rows[0].params[2], 7);
  assert.equal(rows[0].params[7], false);
  assert.ok(h.calls.some(c => c.sql === 'COMMIT'));
});

test('failed evidence insert rolls back the complete reception', async () => {
  const h = harness({ failAt: 'INSERT INTO evidencias_orden' });
  await assert.rejects(h.createQuickOrder(valid({ evidenciasNuevas: ['data:image/png;base64,aGVsbG8='] }), 7));
  assert.ok(h.calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!h.calls.some(c => c.sql === 'COMMIT'));
});

test('reception reuses legacy observation/accessory columns with complete custom text', async () => {
  const h = harness();
  await h.createQuickOrder(valid({ inspeccion_visual: ['Pantalla rota', 'Otro: Tapa despegada', 'Pantalla rota'],
    accesorios_entregados: ['Cargador', 'Cable', 'Otro: Adaptador USB-C'], nota_recepcion: 'Sin bandeja SIM.\nRevisar al entregar.' }), 7);
  const update = h.calls.find(call => call.sql.includes('SET otros_insp'));
  assert.equal(update.params[0], 'Inspección visual: Pantalla rota; Otro: Tapa despegada\n\nNota de recepción: Sin bandeja SIM.\nRevisar al entregar.');
  assert.equal(update.params[1], 'Cargador; Cable; Otro: Adaptador USB-C');
  assert.equal(update.params[2], 17);
  assert.ok(h.calls.some(call => call.sql === 'COMMIT'));
});

test('optional empty reception writes no extra observations', async () => {
  const h = harness();
  await h.createQuickOrder(valid({ inspeccion_visual: [], accesorios_entregados: [], nota_recepcion: '' }), 7);
  assert.ok(!h.calls.some(call => call.sql.includes('SET otros_insp')));
});

test('reception storage failure rolls back the whole order', async () => {
  const h = harness({ failAt: 'SET otros_insp' });
  await assert.rejects(h.createQuickOrder(valid({ nota_recepcion: 'Sin bandeja SIM' }), 7));
  assert.ok(h.calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!h.calls.some(call => call.sql === 'COMMIT'));
});

for (const extra of [{ inspeccion_visual: 'Pantalla rota' }, { accesorios_entregados: [null] },
  { inspeccion_visual: Array(21).fill('Rayones') }, { accesorios_entregados: ['a'.repeat(251)] },
  { nota_recepcion: {} }, { nota_recepcion: 'a'.repeat(2001) }]) {
  test(`rejects invalid reception ${JSON.stringify(extra).slice(0, 55)}`, async () => {
    const h = harness();
    await assert.rejects(h.createQuickOrder(valid(extra), 7), error => error.statusCode === 400);
    assert.equal(h.calls.length, 0);
  });
}

for (const extra of [
  { lock_type: 'invalid' }, { lock_type: 'PIN', lock_pin: '12x' }, { lock_type: 'Patrón', lock_pattern: '1-2-2' },
  { evidenciasNuevas: ['javascript:alert(1)'] }, { evidenciasNuevas: ['data:image/svg+xml;base64,aGVsbG8='] },
  { evidenciasNuevas: Array(13).fill('data:image/png;base64,aGVsbG8=') }
]) {
  test(`rejects malformed optional data ${JSON.stringify(extra).slice(0, 65)}`, async () => {
    const h = harness();
    await assert.rejects(h.createQuickOrder(valid(extra), 7), error => error.statusCode === 400);
    assert.equal(h.calls.length, 0);
  });
}
