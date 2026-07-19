const express = require('express');
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const ordenService = require('../services/ordenService');

const router = express.Router();

router.get('/orders', authMiddleware, async (req, res) => {
  try {
    await ordenService.checkOverdueOrders(req.user.id);
    const events = await ordenService.getCalendarEvents();
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener calendario de ordenes' });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, o.folio, o.estado as orden_estado 
      FROM eventos_calendario c 
      LEFT JOIN ordenes_servicio o ON c.orden_id = o.id 
      ORDER BY c.fecha_inicio ASC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener eventos' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { titulo, descripcion, fecha_inicio, fecha_fin, tipo_evento, categoria, color, orden_id } = req.body;
    const usuario_id = req.user.id;
    const result = await pool.query(
      'INSERT INTO eventos_calendario (titulo, descripcion, fecha_inicio, fecha_fin, tipo_evento, color, orden_id, usuario_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [titulo, descripcion, fecha_inicio, fecha_fin, tipo_evento || categoria, color || '#3b82f6', orden_id, usuario_id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear evento' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { titulo, descripcion, fecha_inicio, fecha_fin, tipo_evento, categoria, color, orden_id } = req.body;
    const result = await pool.query(
      'UPDATE eventos_calendario SET titulo = $1, descripcion = $2, fecha_inicio = $3, fecha_fin = $4, tipo_evento = $5, color = $6, orden_id = $7 WHERE id = $8 RETURNING *',
      [titulo, descripcion, fecha_inicio, fecha_fin, tipo_evento || categoria, color || '#3b82f6', orden_id, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar evento' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM eventos_calendario WHERE id = $1', [req.params.id]);
    res.json({ message: 'Evento eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar evento' });
  }
});

module.exports = router;
