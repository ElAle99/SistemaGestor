const express = require('express');
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const cajaService = require('../services/cajaService');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    let query = `
      SELECT v.*, 
        json_agg(json_build_object(
          'id', vd.id, 'producto_id', vd.producto_id, 'nombre', i.nombre,
          'cantidad', vd.cantidad, 'precio_unitario', vd.precio_unitario, 'subtotal', vd.subtotal
        )) as detalles
      FROM ventas v
      JOIN ventas_detalle vd ON v.id = vd.venta_id
      JOIN inventario i ON vd.producto_id = i.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (desde) {
      query += ` AND v.fecha >= $${idx++}`;
      params.push(desde);
    }
    if (hasta) {
      query += ` AND v.fecha <= $${idx++}`;
      params.push(hasta);
    }
    query += ' GROUP BY v.id ORDER BY v.fecha DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener ventas' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { items, metodo_pago, total } = req.body;
    const usuario_id = req.user.id;
    const descuento = Math.max(0, Number(req.body.descuento || 0));
    const subtotal = Number(req.body.subtotal || total || 0);
    const efectivo_recibido = Number(req.body.efectivo_recibido ?? req.body.monto_recibido ?? 0);
    const transferencia_recibida = Number(req.body.transferencia_recibida || 0);

    const ventaResult = await client.query(
      `INSERT INTO ventas
       (usuario_id, metodo_pago, subtotal, descuento, total, efectivo_recibido, transferencia_recibida,
        referencia_transferencia, observaciones_ticket, monto_recibido, cambio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        usuario_id,
        metodo_pago,
        subtotal,
        descuento,
        total,
        efectivo_recibido,
        transferencia_recibida,
        req.body.referencia_transferencia || null,
        req.body.observaciones_ticket || null,
        Number(req.body.monto_recibido ?? (efectivo_recibido || total)),
        Number(req.body.cambio || 0)
      ]
    );
    const ventaId = ventaResult.rows[0].id;

    for (const item of items) {
      await client.query(
        'INSERT INTO ventas_detalle (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES ($1, $2, $3, $4, $5)',
        [ventaId, item.producto_id, item.cantidad, item.precio_unitario, item.subtotal]
      );
      await client.query(
        'UPDATE inventario SET stock = stock - $1 WHERE id = $2',
        [item.cantidad, item.producto_id]
      );
    }

    const cambio = Number(req.body.cambio || 0);
    const cashAmount = metodo_pago === 'Efectivo'
      ? Number(total)
      : metodo_pago === 'Mixto'
        ? Math.max(efectivo_recibido - cambio, 0)
        : 0;
    const transferAmount = metodo_pago === 'Transferencia'
      ? Number(total)
      : metodo_pago === 'Mixto'
        ? Math.max(Math.min(transferencia_recibida, Number(total) - cashAmount), 0)
        : 0;
    const cardAmount = metodo_pago === 'Tarjeta' ? Number(total) : 0;

    for (const paymentPart of [
      { method: 'Efectivo', amount: cashAmount },
      { method: 'Transferencia', amount: transferAmount },
      { method: 'Tarjeta', amount: cardAmount }
    ]) {
      if (paymentPart.amount <= 0) continue;
      await cajaService.registerMovimiento({
        usuario_id,
        tipo_movimiento: 'venta_pos',
        metodo_pago: paymentPart.method,
        monto: paymentPart.amount,
        descripcion: `Venta POS #${ventaId}`,
        referencia_tipo: 'venta',
        referencia_id: ventaId
      }, { client, lock: true });
    }

    await client.query('COMMIT');
    res.json(ventaResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Error al registrar venta' });
  } finally {
    client.release();
  }
});

module.exports = router;
