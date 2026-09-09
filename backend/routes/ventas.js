const express = require('express');
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const ordenService = require('../services/ordenService');

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
  try {
    const venta = await ordenService.createVenta({
      ...req.body,
      usuario_id: req.user.id
    });
    res.status(201).json(venta);
  } catch (error) {
    console.error('Error al registrar venta:', error);
    res.status(400).json({ error: error.message || 'Error al registrar venta' });
  }
});
module.exports = router;
