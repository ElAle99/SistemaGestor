const express = require('express');
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const ESTADOS_VALIDOS = ['Pendiente', 'Contactado', 'Cotizado', 'Aceptado', 'Rechazado'];

function parsePhotos(value) {
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value || '[]');
  } catch (error) {
    return [];
  }
}

function normalizeQuotePayload(body) {
  const commonFailures = Array.isArray(body.commonFailures) && body.commonFailures.length > 0
    ? `Fallas comunes: ${body.commonFailures.join(', ')}. `
    : '';
  const description = body.problema || body.problem || body.description || '';
  const origin = body.observaciones || body.origin || body.notes || '';

  return {
    nombre: body.nombre || body.clientName || '',
    telefono: body.telefono || body.clientPhone || '',
    correo: body.correo || body.email || body.clientEmail || null,
    preferred_contact: body.preferred_contact || body.preferredContact || 'whatsapp',
    equipo: body.equipo || body.tipo_equipo || body.deviceType || '',
    marca: body.marca || body.brand || '',
    modelo: body.modelo || body.model || '',
    problema: `${commonFailures}${description}`.trim(),
    observaciones: origin || null,
    fotografias: JSON.stringify(body.fotografias || body.photos || []),
    estado: ESTADOS_VALIDOS.includes(body.estado) ? body.estado : 'Pendiente'
  };
}

function mapCotizacion(row) {
  const photos = parsePhotos(row.fotografias);
  return {
    id: row.id,
    nombre: row.nombre,
    cliente_nombre: row.nombre,
    telefono: row.telefono,
    cliente_telefono: row.telefono,
    correo: row.correo,
    email: row.correo,
    preferred_contact: row.preferred_contact || 'whatsapp',
    medio_contacto: row.preferred_contact || 'whatsapp',
    equipo: row.equipo,
    tipo_equipo: row.equipo,
    marca: row.marca,
    modelo: row.modelo,
    problema: row.problema,
    problema_reportado: row.problema,
    observaciones: row.observaciones,
    observaciones_internas: row.observaciones_internas,
    fotografias: row.fotografias,
    photos,
    estado: row.estado,
    orden_id: row.orden_id,
    fecha: row.fecha_creacion,
    fecha_creacion: row.fecha_creacion
  };
}

