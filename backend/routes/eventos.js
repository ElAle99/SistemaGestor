// routes/eventos.js - Enrutador para eventos manuales del calendario
const express = require('express');
const router = express.Router();
const ordenService = require('../services/ordenService');
const { authMiddleware } = require('../middleware/auth');

// 1. Listar todos los eventos
router.get('/', authMiddleware, async (req, res) => {
  try {
    const events = await ordenService.getAllEventos();
    res.json(events);
  } catch (error) {
    console.error('Error al listar eventos:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// 2. Crear un evento manual
router.post('/', authMiddleware, async (req, res) => {
  try {
    const event = await ordenService.createEvento({
      ...req.body,
      usuario_id: req.user.id
    });
    res.status(201).json(event);
  } catch (error) {
    console.error('Error al crear evento:', error);
    res.status(400).json({ error: error.message || 'Error al guardar el evento.' });
  }
});

// 3. Editar un evento manual
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID no válido.' });
    }
    const event = await ordenService.updateEvento(id, req.body);
    res.json(event);
  } catch (error) {
    console.error('Error al editar evento:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// 4. Eliminar un evento manual
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID no válido.' });
    }
    await ordenService.deleteEvento(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error al eliminar evento:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
