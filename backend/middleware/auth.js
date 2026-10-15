const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { withSystemContext, withTenant, validTenant } = require('../config/tenantContext');
const { setFileSession } = require('./fileSession');
require('../config/env');

const authMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '') || req.assetSessionToken;

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado. Token requerido.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT auth_user_by_id($1) AS identity', [decoded.id]);
    const user = result.rows[0]?.identity;
    if (!user?.activo || decoded.sessionVersion !== user.session_version) {
      return res.status(401).json({ error: 'La sesion ha expirado. Inicia sesion nuevamente.' });
    }
    req.user = { id: user.id, username: user.username, rol: user.rol, negocio_id: user.negocio_id, tiene_negocio: user.tiene_negocio };
    if (!validTenant(user.negocio_id)) return res.status(403).json({ error: 'La sesión no tiene un negocio asociado.' });
    if (decoded.exp) setFileSession(req,res,token,decoded.exp);
    withTenant(user.negocio_id, next);
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
