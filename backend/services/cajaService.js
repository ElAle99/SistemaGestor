const { pool } = require('../config/db');

const CASH_METHOD = 'efectivo';
const PAYMENT_METHODS = new Set(['efectivo', 'transferencia', 'tarjeta']);
const OUTGOING_TYPES = new Set(['salida_manual', 'devolucion']);
const PRODUCT_TYPES = new Set(['venta_pos']);
const REPAIR_TYPES = new Set(['cobro_orden', 'liquidacion']);
const ADVANCE_TYPES = new Set(['anticipo']);
const PAYMENT_TYPES = new Set(['abono']);
const MANUAL_IN_TYPES = new Set(['entrada_manual']);
const MANUAL_OUT_TYPES = new Set(['salida_manual']);
const CASH_IN_TYPES = new Set([
  'venta_pos',
  'cobro_orden',
  'anticipo',
  'abono',
  'liquidacion',
  'entrada_manual'
]);

function normalizeMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Number((normalizeMoney(value)).toFixed(2));
}

function normalizePaymentMethod(value = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalized.includes('transfer')) return 'transferencia';
  if (normalized.includes('tarjeta') || normalized.includes('bancaria')) return 'tarjeta';
  return 'efectivo';
}

function normalizeMovementType(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function assertPositiveAmount(monto) {
  const amount = roundMoney(monto);
  if (amount <= 0) {
    const err = new Error('El monto debe ser mayor a cero.');
    err.statusCode = 400;
    throw err;
  }
  return amount;
}

function assertNonNegativeAmount(monto, label = 'El monto') {
  const amount = roundMoney(monto);
  if (amount < 0) {
    const err = new Error(`${label} no puede ser negativo.`);
    err.statusCode = 400;
    throw err;
  }
  return amount;
}

async function getActiveCaja(db = pool, options = {}) {
  const lockClause = options.lock ? 'FOR UPDATE OF c' : '';
  const result = await db.query(
    `SELECT c.*, u.nombre as usuario_nombre
     FROM cajas c
     LEFT JOIN usuarios u ON u.id = c.usuario_id
     WHERE c.estado = 'abierta'
     ORDER BY c.fecha_apertura DESC
     LIMIT 1
     ${lockClause}`
  );
  return result.rows[0] || null;
}

async function getMovimientos(cajaId, db = pool) {
  const result = await db.query(
    `SELECT cm.*, u.nombre as usuario_nombre
     FROM caja_movimientos cm
     LEFT JOIN usuarios u ON u.id = cm.usuario_id
     WHERE cm.caja_id = $1
     ORDER BY cm.created_at ASC, cm.id ASC`,
    [cajaId]
  );
  return result.rows.map(formatMovimiento);
}

function formatCaja(row) {
  if (!row) return null;
  return {
    ...row,
    monto_inicial: roundMoney(row.monto_inicial),
    total_esperado: roundMoney(row.total_esperado),
    monto_contado: row.monto_contado === null || row.monto_contado === undefined ? null : roundMoney(row.monto_contado),
    diferencia: row.diferencia === null || row.diferencia === undefined ? null : roundMoney(row.diferencia)
  };
}

function formatMovimiento(row) {
  return {
    ...row,
    monto: roundMoney(row.monto),
    metodo_pago: normalizePaymentMethod(row.metodo_pago),
    tipo_movimiento: normalizeMovementType(row.tipo_movimiento)
  };
}

function createEmptySummary(caja = null) {
  const fondoInicial = roundMoney(caja?.monto_inicial || 0);
  return {
    fondo_inicial: fondoInicial,
    ventas_pos_efectivo: 0,
    cobros_reparaciones_efectivo: 0,
    anticipos: 0,
    abonos: 0,
    entradas_manuales: 0,
    salidas_manuales: 0,
    transferencias: 0,
    tarjeta: 0,
    total_ingresos: 0,
    total_salidas: 0,
    total_esperado: fondoInicial
  };
}

function buildSummary(caja, movimientos = []) {
  const summary = createEmptySummary(caja);

  movimientos.forEach(movement => {
    const type = normalizeMovementType(movement.tipo_movimiento);
    const method = normalizePaymentMethod(movement.metodo_pago);
    const amount = roundMoney(movement.monto);
    if (type === 'apertura') return;

    if (method === 'transferencia' && !OUTGOING_TYPES.has(type)) {
      summary.transferencias += amount;
      return;
    }
    if (method === 'tarjeta' && !OUTGOING_TYPES.has(type)) {
      summary.tarjeta += amount;
      return;
    }
    if (method !== CASH_METHOD) return;

    if (PRODUCT_TYPES.has(type)) summary.ventas_pos_efectivo += amount;
    if (REPAIR_TYPES.has(type)) summary.cobros_reparaciones_efectivo += amount;
    if (ADVANCE_TYPES.has(type)) summary.anticipos += amount;
    if (PAYMENT_TYPES.has(type)) summary.abonos += amount;
    if (MANUAL_IN_TYPES.has(type)) summary.entradas_manuales += amount;
    if (MANUAL_OUT_TYPES.has(type)) summary.salidas_manuales += amount;

    if (CASH_IN_TYPES.has(type)) summary.total_ingresos += amount;
    if (OUTGOING_TYPES.has(type)) summary.total_salidas += amount;
  });

  Object.keys(summary).forEach(key => {
    summary[key] = roundMoney(summary[key]);
  });
  summary.total_esperado = roundMoney(summary.fondo_inicial + summary.total_ingresos - summary.total_salidas);
  return summary;
}

function getResultado(diferencia) {
  const diff = roundMoney(diferencia);
  if (diff > 0) return 'sobrante';
  if (diff < 0) return 'faltante';
  return 'exacto';
}

async function getCajaConDetalle(cajaId, db = pool) {
  const cajaResult = await db.query(
    `SELECT c.*, u.nombre as usuario_nombre
     FROM cajas c
     LEFT JOIN usuarios u ON u.id = c.usuario_id
     WHERE c.id = $1`,
    [cajaId]
  );
  const caja = formatCaja(cajaResult.rows[0]);
  if (!caja) return null;
  const movimientos = await getMovimientos(caja.id, db);
  const resumen = buildSummary(caja, movimientos);
  const diferencia = caja.monto_contado === null ? null : roundMoney(caja.monto_contado - resumen.total_esperado);
  return {
    ...caja,
    total_esperado: caja.estado === 'cerrada' ? roundMoney(caja.total_esperado ?? resumen.total_esperado) : resumen.total_esperado,
    diferencia: caja.estado === 'cerrada' && caja.diferencia !== null ? caja.diferencia : diferencia,
    resultado: caja.estado === 'cerrada' ? getResultado(caja.diferencia ?? diferencia ?? 0) : 'abierta',
    resumen,
    movimientos
  };
}

async function getCajaActiva() {
  const caja = await getActiveCaja();
  if (!caja) return null;
  return getCajaConDetalle(caja.id);
}

async function openCaja({ usuario_id, monto_inicial }) {
  const amount = assertNonNegativeAmount(monto_inicial, 'El monto inicial');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const active = await getActiveCaja(client, { lock: true });
    if (active) {
      await client.query('COMMIT');
      const detalle = await getCajaConDetalle(active.id);
      return { alreadyOpen: true, caja: detalle };
    }

    const result = await client.query(
      `INSERT INTO cajas (usuario_id, monto_inicial, total_esperado, estado)
       VALUES ($1, $2, $2, 'abierta')
       RETURNING *`,
      [usuario_id, amount]
    );
    const caja = result.rows[0];
    await client.query(
      `INSERT INTO caja_movimientos
       (caja_id, usuario_id, tipo_movimiento, metodo_pago, monto, descripcion, referencia_tipo, referencia_id)
       VALUES ($1, $2, 'apertura', 'efectivo', $3, $4, 'caja', $1)`,
      [caja.id, usuario_id, amount, 'Fondo inicial de apertura de caja']
    );
    await client.query('COMMIT');
    return { alreadyOpen: false, caja: await getCajaConDetalle(caja.id) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensurePaymentAllowed({ metodo_pago, monto }, db = pool) {
  const method = normalizePaymentMethod(metodo_pago);
  const amount = normalizeMoney(monto);
  if (amount <= 0 || method !== CASH_METHOD) return true;
  const active = await getActiveCaja(db);
  if (!active) {
    const err = new Error('No hay caja abierta. Abre caja antes de cobrar en efectivo.');
    err.statusCode = 400;
    throw err;
  }
  return true;
}

async function registerMovimiento(data = {}, options = {}) {
  const db = options.client || pool;
  const amount = assertPositiveAmount(data.monto);
  const method = normalizePaymentMethod(data.metodo_pago);
  const type = normalizeMovementType(data.tipo_movimiento);
  const active = await getActiveCaja(db, { lock: Boolean(options.lock) });

  if (!active) {
    if (method === CASH_METHOD) {
      const err = new Error('No hay caja abierta. Abre caja antes de registrar movimientos en efectivo.');
      err.statusCode = 400;
      throw err;
    }
    return null;
  }

  if (active.estado !== 'abierta') {
    const err = new Error('La caja ya esta cerrada.');
    err.statusCode = 400;
    throw err;
  }

  const result = await db.query(
    `INSERT INTO caja_movimientos
     (caja_id, usuario_id, tipo_movimiento, metodo_pago, monto, descripcion, referencia_tipo, referencia_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      active.id,
      data.usuario_id || active.usuario_id || null,
      type,
      method,
      amount,
      data.descripcion || null,
      data.referencia_tipo || null,
      data.referencia_id || null
    ]
  );

  return formatMovimiento(result.rows[0]);
}

async function registerManualMovimiento({ usuario_id, tipo_movimiento, monto, descripcion }) {
  const type = normalizeMovementType(tipo_movimiento);
  if (!['entrada_manual', 'salida_manual'].includes(type)) {
    const err = new Error('Tipo de movimiento manual invalido.');
    err.statusCode = 400;
    throw err;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await registerMovimiento({
      usuario_id,
      tipo_movimiento: type,
      metodo_pago: CASH_METHOD,
      monto,
      descripcion,
      referencia_tipo: 'manual'
    }, { client, lock: true });
    const active = await getActiveCaja(client);
    await client.query('COMMIT');
    return getCajaConDetalle(active.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function closeCaja({ usuario_id, monto_contado, observaciones }) {
  const counted = assertNonNegativeAmount(monto_contado, 'El dinero contado');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const active = await getActiveCaja(client, { lock: true });
    if (!active) {
      const err = new Error('No hay una caja abierta para cerrar.');
      err.statusCode = 400;
      throw err;
    }
    const movimientos = await getMovimientos(active.id, client);
    const resumen = buildSummary(active, movimientos);
    const diferencia = roundMoney(counted - resumen.total_esperado);

    await client.query(
      `UPDATE cajas
       SET fecha_cierre = CURRENT_TIMESTAMP,
           total_esperado = $1,
           monto_contado = $2,
           diferencia = $3,
           estado = 'cerrada',
           observaciones = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [resumen.total_esperado, counted, diferencia, observaciones || null, active.id]
    );
    await client.query('COMMIT');

    const detalle = await getCajaConDetalle(active.id);
    return {
      ...detalle,
      cerrado_por_usuario_id: usuario_id || null,
      resultado: getResultado(diferencia)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getHistorial() {
  const result = await pool.query(
    `SELECT c.*, u.nombre as usuario_nombre
     FROM cajas c
     LEFT JOIN usuarios u ON u.id = c.usuario_id
     ORDER BY COALESCE(c.fecha_cierre, c.fecha_apertura) DESC, c.id DESC`
  );

  const historial = [];
  for (const row of result.rows) {
    const detalle = await getCajaConDetalle(row.id);
    historial.push({
      id: detalle.id,
      usuario_id: detalle.usuario_id,
      usuario_nombre: detalle.usuario_nombre,
      fecha_apertura: detalle.fecha_apertura,
      fecha_cierre: detalle.fecha_cierre,
      monto_inicial: detalle.monto_inicial,
      total_ingresos: detalle.resumen.total_ingresos,
      total_salidas: detalle.resumen.total_salidas,
      total_esperado: detalle.total_esperado,
      monto_contado: detalle.monto_contado,
      diferencia: detalle.diferencia,
      estado: detalle.estado,
      resultado: detalle.resultado
    });
  }
  return historial;
}

module.exports = {
  normalizePaymentMethod,
  normalizeMovementType,
  ensurePaymentAllowed,
  registerMovimiento,
  registerManualMovimiento,
  openCaja,
  closeCaja,
  getCajaActiva,
  getCajaConDetalle,
  getHistorial,
  buildSummary
};
