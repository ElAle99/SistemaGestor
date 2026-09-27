const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const seed = require('../../backend/db/catalogSeed');
const root = path.resolve(__dirname, '../../frontend');
let server;
let origin;
const catalog = { tipos: [], marcas: [], fallas: [], reparaciones: [], relaciones: [], puede_guardar: true };
let nextId = 1;
for (const [type, names] of Object.entries(seed.brands)) {
  const tipo = { id: nextId++, nombre: type }; catalog.tipos.push(tipo);
  for (const nombre of seed.split(names)) catalog.marcas.push({ id: nextId++, nombre, tipo_equipo_id: tipo.id });
  for (const nombre of seed.split(seed.faults[type])) {
    const fault = { id: nextId++, nombre, tipo_equipo_id: tipo.id }; catalog.fallas.push(fault);
    for (const repair of seed.suggestedRepairs(type, nombre)) {
      let row = catalog.reparaciones.find(r => r.tipo_equipo_id === tipo.id && r.nombre === repair);
      if (!row) { row = { id: nextId++, nombre: repair, tipo_equipo_id: tipo.id }; catalog.reparaciones.push(row); }
      catalog.relaciones.push({ falla_id: fault.id, reparacion_id: row.id });
    }
  }
}
test.beforeAll(async () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const helper = name => {
    const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    const tail = app.slice(start);
    const next = tail.slice(1).search(/\n(?:async )?function /);
    return next < 0 ? tail : tail.slice(0, next + 1);
  };
  const helpers = ['fileToDataUrl', 'readOrderPhotoFiles', 'initPatternLock'].map(helper).join('\n');
  const form = html.slice(html.indexOf('<div id="quick-order-modal"'), html.indexOf('<div id="order-modal"'));
  server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/quickOrder.css"><link rel="stylesheet" href="/dist/order-catalog.css"></head><body>${form}<script>
        const BASE_API_URL = '/api'; const ESTABLISHMENT_CONFIG = {autoPrintTicket:false};
        async function loadAllData() {} async function viewOrderDetails() {} async function printReceipt() {}
        const ORDER_PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
        ${helpers}
        </script><script src="/js/quickOrderExtras.js"></script><script src="/js/quickOrder.js"></script><script defer src="/dist/order-catalog.js"></script></body></html>`);
    }
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/catalogos', route => route.fulfill({ json: catalog }));
  await page.route('**/api/catalogos/modelos?*', route => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    return route.fulfill({ json: [{ id: 2000, nombre: 'Samsung Galaxy A55 5G' }].filter(row => row.nombre.toLowerCase().includes(query.toLowerCase())) });
  });
  await page.route('**/api/clientes?*', route => route.fulfill({ json: [] }));
  await page.goto(origin);
  await page.waitForFunction(() => !!globalThis.quickCatalog);
  await page.evaluate(() => openQuickOrder());
  await expect(page.getByText('Guardar nuevos valores en el catálogo de mi negocio')).toBeVisible();
});

async function select(page, field, text) {
  await page.locator(`#smart-${field}`).fill(text);
  await page.locator('.smart-catalog-field').filter({ has: page.locator(`#smart-${field}`) })
    .locator('.ant-select-dropdown .ant-select-item-option').filter({ hasText: text }).first().click();
  await page.locator(`#smart-${field}`).press('Tab');
}

test('cascading searchable selectors, multiple tags and exact order payload', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let posted;
  await page.route('**/api/ordenes/rapida', async route => { posted = route.request().postDataJSON(); await route.fulfill({ json: { id: 17, folio: 'AFB-2026-10043' } }); });
  await page.locator('#quick-client-name').fill('Juan Pérez');
  await page.locator('#quick-client-phone').fill('9831909656');
  await select(page, 'deviceType', 'Celular');
  await select(page, 'brand', 'Samsung');
  await page.locator('#smart-model').fill('A55');
  await page.getByText('Samsung Galaxy A55 5G', { exact: true }).last().click();
  await select(page, 'fallas', 'Pantalla rota');
  await select(page, 'fallas', 'No carga');
  await page.locator('#smart-reparaciones').click();
  await expect(page.getByText('Cambio de pantalla · Sugerida', { exact: true })).toBeVisible();
  await select(page, 'reparaciones', 'Cambio de pantalla');
  await select(page, 'reparaciones', 'Cambio centro de carga');
  await page.locator('#quick-cost').fill('2400');
  await page.locator('#quick-advance').fill('500');
  await page.getByRole('button', { name: 'Crear orden', exact: true }).click();
  await expect(page.getByText('Orden AFB-2026-10043 creada correctamente.')).toBeVisible();
  expect(posted.fallas).toEqual(['Pantalla rota', 'No carga']);
  expect(posted.reparaciones).toEqual(['Cambio de pantalla', 'Cambio centro de carga']);
  expect(posted.model).toBe('Samsung Galaxy A55 5G');
  expect(posted.guardar_catalogo).toBe(true);
  expect(posted).not.toHaveProperty('negocio_id');
  expect(errors).toEqual([]);
});

