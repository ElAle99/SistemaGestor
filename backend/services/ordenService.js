// services/ordenService.js - Capa de Servicio (PostgreSQL vía config/db.js)

const { pool } = require('../config/db');
const cajaService = require('./cajaService');
const garantiaService = require('./garantiaService');

function parseOrderPhotos(rawPhotos) {
  if (!rawPhotos) return [];
  if (Array.isArray(rawPhotos)) return rawPhotos;
  if (typeof rawPhotos === 'object') return rawPhotos;

  try {
    const parsed = JSON.parse(rawPhotos);
    return parsed || [];
  } catch (err) {
    return [];
  }
}

function stringifyOrderPhotos(photos) {
  if (photos === undefined) return undefined;
  if (typeof photos === 'string') return photos;
  return JSON.stringify(photos || []);
}

function normalizePhotoList(rawPhotos) {
  const parsed = parseOrderPhotos(rawPhotos);
  if (Array.isArray(parsed)) return parsed.filter(Boolean);
  if (parsed && typeof parsed === 'object') return Object.values(parsed).filter(Boolean);
  return [];
}

function normalizeTextValue(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeComparableText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeComparablePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function buildComparableClientFullName(data = {}) {
  return normalizeComparableText([
    data.clientName || data.nombre,
    data.clientLastNamePaternal || data.apellido_paterno,
    data.clientLastNameMaternal || data.apellido_materno
  ].filter(Boolean).join(' '));
}

function buildComparableClientFullNameFromRow(row = {}) {
  return normalizeComparableText([
    row.nombre,
    row.apellido_paterno,
    row.apellido_materno
  ].filter(Boolean).join(' '));
}

async function findDuplicateCliente(data = {}) {
  const phones = [
    data.clientPhone,
    data.telefono,
    data.telefono_principal,
    data.clientPhoneAlt1,
    data.clientPhoneAlt2,
    data.clientPhoneAlt3,
    data.telefono_alt1,
    data.telefono_alt2,
    data.telefono_alt3,
    data.telefono_alternativo_1,
    data.telefono_alternativo_2,
    data.telefono_alternativo_3
  ].map(normalizeComparablePhone).filter(Boolean);

  for (const phone of phones) {
    const phoneResult = await pool.query(
      `SELECT *
       FROM clientes
       WHERE activo = true
         AND (
           regexp_replace(COALESCE(telefono_principal, ''), '\\D', '', 'g') = $1
           OR regexp_replace(COALESCE(telefono_alternativo_1, ''), '\\D', '', 'g') = $1
           OR regexp_replace(COALESCE(telefono_alternativo_2, ''), '\\D', '', 'g') = $1
           OR regexp_replace(COALESCE(telefono_alternativo_3, ''), '\\D', '', 'g') = $1
         )
       LIMIT 1`,
      [phone]
    );
    if (phoneResult.rows.length > 0) {
      return { type: 'strong', reason: 'phone', cliente: phoneResult.rows[0] };
    }
  }

  const fullName = buildComparableClientFullName(data);
  if (!fullName) return null;

  const nameResult = await pool.query(
    'SELECT id, nombre, apellido_paterno, apellido_materno, telefono_principal FROM clientes WHERE activo = true'
  );
  const cliente = nameResult.rows.find(row => buildComparableClientFullNameFromRow(row) === fullName);
  return cliente ? { type: 'possible', reason: 'name', cliente } : null;
}

function createClientDuplicateError(match) {
  const error = new Error(match?.reason === 'phone'
    ? 'Ya existe un cliente registrado con este telefono.'
    : 'Ya existe un cliente con este nombre.');
  error.statusCode = 409;
  error.code = match?.reason === 'phone' ? 'CLIENT_DUPLICATE_PHONE' : 'CLIENT_DUPLICATE_NAME';
  error.duplicate = match;
  return error;
}

function normalizeFolioLookup(value) {
  return String(value ?? '')
    .trim()
    .replace(/[‘’´`'"]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/-+/g, '-');
}

function normalizeMoneyValue(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function buildClientFullName(data = {}) {
  const direct = normalizeTextValue(data.clientFullName || data.nombre_completo);
  if (direct) return direct;

  const parts = [
    data.clientName || data.nombre,
    data.clientLastNamePaternal || data.apellido_paterno,
    data.clientLastNameMaternal || data.apellido_materno
  ].map(normalizeTextValue).filter(Boolean);

  return parts.join(' ') || 'Cliente sin nombre';
}

function splitClientName(fullName = '') {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { nombres: fullName || '', apellidoPaterno: '', apellidoMaterno: '' };
  if (parts.length === 2) return { nombres: parts[0], apellidoPaterno: parts[1], apellidoMaterno: '' };
  return {
    nombres: parts.slice(0, -2).join(' '),
    apellidoPaterno: parts[parts.length - 2],
    apellidoMaterno: parts[parts.length - 1]
  };
}

function defaultEvidenceVisibility(estado) {
  const normalized = String(estado || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return ['recibido', 'diagnostico', 'listo para entregar', 'entregado'].includes(normalized);
}

function groupEvidenciasByEstado(evidencias = []) {
  const grouped = new Map();
  evidencias.forEach(evidencia => {
    const estado = evidencia.nombre_estado || evidencia.estado || 'Sin clasificar';
    if (!grouped.has(estado)) {
      grouped.set(estado, {
        estado,
        fecha: evidencia.fecha_subida,
        usuario: evidencia.usuario_nombre || null,
        comentario: evidencia.comentario || null,
        fotos: []
      });
    }

    const group = grouped.get(estado);
    group.fotos.push(evidencia);
    if (evidencia.fecha_subida && (!group.fecha || new Date(evidencia.fecha_subida) > new Date(group.fecha))) {
      group.fecha = evidencia.fecha_subida;
    }
    if (evidencia.usuario_nombre) group.usuario = evidencia.usuario_nombre;
    if (evidencia.comentario) group.comentario = evidencia.comentario;
  });
  return Array.from(grouped.values());
}

async function getEvidenciasOrden(ordenId, options = {}, db = pool) {
  const visibleClause = options.visibleClienteOnly ? 'AND e.visible_cliente = true' : '';
  const res = await db.query(
    `SELECT e.*, u.nombre as usuario_nombre
     FROM evidencias_orden e
     LEFT JOIN usuarios u ON e.usuario_id = u.id
     WHERE e.orden_id = $1 ${visibleClause}
     ORDER BY e.fecha_subida ASC, e.id ASC`,
    [ordenId]
  );

  return res.rows.map(row => ({
    id: row.id,
    orden_id: row.orden_id,
    historial_estado_id: row.historial_estado_id,
    usuario_id: row.usuario_id,
    usuario_nombre: row.usuario_nombre,
    nombre_estado: row.nombre_estado || 'Sin clasificar',
    estado: row.nombre_estado || 'Sin clasificar',
    url_imagen: row.url_imagen,
    url: row.url_imagen,
    tipo_evidencia: row.tipo_evidencia || 'foto',
    comentario: row.comentario || null,
    visible_cliente: row.visible_cliente,
    fecha_subida: row.fecha_subida
  }));
}

async function addEvidenciasOrden(ordenId, fotos, options = {}, db = pool) {
  const photos = normalizePhotoList(fotos);
  if (photos.length === 0) return [];

  const estado = options.estado || 'Recibido';
  const visibleCliente = options.visibleCliente !== undefined
    ? Boolean(options.visibleCliente)
    : defaultEvidenceVisibility(estado);
  const inserted = [];

  for (const photo of photos) {
    const res = await db.query(
      `INSERT INTO evidencias_orden
       (orden_id, historial_estado_id, usuario_id, nombre_estado, url_imagen, tipo_evidencia, comentario, visible_cliente)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        ordenId,
        options.historialEstadoId || null,
        options.usuarioId || null,
        estado,
        photo,
        options.tipoEvidencia || 'foto',
        options.comentario || null,
        visibleCliente
      ]
    );
    inserted.push(res.rows[0]);
  }

  return inserted;
}

function normalizeOrderRefacciones(data = {}) {
  const rawItems = Array.isArray(data)
    ? data
    : (data.refacciones || data.refacciones_utilizadas || data.parts || []);
  const byProduct = new Map();

  rawItems.forEach(item => {
    const productoId = parseInt(item.producto_id || item.productId || item.id, 10);
    const cantidad = parseInt(item.cantidad || item.qty || item.quantity, 10);
    if (!productoId || !Number.isFinite(cantidad) || cantidad <= 0) return;

    const precio = normalizeMoneyValue(
      item.precio_unitario ?? item.precioUnitario ?? item.precio ?? item.price
    );
    const current = byProduct.get(productoId);
    if (current) {
      current.cantidad += cantidad;
      current.precio_unitario = precio || current.precio_unitario;
      current.subtotal = current.cantidad * current.precio_unitario;
    } else {
      byProduct.set(productoId, {
        producto_id: productoId,
        cantidad,
        precio_unitario: precio,
        subtotal: cantidad * precio
      });
    }
  });

  return Array.from(byProduct.values());
}

function hasOrderRefaccionesPayload(data = {}) {
  return Array.isArray(data.refacciones)
    || Array.isArray(data.refacciones_utilizadas)
    || Array.isArray(data.parts);
}

function buildOrderFinancials(data = {}) {
  const hasRefaccionesPayload = hasOrderRefaccionesPayload(data);
  const refacciones = normalizeOrderRefacciones(data);
  const hasRefacciones = refacciones.length > 0;
  const totalRefacciones = hasRefaccionesPayload
    ? refacciones.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
    : normalizeMoneyValue(data.costo_refaccion);
  const baseTotal = normalizeMoneyValue(data.costo_estimado);
  const hasManualLabor = data.mano_obra !== undefined
    && data.mano_obra !== null
    && data.mano_obra !== ''
    && normalizeMoneyValue(data.mano_obra) > 0;
  const shouldUseBreakdownTotal = hasRefacciones || hasManualLabor;
  const manoObra = data.mano_obra !== undefined && data.mano_obra !== null && data.mano_obra !== ''
    ? normalizeMoneyValue(data.mano_obra)
    : Math.max(baseTotal - totalRefacciones, 0);
  const totalReparacion = shouldUseBreakdownTotal
    ? manoObra + totalRefacciones
    : baseTotal;
  const costoReal = data.costo_real !== undefined && data.costo_real !== null && data.costo_real !== ''
    ? Number(data.costo_real)
    : (shouldUseBreakdownTotal ? totalReparacion : null);

  return {
    refacciones,
    totalRefacciones,
    manoObra,
    totalReparacion,
    costoReal
  };
}

async function validateNewOrderRefaccionesStock(refacciones) {
  for (const item of refacciones) {
    const prodRes = await pool.query(
      'SELECT nombre, stock, activo FROM inventario WHERE id = $1',
      [item.producto_id]
    );
    if (prodRes.rows.length === 0 || !prodRes.rows[0].activo) {
      const err = new Error('Una de las refacciones seleccionadas ya no existe o esta inactiva.');
      err.statusCode = 400;
      throw err;
    }
    const prod = prodRes.rows[0];
    if (Number(prod.stock || 0) < item.cantidad) {
      const err = new Error(`Stock insuficiente para "${prod.nombre}". Disponible: ${prod.stock} pz, solicitado: ${item.cantidad} pz.`);
      err.statusCode = 400;
      throw err;
    }
  }
}

