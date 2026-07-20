require('./config/env');
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./config/db');
const garantiaService = require('./services/garantiaService');

const app = express();
const PORT = process.env.PORT || 5000;
const frontendPath = path.join(__dirname, '..', 'frontend');

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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Rutas
app.use('/api/setup', require('./routes/setup'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/ordenes', require('./routes/ordenes'));
app.use('/api/inventario', require('./routes/inventario'));
app.use('/api/ventas', require('./routes/ventas'));
app.use('/api/cotizaciones', require('./routes/cotizaciones'));
app.use('/api/calendario', require('./routes/calendario'));
app.use('/api/reportes', require('./routes/reportes'));
app.use('/api/configuracion', require('./routes/config'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/pos', require('./routes/pos'));
app.use('/api/caja', require('./routes/caja'));
app.use('/api/eventos', require('./routes/eventos'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/garantias', require('./routes/garantias'));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || !req.accepts('html')) return next();
  return res.sendFile(path.join(frontendPath, 'index.html'));
});

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  try {
    await initDB();
    await garantiaService.initGarantiasDB();
    console.log('Base de datos inicializada correctamente');
  } catch (error) {
    console.error('Error al inicializar la base de datos:', error);
  }
});

