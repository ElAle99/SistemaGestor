const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const WARRANTY_FINAL_STATES = ['Garantía aplicada', 'Rechazada'];
const REJECTION_REASONS = [
  'Golpe o daño físico posterior',
  'Humedad',
  'Manipulación por terceros',
  'Falla diferente a la reparación realizada',
  'Garantía vencida',
  'Otro'
];

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeDateOnly(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function addDays(dateValue, daysValue) {
  const days = parseInt(daysValue, 10) || 0;
  const date = new Date(`${normalizeDateOnly(dateValue)}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseId(value) {
  const id = parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function computedState(row = {}) {
  if (WARRANTY_FINAL_STATES.includes(row.estado) || row.estado === 'En revisión') return row.estado;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expires = new Date(`${normalizeDateOnly(row.fecha_vencimiento)}T00:00:00`);
  const diff = Math.ceil((expires - today) / 86400000);
  if (diff < 0) return 'Vencida';
  if (diff <= 7) return 'Próxima a vencer';
  return 'Vigente';
}

function formatGarantia(row = {}) {
  if (!row) return null;
  const diasRestantes = row.dias_restantes !== undefined && row.dias_restantes !== null
    ? Number(row.dias_restantes)
    : Math.ceil((new Date(`${normalizeDateOnly(row.fecha_vencimiento)}T00:00:00`) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
  const estadoGarantia = row.estado_garantia || computedState(row);
  return {
    id: row.id,
    orden_id: row.orden_id,
    folio_orden: row.folio_orden || row.folio,
    folio: row.folio_orden || row.folio,
    cliente_id: row.cliente_id,
    cliente: row.cliente || row.clientname || 'Cliente sin nombre',
    telefono: row.telefono || row.clientphone || '',
    equipo: row.equipo || row.tipo_equipo || '',
    marca: row.marca || '',
    modelo: row.modelo || '',
    reparacion_realizada: row.reparacion_realizada || row.servicio_cubierto || '',
    servicio_cubierto: row.servicio_cubierto || '',
    condiciones: row.condiciones || '',
    observaciones: row.observaciones || '',
    duracion_dias: Number(row.duracion_dias || 0),
    fecha_inicio: row.fecha_inicio ? normalizeDateOnly(row.fecha_inicio) : '',
    fecha_vencimiento: row.fecha_vencimiento ? normalizeDateOnly(row.fecha_vencimiento) : '',
    fecha_entrega_original: row.fecha_entrega_original,
    dias_restantes: diasRestantes,
    estado: row.estado || 'Vigente',
    estado_garantia: estadoGarantia,
    activo: row.activo !== false,
    ingresos_count: Number(row.ingresos_count || 0),
    costo_total: Number(row.costo_total || 0),
    fecha_creacion: row.fecha_creacion,
    fecha_actualizacion: row.fecha_actualizacion
  };
}

function warrantySelect() {
  return `
    SELECT *
    FROM (
      SELECT
        g.*,
        o.folio AS folio_orden,
        o.tipo_equipo AS equipo,
        o.marca,
        o.modelo,
        o.servicio_solicitado AS reparacion_realizada,
        c.nombre AS cliente,
        c.telefono_principal AS telefono,
        COALESCE(ing.ingresos_count, 0) AS ingresos_count,
        COALESCE(costos.costo_total, 0) AS costo_total,
        (g.fecha_vencimiento - CURRENT_DATE) AS dias_restantes,
        CASE
          WHEN g.estado IN ('En revisión', 'Garantía aplicada', 'Rechazada') THEN g.estado
          WHEN g.fecha_vencimiento < CURRENT_DATE THEN 'Vencida'
          WHEN g.fecha_vencimiento <= CURRENT_DATE + INTERVAL '7 days' THEN 'Próxima a vencer'
          ELSE 'Vigente'
        END AS estado_garantia
      FROM garantias g
      JOIN ordenes_servicio o ON o.id = g.orden_id
      LEFT JOIN clientes c ON c.id = g.cliente_id
      LEFT JOIN (
        SELECT garantia_id, COUNT(*) AS ingresos_count
        FROM ingresos_garantia
        GROUP BY garantia_id
      ) ing ON ing.garantia_id = g.id
      LEFT JOIN (
        SELECT garantia_id, COALESCE(SUM(subtotal), 0) AS costo_total
        FROM costos_garantia
        GROUP BY garantia_id
      ) costos ON costos.garantia_id = g.id
    ) garantia_base
  `;
}

async function initGarantiasDB() {
  const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '20260718_garantias.sql');
  await pool.query(fs.readFileSync(migrationPath, 'utf8'));
}

async function addGarantiaHistory(db, garantiaId, ingresoId, usuarioId, evento, comentario, estadoAnterior = null, estadoNuevo = null, metadata = {}) {
  await db.query(
    `INSERT INTO historial_garantias
     (garantia_id, ingreso_garantia_id, usuario_id, evento, estado_anterior, estado_nuevo, comentario, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [garantiaId, ingresoId || null, usuarioId || null, evento, estadoAnterior, estadoNuevo, comentario || null, JSON.stringify(metadata || {})]
  );
}

async function addOrderHistory(db, ordenId, usuarioId, estado, comentario) {
  await db.query(
    'INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario) VALUES ($1, $2, $3, $4)',
    [ordenId, estado || 'Entregado', usuarioId || 1, comentario]
  );
}

async function getOrderForWarranty(ordenId, db = pool) {
  const res = await db.query(
    `SELECT o.*, c.id AS current_cliente_id
     FROM ordenes_servicio o
     JOIN clientes c ON c.id = o.cliente_id
     WHERE o.id = $1`,
    [ordenId]
  );
  return res.rows[0] || null;
}

async function createOrUpdateGarantiaFromOrder(ordenId, payload = {}, usuarioId = 1, db = pool) {
  const garantiaData = payload.garantia || payload.warranty || {};
  const tieneGarantia = Boolean(garantiaData.tiene_garantia || garantiaData.tieneGarantia);
  const existingRes = await db.query('SELECT * FROM garantias WHERE orden_id = $1', [ordenId]);
  const existing = existingRes.rows[0] || null;

  if (!tieneGarantia) {
    if (existing && existing.activo) {
      await db.query(
        'UPDATE garantias SET activo = false, actualizado_por = $1, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = $2',
        [usuarioId, existing.id]
      );
      await addGarantiaHistory(db, existing.id, null, usuarioId, 'Garantía desactivada', 'La garantía fue marcada como no aplicable desde la orden.', existing.estado, existing.estado);
    }
    return null;
  }

  const order = await getOrderForWarranty(ordenId, db);
  if (!order) {
    const err = new Error('Orden no encontrada para garantía.');
    err.statusCode = 404;
    throw err;
  }
  if (order.estado !== 'Entregado') {
    const err = new Error('La garantía solo puede registrarse cuando la orden está Entregada.');
    err.statusCode = 400;
    throw err;
  }

  const duracionDias = parseInt(garantiaData.duracion_dias || garantiaData.duracionDias, 10);
  if (!Number.isFinite(duracionDias) || duracionDias <= 0) {
    const err = new Error('La duración de garantía debe ser mayor a 0 días.');
    err.statusCode = 400;
    throw err;
  }

  const fechaInicio = normalizeDateOnly(garantiaData.fecha_inicio || garantiaData.fechaInicio || order.fecha_entrega_real || new Date());
  const fechaVencimiento = addDays(fechaInicio, duracionDias);
  const servicioCubierto = normalizeText(garantiaData.servicio_cubierto || garantiaData.servicioCubierto || order.servicio_solicitado || order.falla_reportada);
  if (!servicioCubierto) {
    const err = new Error('Debes indicar el servicio o reparación cubierta por la garantía.');
    err.statusCode = 400;
    throw err;
  }

  const values = [
    ordenId,
    order.cliente_id,
    servicioCubierto,
    normalizeText(garantiaData.condiciones),
    normalizeText(garantiaData.observaciones),
    duracionDias,
    fechaInicio,
    fechaVencimiento,
    order.fecha_entrega_real || new Date(),
    usuarioId
  ];

  const result = await db.query(
    `INSERT INTO garantias
     (orden_id, cliente_id, servicio_cubierto, condiciones, observaciones, duracion_dias,
      fecha_inicio, fecha_vencimiento, fecha_entrega_original, creado_por, actualizado_por, activo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, true)
     ON CONFLICT (orden_id) DO UPDATE SET
       cliente_id = EXCLUDED.cliente_id,
       servicio_cubierto = EXCLUDED.servicio_cubierto,
       condiciones = EXCLUDED.condiciones,
       observaciones = EXCLUDED.observaciones,
       duracion_dias = EXCLUDED.duracion_dias,
       fecha_inicio = EXCLUDED.fecha_inicio,
       fecha_vencimiento = EXCLUDED.fecha_vencimiento,
       fecha_entrega_original = COALESCE(garantias.fecha_entrega_original, EXCLUDED.fecha_entrega_original),
       actualizado_por = EXCLUDED.actualizado_por,
       activo = true,
       estado = CASE WHEN garantias.estado = 'Rechazada' THEN garantias.estado ELSE 'Vigente' END,
       fecha_actualizacion = CURRENT_TIMESTAMP
     RETURNING *`,
    values
  );

  const garantia = result.rows[0];
  await addGarantiaHistory(
    db,
    garantia.id,
    null,
    usuarioId,
    existing ? 'Garantía actualizada' : 'Garantía creada',
    `Garantía registrada para la orden ${order.folio}. Vigencia: ${fechaInicio} a ${fechaVencimiento}.`,
    existing?.estado || null,
    garantia.estado,
    { orden_id: ordenId, folio: order.folio, duracion_dias: duracionDias }
  );
  await addOrderHistory(
    db,
    ordenId,
    usuarioId,
    order.estado,
    `Garantía ${existing ? 'actualizada' : 'registrada'}: ${duracionDias} días para "${servicioCubierto}". Vence ${fechaVencimiento}.`
  );

  return formatGarantia({ ...garantia, folio_orden: order.folio, equipo: order.tipo_equipo, marca: order.marca, modelo: order.modelo });
}

async function getGarantiaByOrderId(ordenId) {
  const res = await pool.query(`${warrantySelect()} WHERE orden_id = $1 LIMIT 1`, [ordenId]);
  return res.rows[0] ? formatGarantia(res.rows[0]) : null;
}

async function getGarantias(filters = {}) {
  const where = ['activo = true'];
  const params = [];
  let idx = 1;

  const search = normalizeText(filters.search || filters.q);
  if (search) {
    where.push(`(
      folio_orden ILIKE $${idx} OR cliente ILIKE $${idx} OR telefono ILIKE $${idx}
      OR marca ILIKE $${idx} OR modelo ILIKE $${idx} OR servicio_cubierto ILIKE $${idx}
    )`);
    params.push(`%${search}%`);
    idx += 1;
  }
  ['folio', 'cliente', 'telefono', 'marca', 'modelo'].forEach(key => {
    if (filters[key]) {
      const column = key === 'folio' ? 'folio_orden' : key;
      where.push(`${column} ILIKE $${idx++}`);
      params.push(`%${filters[key]}%`);
    }
  });
  if (filters.estado) {
    where.push(`estado_garantia = $${idx++}`);
    params.push(filters.estado);
  }
  if (filters.fecha_desde) {
    where.push(`fecha_inicio >= $${idx++}`);
    params.push(filters.fecha_desde);
  }
  if (filters.fecha_hasta) {
    where.push(`fecha_inicio <= $${idx++}`);
    params.push(filters.fecha_hasta);
  }

  const res = await pool.query(
    `${warrantySelect()} WHERE ${where.join(' AND ')} ORDER BY fecha_vencimiento ASC, id DESC`,
    params
  );
  return res.rows.map(formatGarantia);
}

async function getGarantiaById(id) {
  const res = await pool.query(`${warrantySelect()} WHERE id = $1 LIMIT 1`, [id]);
  if (res.rows.length === 0) return null;
  const garantia = formatGarantia(res.rows[0]);

  const ingresos = await pool.query(
    `SELECT ig.*, u.nombre AS tecnico_nombre
     FROM ingresos_garantia ig
     LEFT JOIN usuarios u ON u.id = ig.tecnico_responsable_id
     WHERE ig.garantia_id = $1
     ORDER BY ig.fecha_ingreso DESC, ig.id DESC`,
    [id]
  );
  const historial = await pool.query(
    `SELECT hg.*, u.nombre AS usuario_nombre
     FROM historial_garantias hg
     LEFT JOIN usuarios u ON u.id = hg.usuario_id
     WHERE hg.garantia_id = $1
     ORDER BY hg.fecha ASC, hg.id ASC`,
    [id]
  );
  const fotos = await pool.query(
    `SELECT fg.*, u.nombre AS usuario_nombre
     FROM fotos_garantia fg
     LEFT JOIN usuarios u ON u.id = fg.usuario_id
     WHERE fg.garantia_id = $1
     ORDER BY fg.fecha_subida DESC, fg.id DESC`,
    [id]
  );
  const costos = await pool.query(
    `SELECT cg.*, i.nombre AS producto_nombre, i.codigo, i.codigo_barras
     FROM costos_garantia cg
     LEFT JOIN inventario i ON i.id = cg.producto_id
     WHERE cg.garantia_id = $1
     ORDER BY cg.fecha_creacion DESC, cg.id DESC`,
    [id]
  );

  garantia.ingresos = ingresos.rows.map(row => ({
    ...row,
    tecnico_responsable: row.tecnico_nombre,
    fecha_ingreso: normalizeDateOnly(row.fecha_ingreso)
  }));
  garantia.historial = historial.rows;
  garantia.fotos = fotos.rows;
  garantia.costos = costos.rows.map(row => ({
    ...row,
    cantidad: Number(row.cantidad || 0),
    costo_unitario: Number(row.costo_unitario || 0),
    subtotal: Number(row.subtotal || 0)
  }));
  garantia.costo_total = garantia.costos.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  return garantia;
}

async function getGarantiaByFolio(folio) {
  const res = await pool.query(`${warrantySelect()} WHERE UPPER(TRIM(folio_orden)) = UPPER(TRIM($1)) LIMIT 1`, [folio]);
  return res.rows[0] ? getGarantiaById(res.rows[0].id) : null;
}

async function createGarantia(data, usuarioId) {
  const ordenId = parseId(data.orden_id || data.orderId);
  if (!ordenId) {
    const err = new Error('Orden requerida para crear garantía.');
    err.statusCode = 400;
    throw err;
  }
  return createOrUpdateGarantiaFromOrder(ordenId, { garantia: { ...data, tiene_garantia: true } }, usuarioId);
}

async function updateGarantia(id, data, usuarioId) {
  const current = await pool.query('SELECT * FROM garantias WHERE id = $1', [id]);
  if (current.rows.length === 0) return null;
  const garantia = current.rows[0];
  const next = {
    garantia: {
      tiene_garantia: data.tiene_garantia !== false,
      duracion_dias: data.duracion_dias ?? garantia.duracion_dias,
      fecha_inicio: data.fecha_inicio ?? garantia.fecha_inicio,
      servicio_cubierto: data.servicio_cubierto ?? garantia.servicio_cubierto,
      condiciones: data.condiciones ?? garantia.condiciones,
      observaciones: data.observaciones ?? garantia.observaciones
    }
  };
  await createOrUpdateGarantiaFromOrder(garantia.orden_id, next, usuarioId);
  return getGarantiaById(id);
}

async function registrarIngreso(garantiaId, data, usuarioId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const garantiaRes = await client.query('SELECT * FROM garantias WHERE id = $1 AND activo = true FOR UPDATE', [garantiaId]);
    if (garantiaRes.rows.length === 0) {
      const err = new Error('Garantía no encontrada.');
      err.statusCode = 404;
      throw err;
    }
    const garantia = garantiaRes.rows[0];
    const estadoActual = computedState(garantia);
    if (estadoActual === 'Vencida' || WARRANTY_FINAL_STATES.includes(estadoActual)) {
      const err = new Error(`No se puede registrar reingreso porque la garantía está ${estadoActual}.`);
      err.statusCode = 400;
      throw err;
    }
    const fallaReportada = normalizeText(data.falla_reportada || data.fallaReportada);
    if (!fallaReportada) {
      const err = new Error('La falla reportada por el cliente es obligatoria.');
      err.statusCode = 400;
      throw err;
    }

    const ingresoRes = await client.query(
      `INSERT INTO ingresos_garantia
       (garantia_id, orden_id, fecha_ingreso, falla_reportada, diagnostico_tecnico,
        accesorios_recibidos, observaciones, tecnico_responsable_id, creado_por, actualizado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [
        garantiaId,
        garantia.orden_id,
        data.fecha_ingreso || new Date().toISOString().slice(0, 10),
        fallaReportada,
        normalizeText(data.diagnostico_tecnico || data.diagnosticoTecnico),
        normalizeText(data.accesorios_recibidos || data.accesoriosRecibidos),
        normalizeText(data.observaciones),
        parseId(data.tecnico_responsable_id || data.tecnicoResponsableId),
        usuarioId
      ]
    );
    const ingreso = ingresoRes.rows[0];
    const estadoAnterior = garantia.estado;
    await client.query(
      `UPDATE garantias
       SET estado = 'En revisión', actualizado_por = $1, fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [usuarioId, garantiaId]
    );
    await addGarantiaHistory(client, garantiaId, ingreso.id, usuarioId, 'Reingreso registrado', fallaReportada, estadoAnterior, 'En revisión');
    await addOrderHistory(client, garantia.orden_id, usuarioId, 'Entregado', `Reingreso por garantía registrado. Falla: ${fallaReportada}`);
    await client.query('COMMIT');
    return getGarantiaById(garantiaId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function validarIngreso(ingresoId, data, usuarioId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ingresoRes = await client.query(
      `SELECT ig.*, g.estado AS garantia_estado
       FROM ingresos_garantia ig
       JOIN garantias g ON g.id = ig.garantia_id
       WHERE ig.id = $1 FOR UPDATE`,
      [ingresoId]
    );
    if (ingresoRes.rows.length === 0) {
      const err = new Error('Ingreso de garantía no encontrado.');
      err.statusCode = 404;
      throw err;
    }
    const ingreso = ingresoRes.rows[0];
    const estadoValidacion = data.estado_validacion || data.estadoValidacion;
    const validStates = ['Garantía válida', 'Garantía rechazada', 'Pendiente de revisión'];
    if (!validStates.includes(estadoValidacion)) {
      const err = new Error('Estado de validación inválido.');
      err.statusCode = 400;
      throw err;
    }
    const motivo = normalizeText(data.motivo_rechazo || data.motivoRechazo);
    if (estadoValidacion === 'Garantía rechazada' && !motivo) {
      const err = new Error('El motivo de rechazo es obligatorio.');
      err.statusCode = 400;
      throw err;
    }
    if (motivo && !REJECTION_REASONS.includes(motivo)) {
      const err = new Error('Motivo de rechazo inválido.');
      err.statusCode = 400;
      throw err;
    }

    const garantiaEstado = estadoValidacion === 'Garantía rechazada' ? 'Rechazada' : 'En revisión';
    await client.query(
      `UPDATE ingresos_garantia
       SET estado_validacion = $1,
           motivo_rechazo = $2,
           explicacion_rechazo = $3,
           diagnostico_tecnico = COALESCE($4, diagnostico_tecnico),
           actualizado_por = $5,
           fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [
        estadoValidacion,
        estadoValidacion === 'Garantía rechazada' ? motivo : null,
        estadoValidacion === 'Garantía rechazada' ? normalizeText(data.explicacion_rechazo || data.explicacionRechazo) : null,
        normalizeText(data.diagnostico_tecnico || data.diagnosticoTecnico),
        usuarioId,
        ingresoId
      ]
    );
    await client.query(
      `UPDATE garantias
       SET estado = $1, actualizado_por = $2, fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [garantiaEstado, usuarioId, ingreso.garantia_id]
    );
    await addGarantiaHistory(
      client,
      ingreso.garantia_id,
      ingreso.id,
      usuarioId,
      'Validación de garantía',
      estadoValidacion === 'Garantía rechazada'
        ? `Garantía rechazada. Motivo: ${motivo}. ${normalizeText(data.explicacion_rechazo || data.explicacionRechazo) || ''}`.trim()
        : estadoValidacion,
      ingreso.garantia_estado,
      garantiaEstado
    );
    await addOrderHistory(client, ingreso.orden_id, usuarioId, 'Entregado', `Validación de garantía: ${estadoValidacion}.`);
    await client.query('COMMIT');
    return getGarantiaById(ingreso.garantia_id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function registrarFotos(garantiaId, data, usuarioId) {
  const fotos = Array.isArray(data.fotos) ? data.fotos.filter(Boolean) : [];
  if (fotos.length === 0) return getGarantiaById(garantiaId);

  const garantia = await pool.query('SELECT id, orden_id FROM garantias WHERE id = $1', [garantiaId]);
  if (garantia.rows.length === 0) return null;
  const ingresoId = parseId(data.ingreso_garantia_id || data.ingresoId);
  for (const foto of fotos) {
    await pool.query(
      `INSERT INTO fotos_garantia
       (garantia_id, ingreso_garantia_id, usuario_id, url_imagen, tipo_evidencia, comentario)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [garantiaId, ingresoId, usuarioId, foto, data.tipo_evidencia || 'foto', normalizeText(data.comentario)]
    );
  }
  await addGarantiaHistory(pool, garantiaId, ingresoId, usuarioId, 'Evidencia agregada', `${fotos.length} evidencia(s) agregada(s).`);
  await addOrderHistory(pool, garantia.rows[0].orden_id, usuarioId, 'Entregado', `${fotos.length} evidencia(s) agregada(s) a garantía.`);
  return getGarantiaById(garantiaId);
}

async function registrarCostos(garantiaId, data, usuarioId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const garantiaRes = await client.query('SELECT * FROM garantias WHERE id = $1 FOR UPDATE', [garantiaId]);
    if (garantiaRes.rows.length === 0) {
      const err = new Error('Garantía no encontrada.');
      err.statusCode = 404;
      throw err;
    }
    const garantia = garantiaRes.rows[0];
    const ingresoId = parseId(data.ingreso_garantia_id || data.ingresoId);
    const refacciones = Array.isArray(data.refacciones) ? data.refacciones : [];
    let total = 0;

    for (const item of refacciones) {
      const productoId = parseId(item.producto_id || item.productoId);
      const cantidad = parseInt(item.cantidad, 10) || 0;
      if (!productoId || cantidad <= 0) continue;
      const prodRes = await client.query('SELECT id, nombre, stock, costo, activo FROM inventario WHERE id = $1 FOR UPDATE', [productoId]);
      if (prodRes.rows.length === 0 || !prodRes.rows[0].activo) {
        const err = new Error('Una refacción seleccionada ya no existe o está inactiva.');
        err.statusCode = 400;
        throw err;
      }
      const prod = prodRes.rows[0];
      const stockAnterior = Number(prod.stock || 0);
      if (stockAnterior < cantidad) {
        const err = new Error(`Stock insuficiente para "${prod.nombre}". Disponible: ${stockAnterior} pz.`);
        err.statusCode = 400;
        throw err;
      }
      const costoUnitario = normalizeMoney(item.costo_unitario ?? item.costoUnitario ?? prod.costo);
      const subtotal = Number((cantidad * costoUnitario).toFixed(2));
      const stockNuevo = stockAnterior - cantidad;
      await client.query('UPDATE inventario SET stock = $1 WHERE id = $2', [stockNuevo, productoId]);
      await client.query(
        `INSERT INTO movimientos_inventario
         (producto_id, orden_id, usuario_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [productoId, garantia.orden_id, usuarioId, 'salida_garantia', cantidad, stockAnterior, stockNuevo, `Refacción utilizada en garantía #${garantiaId}`]
      );
      await client.query(
        `INSERT INTO costos_garantia
         (garantia_id, ingreso_garantia_id, producto_id, tipo_costo, descripcion, cantidad, costo_unitario, subtotal, creado_por)
         VALUES ($1, $2, $3, 'refaccion', $4, $5, $6, $7, $8)`,
        [garantiaId, ingresoId, productoId, prod.nombre, cantidad, costoUnitario, subtotal, usuarioId]
      );
      total += subtotal;
    }

    const manoObra = normalizeMoney(data.mano_obra_interna || data.manoObraInterna);
    if (manoObra > 0) {
      await client.query(
        `INSERT INTO costos_garantia
         (garantia_id, ingreso_garantia_id, tipo_costo, descripcion, cantidad, costo_unitario, subtotal, creado_por)
         VALUES ($1, $2, 'mano_obra', $3, 1, $4, $4, $5)`,
        [garantiaId, ingresoId, normalizeText(data.descripcion_mano_obra) || 'Mano de obra interna', manoObra, usuarioId]
      );
      total += manoObra;
    }

    const otros = Array.isArray(data.otros_gastos) ? data.otros_gastos : [];
    for (const gasto of otros) {
      const monto = normalizeMoney(gasto.monto ?? gasto.costo ?? gasto.subtotal);
      const descripcion = normalizeText(gasto.descripcion);
      if (!descripcion || monto <= 0) continue;
      await client.query(
        `INSERT INTO costos_garantia
         (garantia_id, ingreso_garantia_id, tipo_costo, descripcion, cantidad, costo_unitario, subtotal, creado_por)
         VALUES ($1, $2, 'otro', $3, 1, $4, $4, $5)`,
        [garantiaId, ingresoId, descripcion, monto, usuarioId]
      );
      total += monto;
    }

    await client.query(
      `UPDATE garantias
       SET estado = CASE WHEN estado <> 'Rechazada' THEN 'Garantía aplicada' ELSE estado END,
           actualizado_por = $1,
           fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [usuarioId, garantiaId]
    );
    if (ingresoId) {
      await client.query(
        `UPDATE ingresos_garantia
         SET estado_seguimiento = 'En reparación por garantía',
             actualizado_por = $1,
             fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [usuarioId, ingresoId]
      );
    }
    await addGarantiaHistory(client, garantiaId, ingresoId, usuarioId, 'Costos registrados', `Costo interno agregado: $${total.toFixed(2)}.`, garantia.estado, 'Garantía aplicada');
    await addOrderHistory(client, garantia.orden_id, usuarioId, 'Entregado', `Costo interno de garantía registrado: $${total.toFixed(2)}. No se cobra al cliente.`);
    await client.query('COMMIT');
    return getGarantiaById(garantiaId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cerrarIngreso(ingresoId, data, usuarioId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ingresoRes = await client.query('SELECT * FROM ingresos_garantia WHERE id = $1 FOR UPDATE', [ingresoId]);
    if (ingresoRes.rows.length === 0) {
      const err = new Error('Ingreso de garantía no encontrado.');
      err.statusCode = 404;
      throw err;
    }
    const ingreso = ingresoRes.rows[0];
    const resolucion = normalizeText(data.resolucion_final || data.resolucionFinal);
    if (!resolucion) {
      const err = new Error('La resolución final es obligatoria.');
      err.statusCode = 400;
      throw err;
    }
    await client.query(
      `UPDATE ingresos_garantia
       SET estado_seguimiento = 'Entregado',
           resolucion_final = $1,
           fecha_entrega_garantia = COALESCE($2, CURRENT_TIMESTAMP),
           actualizado_por = $3,
           fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [resolucion, data.fecha_entrega_garantia || null, usuarioId, ingresoId]
    );
    if (ingreso.estado_validacion !== 'Garantía rechazada') {
      await client.query(
        `UPDATE garantias
         SET estado = 'Garantía aplicada', actualizado_por = $1, fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [usuarioId, ingreso.garantia_id]
      );
    }
    await addGarantiaHistory(client, ingreso.garantia_id, ingreso.id, usuarioId, 'Ingreso cerrado', resolucion, ingreso.estado_seguimiento, 'Entregado');
    await addOrderHistory(client, ingreso.orden_id, usuarioId, 'Entregado', `Ingreso por garantía cerrado. Resolución: ${resolucion}`);
    await client.query('COMMIT');
    return getGarantiaById(ingreso.garantia_id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function registrarHistorial(garantiaId, data, usuarioId) {
  const garantia = await pool.query('SELECT id, orden_id, estado FROM garantias WHERE id = $1', [garantiaId]);
  if (garantia.rows.length === 0) return null;
  await addGarantiaHistory(pool, garantiaId, parseId(data.ingreso_garantia_id), usuarioId, data.evento || 'Seguimiento', normalizeText(data.comentario), garantia.rows[0].estado, data.estado_nuevo || garantia.rows[0].estado);
  await addOrderHistory(pool, garantia.rows[0].orden_id, usuarioId, 'Entregado', `Seguimiento de garantía: ${normalizeText(data.comentario) || data.evento || 'Actualización'}`);
  return getGarantiaById(garantiaId);
}

async function getEstadisticas() {
  const res = await pool.query(`
    SELECT estado_garantia, COUNT(*)::int AS total
    FROM (${warrantySelect()} WHERE activo = true) g
    GROUP BY estado_garantia
  `);
  const base = {
    vigentes: 0,
    vencidas: 0,
    en_revision: 0,
    aplicadas: 0,
    rechazadas: 0,
    proximas: 0
  };
  res.rows.forEach(row => {
    if (row.estado_garantia === 'Vigente') base.vigentes = row.total;
    if (row.estado_garantia === 'Próxima a vencer') base.proximas = row.total;
    if (row.estado_garantia === 'Vencida') base.vencidas = row.total;
    if (row.estado_garantia === 'En revisión') base.en_revision = row.total;
    if (row.estado_garantia === 'Garantía aplicada') base.aplicadas = row.total;
    if (row.estado_garantia === 'Rechazada') base.rechazadas = row.total;
  });
  const costoRes = await pool.query('SELECT COALESCE(SUM(subtotal), 0) AS total FROM costos_garantia');
  const reparacionesRes = await pool.query(`
    SELECT COALESCE(NULLIF(TRIM(g.servicio_cubierto), ''), 'Sin especificar') AS reparacion,
           COUNT(*)::int AS total,
           COALESCE(SUM(cg.subtotal), 0)::numeric AS costo_total
    FROM garantias g
    LEFT JOIN costos_garantia cg ON cg.garantia_id = g.id
    WHERE g.activo = true
    GROUP BY reparacion
    ORDER BY total DESC, costo_total DESC
    LIMIT 8
  `);
  return {
    ...base,
    costo_total: Number(costoRes.rows[0]?.total || 0),
    reparaciones_mas_garantias: reparacionesRes.rows.map(row => ({
      reparacion: row.reparacion,
      total: Number(row.total || 0),
      costo_total: Number(row.costo_total || 0)
    }))
  };
}

module.exports = {
  initGarantiasDB,
  createOrUpdateGarantiaFromOrder,
  getGarantiaByOrderId,
  getGarantias,
  getGarantiaById,
  getGarantiaByFolio,
  createGarantia,
  updateGarantia,
  registrarIngreso,
  validarIngreso,
  registrarFotos,
  registrarCostos,
  cerrarIngreso,
  registrarHistorial,
  getEstadisticas,
  REJECTION_REASONS
};
