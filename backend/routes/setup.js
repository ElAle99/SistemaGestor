const express = require('express');
const { pool } = require('../config/db');
const { rateLimit } = require('../middleware/rateLimit');
const { isUserCreationAllowed } = require('../services/systemConfigService');
const { createUser } = require('../services/userService');

const router = express.Router();
const SETUP_ADMIN_ROLE = 'Administrador';
const SETUP_LOCK_KEYS = [20260719, 1001];
const setupStatusRateLimit = rateLimit({ windowMs: 60 * 1000, max: 60, keyPrefix: 'setup-status' });
const setupCreateRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'setup-create' });

async function adminExists(client = pool) {
  const result = await client.query(
    'SELECT EXISTS (SELECT 1 FROM usuarios WHERE rol = $1) AS exists',
    [SETUP_ADMIN_ROLE]
  );
  return Boolean(result.rows[0]?.exists);
}

async function getPublicCreationState(client = pool) {
  const setupRequired = !(await adminExists(client));
  const userCreationAllowed = await isUserCreationAllowed(client);
  return {
    setupRequired,
    userCreationAllowed,
    canCreateAdmin: setupRequired || userCreationAllowed
  };
}

router.get('/status', setupStatusRateLimit, async (req, res) => {
  try {
    const exists = await adminExists();
    res.json({ setupRequired: !exists });
  } catch (error) {
    console.error('Error al consultar estado de configuracion inicial:', error);
    res.status(500).json({ error: 'Error al consultar configuracion inicial' });
  }
});

router.get('/user-creation-status', setupStatusRateLimit, async (req, res) => {
  try {
    const state = await getPublicCreationState();
    res.json(state);
  } catch (error) {
    console.error('Error al consultar creacion publica de usuarios:', error);
    res.status(500).json({ error: 'Error al consultar configuracion inicial' });
  }
});

async function createPublicAdmin(req, res, { allowExistingAdmin = true, requireContact = true } = {}) {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', SETUP_LOCK_KEYS);

    const setupRequired = !(await adminExists(client));
    const userCreationAllowed = await isUserCreationAllowed(client);

    if (!setupRequired && (!allowExistingAdmin || !userCreationAllowed)) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(403).json({ error: 'La creacion publica de usuarios no esta habilitada.' });
    }

    const user = await createUser(
      { ...req.body, rol: SETUP_ADMIN_ROLE, activo: true },
      { client, roleOverride: SETUP_ADMIN_ROLE, requireContact }
    );

    await client.query('COMMIT');
    transactionOpen = false;
    return res.status(201).json({ message: 'Administrador creado correctamente.', user });
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir configuracion inicial:', rollbackError);
      }
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error al crear administrador publico:', error);
    return res.status(500).json({ error: 'Error al crear administrador' });
  } finally {
    client.release();
  }
}

router.post('/admin', setupCreateRateLimit, (req, res) => {
  createPublicAdmin(req, res, { allowExistingAdmin: false, requireContact: false });
});

router.post('/create-admin', setupCreateRateLimit, (req, res) => {
  createPublicAdmin(req, res, { allowExistingAdmin: true, requireContact: true });
});

module.exports = router;
