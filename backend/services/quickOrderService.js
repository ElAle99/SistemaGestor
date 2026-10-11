const { pool } = require('../config/db');
const cajaService = require('./cajaService');

function invalid(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function validateQuickOrder(data) {
  data = { ...data };
  for (const [list, text] of [['fallas', 'falla_reportada'], ['reparaciones', 'servicio_solicitado']]) {
    if (data[list] === undefined) continue;
    if (!Array.isArray(data[list]) || !data[list].length || data[list].length > 20
      || data[list].some(value => typeof value !== 'string' || !value.trim() || value.trim().length > 250)) {
      throw invalid('Selecciona entre 1 y 20 fallas/reparaciones de máximo 250 caracteres.');
    }
    data[list] = [...new Set(data[list].map(value => value.trim().replace(/\s+/g, ' ')))];
    data[text] = data[list].join('\n');
  }
  const fields = {
    clientName: ['Nombre del cliente', 200],
    deviceType: ['Equipo', 50], brand: ['Marca', 100], model: ['Modelo', 100],
    falla_reportada: ['Falla reportada', 10000], servicio_solicitado: ['Reparación a realizar', 10000]
  };
  const order = {};
  for (const field of ['inspeccion_visual', 'accesorios_entregados']) {
    const values = data[field] ?? [];
    if (!Array.isArray(values) || values.length > 20 || values.some(value => typeof value !== 'string' || !value.trim() || value.trim().length > 250)) {
      throw invalid('La recepción admite hasta 20 selecciones por campo, de máximo 250 caracteres.');
    }
    order[field] = [...new Set(values.map(value => value.trim().replace(/\s+/g, ' ')))];
  }
  if (data.nota_recepcion != null && (typeof data.nota_recepcion !== 'string' || data.nota_recepcion.length > 2000)) throw invalid('La nota de recepción admite hasta 2000 caracteres.');
  order.nota_recepcion = data.nota_recepcion?.trim() || '';
  // Reuse readable fields already supported by editing and receipt rendering.
  order.inspeccion_obs = [order.inspeccion_visual.length ? `Inspección visual: ${order.inspeccion_visual.join('; ')}` : '',
    order.nota_recepcion ? `Nota de recepción: ${order.nota_recepcion}` : ''].filter(Boolean).join('\n\n') || null;
  order.acc_otro_text = order.accesorios_entregados.join('; ') || null;
  const lockType = data.lock_type || 'Ninguno';
  if (!['Ninguno', 'PIN', 'Contraseña', 'Patrón'].includes(lockType)) throw invalid('Tipo de acceso inválido.');
  order.lock_type = lockType;
  order.lock_pin = lockType === 'PIN' ? data.lock_pin || null : null;
  order.lock_pass = lockType === 'Contraseña' ? data.lock_pass || null : null;
  order.lock_pattern = lockType === 'Patrón' ? data.lock_pattern || null : null;
  if (order.lock_pin !== null && (typeof order.lock_pin !== 'string' || !/^\d{1,20}$/.test(order.lock_pin))) throw invalid('El PIN admite hasta 20 dígitos.');
  if (order.lock_pass !== null && (typeof order.lock_pass !== 'string' || order.lock_pass.length > 100)) throw invalid('La contraseña admite hasta 100 caracteres.');
  if (order.lock_pattern !== null && (typeof order.lock_pattern !== 'string' || !/^[1-9](?:-[1-9]){0,8}$/.test(order.lock_pattern)
    || new Set(order.lock_pattern.split('-')).size !== order.lock_pattern.split('-').length)) throw invalid('Patrón inválido.');
  // Leaving access blank is always allowed, even after choosing a method.
  if (!order.lock_pin && !order.lock_pass && !order.lock_pattern) order.lock_type = 'Ninguno';
  order.evidencias = data.evidenciasNuevas ?? [];
  if (!Array.isArray(order.evidencias) || order.evidencias.length > 12 || order.evidencias.some(photo =>
    typeof photo !== 'string' || photo.length > 12 * 1024 * 1024 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo))) {
    throw invalid('Adjunta hasta 12 imágenes JPG, PNG o WEBP válidas.');
  }
  if (order.evidencias.reduce((sum, photo) => sum + photo.length, 0) > 20 * 1024 * 1024) throw invalid('Las fotos superan el límite total de 15 MB.');
  order.fallas = data.fallas;
  order.reparaciones = data.reparaciones;
  for (const [key, [label, max]] of Object.entries(fields)) {
    if (typeof data[key] !== 'string' || !data[key].trim()) throw invalid(`${label} es obligatorio.`);
    order[key] = data[key].trim();
    if (order[key].length > max) throw invalid(`${label}: máximo ${max} caracteres.`);
  }
  for (const [key, max] of [['clientPhone', 20], ['clientPhoneAlt1', 20], ['color', 50]]) {
    if (data[key] != null && typeof data[key] !== 'string') throw invalid('Texto inválido.');
    order[key] = data[key]?.trim() || null;
    if (order[key]?.length > max) throw invalid(`Máximo ${max} caracteres.`);
  }
  for (const key of ['clientPhone', 'clientPhoneAlt1']) {
    if (order[key] && !/^\+?[\d\s().-]+$/.test(order[key])) throw invalid('El contacto debe ser un teléfono válido.');
    if (order[key] && !/\d/.test(order[key])) throw invalid('El contacto debe contener un número.');
  }
  for (const key of ['costo_estimado', 'anticipo']) {
    const value = data[key];
    if (value === '' || value == null) { order[key] = key === 'anticipo' ? 0 : null; continue; }
    if (!['string', 'number'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value)) || Number(value) > 99999999.99) {
      throw invalid('Los importes deben ser positivos, con máximo dos decimales.');
    }
    order[key] = Number(value);
  }
  if (order.anticipo > 0 && order.costo_estimado === null) throw invalid('Define el costo antes de recibir un anticipo.');
  if (order.anticipo > order.costo_estimado) throw invalid('El anticipo no puede ser mayor al costo.');
  order.clientId = data.clientId == null || data.clientId === '' ? null : Number(data.clientId);
  if (order.clientId !== null && (!Number.isSafeInteger(order.clientId) || order.clientId <= 0)) throw invalid('Cliente inválido.');
  return order;
}

