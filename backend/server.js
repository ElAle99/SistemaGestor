require('./config/env');
if (process.env.NODE_ENV === 'production') {
  const hasUrl = !!process.env.DATABASE_URL?.trim();
  if (!hasUrl && !['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'].every(key => process.env[key]?.trim())) throw new Error('DATABASE_URL de runtime es obligatorio en producción, o un conjunto PG* completo.');
  if (!process.env.JWT_SECRET?.trim()) throw new Error('JWT_SECRET es obligatorio en producción.');
  if (hasUrl) try {
    const url = new URL(process.env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password) throw new Error();
  } catch { throw new Error('DATABASE_URL de runtime no es una URL PostgreSQL válida. Revisa el secreto sin publicarlo.'); }
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB, pool } = require('./config/db');
const { retryStartup, handlePoolErrors, installShutdown, safeCode, isTransient } = require('./config/dbLifecycle');
handlePoolErrors(pool);

const app = express();
// Railway terminates HTTPS at its ingress; trust only the nearest proxy.
app.set('trust proxy', 1);
app.disable('x-powered-by');
const PORT = process.env.PORT || 5000;
const devPreview = process.env.NODE_ENV !== 'production' && process.argv?.includes('--dev-preview');
let databaseReady = false;
const frontendPath = path.join(__dirname, '..', 'frontend');
app.get('/healthz', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!databaseReady) return res.status(503).json({ status: 'unavailable' });
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ok' });
  } catch {
    return res.status(503).json({ status: 'unavailable' });
  }
});

const localOrigins = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:8090',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:8090'
];

function normalizeOrigin(origin = '') {
  return String(origin).trim().replace(/\/$/, '');
}

function parseOrigins(value = '') {
  return String(value)
    .split(',')
    .map(normalizeOrigin)
    .filter(origin => origin && origin !== '*');
}

const configuredOrigins = new Set([
  ...parseOrigins(process.env.FRONTEND_URL),
  ...parseOrigins(process.env.ALLOWED_ORIGINS)
]);
const devOrigins = new Set(localOrigins);
const corsMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const corsAllowedHeaders = ['Content-Type', 'Authorization'];
const corsCredentials = String(process.env.CORS_CREDENTIALS || '').toLowerCase() === 'true';

function getRequestHostOrigin(req) {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host');
  return host ? normalizeOrigin(`${protocol}://${host}`) : '';
}

function isSameRequestOrigin(origin, req) {
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(getRequestHostOrigin(req));
    return originUrl.protocol === requestUrl.protocol && originUrl.host === requestUrl.host;
  } catch (error) {
    return false;
  }
}

const baseCorsOptions = {
  methods: corsMethods,
  allowedHeaders: corsAllowedHeaders,
  credentials: corsCredentials,
  optionsSuccessStatus: 204
};

function corsOptionsDelegate(req, callback) {
  const origin = normalizeOrigin(req.get('origin'));

  if (
    !origin ||
    configuredOrigins.has(origin) ||
    isSameRequestOrigin(origin, req) ||
    (process.env.NODE_ENV !== 'production' && devOrigins.has(origin))
  ) {
    return callback(null, { ...baseCorsOptions, origin: true });
  }

  return callback(new Error('Origen no permitido por CORS'));
}

app.use(cors(corsOptionsDelegate));
app.options('*', cors(corsOptionsDelegate));
app.use((err, req, res, next) => {
  if (err.message === 'Origen no permitido por CORS') {
    return res.status(403).json({ error: err.message });
  }
  return next(err);
});
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(frontendPath));
app.use('/vendor/jsbarcode', express.static(path.join(__dirname, 'node_modules', 'jsbarcode', 'dist')));
app.use('/vendor/html2canvas', express.static(path.join(__dirname, 'node_modules', 'html2canvas', 'dist')));
app.use('/vendor/jspdf', express.static(path.join(__dirname, 'node_modules', 'jspdf', 'dist')));
app.use('/vendor/jspdf-autotable', express.static(path.join(__dirname, 'node_modules', 'jspdf-autotable', 'dist')));
app.use('/vendor/dayjs', express.static(path.join(__dirname, 'node_modules', 'dayjs')));
app.use('/uploads', require('./routes/privateFiles'));

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Rutas
app.use('/api/setup', require('./routes/setup'));
app.use('/api', (req, res, next) => {
  if (databaseReady) return next();
  res.set('Cache-Control', 'no-store');
  return res.status(503).json({ error: 'Base de datos no disponible. Restablece la conexión y reinicia el servidor.' });
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/ordenes', require('./routes/ordenes'));
app.use('/api/catalogos', require('./routes/catalogos'));
app.use('/api/inventario', require('./routes/inventario'));
app.use('/api/ventas', require('./routes/ventas'));
app.use('/api/cotizaciones', (req,res)=>res.status(410).json({error:'Este modulo ya no esta disponible.'}));
app.get(['/cotizaciones','/cotizaciones/*'],(req,res)=>res.status(410).send('Este modulo ya no esta disponible.'));
app.use('/api/calendario', require('./routes/calendario'));
app.use('/api/reportes', require('./routes/reportes'));
app.use('/api/configuracion', require('./routes/config'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/pos', require('./routes/pos'));
app.use('/api/caja', require('./routes/caja'));
app.use('/api/eventos', require('./routes/eventos'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/archivos', require('./routes/privateFiles'));
app.use('/api/garantias', require('./routes/garantias'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta API no encontrada.' }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || !req.accepts('html')) return next();
  return res.sendFile(path.join(frontendPath, 'index.html'));
});

// Iniciar servidor
app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  console.error('Error de solicitud:',error.code||error.name);
  res.status(error.status>=400&&error.status<500?error.status:500).json({error:'No se pudo completar la solicitud.'});
});
async function start() {
  try {
    if (!process.env.JWT_SECRET?.trim()) throw new Error('JWT_SECRET es obligatorio.');
    try {
      await retryStartup(async () => { await pool.query('SELECT 1'); await initDB(); });
      databaseReady = true;
      console.log('Conexión y seguridad PostgreSQL verificadas; no se ejecutaron migraciones.');
    } catch (error) {
      if (!devPreview || !isTransient(error)) throw error;
      console.error('Vista previa local: PostgreSQL no disponible; API desactivada. Corrige la conexión y escribe rs en nodemon para reiniciar.', safeCode(error));
    }
    return await new Promise((resolve, reject) => {
      const server = app.listen(PORT, devPreview ? '127.0.0.1' : '0.0.0.0', () => {
        console.log(`Servidor corriendo en http://localhost:${PORT}`);
        resolve(server);
      });
      server.once('error', reject);
    });
  } catch (error) {
    console.error('No se pudo iniciar el servidor. Revisa conexión, credencial restringida y esquema; ejecuta npm run db:check.', safeCode(error));
    await pool.end();
    throw error;
  }
}

if (require.main === module) {
  start().then(server => installShutdown(server, pool)).catch(() => { process.exitCode = 1; });
}

module.exports = { app, start };
