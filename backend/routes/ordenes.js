const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const ordenService = require('../services/ordenService');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    await ordenService.checkOverdueOrders(req.user.id);
    const ordenes = await ordenService.getAllOrdenes();
    res.json(ordenes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener órdenes' });
  }
});

router.get('/folio/:folio', async (req, res) => {
  try {
    const orden = await ordenService.getOrdenByFolio(req.params.folio);
    if (!orden) return res.status(404).json({ error: 'Folio no encontrado' });

    res.json({
      folio: orden.folio,
      status: orden.status,
      estado_actual: orden.status,
      deviceType: orden.deviceType,
      equipo: orden.deviceType,
      brand: orden.brand,
      marca: orden.brand,
      model: orden.model,
      modelo: orden.model,
      dateIn: orden.dateIn,
      fecha_ingreso: orden.dateIn,
      estimatedDate: orden.estimatedDate,
      fecha_estimada: orden.estimatedDate,
      tecnicoAsignado: orden.tecnicoAsignado,
      tecnico_asignado: orden.tecnicoAsignado,
      historial: orden.historial || [],
      evidencias: orden.evidencias || [],
      evidenciasPorEstado: orden.evidenciasPorEstado || [],
      publicRemarks: orden.publicRemarks,
      observaciones_publicas: orden.publicRemarks
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al consultar folio' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const orden = await ordenService.getOrdenById(parseInt(req.params.id));
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(orden);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener orden' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    req.body.usuario_creador_id = req.user.id;
    const orden = await ordenService.createOrden(req.body);
    res.status(201).json(orden);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Error al crear orden' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    req.body.usuario_creador_id = req.user.id;
    const orden = await ordenService.updateOrden(parseInt(req.params.id), req.body);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(orden);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Error al actualizar orden' });
  }
});

router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const deleted = await ordenService.deleteOrden(parseInt(req.params.id), req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json({ success: true, message: 'Orden eliminada correctamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar orden' });
  }
});

router.put('/:id/estado', authMiddleware, async (req, res) => {
  try {
    const { estado, comentario, evidencias, fotos, evidenciaComentario, visible_cliente, evidenciaVisibleCliente } = req.body;
    const orden = await ordenService.updateOrdenEstado(
      parseInt(req.params.id),
      estado,
      comentario,
      req.user.id,
      evidencias || fotos || [],
      {
        evidenciaComentario,
        visibleCliente: evidenciaVisibleCliente !== undefined ? evidenciaVisibleCliente : visible_cliente
      }
    );
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(orden);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

router.post('/check-overdue', authMiddleware, async (req, res) => {
  try {
    const result = await ordenService.checkOverdueOrders(req.user.id);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al revisar ordenes retrasadas' });
  }
});

router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { estado, comentario } = req.body;
    if (!estado) return res.status(400).json({ error: 'Estado requerido.' });
    const orden = await ordenService.updateOrdenEstado(
      parseInt(req.params.id),
      estado,
      comentario || `Cambio rapido de estado a ${estado}.`,
      req.user.id
    );
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(orden);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

router.get('/:id/evidencias', authMiddleware, async (req, res) => {
  try {
    const evidencias = await ordenService.getEvidenciasOrden(parseInt(req.params.id));
    res.json({
      evidencias,
      evidenciasPorEstado: ordenService.groupEvidenciasByEstado
        ? ordenService.groupEvidenciasByEstado(evidencias)
        : []
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener evidencias' });
  }
});

router.post('/:id/evidencias', authMiddleware, async (req, res) => {
  try {
    const { estado, fotos, evidencias, comentario, visible_cliente, evidenciaVisibleCliente } = req.body;
    const inserted = await ordenService.addEvidenciasOrden(parseInt(req.params.id), evidencias || fotos || [], {
      estado: estado || 'Recibido',
      usuarioId: req.user.id,
      comentario: comentario || null,
      visibleCliente: evidenciaVisibleCliente !== undefined ? evidenciaVisibleCliente : visible_cliente
    });
    res.status(201).json(inserted);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al guardar evidencias' });
  }
});

router.delete('/:id/evidencias/:evidenciaId', authMiddleware, async (req, res) => {
  try {
    const deleted = await ordenService.deleteEvidenciaOrden(parseInt(req.params.id), parseInt(req.params.evidenciaId));
    if (!deleted) return res.status(404).json({ error: 'Evidencia no encontrada' });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar evidencia' });
  }
});

router.get('/:id/historial', authMiddleware, async (req, res) => {
  try {
    const orden = await ordenService.getOrdenById(parseInt(req.params.id));
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(orden.historial || []);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

module.exports = router;
