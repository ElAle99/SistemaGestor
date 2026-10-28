const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const dotenv = require('../backend/node_modules/dotenv');

const root = path.resolve(__dirname, '..');
const local = path.join(root, '.local');
const statePath = path.join(local, 'postgres-local.json');
const dataDir = path.join(local, 'postgres-data');
const native = path.join(local, 'postgres-tools/node_modules/@embedded-postgres/windows-x64/native');
const executable = name => path.join(native, 'bin', name + '.exe');
function run(name, args) {
  // PostgreSQL outlives pg_ctl; inherited output pipes would hold Node open on Windows.
  return execFileSync(executable(name), args, { stdio: 'ignore', windowsHide: true, timeout: 60000 });
}
function state() {
  if (!fs.existsSync(statePath)) throw new Error('Falta la configuración local. Ejecuta npm run db:local:restore.');
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}
function start(settings = state()) {
  try { run('pg_ctl', ['status', '-D', dataDir]); return; } catch (error) {
    if (error.status !== 3) throw error;
  }
  run('pg_ctl', ['start', '-D', dataDir, '-l', path.join(local, 'postgres.log'),
    '-o', `-h 127.0.0.1 -p ${settings.port}`, '-w', '-t', '30']);
  console.log(`PostgreSQL local iniciado en 127.0.0.1:${settings.port}.`);
}
function initialize() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Esta instalación portátil requiere Windows x64.');
  if (!fs.existsSync(executable('initdb'))) throw new Error('Instala los binarios: npm install --prefix .local/postgres-tools --ignore-scripts --save-exact @embedded-postgres/windows-x64@18.4.0-beta.17');
  fs.mkdirSync(local, { recursive: true });
  let settings;
  if (fs.existsSync(statePath)) settings = state();
  else {
    if (fs.existsSync(dataDir)) throw new Error('Ya existe un directorio PostgreSQL sin configuración; no se sobrescribirá.');
    const port = 55432;
    const admin = new URL(`postgresql://postgres@127.0.0.1:${port}/allfix_local`);
    admin.password = crypto.randomBytes(32).toString('hex');
    const runtime = new URL(admin); runtime.username = 'sistema_gestor_app';
    runtime.password = crypto.randomBytes(32).toString('hex');
    settings = { port, adminUrl: admin.toString(), runtimeUrl: runtime.toString() };
    fs.writeFileSync(statePath, JSON.stringify(settings, null, 2), { flag: 'wx', mode: 0o600 });
  }
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    const passwordFile = path.join(local, 'initdb-password.tmp');
    fs.writeFileSync(passwordFile, decodeURIComponent(new URL(settings.adminUrl).password), { mode: 0o600 });
    try {
      run('initdb', ['-D', dataDir, '-U', 'postgres', '--pwfile', passwordFile,
        '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C']);
    } finally { fs.unlinkSync(passwordFile); }
  }
  start(settings);
  return settings;
}
function configuredForLocal(settings) {
  const envFile = path.join(root, 'backend/.env');
  const saved = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
  const configured = process.env.DATABASE_URL || saved.DATABASE_URL;
  if (!configured) return false;
  const actual = new URL(configured), expected = new URL(settings.runtimeUrl);
  return actual.host === expected.host && actual.pathname === expected.pathname && actual.username === expected.username;
}
if (require.main === module) {
  try {
    const command = process.argv[2];
    if (command === 'start-if-configured') {
      if (process.env.NODE_ENV !== 'production' && fs.existsSync(statePath)) {
        const settings = state();
        if (configuredForLocal(settings)) start(settings);
      }
    } else if (command === 'start') start();
    else if (command === 'stop') {
      run('pg_ctl', ['stop', '-D', dataDir, '-m', 'fast', '-w']);
      console.log('PostgreSQL local detenido.');
    } else throw new Error('Usa start, stop o start-if-configured.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { initialize, root, local };
