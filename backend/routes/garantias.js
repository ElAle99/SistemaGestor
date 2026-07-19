const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const garantiaService = require('../services/garantiaService');

const router = express.Router();

function requireRoles(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'Acceso denegado para este módulo.' });
    }
    next();
  };
}

function handleError(res, error, fallback) {
  console.error(error);
  res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : fallback });
}

router.get('/estadisticas', authMiddleware, async (req, res) => {
  try {
    res.json(await garantiaService.getEstadisticas());
  } catch (error) {
    handleError(res, error, 'Error al obtener estadísticas de garantías');
  }
});

router.get('/motivos-rechazo', authMiddleware, async (req, res) => {
  res.json(garantiaService.REJECTION_REASONS);
});

router.get('/folio/:folio', authMiddleware, async (req, res) => {
  try {
    const garantia = await garantiaService.getGarantiaByFolio(req.params.folio);
    if (!garantia) return res.status(404).json({ error: 'Garantía no encontrada para este folio.' });
    res.json(garantia);
  } catch (error) {
    handleError(res, error, 'Error al buscar garantía por folio');
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    res.json(await garantiaService.getGarantias(req.query));
  } catch (error) {
    handleError(res, error, 'Error al obtener garantías');
  }
});

router.post('/', authMiddleware, requireRoles(['Administrador']), async (req, res) => {
  try {
    const garantia = await garantiaService.createGarantia(req.body, req.user.id);
    res.status(201).json(garantia);
  } catch (error) {
    handleError(res, error, 'Error al crear garantía');
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const garantia = await garantiaService.getGarantiaById(parseInt(req.params.id, 10));
    if (!garantia) return res.status(404).json({ error: 'Garantía no encontrada.' });
    res.json(garantia);
  } catch (error) {
    handleError(res, error, 'Error al consultar garantía');
  }
});

router.put('/:id', authMiddleware, requireRoles(['Administrador']), async (req, res) => {
  try {
    const garantia = await garantiaService.updateGarantia(parseInt(req.params.id, 10), req.body, req.user.id);
    if (!garantia) return res.status(404).json({ error: 'Garantía no encontrada.' });
    res.json(garantia);
  } catch (error) {
    handleError(res, error, 'Error al actualizar garantía');
  }
});

router.post('/:id/ingresos', authMiddleware, requireRoles(['Administrador', 'Técnico', 'Recepcionista']), async (req, res) => {
  try {
    const garantia = await garantiaService.registrarIngreso(parseInt(req.params.id, 10), req.body, req.user.id);
    res.status(201).json(garantia);
  } catch (error) {
    handleError(res, error, 'Error al registrar ingreso por garantía');
  }
});

router.post('/ingresos/:ingresoId/validacion', authMiddleware, requireRoles(['Administrador', 'Técnico']), async (req, res) => {
  try {
    res.json(await garantiaService.validarIngreso(parseInt(req.params.ingresoId, 10), req.body, req.user.id));
  } catch (error) {
    handleError(res, error, 'Error al validar garantía');
  }
});

router.post('/ingresos/:ingresoId/cerrar', authMiddleware, requireRoles(['Administrador', 'Técnico']), async (req, res) => {
  try {
    res.json(await garantiaService.cerrarIngreso(parseInt(req.params.ingresoId, 10), req.body, req.user.id));
  } catch (error) {
    handleError(res, error, 'Error al cerrar ingreso de garantía');
  }
});

router.post('/:id/fotos', authMiddleware, requireRoles(['Administrador', 'Técnico', 'Recepcionista']), upload.array('fotos', 12), async (req, res) => {
  try {
    const uploaded = (req.files || []).map(file => `/uploads/${file.filename}`);
    const bodyPhotos = Array.isArray(req.body.fotos) ? req.body.fotos : [];
    const fotos = [...bodyPhotos, ...uploaded];
    const garantia = await garantiaService.registrarFotos(parseInt(req.params.id, 10), {
      ...req.body,
      fotos
    }, req.user.id);
    if (!garantia) return res.status(404).json({ error: 'Garantía no encontrada.' });
    res.status(201).json(garantia);
  } catch (error) {
    handleError(res, error, 'Error al subir evidencia de garantía');
  }
});

router.post('/:id/costos', authMiddleware, requireRoles(['Administrador', 'Técnico']), async (req, res) => {
  try {
    res.status(201).json(await garantiaService.registrarCostos(parseInt(req.params.id, 10), req.body, req.user.id));
  } catch (error) {
    handleError(res, error, 'Error al registrar costos de garantía');
  }
});

router.post('/:id/historial', authMiddleware, requireRoles(['Administrador', 'Técnico']), async (req, res) => {
  try {
    const garantia = await garantiaService.registrarHistorial(parseInt(req.params.id, 10), req.body, req.user.id);
    if (!garantia) return res.status(404).json({ error: 'Garantía no encontrada.' });
    res.status(201).json(garantia);
  } catch (error) {
    handleError(res, error, 'Error al registrar historial de garantía');
  }
});

module.exports = router;
