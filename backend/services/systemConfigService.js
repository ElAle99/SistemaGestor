const { pool } = require('../config/db');
require('../config/env');

function readBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

async function getSystemSetting(key, client = pool) {
  const result = await client.query(
    'SELECT valor FROM configuracion_sistema WHERE clave = $1',
    [key]
  );
  return result.rows[0]?.valor ?? null;
}

async function setSystemSetting(key, value, updatedBy, client = pool) {
  const result = await client.query(
    `INSERT INTO configuracion_sistema (clave, valor, actualizado_por, fecha_actualizacion)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (clave) DO UPDATE SET
       valor = EXCLUDED.valor,
       actualizado_por = EXCLUDED.actualizado_por,
       fecha_actualizacion = CURRENT_TIMESTAMP
     RETURNING clave, valor, actualizado_por, fecha_actualizacion`,
    [key, String(value), updatedBy || null]
  );
  return result.rows[0];
}

async function isUserCreationAllowed(client = pool) {
  if (readBoolean(process.env.ALLOW_USER_CREATION, false)) {
    return true;
  }

  const storedValue = await getSystemSetting('allow_user_creation', client);
  return readBoolean(storedValue, false);
}

module.exports = {
  getSystemSetting,
  setSystemSetting,
  isUserCreationAllowed,
  readBoolean
};
