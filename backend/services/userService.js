const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

const VALID_ROLES = ['Administrador', 'Técnico', 'Recepcionista'];

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function normalizeUsername(username) {
  return String(username || '').trim();
}

async function ensureUserProfileColumns(client = pool) {
  await client.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS correo VARCHAR(120);
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono VARCHAR(30);
    CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo_unique_idx
      ON usuarios (LOWER(correo))
      WHERE correo IS NOT NULL AND TRIM(correo) <> '';
  `);
}

function normalizeUserPayload(data = {}) {
  return {
    nombre: String(data.nombre || '').trim(),
    username: normalizeUsername(data.username),
    correo: normalizeEmail(data.correo || data.email),
    telefono: normalizePhone(data.telefono),
    password: String(data.password || ''),
    rol: String(data.rol || '').trim(),
    activo: data.activo === undefined ? true : Boolean(data.activo)
  };
}

function validatePassword(password) {
  const errors = [];
  if (!password || password.length < 8 || password.length > 128) {
    errors.push('La contrasena debe tener entre 8 y 128 caracteres.');
  }
  if (password && !/[a-z]/.test(password)) errors.push('La contrasena debe incluir una minuscula.');
  if (password && !/[A-Z]/.test(password)) errors.push('La contrasena debe incluir una mayuscula.');
  if (password && !/\d/.test(password)) errors.push('La contrasena debe incluir un numero.');
  return errors;
}

function validateUserData(data, { requirePassword = true, requireRole = true, requireContact = true } = {}) {
  const errors = [];

  if (!data.nombre || data.nombre.length < 2 || data.nombre.length > 100) {
    errors.push('El nombre debe tener entre 2 y 100 caracteres.');
  }

  if (!data.username || data.username.length < 3 || data.username.length > 50) {
    errors.push('El usuario debe tener entre 3 y 50 caracteres.');
  } else if (!/^[A-Za-z0-9._-]+$/.test(data.username)) {
    errors.push('El usuario solo puede contener letras, numeros, punto, guion y guion bajo.');
  }

  if (requireContact && !data.correo) {
    errors.push('El correo electronico es obligatorio.');
  }
  if (data.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.correo)) {
    errors.push('El correo electronico no es valido.');
  }

  if (requireContact && !data.telefono) {
    errors.push('El telefono es obligatorio.');
  }
  if (data.telefono && (data.telefono.length < 7 || data.telefono.length > 15)) {
    errors.push('El telefono debe tener entre 7 y 15 digitos.');
  }

  if (requireRole && !VALID_ROLES.includes(data.rol)) {
    errors.push('El rol no es valido.');
  }

  if (requirePassword) {
    errors.push(...validatePassword(data.password));
  } else if (data.password) {
    errors.push(...validatePassword(data.password));
  }

  return errors;
}

async function assertUniqueUserFields(data, { excludeUserId = null, client = pool } = {}) {
  if (data.correo) {
    await ensureUserProfileColumns(client);
  }

  const checks = [
    {
      value: data.username,
      sql: 'SELECT id FROM usuarios WHERE LOWER(username) = LOWER($1)',
      error: 'El nombre de usuario ya esta ocupado.'
    }
  ];

  if (data.correo) {
    checks.push({
      value: data.correo,
      sql: 'SELECT id FROM usuarios WHERE LOWER(correo) = LOWER($1)',
      error: 'El correo electronico ya esta registrado.'
    });
  }

  for (const check of checks) {
    const params = [check.value];
    let sql = `${check.sql}`;
    if (excludeUserId) {
      sql += ' AND id <> $2';
      params.push(excludeUserId);
    }
    sql += ' LIMIT 1';
    const result = await client.query(sql, params);
    if (result.rows.length > 0) {
      const error = new Error(check.error);
      error.statusCode = 409;
      throw error;
    }
  }
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    rol: row.rol,
    nombre: row.nombre,
    correo: row.correo || '',
    telefono: row.telefono || '',
    activo: row.activo,
    fecha_creacion: row.fecha_creacion
  };
}

async function createUser(data, { client = pool, roleOverride = null, requireContact = true } = {}) {
  await ensureUserProfileColumns(client);

  const userData = normalizeUserPayload({
    ...data,
    rol: roleOverride || data.rol
  });
  const errors = validateUserData(userData, { requirePassword: true, requireRole: true, requireContact });
  if (errors.length > 0) {
    const error = new Error(errors[0]);
    error.statusCode = 400;
    throw error;
  }

  await assertUniqueUserFields(userData, { client });

  const hashedPassword = await bcrypt.hash(userData.password, 10);
  const result = await client.query(
    `INSERT INTO usuarios (username, password, rol, nombre, activo, correo, telefono)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, username, rol, nombre, correo, telefono, activo, fecha_creacion`,
    [
      userData.username,
      hashedPassword,
      userData.rol,
      userData.nombre,
      userData.activo,
      userData.correo || null,
      userData.telefono || null
    ]
  );
  return publicUser(result.rows[0]);
}

async function updateUser(id, data, { client = pool } = {}) {
  await ensureUserProfileColumns(client);

  const userData = normalizeUserPayload(data);
  const errors = validateUserData(userData, { requirePassword: false, requireRole: true, requireContact: false });
  if (errors.length > 0) {
    const error = new Error(errors[0]);
    error.statusCode = 400;
    throw error;
  }

  await assertUniqueUserFields(userData, { excludeUserId: id, client });

  const params = [
    userData.username,
    userData.rol,
    userData.nombre,
    userData.activo,
    userData.correo || null,
    userData.telefono || null
  ];
  let query = `
    UPDATE usuarios
    SET username = $1, rol = $2, nombre = $3, activo = $4, correo = $5, telefono = $6
  `;

  if (userData.password) {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    params.push(hashedPassword);
    query += `, password = $${params.length}`;
  }

  params.push(id);
  query += ` WHERE id = $${params.length} RETURNING id, username, rol, nombre, correo, telefono, activo, fecha_creacion`;

  const result = await client.query(query, params);
  if (result.rows.length === 0) {
    const error = new Error('Usuario no encontrado.');
    error.statusCode = 404;
    throw error;
  }
  return publicUser(result.rows[0]);
}

module.exports = {
  VALID_ROLES,
  normalizeEmail,
  normalizePhone,
  normalizeUserPayload,
  validatePassword,
  validateUserData,
  assertUniqueUserFields,
  publicUser,
  ensureUserProfileColumns,
  createUser,
  updateUser
};
