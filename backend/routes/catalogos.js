const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const service = require('../services/catalogService');
const router = express.Router();
const handle = action => async (req, res) => {
  try { res.json(await action(req, service.scopeForUser(req.user))); }
  catch (error) { res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'No se pudo consultar o guardar el catálogo.' }); }
};
router.get('/', authMiddleware, handle((req, scope) => service.getCatalog(scope)));
router.get('/modelos', authMiddleware, handle((req, scope) => service.getModels(scope, req.query.marca_id, req.query.q)));
router.post('/relaciones', authMiddleware, handle((req, scope) => service.linkRepair(req.body, scope)));
router.post('/:kind', authMiddleware, handle((req, scope) => service.addEntry(req.params.kind, req.body, scope)));
router.delete('/:kind/:id', authMiddleware, adminOnly, handle((req, scope) => service.deactivate(req.params.kind, req.params.id, scope)));
module.exports = router;