test('manual model and tags, parent reset, and mobile single column', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await select(page, 'deviceType', 'Celular');
  await select(page, 'brand', 'Samsung');
  await page.locator('#smart-model').fill('Red Magic 9 Pro');
  await page.getByText('Agregar modelo “Red Magic 9 Pro”', { exact: true }).click();
  await page.locator('#smart-fallas').fill('Falla personalizada');
  await page.locator('#smart-fallas').press('Enter');
  await expect(page.locator('#quick-fault')).toHaveValue('Falla personalizada');
  const device = await page.locator('#smart-deviceType').boundingBox();
  const brand = await page.locator('#smart-brand').boundingBox();
  expect(brand.y).toBeGreaterThan(device.y);
  expect(Math.abs(brand.x - device.x)).toBeLessThan(2);
  await select(page, 'deviceType', 'Laptop');
  await expect(page.locator('#quick-brand')).toHaveValue('');
  await expect(page.locator('#quick-model')).toHaveValue('');
  await expect(page.locator('#quick-fault')).toHaveValue('');
  await page.locator('#smart-brand').click();
  await expect(page.getByText('Dell', { exact: true }).last()).toBeVisible();
  await page.screenshot({ path: 'test-results/catalog-mobile.png', fullPage: true });
});

test('manual type changes to an editable input and disables catalog learning on request', async ({ page }) => {
  await page.locator('#smart-deviceType').fill('Proyector');
  await page.getByText('+ Otro / Escribir manualmente', { exact: true }).click();
  await page.locator('#smart-deviceType').fill('Proyector');
  await expect(page.locator('#quick-device')).toHaveValue('Proyector');
  await page.getByRole('checkbox').uncheck();
  expect(await page.evaluate(() => globalThis.quickCatalog.payload().guardar_catalogo)).toBe(false);
});

test('optional access preserves PIN zeros, clears inactive secrets and draws a reusable pattern', async ({ page }) => {
  expect(await page.evaluate(() => quickOrderExtras.payload().lock_type)).toBe('Ninguno');
  await page.locator('#quick-lock-type').selectOption('PIN');
  await page.locator('#quick-lock-pin').fill('0012');
  expect(await page.evaluate(() => quickOrderExtras.payload().lock_pin)).toBe('0012');
  await page.locator('#quick-lock-type').selectOption('Contraseña');
  await page.locator('#quick-lock-pass').fill('Clave con espacios');
  await expect(page.locator('#quick-lock-pin')).toHaveValue('');
  await page.locator('#quick-lock-type').selectOption('Patrón');
  await expect(page.locator('#quick-lock-pass')).toHaveValue('');
  const canvas = page.locator('#quick-pattern-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const point = id => ({ x: box.x + (40 + ((id - 1) % 3) * 80) * box.width / 240,
    y: box.y + (40 + Math.floor((id - 1) / 3) * 80) * box.height / 240 });
  const first = point(1); await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const id of [2, 5, 8]) { const p = point(id); await page.mouse.move(p.x, p.y, { steps: 10 }); }
  await page.mouse.up();
  await expect(page.locator('#quick-lock-pattern')).toHaveValue('1-2-5-8');
  await page.getByRole('button', { name: 'Limpiar patrón' }).click();
  await expect(page.locator('#quick-lock-pattern')).toHaveValue('');
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1)] });
  for (const id of [2, 5, 8]) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(id)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#quick-lock-pattern')).toHaveValue('1-2-5-8');
  await session.detach();
  await page.evaluate(() => openQuickOrder());
  await expect(page.locator('#quick-pattern-group')).toBeHidden();
});

