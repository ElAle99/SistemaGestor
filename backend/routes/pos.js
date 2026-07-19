// routes/pos.js - Enrutador para el Punto de Venta (POS)

const express = require('express');
const router = express.Router();
const ordenService = require('../services/ordenService');
const { authMiddleware } = require('../middleware/auth');

// 1. Listar historial de ventas
router.get('/ventas', authMiddleware, async (req, res) => {
  try {
    const ventas = await ordenService.getAllVentas();
    res.json(ventas);
  } catch (error) {
    console.error('Error al listar ventas:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.get('/order/:folio', authMiddleware, async (req, res) => {
  try {
    const orden = await ordenService.getPosOrderByFolio(req.params.folio);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada.' });
    res.json(orden);
  } catch (error) {
    console.error('Error al consultar orden POS:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.post('/order-payment', authMiddleware, async (req, res) => {
  try {
    const {
      folio,
      metodo_pago,
      monto_recibido,
      transferencia_recibida,
      referencia_transferencia,
      observaciones_ticket
    } = req.body;
    if (!folio || !metodo_pago) {
      return res.status(400).json({ error: 'Folio y metodo de pago son requeridos.' });
    }
    const venta = await ordenService.payOrderBalance({
      folio,
      metodo_pago,
      monto_recibido,
      transferencia_recibida,
      referencia_transferencia,
      observaciones_ticket,
      usuario_id: req.user.id
    });
    res.status(201).json(venta);
  } catch (error) {
    console.error('Error al cobrar saldo de orden:', error);
    res.status(400).json({ error: error.message || 'Error al cobrar saldo.' });
  }
});

// 2. Guardar nueva venta POS
router.post('/venta', authMiddleware, async (req, res) => {
  try {
    const { total, metodo_pago, monto_recibido, cambio, items } = req.body;
    if (!total || !metodo_pago || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Datos de venta incompletos.' });
    }
    const venta = await ordenService.createVenta({
      ...req.body,
      usuario_id: req.user.id
    });
    res.status(201).json(venta);
  } catch (error) {
    console.error('Error al registrar venta:', error);
    res.status(400).json({ error: error.message || 'Error al procesar la venta.' });
  }
});

module.exports = router;
