const express = require('express');
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const [ordenes, ventas, stockBajo] = await Promise.all([
      pool.query(`SELECT estado, COUNT(*) as cantidad FROM ordenes_servicio WHERE negocio_id=app_tenant_id() GROUP BY estado`),
      pool.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN DATE(fecha) = CURRENT_DATE THEN total END), 0) as ventas_dia,
          COALESCE(SUM(CASE WHEN EXTRACT(MONTH FROM fecha) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM fecha) = EXTRACT(YEAR FROM CURRENT_DATE) THEN total END), 0) as ventas_mes,
          COALESCE(SUM(total), 0) as ingresos
        FROM ventas WHERE negocio_id=app_tenant_id()
      `),
      pool.query('SELECT COUNT(*) as cantidad FROM inventario WHERE negocio_id=app_tenant_id() AND stock <= stock_minimo AND activo = true')
    ]);

    res.json({
      ordenes: ordenes.rows,
      ventas: ventas.rows[0],
      stock_bajo: stockBajo.rows[0].cantidad
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

module.exports = router;
