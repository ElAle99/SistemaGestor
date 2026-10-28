const path = require('node:path');
require('./env');
const configured = process.env.UPLOAD_DIR?.trim() || process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
const uploadDir = configured
  ? path.resolve(configured)
  : path.resolve(__dirname, '../uploads');
module.exports = { uploadDir };
