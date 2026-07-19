const express = require('express');
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/ingresos', authMiddleware, async (req, res) => {
  try {
    const { desde, hasta, periodo } = req.query;
    let groupBy = 'DATE(fecha)';
    if (periodo === 'mes') groupBy = "TO_CHAR(fecha, 'YYYY-MM')";
    if (periodo === 'ano') groupBy = "TO_CHAR(fecha, 'YYYY')";

    let query = `SELECT ${groupBy} as periodo, SUM(total) as ingresos FROM ventas WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (desde) {
      query += ` AND fecha >= $${idx++}`;
      params.push(desde);
    }
    if (hasta) {
      query += ` AND fecha <= $${idx++}`;
      params.push(hasta);
    }
    query += ` GROUP BY ${groupBy} ORDER BY ${groupBy} DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener ingresos' });
  }
});

router.get('/reparaciones', authMiddleware, async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    let query = `
      SELECT estado, COUNT(*) as cantidad 
      FROM ordenes_servicio 
      WHERE fecha_creacion BETWEEN $1 AND $2 
      GROUP BY estado
    `;
    const result = await pool.query(query, [desde || '1900-01-01', hasta || '2100-01-01']);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reporte de reparaciones' });
  }
});

router.get('/ventas', authMiddleware, async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    let query = `
      SELECT i.nombre, SUM(vd.cantidad) as cantidad_vendida, SUM(vd.subtotal) as total_vendido
      FROM ventas_detalle vd
      JOIN ventas v ON vd.venta_id = v.id
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
    query += ' GROUP BY i.nombre ORDER BY total_vendido DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reporte de ventas' });
  }
});

module.exports = router;
