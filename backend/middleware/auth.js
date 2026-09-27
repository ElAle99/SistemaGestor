const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
require('../config/env');

const authMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado. Token requerido.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query("SELECT id, username, rol, activo, session_version, to_jsonb(u)->>'negocio_id' AS negocio_id, to_jsonb(u) ? 'negocio_id' AS tiene_negocio FROM usuarios u WHERE id = $1", [decoded.id]);
    const user = result.rows[0];
    if (!user?.activo || decoded.sessionVersion !== user.session_version) {
      return res.status(401).json({ error: 'La sesion ha expirado. Inicia sesion nuevamente.' });
    }
    req.user = { id: user.id, username: user.username, rol: user.rol, negocio_id: user.negocio_id, tiene_negocio: user.tiene_negocio };
    next();
  } catch (error) {
    if (!['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) {
      console.error('Error al verificar la sesion:', error);
      return res.status(503).json({ error: 'No se pudo verificar la sesion. Intenta nuevamente.' });
    }
    res.status(401).json({ error: 'Token inválido.' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.rol !== 'Administrador') {
    return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
  }
  next();
};

module.exports = { authMiddleware, adminOnly };