test('multiple photo previews, drag/drop, removal and camera capture input', async ({ page }) => {
  const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGfoAAAAASUVORK5CYII=', 'base64');
  await page.locator('#quick-photo-files').setInputFiles([
    { name: 'front.png', mimeType: 'image/png', buffer }, { name: 'back.png', mimeType: 'image/png', buffer }
  ]);
  await expect(page.locator('#quick-photo-previews img')).toHaveCount(2);
  await page.getByRole('button', { name: 'Eliminar foto 1', exact: true }).click();
  await expect(page.locator('#quick-photo-previews img')).toHaveCount(1);
  await page.evaluate(base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
    document.getElementById('quick-photo-drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, buffer.toString('base64'));
  await expect(page.locator('#quick-photo-previews img')).toHaveCount(2);
  await expect(page.locator('#quick-photo-capture')).toHaveAttribute('capture', 'environment');
  expect(await page.evaluate(() => quickOrderExtras.payload().evidenciasNuevas.length)).toBe(2);
  await page.evaluate(() => openQuickOrder());
  await expect(page.locator('#quick-photo-previews img')).toHaveCount(0);
});

test('responsive payment summary reflects advance, unknown price and invalid amounts', async ({ page }) => {
  await expect(page.locator('#quick-summary-balance')).toHaveText('Por definir');
  await page.locator('#quick-cost').fill('2400');
  await page.locator('#quick-advance').fill('500');
  await expect(page.locator('#quick-summary-balance')).toHaveText('$1,900.00');
  await expect(page.locator('#quick-footer-balance')).toHaveText('$1,900.00');
  const main = await page.locator('.quick-form-main').boundingBox();
  const side = await page.locator('.quick-financial-panel').boundingBox();
  expect(side.x).toBeGreaterThan(main.x + main.width);
  await page.screenshot({ path: 'test-results/order-desktop.png', fullPage: true });
  await page.locator('#quick-advance').fill('2400');
  await expect(page.locator('#quick-summary-balance')).toHaveText('$0.00');
  await page.locator('#quick-advance').fill('2500');
  await expect(page.locator('#quick-summary-balance')).toHaveText('Revisar importes');
  await expect(page.locator('#quick-balance-hint')).toContainText('mayor al costo');
  await page.locator('#quick-cost').fill('0.30');
  await page.locator('#quick-advance').fill('0.10');
  await expect(page.locator('#quick-summary-balance')).toHaveText('$0.20');
  await page.locator('#quick-cost').fill('2400');
  await page.locator('#quick-advance').fill('500');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.quick-financial-panel').scrollIntoViewIfNeeded();
  await expect(page.locator('#quick-footer-balance')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/order-mobile-payment.png', fullPage: true });
  await page.evaluate(() => openQuickOrder());
  await expect(page.locator('#quick-summary-balance')).toHaveText('Por definir');
  await page.screenshot({ path: 'test-results/order-mobile.png', fullPage: true });
});

test('reception options follow equipment without losing selections, notes or Other text', async ({ page }) => {
  await select(page, 'deviceType', 'Celular');
  await select(page, 'inspeccion', 'Tapa rota');
  await select(page, 'accesorios', 'Funda');
  await select(page, 'inspeccion', 'Otro');
  await page.getByRole('textbox', { name: 'Otra inspección visual', exact: true }).fill('Tapa despegada');
  await select(page, 'accesorios', 'Otro');
  await page.getByRole('textbox', { name: 'Otro accesorio', exact: true }).fill('Adaptador USB-C');
  await page.locator('#quick-reception-note').fill('Recibido sin bandeja SIM');
  await select(page, 'deviceType', 'Laptop');
  await expect(page.getByText('Cambió el equipo. Conservamos la inspección y los accesorios seleccionados; revísalos antes de guardar.')).toBeVisible();
  await select(page, 'inspeccion', 'Bisagras dañadas');
  await select(page, 'accesorios', 'Mouse');
  const data = await page.evaluate(() => quickCatalog.payload());
  expect(data.inspeccion_visual).toEqual(['Tapa rota', 'Otro: Tapa despegada', 'Bisagras dañadas']);
  expect(data.accesorios_entregados).toEqual(['Funda', 'Otro: Adaptador USB-C', 'Mouse']);
  expect(data.nota_recepcion).toBe('Recibido sin bandeja SIM');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#quick-reception-section').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => openQuickOrder());
  await expect(page.locator('#quick-reception-note')).toHaveValue('');
  expect((await page.evaluate(() => quickCatalog.payload())).inspeccion_visual).toEqual([]);
});