async function validateEditedOrderRefaccionesStock(ordenId, refacciones) {
  const currentRes = await pool.query(
    'SELECT producto_id, cantidad FROM orden_refacciones WHERE orden_id = $1',
    [ordenId]
  );
  const currentByProduct = new Map(currentRes.rows.map(row => [Number(row.producto_id), Number(row.cantidad || 0)]));
  const nextByProduct = new Map(refacciones.map(item => [Number(item.producto_id), Number(item.cantidad || 0)]));

  for (const [productoId, nextQty] of nextByProduct.entries()) {
    const currentQty = currentByProduct.get(productoId) || 0;
    const delta = nextQty - currentQty;
    if (delta <= 0) continue;

    const prodRes = await pool.query(
      'SELECT nombre, stock, activo FROM inventario WHERE id = $1',
      [productoId]
    );
    if (prodRes.rows.length === 0 || !prodRes.rows[0].activo) {
      const err = new Error('Una de las refacciones seleccionadas ya no existe o esta inactiva.');
      err.statusCode = 400;
      throw err;
    }
    const prod = prodRes.rows[0];
    if (Number(prod.stock || 0) < delta) {
      const err = new Error(`Stock insuficiente para "${prod.nombre}". Disponible: ${prod.stock} pz, solicitado adicional: ${delta} pz.`);
      err.statusCode = 400;
      throw err;
    }
  }
}

