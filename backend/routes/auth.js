const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { rateLimit } = require('../middleware/rateLimit');
const { normalizeEmail, validatePassword } = require('../services/userService');
const { sendPasswordResetEmail } = require('../services/emailService');
const { withSystemContext } = require('../config/tenantContext');
const { withTenant } = require('../config/tenantContext');
const { setFileSession } = require('../middleware/fileSession');
require('../config/env');

const router = express.Router();
// Credentials/reset tokens are verified globally; authenticated app routes run in their DB-owned tenant.
const loginRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'login' });
const forgotPasswordRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'forgot-password' });
const resetPasswordRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'reset-password' });

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getPublicAppUrl(req) {
  const configuredUrl = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  if (configuredUrl) return configuredUrl;
  return `${req.protocol}://${req.get('host')}`;
}

router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body;
    const normalizedUsername = String(username || '').trim();
    const normalizedPassword = String(password || '');

    const result = await pool.query(
      'SELECT auth_login($1,$2) AS identity',
      [normalizedUsername,normalizedPassword]
    );

    if (!result.rows[0]?.identity) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const usuario = result.rows[0].identity;
    const token = jwt.sign(
      { id: usuario.id, username: usuario.username, rol: usuario.rol, sessionVersion: usuario.session_version },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    setFileSession(req,res,token,jwt.decode(token).exp);
    res.json({
      token,
      user: {
        id: usuario.id,
        negocio_id: usuario.negocio_id,
        username: usuario.username,
        rol: usuario.rol,
        nombre: usuario.nombre,
        correo: usuario.correo || '',
        telefono: usuario.telefono || ''
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

router.post('/forgot-password', forgotPasswordRateLimit, async (req, res) => {
  const genericMessage = 'Si el correo esta registrado, enviaremos instrucciones para recuperar la contrasena.';

  try {
    const correo = normalizeEmail(req.body?.correo || req.body?.email);
    if (!correo) {
      return res.json({ message: genericMessage });
    }

    const result = await pool.query(
      'SELECT auth_user_by_email($1) AS identity',
      [correo]
    );

    if (!result.rows[0]?.identity) {
      return res.json({ message: genericMessage });
    }

    const usuario = result.rows[0].identity;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await withTenant(usuario.negocio_id, async () => {
    await pool.query(
      `UPDATE password_reset_tokens
       SET used_at = CURRENT_TIMESTAMP
       WHERE usuario_id = $1 AND used_at IS NULL`,
      [usuario.id]
    );

    await pool.query(
      `INSERT INTO password_reset_tokens (usuario_id, token_hash, expires_at, negocio_id)
       VALUES ($1, $2, $3, $4)`,
      [usuario.id, tokenHash, expiresAt, usuario.negocio_id]
    );
    });

    const resetUrl = `${getPublicAppUrl(req)}/?reset_token=${token}`;
    await sendPasswordResetEmail({
      to: usuario.correo,
      nombre: usuario.nombre,
      resetUrl
    });

    return res.json({ message: genericMessage });
  } catch (error) {
    if (error.code === 'SMTP_NOT_CONFIGURED') {
      console.error('Recuperacion de contrasena no disponible: SMTP no configurado.');
      return res.json({ message: genericMessage });
    }
    console.error('Error en recuperacion de contrasena:', error);
    return res.json({ message: genericMessage });
  }
});

router.post('/reset-password', resetPasswordRateLimit, async (req, res) => {
  let client;
  let transactionOpen = false;

  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || req.body?.newPassword || '');
    const errors = validatePassword(password);

    if (!token) {
      return res.status(400).json({ error: 'Token invalido o expirado.' });
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const tokenHash = hashResetToken(token);
    const identity=(await pool.query('SELECT auth_reset_identity($1) AS identity',[tokenHash])).rows[0]?.identity;
    if (!identity) return res.status(400).json({ error:'Token invalido o expirado.' });
    client = await withTenant(identity.negocio_id,()=>pool.connect());
    await client.query('BEGIN');
    transactionOpen = true;

    const tokenResult = await client.query(
      `SELECT prt.id, prt.usuario_id
       FROM password_reset_tokens prt
       JOIN usuarios u ON u.id = prt.usuario_id
       WHERE prt.token_hash = $1
         AND prt.used_at IS NULL
         AND prt.expires_at > CURRENT_TIMESTAMP
         AND u.activo = true AND prt.negocio_id=app_tenant_id() AND u.negocio_id=prt.negocio_id
       FOR UPDATE`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ error: 'Token invalido o expirado.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const resetToken = tokenResult.rows[0];
    await client.query('UPDATE usuarios SET password = $1, session_version = session_version + 1 WHERE id = $2', [hashedPassword, resetToken.usuario_id]);
    await client.query('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1', [resetToken.id]);

    await client.query('COMMIT');
    transactionOpen = false;
    return res.json({ message: 'Contrasena actualizada correctamente.' });
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir recuperacion de contrasena:', rollbackError);
      }
    }
    console.error('Error al restablecer contrasena:', error);
    return res.status(500).json({ error: 'Error al restablecer contrasena' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
