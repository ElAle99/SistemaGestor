// Compatibility entry point: reuse the application connection pool.
const { pool } = require('../config/db');
async function getDatabase() {
  await pool.query('SELECT 1');
  return pool;
}
module.exports = { getDatabase };