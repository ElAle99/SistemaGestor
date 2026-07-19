const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const ordenService = require('../services/ordenService');

const router = express.Router();

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { search } = req.query;
    let clientes = await ordenService.getAllClientes();
    if (search) {
      const tokens = normalizeSearchText(search).split(' ').filter(Boolean);
      const phone = normalizePhone(search);
      clientes = clientes.filter(c => [
        c.nombre,
        c.apellido_paterno,
        c.apellido_materno,
        [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' '),
        c.telefono_principal,
        c.telefono
      ].some(value => {
        const normalizedValue = normalizeSearchText(value);
        const normalizedPhone = normalizePhone(value);
        return tokens.every(token => normalizedValue.includes(token)) || (phone && normalizedPhone.includes(phone));
      }));
    }
    res.json(clientes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const clientes = await ordenService.getAllClientes();
    const cliente = clientes.find(c => c.id === parseInt(req.params.id));
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const cliente = await ordenService.createCliente(req.body);
    res.status(201).json(cliente);
  } catch (error) {
    console.error(error);
    if (error.statusCode === 409) {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        duplicate: error.duplicate
      });
    }
    res.status(500).json({ error: 'Error al crear cliente' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const cliente = await ordenService.updateCliente(parseInt(req.params.id), req.body);
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar cliente' });
  }
});

router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await ordenService.deleteCliente(parseInt(req.params.id), req.user.id);
    if (!result) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({
      success: true,
      message: 'Cliente eliminado',
      ordenes_eliminadas: result.ordenes_eliminadas || 0
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar cliente' });
  }
});

router.get('/:id/historial', authMiddleware, async (req, res) => {
  try {
    const ordenes = await ordenService.getAllOrdenes();
    const historial = ordenes.filter(o => o.clientId === parseInt(req.params.id)).map(o => ({
      folio: o.folio,
      fecha_creacion: o.dateIn,
      estado: o.status,
      costo_final: o.costo_real || o.costo_estimado
    }));
    res.json(historial);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

module.exports = router;
