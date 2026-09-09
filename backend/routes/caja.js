const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const cajaService = require('../services/cajaService');

const router = express.Router();

function sendCajaError(res, error) {
  res.status(error.statusCode || 500).json({
    error: error.message || 'Error en el modulo de caja.'
  });
}

router.get('/activa', authMiddleware, async (req, res) => {
  try {
    const caja = await cajaService.getCajaActiva();
    res.json({ caja });
  } catch (error) {
    sendCajaError(res, error);
  }
});

router.get('/resumen', authMiddleware, async (req, res) => {
  try {
    const caja = await cajaService.getCajaActiva();
    if (!caja) return res.status(404).json({ error: 'No hay caja abierta.' });
    res.json(caja);
  } catch (error) {
    sendCajaError(res, error);
  }
});

router.post('/abrir', authMiddleware, async (req, res) => {
  try {
    const result = await cajaService.openCaja({
      usuario_id: req.user.id,
      monto_inicial: req.body.monto_inicial
    });
    res.status(result.alreadyOpen ? 200 : 201).json(result);
  } catch (error) {
    sendCajaError(res, error);
  }
});

router.post('/movimientos', authMiddleware, async (req, res) => {
  try {
    const movimiento = await cajaService.registerMovimiento({
      ...req.body,
      usuario_id: req.user.id
    });
    const caja = await cajaService.getCajaActiva();
    res.status(201).json({ movimiento, caja });
  } catch (error) {
    sendCajaError(res, error);
  }
});

router.post('/entrada', authMiddleware, async (req, res) => {
  try {
    const caja = await cajaService.registerManualMovimiento({
      usuario_id: req.user.id,
      tipo_movimiento: 'entrada_manual',
      monto: req.body.monto,
      descripcion: req.body.descripcion || req.body.motivo || 'Entrada manual de efectivo'
    });
    res.status(201).json(caja);
  } catch (error) {
    sendCajaError(res, error);
  }
});

router.post('/salida', authMiddleware, async (req, res) => {
  try {
    const caja = await cajaService.registerManualMovimiento({
      usuario_id: req.user.id,
      tipo_movimiento: 'salida_manual',
      monto: req.body.monto,
      descripcion: req.body.descripcion || req.body.motivo || 'Salida manual de efectivo'
    });
    res.status(201).json(caja);
  } catch (error) {
    sendCajaError(res, error);
  }
});

router.post('/cerrar', authMiddleware, async (req, res) => {
  try {
    const caja = await cajaService.closeCaja({
      usuario_id: req.user.id,
      monto_contado: req.body.monto_contado,
      observaciones: req.body.observaciones
    });
    res.json(caja);
  } catch (error) {
    sendCajaError(res, error);
  }
});

router.get('/historial', authMiddleware, async (req, res) => {
  try {
    const historial = await cajaService.getHistorial();
    res.json(historial);
  } catch (error) {
    sendCajaError(res, error);
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const caja = await cajaService.getCajaConDetalle(parseInt(req.params.id, 10));
    if (!caja) return res.status(404).json({ error: 'Corte no encontrado.' });
    res.json(caja);
  } catch (error) {
    sendCajaError(res, error);
  }
});

module.exports = router;
