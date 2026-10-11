import { mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
// Use the existing Railway app, including its same-origin login and assets.
// Only a trusted HTTPS deployment may receive the native Bluetooth bridge.
const origin = process.env.ALLFIX_APP_URL;
const config = JSON.parse(await readFile('capacitor.config.json', 'utf8'));
if (origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('ALLFIX_APP_URL debe ser el origen HTTPS de tu instalación Allfix.');
  config.server = { url: url.origin, cleartext: false };
} else {
  delete config.server;
  console.warn('Sin ALLFIX_APP_URL: se sincronizará el frontend local. Configura la URL HTTPS de Railway antes de instalar el APK para usar login/API.');
}
await mkdir('www', { recursive: true });
await rm('www/js/qzPrinterService.js', { force: true });
for (const name of ['index.html', 'css', 'js', 'dist', 'img']) {
  try { await cp(`frontend/${name}`, `www/${name}`, { recursive: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await writeFile('capacitor.config.json', JSON.stringify(config, null, 2) + '\n');