async function createQuickOrder(data, usuarioId, negocioId = null) {
  const order = validateQuickOrder(data);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (data.guardar_catalogo === true) {
      await require('./catalogService').learnOrder(order, negocioId, db);
    }
    // Serialize folio allocation and duplicate checks across quick receptions.
    await db.query('LOCK TABLE ordenes_servicio IN SHARE ROW EXCLUSIVE MODE');
    if (order.anticipo > 0) await cajaService.ensurePaymentAllowed({ metodo_pago: 'Efectivo', monto: order.anticipo }, db);

    let cliente;
    if (order.clientId) {
      const result = await db.query('SELECT * FROM clientes WHERE id = $1 AND activo = true FOR UPDATE', [order.clientId]);
      cliente = result.rows[0];
      if (!cliente) throw invalid('El cliente seleccionado ya no está disponible.');
    } else if (order.clientPhone) {
      const phone = order.clientPhone.replace(/\D/g, '');
      const match = await db.query(`SELECT * FROM clientes WHERE activo = true AND (
        regexp_replace(COALESCE(telefono_principal, ''), '\\D', '', 'g') = $1
        OR regexp_replace(COALESCE(telefono_alternativo_1, ''), '\\D', '', 'g') = $1
        OR regexp_replace(COALESCE(telefono_alternativo_2, ''), '\\D', '', 'g') = $1
        OR regexp_replace(COALESCE(telefono_alternativo_3, ''), '\\D', '', 'g') = $1) LIMIT 1`, [phone]);
      if (match.rows.length) throw Object.assign(new Error('Este teléfono pertenece a un cliente existente. Selecciónalo en las coincidencias.'), { statusCode: 409 });
    }
    if (!cliente) {
      const result = await db.query(`INSERT INTO clientes (nombre, telefono_principal, telefono_alternativo_1)
        VALUES ($1, $2, $3) RETURNING *`, [order.clientName, order.clientPhone, order.clientPhoneAlt1]);
      cliente = result.rows[0];
    } else {
      // Keep separately stored surnames and every advanced customer field intact.
      const fullName = [cliente.nombre, cliente.apellido_paterno, cliente.apellido_materno].filter(Boolean).join(' ');
      if (order.clientName !== fullName || order.clientPhone !== (cliente.telefono_principal || null)) {
        throw invalid('Selecciona nuevamente el cliente o modifica sus datos desde Clientes.');
      }
      await db.query('UPDATE clientes SET telefono_alternativo_1 = $1 WHERE id = $2', [order.clientPhoneAlt1, cliente.id]);
    }

    const year = new Date().getFullYear();
    const last = await db.query('SELECT folio FROM ordenes_servicio WHERE folio LIKE $1 ORDER BY id DESC LIMIT 1', [`AFB-${year}-%`]);
    const lastNumber = Number(last.rows[0]?.folio?.split('-')[2]);
    const folio = `AFB-${year}-${Number.isSafeInteger(lastNumber) ? lastNumber + 1 : 10000}`;
    const result = await db.query(`INSERT INTO ordenes_servicio
      (folio, cliente_id, usuario_creador_id, tipo_equipo, marca, modelo, color, falla_reportada,
       servicio_solicitado, costo_estimado, costo_real, mano_obra, anticipo, estado, pendiente_presupuesto, status_reason,
       lock_type, lock_pin, lock_pass, lock_pattern, pin, password, patron)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,'Recibido',$13,$14,$15,$16,$17,$18,$16,$17,$18) RETURNING *`,
    [folio, cliente.id, usuarioId, order.deviceType, order.brand, order.model, order.color,
      order.falla_reportada, order.servicio_solicitado, order.costo_estimado, order.costo_estimado || 0,
      order.anticipo, order.costo_estimado === null, order.costo_estimado === null ? 'Pendiente de presupuesto' : null,
      order.lock_type, order.lock_pin, order.lock_pass, order.lock_pattern]);
    const created = result.rows[0];
    if (order.inspeccion_obs || order.acc_otro_text) {
      await db.query('UPDATE ordenes_servicio SET otros_insp = $1, accesorios_otros = $2 WHERE id = $3',
        [order.inspeccion_obs, order.acc_otro_text, created.id]);
    }
    const history = await db.query(`INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario)
      VALUES ($1, 'Recibido', $2, 'Orden registrada en recepción rápida.') RETURNING id`, [created.id, usuarioId]);
    if (order.evidencias.length) {
      await require('./ordenService').addEvidenciasOrden(created.id, order.evidencias, {
        estado: 'Recibido', historialEstadoId: history.rows[0]?.id, usuarioId,
        comentario: 'Evidencia de recepción.', visibleCliente: false
      }, db);
    }
    if (order.anticipo > 0) await cajaService.registerMovimiento({
      usuario_id: usuarioId, tipo_movimiento: 'anticipo', metodo_pago: 'Efectivo', monto: order.anticipo,
      descripcion: `Anticipo de orden ${folio}`, referencia_tipo: 'orden', referencia_id: created.id
    }, { client: db, lock: true });
    await db.query(`INSERT INTO auditoria_ordenes (orden_id, usuario_id, accion, detalle)
      VALUES ($1, $2, 'crear', $3::jsonb)`, [created.id, usuarioId, JSON.stringify({ folio, origen: 'recepcion_rapida', anticipo: order.anticipo, costo: order.costo_estimado })]);
    await db.query('COMMIT');
    return { id: created.id, folio, status: 'Recibido' };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

module.exports = { createQuickOrder, validateQuickOrder };
