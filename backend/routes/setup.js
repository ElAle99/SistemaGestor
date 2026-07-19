const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

const router = express.Router();
const SETUP_ADMIN_ROLE = 'Administrador';
const SETUP_LOCK_KEYS = [20260719, 1001];
const setupAttempts = new Map();

function getRequestKey(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function setupRateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.method}:${req.originalUrl}:${getRequestKey(req)}`;
    const entry = setupAttempts.get(key);

    if (!entry || entry.resetAt <= now) {
      setupAttempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo mas tarde.' });
    }

    return next();
  };
}

async function adminExists(client = pool) {
  const result = await client.query(
    'SELECT EXISTS (SELECT 1 FROM usuarios WHERE rol = $1) AS exists',
    [SETUP_ADMIN_ROLE]
  );
  return Boolean(result.rows[0]?.exists);
}

function validateSetupPayload({ username, password, nombre }) {
  const errors = [];

  if (!nombre || nombre.length < 2 || nombre.length > 100) {
    errors.push('El nombre del administrador debe tener entre 2 y 100 caracteres.');
  }

  if (!username || username.length < 3 || username.length > 50) {
    errors.push('El nombre de usuario debe tener entre 3 y 50 caracteres.');
  } else if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    errors.push('El nombre de usuario solo puede contener letras, numeros, punto, guion y guion bajo.');
  }

  if (!password || password.length < 8 || password.length > 128) {
    errors.push('La contrasena debe tener entre 8 y 128 caracteres.');
  }

  return errors;
}

router.get('/status', setupRateLimit({ windowMs: 60 * 1000, max: 60 }), async (req, res) => {
  try {
    const exists = await adminExists();
    res.json({ setupRequired: !exists });
  } catch (error) {
    console.error('Error al consultar estado de configuracion inicial:', error);
    res.status(500).json({ error: 'Error al consultar configuracion inicial' });
  }
});

router.post('/admin', setupRateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), async (req, res) => {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const nombre = String(req.body?.nombre || '').trim();

    await client.query('BEGIN');
    transactionOpen = true;
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', SETUP_LOCK_KEYS);

    if (await adminExists(client)) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(403).json({ error: 'La configuracion inicial ya fue completada.' });
    }

    const validationErrors = validateSetupPayload({ username, password, nombre });
    if (validationErrors.length > 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ error: validationErrors[0] });
    }

    const usernameExists = await client.query(
      'SELECT id FROM usuarios WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username]
    );

    if (usernameExists.rows.length > 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ error: 'El nombre de usuario ya esta ocupado.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await client.query(
      'INSERT INTO usuarios (username, password, rol, nombre, activo) VALUES ($1, $2, $3, $4, $5)',
      [username, hashedPassword, SETUP_ADMIN_ROLE, nombre, true]
    );

    await client.query('COMMIT');
    transactionOpen = false;
    return res.status(201).json({ message: 'Administrador creado correctamente.' });
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir configuracion inicial:', rollbackError);
      }
    }
    console.error('Error al crear administrador inicial:', error);
    return res.status(500).json({ error: 'Error al crear administrador inicial' });
  } finally {
    client.release();
  }
});

module.exports = router;
