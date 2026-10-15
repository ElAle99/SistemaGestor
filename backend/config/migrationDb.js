// CLI-only. Never import this module from the HTTP server or request services.
require('./env');
const { Pool } = require('pg');
const { getMigrationPoolConfig } = require('./pgConfig');
module.exports = { pool: new Pool(getMigrationPoolConfig()) };