async function getOrdenRefacciones(ordenId, db = pool) {
  const res = await db.query(
    `SELECT opr.id, opr.orden_id, opr.producto_id, opr.cantidad, opr.precio_unitario,
            opr.subtotal, opr.created_at, opr.updated_at,
            i.nombre as refaccion, i.nombre, i.codigo, i.codigo_barras,
            i.descripcion, i.categoria, i.stock as stock_disponible, i.precio as precio_actual
     FROM orden_refacciones opr
     JOIN inventario i ON i.id = opr.producto_id
     WHERE opr.orden_id = $1
     ORDER BY opr.id ASC`,
    [ordenId]
  );

  return res.rows.map(row => ({
    id: row.id,
    orden_id: row.orden_id,
    producto_id: row.producto_id,
    refaccion: row.refaccion,
    nombre: row.nombre,
    codigo: row.codigo,
    codigo_barras: row.codigo_barras,
    descripcion: row.descripcion,
    categoria: row.categoria,
    stock_disponible: Number(row.stock_disponible || 0),
    precio_actual: Number(row.precio_actual || 0),
    cantidad: Number(row.cantidad || 0),
    precio_unitario: Number(row.precio_unitario || 0),
    subtotal: Number(row.subtotal || 0),
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

async function syncOrdenRefacciones(ordenId, nextRefacciones, options = {}) {
  const client = options.client || pool;
  const usuarioId = options.usuarioId || 1;
  const estado = options.estado || 'Recibido';
  const normalized = normalizeOrderRefacciones(nextRefacciones);
  const nextByProduct = new Map(normalized.map(item => [item.producto_id, item]));
  const historyMessages = [];

  const currentRes = await client.query(
    `SELECT producto_id, cantidad, precio_unitario, subtotal
     FROM orden_refacciones
     WHERE orden_id = $1
     FOR UPDATE`,
    [ordenId]
  );
  const currentByProduct = new Map(currentRes.rows.map(item => [Number(item.producto_id), item]));
  const productIds = Array.from(new Set([...currentByProduct.keys(), ...nextByProduct.keys()]));

  for (const productoId of productIds) {
    const desired = nextByProduct.get(productoId) || null;
    const current = currentByProduct.get(productoId) || null;
    const currentQty = current ? Number(current.cantidad || 0) : 0;
    const nextQty = desired ? Number(desired.cantidad || 0) : 0;
    const delta = nextQty - currentQty;

    const productRes = await client.query(
      'SELECT id, nombre, codigo, stock, precio, activo FROM inventario WHERE id = $1 FOR UPDATE',
      [productoId]
    );
    if (productRes.rows.length === 0 || (!productRes.rows[0].activo && nextQty > 0)) {
      const err = new Error(`La refaccion seleccionada ya no existe o esta inactiva en inventario.`);
      err.statusCode = 400;
      throw err;
    }

    const product = productRes.rows[0];
    const stockAnterior = Number(product.stock || 0);
    if (delta > 0 && stockAnterior < delta) {
      const err = new Error(`Stock insuficiente para "${product.nombre}". Disponible: ${stockAnterior} pz, solicitado adicional: ${delta} pz.`);
      err.statusCode = 400;
      throw err;
    }

    if (delta !== 0) {
      const stockNuevo = delta > 0 ? stockAnterior - delta : stockAnterior + Math.abs(delta);
      await client.query(
        'UPDATE inventario SET stock = $1 WHERE id = $2',
        [stockNuevo, productoId]
      );
      await client.query(
        `INSERT INTO movimientos_inventario
         (producto_id, orden_id, usuario_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          productoId,
          ordenId,
          usuarioId,
          delta > 0 ? 'salida_orden' : 'entrada_orden',
          Math.abs(delta),
          stockAnterior,
          stockNuevo,
          delta > 0
            ? `Refaccion utilizada en orden #${ordenId}`
            : `Refaccion devuelta por ajuste de orden #${ordenId}`
        ]
      );
    }

    if (desired && nextQty > 0) {
      const precioUnitario = desired.precio_unitario || Number(product.precio || 0);
      const subtotal = nextQty * precioUnitario;
      await client.query(
        `INSERT INTO orden_refacciones (orden_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (orden_id, producto_id)
         DO UPDATE SET cantidad = EXCLUDED.cantidad,
                       precio_unitario = EXCLUDED.precio_unitario,
                       subtotal = EXCLUDED.subtotal,
                       updated_at = CURRENT_TIMESTAMP`,
        [ordenId, productoId, nextQty, precioUnitario, subtotal]
      );

      if (!current) {
        historyMessages.push(`Refaccion agregada: ${product.nombre} x${nextQty}. Subtotal: $${subtotal.toFixed(2)}.`);
      } else if (currentQty !== nextQty) {
        historyMessages.push(`Cantidad de refaccion modificada: ${product.nombre} de ${currentQty} a ${nextQty}.`);
      }
    } else if (current) {
      await client.query(
        'DELETE FROM orden_refacciones WHERE orden_id = $1 AND producto_id = $2',
        [ordenId, productoId]
      );
      historyMessages.push(`Refaccion eliminada: ${product.nombre}. Se regresaron ${currentQty} pz al inventario.`);
    }
  }

  const totalRes = await client.query(
    'SELECT COALESCE(SUM(subtotal), 0) AS total FROM orden_refacciones WHERE orden_id = $1',
    [ordenId]
  );
  const totalRefacciones = Number(totalRes.rows[0]?.total || 0);
  await client.query(
    'UPDATE ordenes_servicio SET costo_refaccion = $1, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = $2',
    [totalRefacciones, ordenId]
  );

  for (const message of historyMessages) {
    await client.query(
      'INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario) VALUES ($1, $2, $3, $4)',
      [ordenId, estado, usuarioId, message]
    );
  }

  return {
    refacciones: await getOrdenRefacciones(ordenId, client),
    totalRefacciones,
    historyMessages
  };
}

// Helper para dar formato a los objetos de orden que espera el frontend
function formatOrderResponse(row, historial = [], evidencias = [], refacciones = []) {
  if (!row) return null;
  const latestHistory = historial.length > 0 ? historial[historial.length - 1] : null;
  const legacyPhotos = normalizePhotoList(row.fotografias);
  const evidencePhotos = evidencias.map(e => e.url_imagen || e.url).filter(Boolean);
  const fotos = evidencePhotos.length > 0 ? evidencePhotos : legacyPhotos;
  
  let dateIn;
  if (row.fecha_creacion instanceof Date) {
    dateIn = row.fecha_creacion.toISOString().split('T')[0];
  } else if (row.fecha_creacion) {
    dateIn = String(row.fecha_creacion).split(' ')[0];
  } else {
    dateIn = new Date().toISOString().split('T')[0];
  }

  return {
    id: row.id,
    folio: row.folio,
    clientId: row.cliente_id,
    
    // Cliente
    clientName: row.clientname || row.cliente_nombre,
    clientLastNamePaternal: row.apellido_paterno || null,
    clientLastNameMaternal: row.apellido_materno || null,
    clientPhone: row.clientphone || row.cliente_telefono,
    clientPhoneAlt1: row.telefono_alternativo_1 || null,
    clientPhoneAlt2: row.telefono_alternativo_2 || null,
    clientPhoneAlt3: row.telefono_alternativo_3 || null,
    clientEmail: row.correo || null,
    clientAddress: row.direccion || null,
    clientPreferredContact: row.contacto_preferido || null,
    clientRemarks: row.notas || null,

    // Equipo
    deviceType: row.tipo_equipo,
    brand: row.marca,
    model: row.modelo,
    deviceDescription: row.descripcion_equipo || null,
    color: row.color || null,
    imei: row.imei1 || null,
    imei2: row.imei2 || null,
    serial: row.serie || null,

    // Desbloqueos
    sec_android: row.sec_android || null,
    sec_patch: row.sec_patch || null,
    sec_imei_orig: row.sec_imei_orig || null,
    sec_imei_mod: row.sec_imei_mod || null,

    // Bloqueos
    lock_type: row.lock_type || 'Ninguno',
    lock_pin: row.lock_pin || null,
    lock_pass: row.lock_pass || null,
    lock_pattern: row.lock_pattern || null,

    // Inspección visual
    vis_pantalla_rota: row.pantalla_rota ? 1 : 0,
    vis_pantalla_manchada: row.pantalla_manchada ? 1 : 0,
    vis_pantalla_rayada: row.pantalla_rayada ? 1 : 0,
    vis_botones: row.botones_danados ? 1 : 0,
    vis_tapa: row.tapa_rota ? 1 : 0,
    vis_tapa_rota: row.tapa_rota ? 1 : 0,
    vis_tapa_rayada: row.tapa_rayada ? 1 : 0,
    vis_camara: row.camara_danada ? 1 : 0,
    vis_lente_camara: row.lente_camara_roto ? 1 : 0,
    vis_marco: row.marco_golpeado ? 1 : 0,
    vis_puerto: row.puerto_danado ? 1 : 0,
    vis_humedad: row.humedad ? 1 : 0,
    vis_no_enciende: row.no_enciende ? 1 : 0,
    vis_doblado: row.equipo_doblado ? 1 : 0,
    vis_tornillos: row.tornillos_faltantes ? 1 : 0,
    vis_otro: row.otros_insp ? 1 : 0,
    inspeccion_obs: row.otros_insp || null,

    // Accesorios
    acc_funda: row.accesorios_funda ? 1 : 0,
    acc_sim: row.accesorios_sim ? 1 : 0,
    acc_memoria: row.accesorios_memoria ? 1 : 0,
    acc_cargador: row.accesorios_cargador ? 1 : 0,
    acc_cable: row.accesorios_cable ? 1 : 0,
    acc_caja: row.accesorios_caja ? 1 : 0,
    acc_templado: row.accesorios_templado ? 1 : 0,
    acc_otro: row.accesorios_otros ? 1 : 0,
    acc_otro_text: row.accesorios_otros || null,

    // Firma
    firma_imagen: row.firma_imagen || row.firma || null,

    // Económicos
    costo_estimado: parseFloat(row.costo_estimado) || 0,
    anticipo: parseFloat(row.anticipo) || 0,
    costo_real: row.costo_real !== null && row.costo_real !== undefined ? parseFloat(row.costo_real) : null,
    costo_refaccion: parseFloat(row.costo_refaccion) || 0,
    mano_obra: row.mano_obra !== null && row.mano_obra !== undefined
      ? parseFloat(row.mano_obra)
      : Math.max((parseFloat(row.costo_real || row.costo_estimado) || 0) - (parseFloat(row.costo_refaccion) || 0), 0),
    refacciones,
    refacciones_utilizadas: refacciones,
    total_refacciones: refacciones.reduce((sum, item) => sum + Number(item.subtotal || 0), 0),

    // Estatus
    status: row.estado || row.estado_actual,
    estado_pago: row.estado_pago || 'Pendiente',
    fecha_entrega_real: row.fecha_entrega_real || null,
    pagado_en: row.pagado_en || null,
    tecnicoAsignado: row.tecnico_nombre || null,
    technicianName: row.tecnico_nombre || null,
    status_reason: row.status_reason || null,
    publicRemarks: latestHistory ? latestHistory.comentario : 'Sin observaciones.',
    dateIn: dateIn,
    estimatedDate: row.fecha_entrega_estimada || null,
    falla_reportada: row.falla_reportada || '',
    descripcion_falla: row.descripcion_falla || null,
    servicio_solicitado: row.servicio_solicitado || null,
    tipo_orden: row.tipo_orden || 'Reparación directa',
    pendiente_presupuesto: Boolean(row.pendiente_presupuesto),
    
    historial: historial.map(h => ({
      estado: h.estado,
      fecha: h.fecha,
      comentario: h.comentario
    })),
    fotografias: row.fotografias || null,
    fotos,
    evidencias,
    evidenciasPorEstado: groupEvidenciasByEstado(evidencias)
  };
}

// --------------------------------------------------------
// SERVICIOS DE USUARIOS (AUTENTICACIÓN REAL DESDE BD)
// --------------------------------------------------------

async function validateUserLogin(email, password) {
  const res = await pool.query(
    'SELECT id, nombre, username, rol FROM usuarios WHERE username = $1',
    [email]
  );
  if (res.rows.length === 0) return null;
  const bcrypt = require('bcrypt');
  const valid = await bcrypt.compare(password, res.rows[0].password);
  if (!valid) return null;
  return res.rows[0];
}

async function getAllUsuarios() {
  const res = await pool.query('SELECT id, nombre, username, rol, activo FROM usuarios ORDER BY id ASC');
  return res.rows;
}

async function createUsuario(data) {
  const bcrypt = require('bcrypt');
  const rolesValidos = ['Administrador', 'Técnico', 'Recepcionista'];
  if (!rolesValidos.includes(data.rol)) {
    throw new Error('Rol no válido.');
  }
  const hashedPassword = await bcrypt.hash(data.password, 10);
  const result = await pool.query(
    'INSERT INTO usuarios (nombre, username, password, rol) VALUES ($1, $2, $3, $4) RETURNING id',
    [data.nombre, data.email, hashedPassword, data.rol]
  );
  return { id: result.rows[0].id, nombre: data.nombre, email: data.email, rol: data.rol };
}

async function deleteUsuario(id) {
  if (id === 1) {
    throw new Error('No se puede eliminar el administrador principal.');
  }
  await pool.query('UPDATE usuarios SET activo = false WHERE id = $1', [id]);
  return true;
}

// --------------------------------------------------------
// SERVICIOS DE CLIENTES
// --------------------------------------------------------

async function getAllClientes() {
  const res = await pool.query('SELECT * FROM clientes WHERE activo = true ORDER BY id DESC');
  return res.rows.map(c => ({
    id: c.id,
    nombre: c.nombre,
    apellido_paterno: c.apellido_paterno,
    apellido_materno: c.apellido_materno,
    clientLastNamePaternal: c.apellido_paterno,
    clientLastNameMaternal: c.apellido_materno,
    telefono: c.telefono_principal,
    telefono_principal: c.telefono_principal,
    telefono_alt1: c.telefono_alternativo_1,
    telefono_alt2: c.telefono_alternativo_2,
    telefono_alt3: c.telefono_alternativo_3,
    telefono_alternativo_1: c.telefono_alternativo_1,
    telefono_alternativo_2: c.telefono_alternativo_2,
    telefono_alternativo_3: c.telefono_alternativo_3,
    email: c.correo,
    correo: c.correo,
    direccion: c.direccion,
    contacto_preferido: c.contacto_preferido,
    preferredContact: c.contacto_preferido,
    observaciones: c.notas,
    notas: c.notas,
    activo: c.activo,
    fecha_creacion: c.fecha_creacion
  }));
}

async function createCliente(data) {
  const duplicate = await findDuplicateCliente(data);
  if (duplicate?.type === 'strong') {
    throw createClientDuplicateError(duplicate);
  }

  const result = await pool.query(
    `INSERT INTO clientes (nombre, apellido_paterno, apellido_materno, telefono_principal, telefono_alternativo_1, telefono_alternativo_2, telefono_alternativo_3, correo, direccion, contacto_preferido, notas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      data.nombre || data.clientName,
      data.apellido_paterno || data.clientLastNamePaternal || null,
      data.apellido_materno || data.clientLastNameMaternal || null,
      normalizeTextValue(data.telefono || data.clientPhone),
      data.telefono_alt1 || data.clientPhoneAlt1 || null,
      data.telefono_alt2 || data.clientPhoneAlt2 || null,
      data.telefono_alt3 || data.clientPhoneAlt3 || null,
      data.email || data.clientEmail || null,
      data.direccion || data.clientAddress || null,
      data.contacto_preferido || data.clientPreferredContact || null,
      data.observaciones || data.clientRemarks || null
    ]
  );
  return { id: result.rows[0].id, ...data };
}

async function updateCliente(id, data) {
  await pool.query(
    `UPDATE clientes SET nombre = $1, apellido_paterno = $2, apellido_materno = $3, telefono_principal = $4, telefono_alternativo_1 = $5, telefono_alternativo_2 = $6, telefono_alternativo_3 = $7, correo = $8, direccion = $9, contacto_preferido = COALESCE($10, contacto_preferido), notas = $11
     WHERE id = $12`,
    [
      data.nombre || data.clientName,
      data.apellido_paterno || data.clientLastNamePaternal || null,
      data.apellido_materno || data.clientLastNameMaternal || null,
      normalizeTextValue(data.telefono || data.clientPhone),
      data.telefono_alt1 || data.clientPhoneAlt1 || null,
      data.telefono_alt2 || data.clientPhoneAlt2 || null,
      data.telefono_alt3 || data.clientPhoneAlt3 || null,
      data.email || data.clientEmail || null,
      data.direccion || data.clientAddress || null,
      data.contacto_preferido || data.clientPreferredContact || null,
      data.observaciones || data.clientRemarks || null,
      id
    ]
  );
  return { id, ...data };
}

async function getClienteByTelefono(telefono) {
  const normalizedPhone = normalizeComparablePhone(telefono);
  const res = await pool.query(
    `SELECT *
     FROM clientes
     WHERE activo = true
       AND regexp_replace(COALESCE(telefono_principal, ''), '\\D', '', 'g') = $1`,
    [normalizedPhone]
  );
  return res.rows[0];
}

// --------------------------------------------------------
// SERVICIOS DE ÓRDENES
// --------------------------------------------------------

async function getAllOrdenes() {
  const orders = await pool.query(`
    SELECT o.*, 
           c.nombre as clientName, c.apellido_paterno, c.apellido_materno, c.telefono_principal as clientPhone, c.telefono_alternativo_1, c.telefono_alternativo_2, c.telefono_alternativo_3, c.correo, c.direccion, c.contacto_preferido, c.notas as clientRemarks,
           u.nombre as tecnico_nombre
    FROM ordenes_servicio o
    JOIN clientes c ON o.cliente_id = c.id
    LEFT JOIN usuarios u ON o.tecnico_id = u.id
    ORDER BY o.id DESC
  `);

  const orderIds = orders.rows.map(order => order.id);
  const historiesByOrder = new Map();
  if (orderIds.length > 0) {
    const histories = await pool.query(
      'SELECT orden_id, estado, fecha, comentario FROM historial_estados WHERE orden_id = ANY($1::int[]) ORDER BY orden_id ASC, id ASC',
      [orderIds]
    );
    histories.rows.forEach(history => {
      if (!historiesByOrder.has(history.orden_id)) historiesByOrder.set(history.orden_id, []);
      historiesByOrder.get(history.orden_id).push(history);
    });
  }

  const formattedOrders = [];
  for (const order of orders.rows) {
    const formatted = formatOrderResponse({ ...order, fotografias: null }, historiesByOrder.get(order.id) || [], []);
    formatted.fotografias = null;
    formatted.fotos = [];
    formattedOrders.push(formatted);
  }

  return formattedOrders;
}

async function getOrdenById(id) {
  const order = await pool.query(`
    SELECT o.*, 
           c.nombre as clientName, c.apellido_paterno, c.apellido_materno, c.telefono_principal as clientPhone, c.telefono_alternativo_1, c.telefono_alternativo_2, c.telefono_alternativo_3, c.correo, c.direccion, c.contacto_preferido, c.notas as clientRemarks
    FROM ordenes_servicio o
    JOIN clientes c ON o.cliente_id = c.id
    WHERE o.id = $1
  `, [id]);

  if (order.rows.length === 0) return null;

  const historial = await pool.query(
    'SELECT estado, fecha, comentario FROM historial_estados WHERE orden_id = $1 ORDER BY id ASC',
    [id]
  );

  const evidencias = await getEvidenciasOrden(id);
  const refacciones = await getOrdenRefacciones(id);
  const formatted = formatOrderResponse(order.rows[0], historial.rows, evidencias, refacciones);
  formatted.garantia = await garantiaService.getGarantiaByOrderId(id);
  return formatted;
}

async function getOrdenByFolio(folio) {
  const normalizedFolio = normalizeFolioLookup(folio);
  const order = await pool.query(`
    SELECT o.*, 
           c.nombre as clientName, c.apellido_paterno, c.apellido_materno, c.telefono_principal as clientPhone, c.telefono_alternativo_1, c.telefono_alternativo_2, c.telefono_alternativo_3, c.correo, c.direccion, c.contacto_preferido, c.notas as clientRemarks,
           u.nombre as tecnico_nombre
    FROM ordenes_servicio o
    JOIN clientes c ON o.cliente_id = c.id
    LEFT JOIN usuarios u ON o.tecnico_id = u.id
    WHERE UPPER(TRIM(o.folio)) = UPPER(TRIM($1))
  `, [normalizedFolio]);

  if (order.rows.length === 0) return null;
  const o = order.rows[0];

  const historial = await pool.query(
    'SELECT estado, fecha, comentario FROM historial_estados WHERE orden_id = $1 ORDER BY id ASC',
    [o.id]
  );

  const evidencias = await getEvidenciasOrden(o.id, { visibleClienteOnly: true });
  const refacciones = await getOrdenRefacciones(o.id);
  return formatOrderResponse(o, historial.rows, evidencias, refacciones);
}

async function createOrden(data) {
  const nombreCliente = buildClientFullName(data);
  const nombresCliente = normalizeTextValue(data.clientName || data.nombre) || nombreCliente;
  const apellidoPaterno = normalizeTextValue(data.clientLastNamePaternal || data.apellido_paterno);
  const apellidoMaterno = normalizeTextValue(data.clientLastNameMaternal || data.apellido_materno);
  const telefonoCliente = normalizeTextValue(data.clientPhone || data.telefono);
  const telefonoAlternativo1 = normalizeTextValue(data.clientPhoneAlt1 || data.telefono_alt1 || data.telefono_alternativo_1);
  const telefonoAlternativo2 = normalizeTextValue(data.clientPhoneAlt2 || data.telefono_alt2 || data.telefono_alternativo_2);
  const telefonoAlternativo3 = normalizeTextValue(data.clientPhoneAlt3 || data.telefono_alt3 || data.telefono_alternativo_3);
  const contactoPreferido = normalizeTextValue(data.clientPreferredContact || data.contacto_preferido);
  const nombreParaCliente = nombresCliente || nombreCliente;
  let clienteId = data.clientId ? parseInt(data.clientId, 10) : null;

  if (!clienteId) {
    const duplicate = await findDuplicateCliente({
      clientName: nombresCliente,
      clientLastNamePaternal: apellidoPaterno,
      clientLastNameMaternal: apellidoMaterno,
      clientPhone: telefonoCliente
    });
    if (duplicate?.type === 'strong') {
      clienteId = duplicate.cliente.id;
      await pool.query(
        `UPDATE clientes SET
          telefono_alternativo_1 = COALESCE($1, telefono_alternativo_1),
          telefono_alternativo_2 = COALESCE($2, telefono_alternativo_2),
          telefono_alternativo_3 = COALESCE($3, telefono_alternativo_3)
         WHERE id = $4`,
        [telefonoAlternativo1, telefonoAlternativo2, telefonoAlternativo3, clienteId]
      );
    }

    if (!clienteId) {
      const createdClient = await pool.query(
        `INSERT INTO clientes (nombre, apellido_paterno, apellido_materno, telefono_principal, telefono_alternativo_1, telefono_alternativo_2, telefono_alternativo_3, correo, direccion, contacto_preferido, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [nombreParaCliente, apellidoPaterno, apellidoMaterno, telefonoCliente, telefonoAlternativo1, telefonoAlternativo2, telefonoAlternativo3, data.clientEmail || data.email || null, data.clientAddress || data.direccion || null, contactoPreferido, data.clientRemarks || data.observaciones || null]
      );
      clienteId = createdClient.rows[0].id;
    }
  } else {
    await pool.query(
      `UPDATE clientes SET
        nombre = COALESCE($1, nombre),
        apellido_paterno = COALESCE($2, apellido_paterno),
        apellido_materno = COALESCE($3, apellido_materno),
        telefono_principal = COALESCE($4, telefono_principal),
        telefono_alternativo_1 = COALESCE($5, telefono_alternativo_1),
        telefono_alternativo_2 = COALESCE($6, telefono_alternativo_2),
        telefono_alternativo_3 = COALESCE($7, telefono_alternativo_3),
        correo = COALESCE($8, correo),
        direccion = COALESCE($9, direccion),
        contacto_preferido = COALESCE($10, contacto_preferido),
        notas = COALESCE($11, notas)
       WHERE id = $12`,
      [nombreParaCliente, apellidoPaterno, apellidoMaterno, telefonoCliente, telefonoAlternativo1, telefonoAlternativo2, telefonoAlternativo3, data.clientEmail || data.email || null, data.clientAddress || data.direccion || null, contactoPreferido, data.clientRemarks || data.observaciones || null, clienteId]
    );
  }

  const activeYear = new Date().getFullYear();
  const lastOrder = await pool.query("SELECT folio FROM ordenes_servicio WHERE folio LIKE $1 ORDER BY id DESC LIMIT 1", [`AFB-${activeYear}-%`]);
  let nextNum = 10000;
  if (lastOrder.rows.length > 0 && lastOrder.rows[0].folio) {
    const parts = lastOrder.rows[0].folio.split('-');
    if (parts.length === 3) {
      const lastNum = parseInt(parts[2], 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
  }
  const folio = `AFB-${activeYear}-${nextNum}`;

  const estado = 'Recibido';
  const usuarioId = data.usuario_creador_id || data.usuario_id || data.userId || 1;
  const financials = buildOrderFinancials(data);
  const anticipoAmount = normalizeMoneyValue(data.anticipo);
  const anticipoMetodoPago = data.metodo_pago_anticipo || data.advancePaymentMethod || data.metodo_pago || 'Efectivo';
  if (anticipoAmount > 0) {
    await cajaService.ensurePaymentAllowed({ metodo_pago: anticipoMetodoPago, monto: anticipoAmount });
  }
  await validateNewOrderRefaccionesStock(financials.refacciones);
  const evidenciasIniciales = normalizePhotoList(data.evidenciasNuevas || data.fotografias || data.fotos || []);
  const fotografias = stringifyOrderPhotos(evidenciasIniciales);
  const pendientePresupuesto = Boolean(data.pendiente_presupuesto)
    || data.tipo_orden === 'Inspección / diagnóstico para presupuesto posterior'
    || data.orderType === 'Inspección / diagnóstico para presupuesto posterior';
  const columns = [
    'folio', 'cliente_id', 'usuario_creador_id',
    'tipo_equipo', 'marca', 'modelo', 'descripcion_equipo', 'imei1', 'imei2', 'serie', 'color',
    'falla_reportada', 'servicio_solicitado', 'descripcion_falla',
    'pin', 'password', 'patron',
    'pantalla_rota', 'camara_danada', 'tapa_rota', 'marco_golpeado', 'humedad',
    'pantalla_manchada', 'pantalla_rayada', 'tapa_rayada', 'lente_camara_roto',
    'botones_danados', 'puerto_danado', 'no_enciende', 'equipo_doblado', 'tornillos_faltantes', 'otros_insp',
    'accesorios_sim', 'accesorios_memoria', 'accesorios_funda', 'accesorios_cargador', 'accesorios_cable', 'accesorios_caja', 'accesorios_templado', 'accesorios_otros',
    'lock_type', 'lock_pin', 'lock_pass', 'lock_pattern',
    'sec_android', 'sec_patch', 'sec_imei_orig', 'sec_imei_mod',
    'firma_imagen', 'firma',
    'costo_estimado', 'anticipo', 'costo_real', 'costo_refaccion', 'mano_obra',
    'tipo_orden', 'pendiente_presupuesto',
    'estado', 'status_reason', 'fecha_entrega_estimada', 'fotografias'
  ];
  const values = [
    folio, clienteId, data.usuario_creador_id || 1,
    data.deviceType, normalizeTextValue(data.brand), normalizeTextValue(data.model), normalizeTextValue(data.deviceDescription || data.descripcion_equipo), data.imei || null, data.imei2 || null, data.serial || null, data.color || null,
    normalizeTextValue(data.falla_reportada), normalizeTextValue(data.servicio_solicitado), data.descripcion_falla || null,
    data.lock_pin || null, data.lock_pass || null, data.lock_pattern || null,
    Boolean(data.vis_pantalla_rota), Boolean(data.vis_camara), Boolean(data.vis_tapa || data.vis_tapa_rota), Boolean(data.vis_marco), Boolean(data.vis_humedad),
    Boolean(data.vis_pantalla_manchada), Boolean(data.vis_pantalla_rayada), Boolean(data.vis_tapa_rayada), Boolean(data.vis_lente_camara),
    Boolean(data.vis_botones), Boolean(data.vis_puerto), Boolean(data.vis_no_enciende), Boolean(data.vis_doblado), Boolean(data.vis_tornillos), data.inspeccion_obs || null,
    Boolean(data.acc_sim), Boolean(data.acc_memoria), Boolean(data.acc_funda), Boolean(data.acc_cargador), Boolean(data.acc_cable), Boolean(data.acc_caja), Boolean(data.acc_templado), data.acc_otro_text || (data.acc_otro && typeof data.acc_otro === 'string' ? data.acc_otro : null),
    data.lock_type || 'Ninguno', data.lock_pin || null, data.lock_pass || null, data.lock_pattern || null,
    data.sec_android || null, data.sec_patch || null, data.sec_imei_orig || null, data.sec_imei_mod || null,
    data.firma_imagen || null, data.firma_imagen || null,
    financials.totalReparacion, anticipoAmount,
    financials.costoReal,
    financials.totalRefacciones,
    financials.manoObra,
    data.tipo_orden || data.orderType || 'Reparación directa', pendientePresupuesto,
    estado, pendientePresupuesto ? 'Pendiente de presupuesto' : (data.status_reason || null), data.estimatedDate || null, fotografias
  ];
  const placeholders = values.map((_, index) => `$${index + 1}`).join(',');
  const result = await pool.query(
    `INSERT INTO ordenes_servicio (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values
  );
  const ordenId = result.rows[0].id;

  await pool.query(
    'INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario) VALUES ($1, $2, $3, $4)',
    [ordenId, estado, usuarioId, data.publicRemarks || 'Orden registrada en recepción.']
  );

  const latestHistory = await pool.query(
    'SELECT id FROM historial_estados WHERE orden_id = $1 ORDER BY id DESC LIMIT 1',
    [ordenId]
  );

  await addEvidenciasOrden(ordenId, evidenciasIniciales, {
    estado: 'Recibido',
    historialEstadoId: latestHistory.rows[0]?.id || null,
    usuarioId,
    comentario: data.evidenciaComentario || data.publicRemarks || 'Fotos iniciales de recepcion.',
    visibleCliente: data.evidenciaVisibleCliente !== undefined ? data.evidenciaVisibleCliente : true
  });

  if (hasOrderRefaccionesPayload(data)) {
    await syncOrdenRefacciones(ordenId, financials.refacciones, {
      usuarioId,
      estado
    });
  }

  if (anticipoAmount > 0) {
    await cajaService.registerMovimiento({
      usuario_id: usuarioId,
      tipo_movimiento: 'anticipo',
      metodo_pago: anticipoMetodoPago,
      monto: anticipoAmount,
      descripcion: `Anticipo de orden ${folio}`,
      referencia_tipo: 'orden',
      referencia_id: ordenId
    });
  }

  return getOrdenById(ordenId);
}

async function updateOrden(id, data) {
  const oldOrderRes = await pool.query(
    'SELECT cliente_id, estado, otros_insp, costo_estimado, costo_refaccion, mano_obra, anticipo, folio FROM ordenes_servicio WHERE id = $1',
    [id]
  );
  if (oldOrderRes.rows.length === 0) return null;
  const oldOrder = oldOrderRes.rows[0];
  const usuarioId = data.usuario_creador_id || data.usuario_id || data.userId || 1;
  const financials = buildOrderFinancials(data);
  const nextAnticipo = normalizeMoneyValue(data.anticipo);
  const previousAnticipo = normalizeMoneyValue(oldOrder.anticipo);
  const anticipoDelta = Number((nextAnticipo - previousAnticipo).toFixed(2));
  const anticipoMetodoPago = data.metodo_pago_anticipo || data.metodo_pago_abono || data.advancePaymentMethod || data.metodo_pago || 'Efectivo';
  if (anticipoDelta !== 0) {
    await cajaService.ensurePaymentAllowed({ metodo_pago: anticipoMetodoPago, monto: Math.abs(anticipoDelta) });
  }
  if (hasOrderRefaccionesPayload(data)) {
    await validateEditedOrderRefaccionesStock(id, financials.refacciones);
  }

  const statusChanged = data.status && data.status !== oldOrder.estado;
  const evidenciasNuevas = normalizePhotoList(data.evidenciasNuevas || []);
  const fotografias = stringifyOrderPhotos(data.fotografias ?? data.fotos);

  let clienteId = oldOrder.cliente_id;
  const nombreCliente = normalizeTextValue(data.clientFullName || data.nombre_completo || buildClientFullName(data));
  const nombresCliente = normalizeTextValue(data.clientName || data.nombre) || nombreCliente;
  const apellidoPaterno = normalizeTextValue(data.clientLastNamePaternal || data.apellido_paterno);
  const apellidoMaterno = normalizeTextValue(data.clientLastNameMaternal || data.apellido_materno);
  const telefonoCliente = normalizeTextValue(data.clientPhone || data.telefono);
  const telefonoAlternativo1 = normalizeTextValue(data.clientPhoneAlt1 || data.telefono_alt1 || data.telefono_alternativo_1);
  const telefonoAlternativo2 = normalizeTextValue(data.clientPhoneAlt2 || data.telefono_alt2 || data.telefono_alternativo_2);
  const telefonoAlternativo3 = normalizeTextValue(data.clientPhoneAlt3 || data.telefono_alt3 || data.telefono_alternativo_3);
  const contactoPreferido = normalizeTextValue(data.clientPreferredContact || data.contacto_preferido);
  const emailCliente = data.clientEmail || data.email || null;
  const direccionCliente = data.clientAddress || data.direccion || null;
  const observacionesCliente = data.clientRemarks || data.observaciones || null;

  if (data.clientId) {
    const parsedClientId = parseInt(data.clientId, 10);
    if (!Number.isNaN(parsedClientId)) clienteId = parsedClientId;
  }

  if (nombreCliente || apellidoPaterno || apellidoMaterno || telefonoCliente || telefonoAlternativo1 || telefonoAlternativo2 || telefonoAlternativo3 || contactoPreferido || emailCliente || direccionCliente || observacionesCliente) {
    if (clienteId) {
      await pool.query(
        `UPDATE clientes SET nombre = COALESCE($1, nombre), apellido_paterno = COALESCE($2, apellido_paterno), apellido_materno = COALESCE($3, apellido_materno), telefono_principal = COALESCE($4, telefono_principal), telefono_alternativo_1 = COALESCE($5, telefono_alternativo_1), telefono_alternativo_2 = COALESCE($6, telefono_alternativo_2), telefono_alternativo_3 = COALESCE($7, telefono_alternativo_3), correo = COALESCE($8, correo), direccion = COALESCE($9, direccion), contacto_preferido = COALESCE($10, contacto_preferido), notas = COALESCE($11, notas) WHERE id = $12`,
        [nombresCliente, apellidoPaterno, apellidoMaterno, telefonoCliente, telefonoAlternativo1, telefonoAlternativo2, telefonoAlternativo3, emailCliente, direccionCliente, contactoPreferido, observacionesCliente, clienteId]
      );
    } else if (telefonoCliente) {
      const duplicate = await findDuplicateCliente({
        clientName: nombresCliente,
        clientLastNamePaternal: apellidoPaterno,
        clientLastNameMaternal: apellidoMaterno,
        clientPhone: telefonoCliente
      });
      if (duplicate?.type === 'strong') {
        clienteId = duplicate.cliente.id;
      } else {
        const createdClient = await pool.query(
          `INSERT INTO clientes (nombre, apellido_paterno, apellido_materno, telefono_principal, telefono_alternativo_1, telefono_alternativo_2, telefono_alternativo_3, correo, direccion, contacto_preferido, notas) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [nombresCliente || 'Cliente sin nombre', apellidoPaterno, apellidoMaterno, telefonoCliente, telefonoAlternativo1, telefonoAlternativo2, telefonoAlternativo3, emailCliente, direccionCliente, contactoPreferido, observacionesCliente]
        );
        clienteId = createdClient.rows[0].id;
      }
    } else {
      const createdClient = await pool.query(
        `INSERT INTO clientes (nombre, apellido_paterno, apellido_materno, telefono_principal, telefono_alternativo_1, telefono_alternativo_2, telefono_alternativo_3, correo, direccion, contacto_preferido, notas) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [nombresCliente || 'Cliente sin nombre', apellidoPaterno, apellidoMaterno, null, telefonoAlternativo1, telefonoAlternativo2, telefonoAlternativo3, emailCliente, direccionCliente, contactoPreferido, observacionesCliente]
      );
      clienteId = createdClient.rows[0].id;
    }
  }

  if (clienteId) {
    await pool.query('UPDATE ordenes_servicio SET cliente_id = $1 WHERE id = $2', [clienteId, id]);
  }

  const pendientePresupuesto = Boolean(data.pendiente_presupuesto)
    || data.tipo_orden === 'Inspección / diagnóstico para presupuesto posterior'
    || data.orderType === 'Inspección / diagnóstico para presupuesto posterior';
  const updates = {
    tipo_equipo: data.deviceType,
    marca: normalizeTextValue(data.brand),
    modelo: normalizeTextValue(data.model),
    descripcion_equipo: normalizeTextValue(data.deviceDescription || data.descripcion_equipo),
    imei1: data.imei || null,
    imei2: data.imei2 || null,
    serie: data.serial || null,
    color: data.color || null,
    falla_reportada: normalizeTextValue(data.falla_reportada),
    servicio_solicitado: normalizeTextValue(data.servicio_solicitado),
    descripcion_falla: data.descripcion_falla || null,
    lock_type: data.lock_type || 'Ninguno',
    lock_pin: data.lock_pin || null,
    lock_pass: data.lock_pass || null,
    lock_pattern: data.lock_pattern || null,
    pantalla_rota: Boolean(data.vis_pantalla_rota),
    camara_danada: Boolean(data.vis_camara),
    tapa_rota: Boolean(data.vis_tapa || data.vis_tapa_rota),
    marco_golpeado: Boolean(data.vis_marco),
    humedad: Boolean(data.vis_humedad),
    pantalla_manchada: Boolean(data.vis_pantalla_manchada),
    pantalla_rayada: Boolean(data.vis_pantalla_rayada),
    tapa_rayada: Boolean(data.vis_tapa_rayada),
    lente_camara_roto: Boolean(data.vis_lente_camara),
    botones_danados: Boolean(data.vis_botones),
    puerto_danado: Boolean(data.vis_puerto),
    no_enciende: Boolean(data.vis_no_enciende),
    equipo_doblado: Boolean(data.vis_doblado),
    tornillos_faltantes: Boolean(data.vis_tornillos),
    otros_insp: data.inspeccion_obs || null,
    accesorios_funda: Boolean(data.acc_funda),
    accesorios_sim: Boolean(data.acc_sim),
    accesorios_memoria: Boolean(data.acc_memoria),
    accesorios_cargador: Boolean(data.acc_cargador),
    accesorios_cable: Boolean(data.acc_cable),
    accesorios_caja: Boolean(data.acc_caja),
    accesorios_templado: Boolean(data.acc_templado),
    accesorios_otros: data.acc_otro_text || (data.acc_otro && typeof data.acc_otro === 'string' ? data.acc_otro : null),
    firma_imagen: data.firma_imagen || null,
    costo_estimado: financials.totalReparacion,
    anticipo: nextAnticipo,
    costo_real: financials.costoReal,
    costo_refaccion: financials.totalRefacciones,
    mano_obra: financials.manoObra,
    tipo_orden: data.tipo_orden || data.orderType || 'Reparación directa',
    pendiente_presupuesto: pendientePresupuesto,
    estado: data.status,
    status_reason: pendientePresupuesto ? 'Pendiente de presupuesto' : (data.status_reason || null),
    fecha_entrega_estimada: data.estimatedDate || null,
    sec_android: data.sec_android || null,
    sec_patch: data.sec_patch || null,
    sec_imei_orig: data.sec_imei_orig || null,
    sec_imei_mod: data.sec_imei_mod || null
  };

  if (fotografias !== undefined) {
    updates.fotografias = fotografias;
  }

  const updateEntries = Object.entries(updates);
  const setClause = updateEntries.map(([key], index) => `${key} = $${index + 1}`).join(', ');
  await pool.query(
    `UPDATE ordenes_servicio SET ${setClause} WHERE id = $${updateEntries.length + 1}`,
    [...updateEntries.map(([, value]) => value), id]
  );

  if (statusChanged || data.publicRemarks) {
    await pool.query(
      'INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario) VALUES ($1, $2, $3, $4)',
      [id, data.status, usuarioId, data.publicRemarks || 'Detalles de la orden actualizados.']
    );
  }

  const updateHistoryMessages = [];
  if (data.inspeccion_obs !== undefined && String(data.inspeccion_obs || '') !== String(oldOrder.otros_insp || '')) {
    updateHistoryMessages.push('Observaciones de inspeccion modificadas.');
  }
  if (Number(oldOrder.costo_estimado || 0) !== Number(financials.totalReparacion || 0)
      || Number(oldOrder.costo_refaccion || 0) !== Number(financials.totalRefacciones || 0)) {
    updateHistoryMessages.push(`Precio total actualizado. Total reparacion: $${Number(financials.totalReparacion || 0).toFixed(2)}.`);
  }
  for (const message of updateHistoryMessages) {
    await pool.query(
      'INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario) VALUES ($1, $2, $3, $4)',
      [id, data.status || oldOrder.estado, usuarioId, message]
    );
  }

  if (evidenciasNuevas.length > 0) {
    let historialEstadoId = null;
    const estadoEvidencia = data.evidenciaEstado || data.status || oldOrder.estado || 'Recibido';

    if (!statusChanged && !data.publicRemarks) {
      const historialRes = await pool.query(
        'INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario) VALUES ($1, $2, $3, $4) RETURNING id',
        [id, estadoEvidencia, usuarioId, data.evidenciaComentario || `Evidencia agregada en ${estadoEvidencia}.`]
      );
      historialEstadoId = historialRes.rows[0]?.id || null;
    } else {
      const latestHistory = await pool.query(
        'SELECT id FROM historial_estados WHERE orden_id = $1 ORDER BY id DESC LIMIT 1',
        [id]
      );
      historialEstadoId = latestHistory.rows[0]?.id || null;
    }

    await addEvidenciasOrden(id, evidenciasNuevas, {
      estado: estadoEvidencia,
      historialEstadoId,
      usuarioId,
      comentario: data.evidenciaComentario || data.publicRemarks || null,
      visibleCliente: data.evidenciaVisibleCliente !== undefined
        ? data.evidenciaVisibleCliente
        : defaultEvidenceVisibility(estadoEvidencia)
    });
  }

  if (hasOrderRefaccionesPayload(data)) {
    await syncOrdenRefacciones(id, financials.refacciones, {
      usuarioId,
      estado: data.status || oldOrder.estado
    });
  }

  if (anticipoDelta !== 0) {
    await cajaService.registerMovimiento({
      usuario_id: usuarioId,
      tipo_movimiento: anticipoDelta > 0 ? 'abono' : 'devolucion',
      metodo_pago: anticipoMetodoPago,
      monto: Math.abs(anticipoDelta),
      descripcion: anticipoDelta > 0
        ? `Abono agregado a orden ${oldOrder.folio}`
        : `Devolucion o ajuste de anticipo en orden ${oldOrder.folio}`,
      referencia_tipo: 'orden',
      referencia_id: id
    });
  }

  if (Object.prototype.hasOwnProperty.call(data, 'garantia') || Object.prototype.hasOwnProperty.call(data, 'warranty')) {
    await garantiaService.createOrUpdateGarantiaFromOrder(id, data, usuarioId);
  }

  return getOrdenById(id);
}

async function updateOrdenEstado(id, estado, comentario, usuarioId = 1, evidencias = [], options = {}) {
  const orderExists = await pool.query('SELECT id FROM ordenes_servicio WHERE id = $1', [id]);
  if (orderExists.rows.length === 0) return null;

  await pool.query(
    'UPDATE ordenes_servicio SET estado = $1 WHERE id = $2',
    [estado, id]
  );

  const historialRes = await pool.query(
    'INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario) VALUES ($1, $2, $3, $4) RETURNING id',
    [id, estado, usuarioId, comentario || `Cambio de estado a ${estado}.`]
  );

  await addEvidenciasOrden(id, evidencias, {
    estado,
    historialEstadoId: historialRes.rows[0]?.id || null,
    usuarioId,
    comentario: options.evidenciaComentario || comentario || null,
    visibleCliente: options.visibleCliente !== undefined ? options.visibleCliente : defaultEvidenceVisibility(estado)
  });

  return getOrdenById(id);
}

async function checkOverdueOrders(usuarioId = 1) {
  const overdue = await pool.query(`
    SELECT id
    FROM ordenes_servicio
    WHERE estado NOT IN ('Entregado', 'Cancelado', 'Retrasado')
      AND COALESCE(estado_pago, 'Pendiente') <> 'Pagado'
      AND fecha_entrega_estimada IS NOT NULL
      AND TRIM(fecha_entrega_estimada) <> ''
      AND CASE
        WHEN fecha_entrega_estimada ~ '^\\d{4}-\\d{2}-\\d{2}' THEN fecha_entrega_estimada::date
        ELSE NULL
      END < CURRENT_DATE
  `);

  for (const order of overdue.rows) {
    await pool.query(
      `UPDATE ordenes_servicio
       SET estado = 'Retrasado', status_reason = COALESCE(status_reason, 'Fecha de entrega vencida'), fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [order.id]
    );
    await pool.query(
      `INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario)
       VALUES ($1, 'Retrasado', $2, 'Marcado automaticamente por fecha de entrega vencida.')`,
      [order.id, usuarioId]
    );
  }

  return { updated: overdue.rows.length };
}

function getOrderEventColor(estado) {
  const normalized = String(estado || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (normalized === 'recibido') return '#2563eb';
  if (normalized.includes('diagnostico')) return '#06b6d4';
  if (normalized.includes('refaccion') || normalized.includes('pieza')) return '#8b5cf6';
  if (normalized.includes('reparacion')) return '#f59e0b';
  if (normalized.includes('retrasado')) return '#ef4444';
  if (normalized.includes('terminado')) return '#0d9488';
  if (normalized.includes('entregado')) return '#22c55e';
  if (normalized.includes('listo')) return '#10b981';
  if (normalized.includes('autorizacion')) return '#f59e0b';
  if (normalized.includes('cancelado')) return '#ef4444';
  return '#64748b';
}

async function getCalendarEvents() {
  const [orders, quotes, manualEvents] = await Promise.all([
    pool.query(`
      SELECT o.id, o.folio, o.tipo_equipo, o.marca, o.modelo, o.estado, o.fecha_entrega_estimada, o.fecha_creacion,
             o.estado_pago, c.nombre as cliente
      FROM ordenes_servicio o
      JOIN clientes c ON c.id = o.cliente_id
      WHERE o.estado <> 'Cancelado'
      ORDER BY COALESCE(
        CASE
          WHEN o.fecha_entrega_estimada ~ '^\\d{4}-\\d{2}-\\d{2}' THEN o.fecha_entrega_estimada::date
          ELSE NULL
        END,
        o.fecha_creacion::date
      ) ASC
    `),
    pool.query(`
      SELECT id, nombre, equipo, marca, modelo, estado, fecha_creacion
      FROM cotizaciones
      WHERE estado = 'Pendiente'
      ORDER BY fecha_creacion ASC
    `),
    pool.query(`
      SELECT c.*, o.folio, o.estado as orden_estado
      FROM eventos_calendario c
      LEFT JOIN ordenes_servicio o ON c.orden_id = o.id
      ORDER BY c.fecha_inicio ASC
    `)
  ]);

  const orderEvents = orders.rows.map(order => {
    const start = order.fecha_entrega_estimada || String(order.fecha_creacion).split('T')[0];
    const equipo = `${order.tipo_equipo || 'Equipo'} ${order.marca || ''} ${order.modelo || ''}`.trim();
    return {
      id: `order-${order.id}`,
      source: 'order',
      orderId: order.id,
      title: `${order.folio} · ${order.cliente}`,
      start,
      allDay: true,
      color: getOrderEventColor(order.estado),
      extendedProps: {
        type: 'order',
        folio: order.folio,
        cliente: order.cliente,
        equipo,
        estado: order.estado,
        estado_pago: order.estado_pago || 'Pendiente',
        fecha_entrega: order.fecha_entrega_estimada || null
      }
    };
  });

  const quoteEvents = quotes.rows.map(quote => ({
    id: `quote-${quote.id}`,
    source: 'quote',
    title: `Cotizacion pendiente · ${quote.nombre}`,
    start: quote.fecha_creacion,
    allDay: true,
    color: '#1e3a8a',
    extendedProps: {
      type: 'quote',
      quoteId: quote.id,
      folio: `COT-${String(quote.id).padStart(4, '0')}`,
      cliente: quote.nombre,
      equipo: `${quote.equipo || 'Equipo'} ${quote.marca || ''} ${quote.modelo || ''}`.trim(),
      estado: quote.estado
    }
  }));

  const manual = manualEvents.rows.map(event => ({
    id: `event-${event.id}`,
    source: 'manual',
    eventId: event.id,
    title: event.titulo,
    start: event.fecha_inicio,
    end: event.fecha_fin || null,
    color: event.color || '#3b82f6',
    extendedProps: {
      type: 'manual',
      eventId: event.id,
      folio: event.folio || 'Actividad',
      cliente: 'Taller',
      equipo: event.descripcion || '',
      estado: event.tipo_evento || event.categoria || 'Actividad',
      category: event.tipo_evento || event.categoria || 'otro',
      description: event.descripcion
    }
  }));

  return [...orderEvents, ...quoteEvents, ...manual];
}

async function getPosOrderByFolio(folio) {
  const order = await getOrdenByFolio(folio);
  if (!order) return null;
  const total = Number(order.costo_real ?? order.costo_estimado ?? 0);
  const anticipo = Number(order.anticipo || 0);
  const paid = order.estado_pago === 'Pagado';
  const saldo = paid ? 0 : Math.max(total - anticipo, 0);
  return {
    id: order.id,
    folio: order.folio,
    cliente: order.clientName,
    equipo: `${order.deviceType || 'Equipo'} ${order.brand || ''} ${order.model || ''}`.trim(),
    estado: order.status,
    estado_pago: order.estado_pago || 'Pendiente',
    total,
    anticipo,
    saldo_pendiente: saldo,
    fecha_entrega_estimada: order.estimatedDate || null
  };
}

async function payOrderBalance({
  folio,
  metodo_pago,
  monto_recibido = 0,
  transferencia_recibida = 0,
  referencia_transferencia = null,
  observaciones_ticket = null,
  usuario_id = null
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const normalizedFolio = normalizeFolioLookup(folio);
    const orderRes = await client.query(`
      SELECT o.*, c.nombre as cliente
      FROM ordenes_servicio o
      JOIN clientes c ON c.id = o.cliente_id
      WHERE UPPER(TRIM(o.folio)) = UPPER(TRIM($1))
      FOR UPDATE
    `, [normalizedFolio]);
    if (orderRes.rows.length === 0) throw new Error('Orden no encontrada.');

    const order = orderRes.rows[0];
    const total = Number(order.costo_real ?? order.costo_estimado ?? 0);
    const anticipo = Number(order.anticipo || 0);
    const saldo = order.estado_pago === 'Pagado' ? 0 : Math.max(total - anticipo, 0);
    if (saldo <= 0) throw new Error('La orden no tiene saldo pendiente.');
    const payment = normalizeSalePayment({
      metodo_pago,
      monto_recibido,
      efectivo_recibido: monto_recibido,
      transferencia_recibida,
      referencia_transferencia,
      observaciones_ticket
    }, saldo);

    const ventaResult = await client.query(
      `INSERT INTO ventas
       (usuario_id, subtotal, descuento, total, metodo_pago, efectivo_recibido, transferencia_recibida,
        referencia_transferencia, observaciones_ticket, monto_recibido, cambio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        usuario_id,
        payment.subtotal,
        payment.descuento,
        payment.total,
        payment.metodoPago,
        payment.efectivoRecibido,
        payment.transferenciaRecibida,
        payment.referenciaTransferencia,
        payment.observacionesTicket,
        payment.montoRecibido,
        payment.cambio
      ]
    );

    await client.query(`
      UPDATE ordenes_servicio
      SET estado_pago = 'Pagado',
          estado = 'Entregado',
          costo_real = COALESCE(costo_real, costo_estimado, 0),
          fecha_entrega_real = CURRENT_TIMESTAMP,
          pagado_en = CURRENT_TIMESTAMP,
          fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [order.id]);

    await client.query(
      `INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario)
       VALUES ($1, 'Entregado', $2, $3)`,
      [order.id, usuario_id || order.usuario_creador_id || 1, `Saldo liquidado desde Punto de Venta. Venta #${ventaResult.rows[0].id}.`]
    );

    for (const split of [
      { metodo: 'Efectivo', amount: payment.efectivoAplicado },
      { metodo: 'Transferencia', amount: payment.transferenciaAplicada },
      { metodo: 'Tarjeta', amount: payment.tarjetaAplicada }
    ]) {
      if (split.amount <= 0) continue;
      await cajaService.registerMovimiento({
        usuario_id: usuario_id || order.usuario_creador_id || null,
        tipo_movimiento: 'liquidacion',
        metodo_pago: split.metodo,
        monto: split.amount,
        descripcion: `Liquidacion de orden ${order.folio}`,
        referencia_tipo: 'venta',
        referencia_id: ventaResult.rows[0].id
      }, { client, lock: true });
    }

    const venta = ventaResult.rows[0];
    const updatedOrder = {
      id: order.id,
      folio: order.folio,
      cliente: order.cliente,
      equipo: `${order.tipo_equipo || 'Equipo'} ${order.marca || ''} ${order.modelo || ''}`.trim(),
      estado: 'Entregado',
      estado_pago: 'Pagado',
      total,
      anticipo,
      saldo_pendiente: 0,
      fecha_entrega_estimada: order.fecha_entrega_estimada || null
    };

    await client.query('COMMIT');
    return {
      ...venta,
      subtotal: Number(venta.subtotal || saldo),
      descuento: Number(venta.descuento || 0),
      total: Number(venta.total),
      efectivo_recibido: Number(venta.efectivo_recibido || 0),
      transferencia_recibida: Number(venta.transferencia_recibida || 0),
      monto_recibido: Number(venta.monto_recibido),
      cambio: Number(venta.cambio),
      items: [{
        cantidad: 1,
        nombre: `Saldo orden ${order.folio}`,
        precio_unitario: saldo,
        subtotal: saldo
      }],
      orden: updatedOrder
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteEvidenciaOrden(ordenId, evidenciaId) {
  const result = await pool.query(
    'DELETE FROM evidencias_orden WHERE id = $1 AND orden_id = $2 RETURNING id',
    [evidenciaId, ordenId]
  );
  return result.rows.length > 0;
}

async function returnOrdenRefaccionesStock(ordenId, usuarioId = 1, db = pool) {
  const refacciones = await db.query(
    `SELECT opr.producto_id, opr.cantidad, i.nombre, i.stock
     FROM orden_refacciones opr
     JOIN inventario i ON i.id = opr.producto_id
     WHERE opr.orden_id = $1
     FOR UPDATE OF opr, i`,
    [ordenId]
  );

  for (const item of refacciones.rows) {
    const cantidad = Number(item.cantidad || 0);
    const stockAnterior = Number(item.stock || 0);
    const stockNuevo = stockAnterior + cantidad;

    await db.query(
      'UPDATE inventario SET stock = $1 WHERE id = $2',
      [stockNuevo, item.producto_id]
    );
    await db.query(
      `INSERT INTO movimientos_inventario
       (producto_id, orden_id, usuario_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        item.producto_id,
        ordenId,
        usuarioId,
        'entrada_orden_eliminada',
        cantidad,
        stockAnterior,
        stockNuevo,
        `Stock devuelto por eliminacion de orden #${ordenId}`
      ]
    );
  }
}

async function deleteOrdenInTransaction(id, usuarioId = 1, db = pool) {
  const orderRes = await db.query(
    'SELECT id FROM ordenes_servicio WHERE id = $1 FOR UPDATE',
    [id]
  );
  if (orderRes.rows.length === 0) return false;

  await returnOrdenRefaccionesStock(id, usuarioId, db);
  await db.query('UPDATE ventas_detalle SET orden_id = NULL WHERE orden_id = $1', [id]);
  await db.query('UPDATE eventos_calendario SET orden_id = NULL WHERE orden_id = $1', [id]);
  await db.query('UPDATE cotizaciones SET orden_id = NULL WHERE orden_id = $1', [id]);
  await db.query('DELETE FROM orden_refacciones WHERE orden_id = $1', [id]);
  await db.query('DELETE FROM evidencias_orden WHERE orden_id = $1', [id]);
  await db.query('DELETE FROM historial_estados WHERE orden_id = $1', [id]);
  await db.query('DELETE FROM ordenes_servicio WHERE id = $1', [id]);
  return true;
}

async function deleteOrden(id, usuarioId = 1) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deleted = await deleteOrdenInTransaction(id, usuarioId, client);
    await client.query('COMMIT');
    return deleted;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteCliente(id, usuarioId = 1) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const clienteRes = await client.query(
      'SELECT id FROM clientes WHERE id = $1 AND activo = true FOR UPDATE',
      [id]
    );
    if (clienteRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const orders = await client.query(
      'SELECT id FROM ordenes_servicio WHERE cliente_id = $1 ORDER BY id ASC FOR UPDATE',
      [id]
    );
    for (const order of orders.rows) {
      await deleteOrdenInTransaction(order.id, usuarioId, client);
    }

    await client.query('UPDATE clientes SET activo = false WHERE id = $1', [id]);
    await client.query('COMMIT');
    return {
      deleted: true,
      ordenes_eliminadas: orders.rows.length
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error al revertir eliminacion de cliente:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function addFotoOrden(ordenId, urlFoto, etapa) {
  const orderExists = await pool.query('SELECT id FROM ordenes_servicio WHERE id = $1', [ordenId]);
  if (orderExists.rows.length === 0) return null;

  const inserted = await addEvidenciasOrden(ordenId, [urlFoto], {
    estado: etapa || 'Sin clasificar',
    tipoEvidencia: 'foto',
    visibleCliente: defaultEvidenceVisibility(etapa || '')
  });

  return {
    id: inserted[0]?.id,
    ordenId,
    url_foto: urlFoto,
    etapa
  };
}

// --------------------------------------------------------
// SERVICIOS DE INVENTARIO (REAL DESDE BD)
// --------------------------------------------------------

async function getAllInventario() {
  const res = await pool.query('SELECT * FROM inventario WHERE activo = true ORDER BY id DESC');
  return res.rows.map(item => ({
    ...item,
    costo: parseFloat(item.costo),
    precio: parseFloat(item.precio)
  }));
}

async function createInventarioItem(data) {
  const result = await pool.query(
    `INSERT INTO inventario (codigo, nombre, categoria, descripcion, costo, precio, stock, stock_minimo, foto_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      data.codigo,
      data.nombre,
      data.categoria,
      data.descripcion || null,
      data.costo || 0,
      data.precio || 0,
      data.stock || 0,
      data.stock_minimo || 0,
      data.foto_url || null
    ]
  );
  return { id: result.rows[0].id, ...data };
}

async function updateInventarioItem(id, data) {
  await pool.query(
    `UPDATE inventario SET codigo = $1, nombre = $2, categoria = $3, descripcion = $4, costo = $5, precio = $6, stock = $7, stock_minimo = $8, foto_url = $9
     WHERE id = $10`,
    [
      data.codigo,
      data.nombre,
      data.categoria,
      data.descripcion || null,
      data.costo || 0,
      data.precio || 0,
      data.stock || 0,
      data.stock_minimo || 0,
      data.foto_url || null,
      id
    ]
  );
  return { id, ...data };
}

async function deleteInventarioItem(id) {
  await pool.query('UPDATE inventario SET activo = false WHERE id = $1', [id]);
  return true;
}

// --------------------------------------------------------
// SERVICIOS DE PUNTO DE VENTA (POS VENTAS REALES)
// --------------------------------------------------------

function clampMoney(value, min, max) {
  return Math.min(Math.max(normalizeMoneyValue(value), min), max);
}

function normalizeSalePayment(data, subtotal) {
  const metodoPago = data.metodo_pago || 'Efectivo';
  const descuento = clampMoney(data.descuento, 0, subtotal);
  const total = Number(Math.max(subtotal - descuento, 0).toFixed(2));
  const rawCash = data.efectivo_recibido !== undefined ? data.efectivo_recibido : data.monto_recibido;
  let efectivoRecibido = ['Efectivo', 'Mixto'].includes(metodoPago) ? normalizeMoneyValue(rawCash) : 0;
  let transferenciaRecibida = ['Transferencia', 'Mixto'].includes(metodoPago)
    ? normalizeMoneyValue(data.transferencia_recibida)
    : 0;

  if (metodoPago === 'Transferencia' && transferenciaRecibida <= 0) transferenciaRecibida = total;
  if (metodoPago === 'Tarjeta') {
    efectivoRecibido = 0;
    transferenciaRecibida = 0;
  }

  const disponible = metodoPago === 'Efectivo'
    ? efectivoRecibido
    : metodoPago === 'Transferencia'
      ? transferenciaRecibida
      : metodoPago === 'Mixto'
        ? efectivoRecibido + transferenciaRecibida
        : total;

  if (metodoPago === 'Efectivo' && efectivoRecibido < total) {
    throw new Error('El efectivo recibido es menor al total a cobrar.');
  }
  if (metodoPago === 'Transferencia' && transferenciaRecibida < total) {
    throw new Error('La transferencia recibida es menor al total a cobrar.');
  }
  if (metodoPago === 'Mixto' && disponible < total) {
    throw new Error('El pago mixto no cubre el total a cobrar.');
  }

  const cambio = ['Efectivo', 'Mixto'].includes(metodoPago)
    ? Number(Math.min(efectivoRecibido, Math.max(disponible - total, 0)).toFixed(2))
    : 0;
  const efectivoAplicado = Number(Math.max(efectivoRecibido - cambio, 0).toFixed(2));
  const transferenciaAplicada = metodoPago === 'Transferencia'
    ? total
    : metodoPago === 'Mixto'
      ? Number(Math.max(Math.min(transferenciaRecibida, total - efectivoAplicado), 0).toFixed(2))
      : 0;
  const tarjetaAplicada = metodoPago === 'Tarjeta' ? total : 0;
  const montoRecibido = metodoPago === 'Efectivo'
    ? efectivoRecibido
    : metodoPago === 'Mixto'
      ? efectivoRecibido
      : metodoPago === 'Transferencia'
        ? transferenciaRecibida
        : total;

  return {
    metodoPago,
    subtotal: Number(subtotal.toFixed(2)),
    descuento,
    total,
    efectivoRecibido: Number(efectivoRecibido.toFixed(2)),
    transferenciaRecibida: Number(transferenciaRecibida.toFixed(2)),
    efectivoAplicado,
    transferenciaAplicada,
    tarjetaAplicada,
    montoRecibido: Number(montoRecibido.toFixed(2)),
    cambio,
    referenciaTransferencia: data.referencia_transferencia || null,
    observacionesTicket: data.observaciones_ticket || null
  };
}

function allocatePaymentByType(items, subtotal, paymentAmount, targetType) {
  if (paymentAmount <= 0 || subtotal <= 0) return 0;
  const gross = items
    .filter(item => item.tipo_item === targetType)
    .reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  return Number(((paymentAmount * gross) / subtotal).toFixed(2));
}

async function createVenta(data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const normalizedItems = [];
    const orderFolios = new Set();

    for (const item of data.items || []) {
      if (item.tipo === 'reparacion' || item.tipo_item === 'reparacion') {
        const folio = String(item.orden_folio || item.folio || '').trim();
        if (!folio) throw new Error('Folio de orden requerido para cobro de reparacion.');
        if (orderFolios.has(folio.toUpperCase())) throw new Error(`La orden ${folio} esta duplicada en el carrito.`);
        orderFolios.add(folio.toUpperCase());

        const orderRes = await client.query(`
          SELECT o.*, c.nombre as cliente
          FROM ordenes_servicio o
          JOIN clientes c ON c.id = o.cliente_id
          WHERE UPPER(TRIM(o.folio)) = UPPER(TRIM($1))
          FOR UPDATE
        `, [folio]);
        if (orderRes.rows.length === 0) throw new Error(`Orden ${folio} no encontrada.`);

        const order = orderRes.rows[0];
        if (order.estado_pago === 'Pagado') throw new Error('Esta orden ya fue pagada.');
        if (order.estado === 'Entregado' && order.estado_pago === 'Pagado') throw new Error('Esta orden ya fue pagada.');

        const total = Number(order.costo_real ?? order.costo_estimado ?? 0);
        const anticipo = Number(order.anticipo || 0);
        const saldo = Math.max(total - anticipo, 0);
        if (saldo <= 0) throw new Error('La orden no tiene saldo pendiente.');

        const equipo = `${order.tipo_equipo || 'Equipo'} ${order.marca || ''} ${order.modelo || ''}`.trim();
        normalizedItems.push({
          tipo_item: 'reparacion',
          producto_id: null,
          orden_id: order.id,
          orden_folio: order.folio,
          cliente: order.cliente,
          equipo,
          nombre: `Servicio de reparacion - ${order.folio}`,
          descripcion: `Cliente: ${order.cliente} | Equipo: ${equipo} | Total reparacion: $${total.toFixed(2)} | Anticipo: $${anticipo.toFixed(2)} | Saldo pendiente: $${saldo.toFixed(2)}`,
          cantidad: 1,
          precio_unitario: saldo,
          subtotal: saldo
        });
      } else {
        const cantidad = parseInt(item.cantidad, 10) || 0;
        const productoId = parseInt(item.producto_id, 10);
        if (!productoId || cantidad <= 0) throw new Error('Producto o cantidad invalida en el carrito.');

        const prodRes = await client.query('SELECT id, stock, nombre FROM inventario WHERE id = $1 FOR UPDATE', [productoId]);
        if (prodRes.rows.length === 0) {
          throw new Error(`El producto con ID ${productoId} no existe en el inventario.`);
        }
        const prod = prodRes.rows[0];
        if (prod.stock < cantidad) {
          throw new Error(`Stock insuficiente para "${prod.nombre}". Disponible: ${prod.stock} pz, solicitado: ${cantidad} pz.`);
        }
        const precio = Number(item.precio_unitario || 0);
        normalizedItems.push({
          tipo_item: 'producto',
          producto_id: productoId,
          orden_id: null,
          nombre: item.nombre || prod.nombre,
          descripcion: item.descripcion || null,
          cantidad,
          precio_unitario: precio,
          subtotal: precio * cantidad
        });
      }
    }

    if (normalizedItems.length === 0) throw new Error('El carrito esta vacio.');

    const subtotalVenta = normalizedItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const payment = normalizeSalePayment(data, subtotalVenta);
    if (payment.efectivoAplicado > 0) {
      await cajaService.ensurePaymentAllowed({ metodo_pago: 'Efectivo', monto: payment.efectivoAplicado }, client);
    }

    const ventaResult = await client.query(
      `INSERT INTO ventas
       (usuario_id, subtotal, descuento, total, metodo_pago, efectivo_recibido, transferencia_recibida,
        referencia_transferencia, observaciones_ticket, monto_recibido, cambio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        data.usuario_id || null,
        payment.subtotal,
        payment.descuento,
        payment.total,
        payment.metodoPago,
        payment.efectivoRecibido,
        payment.transferenciaRecibida,
        payment.referenciaTransferencia,
        payment.observacionesTicket,
        payment.montoRecibido,
        payment.cambio
      ]
    );
    const ventaId = ventaResult.rows[0].id;

    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO ventas_detalle (venta_id, producto_id, orden_id, tipo_item, nombre, descripcion, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [ventaId, item.producto_id, item.orden_id, item.tipo_item, item.nombre, item.descripcion || null, item.cantidad, item.precio_unitario, item.subtotal]
      );

      if (item.tipo_item === 'producto') {
        await client.query(
          `UPDATE inventario SET stock = GREATEST(0, stock - $1) WHERE id = $2`,
          [item.cantidad, item.producto_id]
        );
      } else if (item.tipo_item === 'reparacion') {
        await client.query(`
          UPDATE ordenes_servicio
          SET estado_pago = 'Pagado',
              estado = 'Entregado',
              fecha_entrega_real = CURRENT_TIMESTAMP,
              pagado_en = CURRENT_TIMESTAMP,
              fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [item.orden_id]);
        await client.query(
          `INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario)
           VALUES ($1, 'Entregado', $2, $3)`,
          [item.orden_id, data.usuario_id || 1, `Saldo completado desde Punto de Venta. Venta #${ventaId}.`]
        );
      }
    }

    const paymentSplits = [
      { metodo: 'Efectivo', amount: payment.efectivoAplicado },
      { metodo: 'Transferencia', amount: payment.transferenciaAplicada },
      { metodo: 'Tarjeta', amount: payment.tarjetaAplicada }
    ];

    for (const split of paymentSplits) {
      if (split.amount <= 0) continue;
      const productAmount = allocatePaymentByType(normalizedItems, subtotalVenta, split.amount, 'producto');
      const repairAmount = allocatePaymentByType(normalizedItems, subtotalVenta, split.amount, 'reparacion');

      if (productAmount > 0) {
        await cajaService.registerMovimiento({
          usuario_id: data.usuario_id || null,
          tipo_movimiento: 'venta_pos',
          metodo_pago: split.metodo,
          monto: productAmount,
          descripcion: `Venta POS #${ventaId}`,
          referencia_tipo: 'venta',
          referencia_id: ventaId
        }, { client, lock: true });
      }

      if (repairAmount > 0) {
        await cajaService.registerMovimiento({
          usuario_id: data.usuario_id || null,
          tipo_movimiento: 'liquidacion',
          metodo_pago: split.metodo,
          monto: repairAmount,
          descripcion: `Cobro de reparacion desde POS #${ventaId}`,
          referencia_tipo: 'venta',
          referencia_id: ventaId
        }, { client, lock: true });
      }
    }

    const dbVentaRes = await client.query('SELECT * FROM ventas WHERE id = $1', [ventaId]);
    await client.query('COMMIT');

    const dbVenta = dbVentaRes.rows[0];
    dbVenta.subtotal = parseFloat(dbVenta.subtotal || payment.subtotal);
    dbVenta.descuento = parseFloat(dbVenta.descuento || 0);
    dbVenta.total = parseFloat(dbVenta.total);
    dbVenta.efectivo_recibido = parseFloat(dbVenta.efectivo_recibido || 0);
    dbVenta.transferencia_recibida = parseFloat(dbVenta.transferencia_recibida || 0);
    dbVenta.monto_recibido = parseFloat(dbVenta.monto_recibido);
    dbVenta.cambio = parseFloat(dbVenta.cambio);
    dbVenta.items = normalizedItems;
    return dbVenta;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getAllVentas() {
  const salesRes = await pool.query('SELECT * FROM ventas ORDER BY id DESC');
  const sales = salesRes.rows.map(s => ({
    ...s,
    subtotal: parseFloat(s.subtotal || s.total || 0),
    descuento: parseFloat(s.descuento || 0),
    total: parseFloat(s.total),
    efectivo_recibido: parseFloat(s.efectivo_recibido || s.monto_recibido || 0),
    transferencia_recibida: parseFloat(s.transferencia_recibida || 0),
    monto_recibido: parseFloat(s.monto_recibido),
    cambio: parseFloat(s.cambio)
  }));

  for (const sale of sales) {
    const itemsRes = await pool.query(`
      SELECT dv.*, COALESCE(dv.nombre, inv.nombre) as nombre, inv.costo, o.folio as orden_folio
      FROM ventas_detalle dv
      LEFT JOIN inventario inv ON dv.producto_id = inv.id
      LEFT JOIN ordenes_servicio o ON dv.orden_id = o.id
      WHERE dv.venta_id = $1
    `, [sale.id]);
    sale.items = itemsRes.rows.map(item => ({
      ...item,
      precio_unitario: parseFloat(item.precio_unitario),
      subtotal: parseFloat(item.subtotal || 0),
      costo: parseFloat(item.costo || 0)
    }));
  }
  return sales;
}

// --------------------------------------------------------
// SERVICIOS DE ESTADÍSTICAS Y DASHBOARD
// --------------------------------------------------------

async function getDashboardStats() {
  const orders = await pool.query('SELECT estado FROM ordenes_servicio');
  const counts = { Recibido: 0, Diagnóstico: 0, 'En reparación': 0, Retrasado: 0, 'Listo para entregar': 0, Entregado: 0, Cancelado: 0 };
  orders.rows.forEach(o => {
    if (counts[o.estado] !== undefined) counts[o.estado]++;
  });

  const sales = await pool.query('SELECT total FROM ventas');
  const totalSales = sales.rows.reduce((sum, s) => sum + parseFloat(s.total || 0), 0);

  const completedRepairs = await pool.query("SELECT costo_real, costo_refaccion FROM ordenes_servicio WHERE estado = 'Entregado'");
  const repairsProfit = completedRepairs.rows.reduce((sum, r) => sum + (parseFloat(r.costo_real || 0) - parseFloat(r.costo_refaccion || 0)), 0);

  const lowStockResult = await pool.query('SELECT COUNT(*) as count FROM inventario WHERE stock <= stock_minimo AND activo = true');
  const lowStockCount = parseInt(lowStockResult.rows[0].count, 10);

  return { orderStatusCounts: counts, totalSales, repairsProfit, lowStockCount };
}

// --------------------------------------------------------
// SERVICIOS DE COTIZACIONES (DESDE LA WEB PÚBLICA)
// --------------------------------------------------------

async function getAllCotizaciones() {
  const res = await pool.query('SELECT * FROM cotizaciones ORDER BY id DESC');
  return res.rows;
}

async function createCotizacion(data) {
  const photosJson = data.photos ? JSON.stringify(data.photos) : '[]';
  const result = await pool.query(
    `INSERT INTO cotizaciones (nombre, telefono, equipo, marca, modelo, problema, fotografias, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      data.clientName || data.nombre,
      data.clientPhone || data.telefono,
      data.deviceType || data.equipo,
      data.brand || data.marca,
      data.model || data.modelo,
      data.description || data.problema,
      photosJson,
      data.estado || 'Pendiente'
    ]
  );
  return { id: result.rows[0].id, ...data };
}

async function updateCotizacion(id, data) {
  await pool.query(
    `UPDATE cotizaciones SET estado = $1 WHERE id = $2`,
    [data.estado, id]
  );
  return { id, ...data };
}

async function deleteCotizacion(id) {
  await pool.query('DELETE FROM cotizaciones WHERE id = $1', [id]);
  return true;
}

async function convertirCotizacionAOrden(id) {
  const quoteRes = await pool.query('SELECT * FROM cotizaciones WHERE id = $1', [id]);
  if (quoteRes.rows.length === 0) {
    throw new Error('Cotización no encontrada.');
  }
  const quote = quoteRes.rows[0];

  let cliente = await pool.query('SELECT id FROM clientes WHERE telefono_principal = $1', [quote.telefono]);
  let clienteId;
  if (cliente.rows.length === 0) {
    const newCl = await pool.query(
      'INSERT INTO clientes (nombre, telefono_principal, notas) VALUES ($1, $2, $3) RETURNING id',
      [quote.nombre, quote.telefono, 'Cliente creado desde cotización.']
    );
    clienteId = newCl.rows[0].id;
  } else {
    clienteId = cliente.rows[0].id;
  }

  const activeYear = new Date().getFullYear();
  const lastOrder = await pool.query("SELECT folio FROM ordenes_servicio WHERE folio LIKE $1 ORDER BY id DESC LIMIT 1", [`AFB-${activeYear}-%`]);
  let nextNum = 10000;
  if (lastOrder.rows.length > 0 && lastOrder.rows[0].folio) {
    const parts = lastOrder.rows[0].folio.split('-');
    if (parts.length === 3) {
      const lastNum = parseInt(parts[2], 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
  }
  const folio = `AFB-${activeYear}-${nextNum}`;

  const orderResult = await pool.query(
    `INSERT INTO ordenes_servicio (folio, cliente_id, usuario_creador_id, tipo_equipo, marca, modelo, falla_reportada, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Recibido') RETURNING id`,
    [folio, clienteId, 1, quote.equipo, quote.marca, quote.modelo, quote.problema]
  );
  const ordenId = orderResult.rows[0].id;

  await pool.query(
    'INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario) VALUES ($1, $2, $3, $4)',
    [ordenId, 'Recibido', 1, 'Orden generada a partir de cotización web.']
  );

  await pool.query(
    "UPDATE cotizaciones SET estado = 'Aceptado', orden_id = $1 WHERE id = $2",
    [ordenId, id]
  );

  return getOrdenById(ordenId);
}

// --------------------------------------------------------
// SERVICIOS DE CALENDARIO DE EVENTOS
// --------------------------------------------------------

async function getAllEventos() {
  const res = await pool.query('SELECT * FROM eventos_calendario ORDER BY fecha_inicio ASC');
  return res.rows;
}

async function createEvento(data) {
  const result = await pool.query(
    `INSERT INTO eventos_calendario (titulo, descripcion, fecha_inicio, fecha_fin, tipo_evento, color, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      data.titulo,
      data.descripcion || null,
      data.fecha_inicio,
      data.fecha_fin || null,
      data.categoria || 'general',
      data.color || '#3b82f6',
      data.usuario_id || 1
    ]
  );
  return { id: result.rows[0].id, ...data };
}

async function updateEvento(id, data) {
  await pool.query(
    `UPDATE eventos_calendario SET titulo = $1, descripcion = $2, fecha_inicio = $3, fecha_fin = $4, tipo_evento = $5, color = $6
     WHERE id = $7`,
    [
      data.titulo,
      data.descripcion || null,
      data.fecha_inicio,
      data.fecha_fin || null,
      data.categoria || 'general',
      data.color || '#3b82f6',
      id
    ]
  );
  return { id, ...data };
}

async function deleteEvento(id) {
  await pool.query('DELETE FROM eventos_calendario WHERE id = $1', [id]);
  return true;
}

module.exports = {
  validateUserLogin,
  getAllUsuarios,
  createUsuario,
  deleteUsuario,
  
  getAllClientes,
  createCliente,
  updateCliente,
  getClienteByTelefono,
  deleteCliente,
  
  getAllOrdenes,
  getOrdenById,
  getOrdenByFolio,
  createOrden,
  updateOrden,
  updateOrdenEstado,
  checkOverdueOrders,
  getEvidenciasOrden,
  addEvidenciasOrden,
  deleteEvidenciaOrden,
  groupEvidenciasByEstado,
  deleteOrden,
  addFotoOrden,

  getAllInventario,
  createInventarioItem,
  updateInventarioItem,
  deleteInventarioItem,

  createVenta,
  getAllVentas,
  getPosOrderByFolio,
  payOrderBalance,

  getDashboardStats,

  getAllCotizaciones,
  createCotizacion,
  updateCotizacion,
  deleteCotizacion,
  convertirCotizacionAOrden,

  getAllEventos,
  getCalendarEvents,
  createEvento,
  updateEvento,
  deleteEvento
};