async function generateFolio(client) {
  const activeYear = new Date().getFullYear();
  const result = await client.query(
    "SELECT folio FROM ordenes_servicio WHERE folio LIKE $1 ORDER BY id DESC LIMIT 1",
    [`AFB-${activeYear}-%`]
  );
  let nextNum = 1;
  if (result.rows.length > 0 && result.rows[0].folio) {
    const parts = result.rows[0].folio.split('-');
    const lastNum = parseInt(parts[2], 10);
    if (!Number.isNaN(lastNum)) nextNum = lastNum + 1;
  }
  return `AFB-${activeYear}-${String(nextNum).padStart(6, '0')}`;
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { search, estado, sort = 'fecha_desc' } = req.query;
    const params = [];
    const where = [];

    if (estado && ESTADOS_VALIDOS.includes(estado)) {
      params.push(estado);
      where.push(`estado = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      where.push(`(nombre ILIKE $${params.length} OR telefono ILIKE $${params.length} OR correo ILIKE $${params.length} OR equipo ILIKE $${params.length} OR marca ILIKE $${params.length} OR modelo ILIKE $${params.length} OR problema ILIKE $${params.length})`);
    }

    const orderBy = {
      fecha_asc: 'fecha_creacion ASC',
      estado_asc: 'estado ASC, fecha_creacion DESC',
      cliente_asc: 'nombre ASC',
      fecha_desc: 'fecha_creacion DESC'
    }[sort] || 'fecha_creacion DESC';

    const result = await pool.query(
      `SELECT * FROM cotizaciones ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy}`,
      params
    );
    res.json(result.rows.map(mapCotizacion));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener cotizaciones' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cotizaciones WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cotización no encontrada' });
    res.json(mapCotizacion(result.rows[0]));
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener cotización' });
  }
});

router.post('/', async (req, res) => {
  try {
    const quote = normalizeQuotePayload(req.body);
    if (!quote.nombre || !quote.telefono || !quote.equipo || !quote.marca || !quote.modelo || !quote.problema) {
      return res.status(400).json({ error: 'Faltan datos obligatorios para crear la cotización.' });
    }

    const result = await pool.query(
      `INSERT INTO cotizaciones (
        nombre, telefono, correo, preferred_contact, equipo, marca, modelo,
        problema, observaciones, fotografias, estado
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        quote.nombre,
        quote.telefono,
        quote.correo,
        quote.preferred_contact,
        quote.equipo,
        quote.marca,
        quote.modelo,
        quote.problema,
        quote.observaciones,
        quote.fotografias,
        quote.estado
      ]
    );
    res.status(201).json(mapCotizacion(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear cotización' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { estado, observaciones, observaciones_internas } = req.body;
    if (estado && !ESTADOS_VALIDOS.includes(estado)) {
      return res.status(400).json({ error: 'Estado de cotización no válido.' });
    }

    const result = await pool.query(
      `UPDATE cotizaciones
       SET estado = COALESCE($1, estado),
           observaciones_internas = COALESCE($2, observaciones_internas)
       WHERE id = $3
       RETURNING *`,
      [estado || null, observaciones_internas || observaciones || null, req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Cotización no encontrada' });
    res.json(mapCotizacion(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar cotización' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM cotizaciones WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cotización no encontrada' });
    res.json({ message: 'Cotización eliminada' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar cotización' });
  }
});

router.post('/:id/convertir', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const quoteResult = await client.query('SELECT * FROM cotizaciones WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (quoteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotización no encontrada' });
    }

    const quote = quoteResult.rows[0];
    if (quote.orden_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Esta cotización ya fue convertida en orden.' });
    }

    let clienteId;
    const existingClient = await client.query(
      'SELECT id FROM clientes WHERE telefono_principal = $1 LIMIT 1',
      [quote.telefono]
    );

    if (existingClient.rows.length > 0) {
      clienteId = existingClient.rows[0].id;
      await client.query(
        `UPDATE clientes
         SET nombre = COALESCE(NULLIF($1, ''), nombre),
             correo = COALESCE($2, correo),
             notas = COALESCE(notas, $3)
         WHERE id = $4`,
        [quote.nombre, quote.correo || null, `Cliente relacionado con cotización ${quote.id}.`, clienteId]
      );
    } else {
      const newClient = await client.query(
        `INSERT INTO clientes (nombre, telefono_principal, correo, notas)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [quote.nombre, quote.telefono, quote.correo || null, `Cliente creado desde cotización ${quote.id}.`]
      );
      clienteId = newClient.rows[0].id;
    }

    const folio = await generateFolio(client);
    const usuarioId = req.user?.id || 1;
    const orderResult = await client.query(
      `INSERT INTO ordenes_servicio (
        folio, cliente_id, usuario_creador_id, tipo_equipo, marca, modelo,
        falla_reportada, descripcion_falla, fotografias, estado
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Recibido') RETURNING id`,
      [
        folio,
        clienteId,
        usuarioId,
        quote.equipo,
        quote.marca,
        quote.modelo,
        quote.problema,
        quote.observaciones,
        quote.fotografias || '[]'
      ]
    );

    const ordenId = orderResult.rows[0].id;
    await client.query(
      'INSERT INTO historial_estados (orden_id, estado, usuario_id, comentario) VALUES ($1, $2, $3, $4)',
      [ordenId, 'Recibido', usuarioId, 'Orden creada a partir de cotización web aceptada.']
    );

    await client.query(
      "UPDATE cotizaciones SET estado = 'Aceptado', orden_id = $1 WHERE id = $2",
      [ordenId, quote.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ ordenId, folio, estado: 'Aceptado' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al convertir cotización' });
  } finally {
    client.release();
  }
});

module.exports = router;
