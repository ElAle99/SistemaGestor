const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { getSystemSetting, setSystemSetting, isUserCreationAllowed } = require('../services/systemConfigService');
const {
  normalizeUserPayload,
  normalizeEmail,
  normalizePhone,
  validatePassword,
  validateUserData,
  assertUniqueUserFields,
  publicUser,
  createUser,
  updateUser
} = require('../services/userService');

const router = express.Router();

router.get('/settings', authMiddleware, adminOnly, async (req, res) => {
  try {
    const storedValue = await getSystemSetting('allow_user_creation');
    const allowed = await isUserCreationAllowed();
    res.json({
      allowUserCreation: allowed,
      storedAllowUserCreation: String(storedValue).toLowerCase() === 'true',
      envOverrideActive: String(process.env.ALLOW_USER_CREATION || '').toLowerCase() === 'true'
    });
  } catch (error) {
    console.error('Error al consultar configuracion de usuarios:', error);
    res.status(500).json({ error: 'Error al consultar configuracion de usuarios' });
  }
});

router.put('/settings', authMiddleware, adminOnly, async (req, res) => {
  try {
    const allowUserCreation = Boolean(req.body?.allowUserCreation);
    const setting = await setSystemSetting('allow_user_creation', allowUserCreation ? 'true' : 'false', req.user.id);
    res.json({
      allowUserCreation: allowUserCreation,
      setting
    });
  } catch (error) {
    console.error('Error al actualizar configuracion de usuarios:', error);
    res.status(500).json({ error: 'Error al actualizar configuracion de usuarios' });
  }
});

router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, rol, nombre, correo, telefono, activo, fecha_creacion
       FROM usuarios
       WHERE COALESCE(eliminado, false) = false
       ORDER BY fecha_creacion DESC, id DESC`
    );
    res.json(result.rows.map(publicUser));
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const user = await createUser(req.body);
    res.status(201).json(user);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error al crear usuario:', error);
    return res.status(500).json({ error: 'Error al crear usuario' });
  }
});

router.put('/me/profile', authMiddleware, async (req, res) => {
  try {
    const data = normalizeUserPayload({
      nombre: req.body?.nombre,
      username: req.user.username,
      correo: req.body?.correo || req.body?.email,
      telefono: req.body?.telefono,
      rol: req.user.rol,
      activo: true
    });
    const errors = validateUserData(data, { requirePassword: false, requireRole: true, requireContact: false });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    await assertUniqueUserFields(
      { username: req.user.username, correo: data.correo },
      { excludeUserId: req.user.id }
    );

    const result = await pool.query(
      `UPDATE usuarios
       SET nombre = $1, correo = $2, telefono = $3
       WHERE id = $4
       RETURNING id, username, rol, nombre, correo, telefono, activo, fecha_creacion`,
      [data.nombre, data.correo || null, normalizePhone(data.telefono) || null, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    return res.json(publicUser(result.rows[0]));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error al actualizar perfil:', error);
    return res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

router.put('/me/password', authMiddleware, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const errors = validatePassword(newPassword);

    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const result = await pool.query(
      'SELECT id, password FROM usuarios WHERE id = $1 AND activo = true',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) {
      return res.status(400).json({ error: 'La contrasena actual no es correcta.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE usuarios SET password = $1 WHERE id = $2', [hashedPassword, req.user.id]);

    return res.json({ message: 'Contrasena actualizada correctamente.' });
  } catch (error) {
    console.error('Error al actualizar contrasena:', error);
    return res.status(500).json({ error: 'Error al actualizar contrasena' });
  }
});

router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const user = await updateUser(req.params.id, req.body);
    res.json(user);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error al actualizar usuario:', error);
    return res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

router.patch('/:id/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const activo = Boolean(req.body?.activo);

    if (id === Number(req.user.id) && !activo) {
      return res.status(400).json({ error: 'No puedes desactivar tu propio usuario.' });
    }

    const result = await pool.query(
      `UPDATE usuarios
       SET activo = $1
       WHERE id = $2
       RETURNING id, username, rol, nombre, correo, telefono, activo, fecha_creacion`,
      [activo, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    return res.json(publicUser(result.rows[0]));
  } catch (error) {
    console.error('Error al cambiar estado de usuario:', error);
    return res.status(500).json({ error: 'Error al cambiar estado de usuario' });
  }
});

router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Usuario no válido.' });
    }
    if (id === Number(req.user.id)) {
      return res.status(400).json({ error: 'No puedes eliminar tu propio usuario.' });
    }

    // Eliminación lógica: conserva la relación con órdenes, ventas y cortes
    // históricos, pero revoca el acceso y libera usuario/correo para reutilizarlos.
    const result = await pool.query(
      `UPDATE usuarios
       SET activo = false,
           eliminado = true,
           username = CONCAT('eliminado_', id, '_', EXTRACT(EPOCH FROM NOW())::BIGINT),
           nombre = 'Usuario eliminado',
           correo = NULL,
           telefono = NULL
       WHERE id = $1 AND COALESCE(eliminado, false) = false
       RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    return res.json({ message: 'Usuario eliminado correctamente.' });
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    return res.status(500).json({ error: 'Error al eliminar usuario.' });
  }
});

module.exports = router;
