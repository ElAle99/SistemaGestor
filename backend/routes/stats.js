// routes/stats.js - Enrutador para métricas del Dashboard y reportes

const express = require('express');
const router = express.Router();
const ordenService = require('../services/ordenService');

router.get('/dashboard', async (req, res) => {
  try {
    const stats = await ordenService.getDashboardStats();
    res.json(stats);
  } catch (error) {
    console.error('Error al obtener estadísticas del dashboard:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
