// db/database.js - Conexión PostgreSQL usando pg

const { Pool } = require('pg');
require('dotenv').config();
const { getPgPoolConfig } = require('../config/pgConfig');

let poolInstance = null;

async function getDatabase() {
  if (poolInstance) return poolInstance;

  poolInstance = new Pool(getPgPoolConfig());

  // Test the connection
  try {
    await poolInstance.query('SELECT 1');
    console.log('Conexión exitosa a PostgreSQL');
  } catch (err) {
    console.error('Error al conectar a PostgreSQL:', err);
  }

  return poolInstance;
}

module.exports = { getDatabase };
