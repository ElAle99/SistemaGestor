const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { rateLimit } = require('../middleware/rateLimit');
const { normalizeEmail, validatePassword } = require('../services/userService');
const { sendPasswordResetEmail } = require('../services/emailService');
require('../config/env');

const router = express.Router();
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

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const normalizedUsername = String(username || '').trim();
    const normalizedPassword = String(password || '').trim();

    const result = await pool.query(
      'SELECT * FROM usuarios WHERE LOWER(username) = LOWER($1) AND activo = true',
      [normalizedUsername]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const usuario = result.rows[0];
    const validPassword = await bcrypt.compare(normalizedPassword, usuario.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { id: usuario.id, username: usuario.username, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: usuario.id,
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
      `SELECT id, nombre, correo
       FROM usuarios
       WHERE LOWER(correo) = LOWER($1) AND activo = true
       LIMIT 1`,
      [correo]
    );

    if (result.rows.length === 0) {
      return res.json({ message: genericMessage });
    }

    const usuario = result.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      `UPDATE password_reset_tokens
       SET used_at = CURRENT_TIMESTAMP
       WHERE usuario_id = $1 AND used_at IS NULL`,
      [usuario.id]
    );

    await pool.query(
      `INSERT INTO password_reset_tokens (usuario_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [usuario.id, tokenHash, expiresAt]
    );

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
  const client = await pool.connect();
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
    await client.query('BEGIN');
    transactionOpen = true;

    const tokenResult = await client.query(
      `SELECT prt.id, prt.usuario_id
       FROM password_reset_tokens prt
       JOIN usuarios u ON u.id = prt.usuario_id
       WHERE prt.token_hash = $1
         AND prt.used_at IS NULL
         AND prt.expires_at > CURRENT_TIMESTAMP
         AND u.activo = true
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
    await client.query('UPDATE usuarios SET password = $1 WHERE id = $2', [hashedPassword, resetToken.usuario_id]);
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
    client.release();
  }
});

module.exports = router;
