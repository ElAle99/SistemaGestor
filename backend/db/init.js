// Compatibility entry point: keep a single schema initializer.
const { initDB } = require('../config/db');
module.exports = { initializeDatabase: initDB };