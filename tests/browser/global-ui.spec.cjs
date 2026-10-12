const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../frontend');
let server, origin;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/') {
      let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
        .replace(/<link[^>]*href="https:[^>]*>/g, '');
      html = html.replace('</body>', `<script src="/js/formFeedback.js"></script><script src="/test-app.js"></script><script src="/js/quickOrderExtras.js"></script><script src="/js/quickOrder.js"></script><script src="/dist/order-catalog.js"></script><script src="/js/responsive.js"></script><script src="/js/ui.js"></script></body>`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html);
    }
    if (url === '/test-app.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').replace("document.addEventListener('DOMContentLoaded', async () => {", "document.addEventListener('allfix-test-init', async () => {"));
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'image/png');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

test('printer configuration uses local preferences and browser fallback without QZ', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'platform', { value: 'Linux', configurable: true });
    Object.defineProperty(navigator, 'serial', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'usb', { value: undefined, configurable: true });
  });
  await page.addScriptTag({ url: origin + '/dist/printer-service.js' });
  await page.addScriptTag({ url: origin + '/js/printerConfig.js' });
  await page.evaluate(() => {
    initPrinterConfigForm();
    switchView('configuracion');
    window.__prints = 0;
    const append = document.body.append.bind(document.body);
    document.body.append = (...nodes) => {
      append(...nodes);
      for (const node of nodes) if (node.tagName === 'IFRAME') node.contentWindow.print = () => window.__prints++;
    };
    APP_STATE.selectedOrderForReceipt = { folio: 'AFB-TEST', clientName: 'Cliente', lock_pin: 'PRIVATE_PIN' };
  });
  await expect(page.locator('#btn-connect-printer')).toBeDisabled();
  await expect(page.locator('#btn-detect-printers')).toBeDisabled();
  const result = await page.evaluate(async () => {
    window.printerService.savePreferences({ paperWidth: '80mm', autoPrint: false });
    await printReceipt('80mm');
    return { printed: window.__prints, prefs: window.printerService.readPreferences(), qz: typeof window.qz };
  });
  expect(result.printed).toBe(1);
  expect(result.prefs.autoPrint).toBe(false);
  expect(result.qz).toBe('undefined');
  const receipt = await page.locator('iframe[title="Impresión de ticket"]').contentFrame().locator('body').innerText();
  expect(receipt).toContain('AFB-TEST');
  expect(receipt).not.toContain('PRIVATE_PIN');
});

async function serialFixture(page) {
  await page.evaluate(() => {
    window.__writes = []; window.__failWrite = false; window.__requests = 0;
    const port = {
      open: async () => {}, close: async () => {},
      writable: { getWriter: () => ({
        write: async bytes => { if (window.__failWrite) throw new DOMException('Disconnected', 'NetworkError'); window.__writes.push(Array.from(bytes)); },
        releaseLock() {}, abort: async () => {}
      }) }
    };
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { getPorts: async () => [port], requestPort: async () => { window.__requests++; return port; }, addEventListener() {} } });
  });
  await page.addScriptTag({ url: origin + '/dist/printer-service.js' });
  await page.evaluate(() => window.printerService.savePreferences({ connection: 'serial', showLogo: false, chunkDelay: 0 }));
}

test('printer settings keep technical options collapsed and apply paper profiles', async ({ page }) => {
  await serialFixture(page);
  await page.addScriptTag({ url: origin + '/js/printerConfig.js' });
  await page.evaluate(() => { initPrinterConfigForm(); switchView('configuracion'); });
  await page.locator('[href="#config-print-card"]').click();
  await expect(page.locator('#btn-connect-printer')).toBeVisible();
  await expect(page.locator('#cfg-print-dots')).toBeHidden();
  await expect(page.locator('#cfg-print-connection')).toBeHidden();
  await expect(page.locator('#btn-browser-print-test')).toBeHidden();
  await expect(page.locator('#cfg-print-name')).toHaveCount(0);
  await page.locator('#cfg-ticket-paper').selectOption('80mm');
  expect(await page.evaluate(() => printerService.readPreferences().dots)).toBe(576);
  await page.locator('#cfg-ticket-paper').selectOption('58mm');
  expect(await page.evaluate(() => printerService.readPreferences().columns)).toBe(32);
  await page.locator('#printer-advanced summary').click();
  await expect(page.locator('#cfg-print-dots')).toHaveValue('384');
  await expect(page.locator('#cfg-print-codepage')).toHaveValue('cp850');
  await expect(page.locator('#cfg-print-mapping')).toHaveValue('auto');
  // Exercise the expanded layout too: the former desktop grid clipped its fields.
  for (const width of [1920, 1366, 1100, 980, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.locator('#config-printer-form').evaluate(el => {
      const bounds = el.getBoundingClientRect();
      const advanced = el.querySelector('#printer-advanced').getBoundingClientRect();
      const actions = el.querySelector('.printer-config-actions').getBoundingClientRect();
      const clipped = [...el.querySelectorAll('input, select, button, pre, .ticket-logo-settings')]
        .filter(node => node.getClientRects().length && !node.closest('[hidden]'))
        .filter(node => { const r = node.getBoundingClientRect(); return r.left < bounds.left - 1 || r.right > bounds.right + 1; })
        .map(node => node.id || node.className);
      return { overflow: el.scrollWidth - el.clientWidth, clipped, actionsBeforeAdvanced: actions.bottom <= advanced.top };
    });
    expect(layout.overflow, `${width}px`).toBeLessThanOrEqual(1);
    expect(layout.clipped, `${width}px`).toEqual([]);
    expect(layout.actionsBeforeAdvanced, `${width}px`).toBe(true);
    if (width === 1920) await page.screenshot({ path: 'test-results/printer-settings-desktop.png', fullPage: true, animations: 'disabled' });
  }
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await page.screenshot({ path: 'test-results/printer-settings-mobile.png', fullPage: true, animations: 'disabled' });
});

test('USB selector starts on user click and diagnostic keeps the real localhost error', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'platform', { value: 'Linux', configurable: true });
    window.__pickerCalls = 0; window.__pickerActivation = false;
    Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'usb', { configurable: true, value: {
      getDevices: async () => [], addEventListener() {},
      requestDevice: () => {
        window.__pickerCalls++; window.__pickerActivation = navigator.userActivation.isActive;
        return Promise.reject(new DOMException('Access denied by test policy', 'SecurityError'));
      }
    } });
  });
  await page.addScriptTag({ url: origin + '/dist/printer-service.js' });
  await page.addScriptTag({ url: origin + '/js/printerConfig.js' });
  await page.evaluate(() => { initPrinterConfigForm(); switchView('configuracion'); });
  await page.locator('[href="#config-print-card"]').click();
  expect(await page.evaluate(() => window.__pickerCalls)).toBe(0);
  expect(await page.evaluate(() => printerService.readPreferences().connection)).toBe('auto');
  await page.locator('#btn-connect-printer').click();
  await expect(page.locator('#printer-config-status')).toContainText('El contexto es seguro');
  const diagnostic = JSON.parse(await page.locator('#printer-diagnostics').innerText());
  expect(diagnostic.origin).toBe(origin); expect(diagnostic.isSecureContext).toBe(true);
  expect(diagnostic.navigatorUsb).toBe(true); expect(diagnostic.navigatorSerial).toBe(false);
  expect(diagnostic.error).toMatchObject({ name: 'SecurityError', message: 'Access denied by test policy', phase: 'select', method: 'usb' });
  expect(await page.evaluate(() => window.__pickerActivation)).toBe(true);
  await page.locator('#btn-select-other-printer').click();
  expect(await page.evaluate(() => window.__pickerCalls)).toBe(2);
});

async function qzBrowserFixture(page, unavailable = false) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' });
    window.__usbRequests = 0;
    Object.defineProperty(navigator, 'usb', { configurable: true, value: { getDevices: async () => [], addEventListener() {}, requestDevice() { window.__usbRequests++; throw new Error('USB must not open'); } } });
  });
  await page.addScriptTag({url: origin + '/dist/printer-service.js'});
  await page.evaluate(unavailable => {
    window.__qzCalls = []; window.__qzConnects = 0; window.__qzActive = false;
    const qz = printerManager.transports.qz.qz;
    qz.websocket.isActive = () => window.__qzActive;
    qz.websocket.connect = async () => { window.__qzConnects++; if (unavailable) throw new Error('Unable to establish connection with QZ Tray'); window.__qzActive = true; };
    qz.websocket.disconnect = async () => { window.__qzActive = false; };
    qz.printers.find = async () => ['Microsoft Print to PDF','POS-58'];
    qz.configs.create = (name,options) => ({name,options});
    qz.print = async (config,data) => { window.__qzCalls.push({config,data}); };
    window.html2canvas = () => { throw new Error('No physical capture allowed'); };
  }, unavailable);
  await page.addScriptTag({url: origin + '/js/printerConfig.js'});
  await page.evaluate(() => { initPrinterConfigForm(); switchView('configuracion'); });
  await page.locator('[href="#config-print-card"]').click();
}

test('Windows QZ connects on click, selects spooler printer and sends native bytes', async ({page}) => {
  await qzBrowserFixture(page);
  expect(await page.evaluate(() => window.__qzConnects)).toBe(0);
  await page.locator('#btn-connect-printer').click();
  await expect(page.locator('#printer-config-status')).toContainText('QZ Tray conectado');
  await page.locator('#cfg-ticket-printer').selectOption('qz:POS-58');
  await expect(page.locator('#printer-config-status')).toContainText('POS-58 seleccionada');
  await expect(page.locator('#printer-connection-status')).toHaveText('Conectada');
  expect(await page.evaluate(() => printerService.readPreferences().qzPrinterName)).toBe('POS-58');
  await expect(page.locator('#cfg-print-connection')).toBeHidden();
  await page.locator('#btn-test-printer').click();
  await expect(page.locator('#printer-config-status')).toContainText('Prueba enviada');
  const calls = await page.evaluate(() => window.__qzCalls);
  expect(calls).toHaveLength(1); expect(calls[0].config.name).toBe('POS-58');
  expect(calls[0].data[0]).toMatchObject({type:'raw',format:'command',flavor:'base64'});
  expect(Buffer.from(calls[0].data[0].data,'base64').subarray(0,2)).toEqual(Buffer.from([27,64]));
  expect(await page.evaluate(() => window.__usbRequests)).toBe(0);
  await page.locator('#btn-disconnect-printer').click();
  await expect(page.locator('#printer-connection-status')).toHaveText('Desconectada');
});

test('missing QZ explains local desktop requirement and never opens WebUSB automatically', async ({page}) => {
  await qzBrowserFixture(page, true);
  await page.locator('#btn-connect-printer').click();
  await expect(page.locator('#printer-config-status')).toContainText('QZ Tray no está disponible');
  await expect(page.locator('#printer-qz-help')).toBeVisible();
  await expect(page.locator('#btn-connect-printer')).toBeEnabled();
  expect(await page.evaluate(() => window.__usbRequests)).toBe(0);
  expect(await page.evaluate(() => printerManager.resolveMethod())).toBe('browser');
});

test('QZ reconnect retries a failed sale job without creating another sale or ticket job', async ({page}) => {
  await qzBrowserFixture(page);
  await page.locator('#btn-connect-printer').click();
  await page.locator('#cfg-ticket-printer').selectOption('qz:POS-58');
  await page.evaluate(async () => {
    const qz = printerManager.transports.qz.qz, original = qz.print;
    let fail = true;
    qz.print = async (...args) => { if (fail) { fail = false; window.__qzActive = false; throw new Error('Connection closed'); } return original(...args); };
    await handleCompletedSale({fecha:'2026-10-11',total:50,metodo_pago:'Efectivo',items:[{nombre:'Cable',cantidad:1,precio_unitario:50}]});
  });
  await expect(page.locator('#sale-success-message')).toHaveText('Venta completada, ticket pendiente de impresión');
  await page.locator('#btn-sale-retry-print').click();
  await expect.poll(() => page.evaluate(() => [...printerManager.jobs.values()][0].state)).toBe('printed');
  expect(await page.evaluate(() => printerManager.jobs.size)).toBe(1);
  expect(await page.evaluate(() => window.__qzCalls.length)).toBe(1);
  expect(await page.evaluate(() => window.__qzConnects)).toBe(2);
  expect(await page.evaluate(() => window.__usbRequests)).toBe(0);
});

test('service, sale, cash closing and reprint use native bytes without capturing HTML', async ({ page }) => {
  await serialFixture(page);
  const result = await page.evaluate(async () => {
    window.html2canvas = () => { throw new Error('Must not capture physical tickets'); };
    APP_STATE.selectedOrderForReceipt = { folio: 'AFB-SAFE', clientName: 'Ana', lock_pin: 'PRIVATE_PIN', clientPhone: 'PRIVATE_PHONE', costo_estimado: 100, anticipo: 20 };
    await Promise.all([printReceipt(), printReceipt()]);
    const serviceJobs = window.printerManager.jobs.size;
    await window.printerManager.reprintLast('service');
    await handleCompletedSale({ fecha: '2026-10-11', total: 50, metodo_pago: 'Efectivo', items: [{ nombre: 'Cable', cantidad: 1, precio_unitario: 50 }] });
    APP_STATE.selectedCajaForReceipt = { fecha_cierre: '2026-10-11', resumen: { fondo_inicial: 100 }, monto_contado: 150, observaciones: 'PRIVATE_CASH_NOTE' };
    document.getElementById('btn-show-ticket-corte').click();
    await printReceipt();
    return { serviceJobs, jobs: [...window.printerManager.jobs.values()].map(job => job.state), bytes: window.__writes.flat(), requests: window.__requests };
  });
  expect(result.serviceJobs).toBe(1);
  expect(result.jobs).toEqual(['printed', 'printed', 'printed', 'printed']);
  expect(Buffer.from(result.bytes).toString('latin1')).not.toContain('PRIVATE_');
  expect(result.requests).toBe(0);
});

test('confirmed sale survives printer disconnection and reconnect button retries the same job', async ({ page }) => {
  await serialFixture(page);
  await page.evaluate(async () => {
    window.__failWrite = true;
    await handleCompletedSale({ fecha: '2026-10-11', total: 50, metodo_pago: 'Efectivo', items: [{ nombre: 'Cable', cantidad: 1, precio_unitario: 50 }] });
  });
  await expect(page.locator('#sale-success-message')).toHaveText('Venta completada, ticket pendiente de impresión');
  await expect(page.locator('#btn-sale-retry-print')).toBeVisible();
  await page.evaluate(() => { window.__failWrite = false; });
  await page.locator('#btn-sale-retry-print').click();
  await expect.poll(() => page.evaluate(() => [...window.printerManager.jobs.values()][0].state)).toBe('printed');
  expect(await page.evaluate(() => window.printerManager.jobs.size)).toBe(1);
});

test('POS sends the sale once before printing, failure never repeats the charge', async ({ page }) => {
  await serialFixture(page);
  let charges = 0;
  await page.route('**/api/pos/venta', async route => {
    charges++;
    expect(await page.evaluate(() => window.__writes.length)).toBe(0);
    await route.fulfill({ json: { id: 987, fecha: '2026-10-11', total: 50, metodo_pago: 'Efectivo', items: [{ nombre: 'Cable', cantidad: 1, precio_unitario: 50 }] } });
  });
  await page.evaluate(() => {
    initPOS(); switchView('pos');
    APP_STATE.cart = [{ id: 1, nombre: 'Cable', precio: 50, qty: 1, type: 'product' }];
    APP_STATE.cajaActiva = { id: 1 }; updateCartUI();
    document.getElementById('pos-monto-recibido').value = '50';
    window.__failWrite = true;
  });
  await page.locator('#btn-pos-pay').click();
  await expect(page.locator('#sale-success-message')).toHaveText('Venta completada, ticket pendiente de impresión');
  expect(charges).toBe(1);
  expect(await page.evaluate(() => APP_STATE.cart.length)).toBe(0);
  await page.evaluate(() => { window.__failWrite = false; });
  await page.locator('#btn-sale-retry-print').click();
  await expect.poll(() => page.evaluate(() => [...window.printerManager.jobs.values()][0].state)).toBe('printed');
  expect(charges).toBe(1);
});

test('logo is resized to printer width and contains only opaque black and white pixels', async ({ page }) => {
  await serialFixture(page);
  const result = await page.evaluate(async () => {
    const config = window.printerManager.readPreferences();
    const pixels = await window.printerManager.encoder.logoLoader('img/logoallfix-ticket.png', config);
    let monochrome = true;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (![0,255].includes(pixels.data[i]) || pixels.data[i] !== pixels.data[i+1] || pixels.data[i] !== pixels.data[i+2] || pixels.data[i+3] !== 255) monochrome = false;
    }
    window.printerManager.savePreferences({ showLogo: true });
    await window.printerManager.print({ type: 'service', data: { folio: 'LOGO-TEST', logoUrl: 'img/logoallfix-ticket.png' } });
    return { width: pixels.width, monochrome, bytes: window.__writes.flat().length };
  });
  expect(result.width).toBeLessThanOrEqual(384);
  expect(result.monochrome).toBe(true);
  expect(result.bytes).toBeGreaterThan(1000);
});

test('WhatsApp export remains a real high-resolution PNG independent of ESC/POS', async ({ page }) => {
  await page.addScriptTag({ url: origin + '/dist/share-ticket.js' });
  await page.addScriptTag({ url: origin + '/js/receiptShare.js' });
  await page.evaluate(() => {
    viewVentaDetails({ fecha: '2026-10-11', total: 75, metodo_pago: 'Efectivo', items: [{ nombre: 'Cable USB', cantidad: 1, precio_unitario: 75 }] });
  });
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#btn-download-receipt-png').click();
  const download = await downloadEvent;
  const png = fs.readFileSync(await download.path());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(800);
  expect(png.length).toBeLessThan(400 * 1024);
  console.log(`Visual POS PNG: ${png.length} bytes`);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => { window.__sharedType = files[0].type; } });
  });
  await page.locator('#btn-share-receipt-whatsapp').click();
  await expect.poll(() => page.evaluate(() => window.__sharedType)).toBe('image/png');
});
test('visual service preview excludes private DOM data and works without any printer', async ({page}) => {
  await page.addScriptTag({ url: origin + '/dist/share-ticket.js' });
  await page.addScriptTag({ url: origin + '/js/receiptShare.js' });
  await page.evaluate(() => {
    window.html2canvas = () => { throw new Error('Visual sharing must not capture receipt DOM'); };
    window.printerManager = { print() { throw new Error('Sharing must not print'); } };
    window.__visualText = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.__visualText.push(text); return original.call(this,text,...args); };
    APP_STATE.selectedOrderForReceipt = {folio:'AFB-2026-0042',clientName:'José Muñoz',deviceType:'Celular',brand:'Samsung',model:'Galaxy A55',
      fecha_creacion:'2026-10-11T18:30:00',status:'Recibido',falla_reportada:'La pantalla no muestra imagen después de una caída.',
      servicio_solicitado:'Cambio de pantalla y revisión de funcionamiento.',costo_estimado:1500,anticipo:500,
      lock_pin:'SECRET_PIN',lock_pass:'SECRET_PASSWORD',imei:'SECRET_IMEI',clientPhone:'SECRET_PHONE',tracking_token:'SECRET_TOKEN',notas:'SECRET_NOTES'};
    ESTABLISHMENT_CONFIG.phone = '983 123 4567'; ESTABLISHMENT_CONFIG.whatsapp = '';
    for (const id of ['ticket-venta-container','ticket-corte-container','etiqueta-pequena-container']) document.getElementById(id).classList.add('hidden');
    document.getElementById('ticket-recepcion-container').classList.remove('hidden');
    document.getElementById('ticket-recepcion-container').textContent = 'SECRET_DOM_DATA';
    document.getElementById('receipt-modal').classList.remove('hidden');
  });
  await page.locator('#btn-preview-share-ticket').click();
  await expect(page.locator('#share-ticket-preview')).toBeVisible();
  await expect(page.locator('#share-ticket-preview-image')).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#btn-download-share-preview').click();
  const download = await downloadEvent;
  const png = fs.readFileSync(await download.path());
  fs.writeFileSync('test-results/share-service.png',png);
  expect(png.readUInt32BE(16)).toBe(800); expect(png.length).toBeLessThan(400*1024);
  console.log(`Visual service PNG: ${png.length} bytes`);
  const text = await page.evaluate(() => window.__visualText.join(' '));
  expect(text).not.toContain('SECRET_'); expect(text).toContain('José Muñoz'); expect(text).toContain('$1,000.00');
  await page.setViewportSize({width:360,height:800});
  expect(await page.locator('#share-ticket-preview').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.locator('#btn-close-share-preview').click();
  await expect(page.locator('#share-ticket-preview')).not.toBeVisible();
  await expect(page.locator('#share-ticket-preview-image')).not.toHaveAttribute('src');
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: [] }));
  await page.goto(origin);
  await page.evaluate(() => {
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    initNavigation(); initConfigurationNavigation(); applyRolePermissions();
    renderDashboard(); renderClientes(); renderOrdenes(); renderInventario(); renderUsuarios(); renderPOSCatalog(); renderCaja();
  });
});
for (const width of [1920, 1366, 768, 390, 360]) {
  test(`all views fit ${width}px and preserve mobile record labels`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.allfix-quick-actions')).toHaveCount(0);
    await expect(page.locator('.mobile-more')).toHaveCount(0);
    if (width > 1024) {
      await expect(page.locator('.mobile-bottom-nav')).toBeHidden();
      await expect(page.locator('#mobile-menu-toggle')).toBeHidden();
    }
    const views = await page.locator('.view-section').evaluateAll(nodes => nodes.map(node => node.id.replace('view-', '')));
    for (const view of views) {
      await page.evaluate(name => switchView(name), view);
      await expect(page.locator(`#view-${view}`)).toBeVisible();
      if (width <= 640) {
        await page.evaluate(name => {
          document.querySelectorAll(`#view-${name} table`).forEach(table => {
            const body = table.querySelector('tbody'); const count = table.querySelectorAll('thead tr:last-child th').length;
            if (!body || !count) return;
            const row = document.createElement('tr');
            for (let i = 0; i < count; i++) { const cell = document.createElement('td'); cell.textContent = i === 0 ? 'AFB-2026-12345' : 'Texto largo de ejemplo para comprobar la recepción y las acciones disponibles'; row.append(cell); }
            body.append(row);
          });
        }, view);
        await expect.poll(() => page.locator(`#view-${view} table tbody tr:last-child`).evaluateAll(rows => rows.filter(row => {
          if (!row.getClientRects().length) return false;
          const rect = row.getBoundingClientRect(); return rect.right > innerWidth + 2 || rect.left < -2;
        }).length)).toBe(0);
      }
      const overflow = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('.view-section:not(.hidden), .view-section:not(.hidden) *, .topbar, .mobile-bottom-nav')];
        return nodes.filter(el => el.getClientRects().length && getComputedStyle(el).position !== 'absolute' && !el.closest('svg, .table-responsive, .financial-table-wrap, .fc-scroller, .config-section-nav'))
          .filter(el => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 2 || r.left < -2; }).map(el => `${el.tagName}.${el.className}`).slice(0, 8);
      });
      expect(overflow, `${view} at ${width}`).toEqual([]);
    }
    await page.evaluate(() => switchView('ordenes'));
    if (width <= 640) {
      await expect(page.locator('.mobile-bottom-nav')).toBeVisible();
      await expect(page.locator('.sidebar')).not.toBeVisible();
      const rows = page.locator('#view-ordenes .mobile-record-table tbody tr');
      if (await rows.count()) expect(await rows.first().evaluate(el => getComputedStyle(el).display)).toBe('grid');
    }
    await page.screenshot({ path: `test-results/allfix-${width}.png`, fullPage: true });
  });
}
test('notifications deduplicate and confirmation requires an explicit decision', async ({ page }) => {
  let nativeDialogs = 0; page.on('dialog', dialog => { nativeDialogs++; dialog.dismiss(); });
  await page.evaluate(() => { AllfixUI.notify('Orden creada correctamente.'); AllfixUI.notify('Orden creada correctamente.'); });
  await expect(page.locator('.ant-notification-notice')).toHaveCount(1);
  await page.evaluate(() => { window.decision = null; AllfixUI.confirm('¿Eliminar esta orden?').then(value => { window.decision = value; }); });
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.decision)).toBe(false);
  await page.evaluate(() => { AllfixUI.confirm('¿Cerrar caja?').then(value => { window.decision = value; }); });
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.decision)).toBe(true);
  expect(nativeDialogs).toBe(0);
});
test('collapse, permission-aware shortcuts, mobile menu and keyboard focus', async ({ page }) => {
  await page.getByRole('button', { name: 'Colapsar menú', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/sidebar-collapsed/);
  await page.evaluate(() => { APP_STATE.currentRole = 'Técnico'; applyRolePermissions(); });
  await expect(page.locator('.allfix-quick-actions')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.mobile-create-order')).toBeHidden();
  await page.locator('#mobile-menu-toggle').click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(page.locator('#mobile-menu-toggle')).toBeFocused();
});
test('form wrapper blocks duplicate submits and restores controls after failure', async ({ page }) => {
  await page.evaluate(() => {
    const form = document.createElement('form'); form.id = 'test-submit';
    form.innerHTML = '<button type="submit">Guardar prueba</button>';
    document.getElementById('view-dashboard').prepend(form);
    window.saves = 0;
    form.addEventListener('submit', withFormFeedback(async () => {
      window.saves++;
      await new Promise(resolve => { window.finishSave = resolve; });
      throw new Error('Fallo de prueba');
    }));
    form.requestSubmit(); form.requestSubmit();
  });
  await expect(page.getByRole('button', { name: 'Guardar prueba' })).toBeDisabled();
  expect(await page.evaluate(() => window.saves)).toBe(1);
  await page.evaluate(() => window.finishSave());
  await expect(page.getByRole('button', { name: 'Guardar prueba' })).toBeEnabled();
  await expect(page.getByText('Fallo de prueba', { exact: true })).toBeVisible();
});
test('mobile full-screen dialogs fit viewport and leave actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const ids = await page.locator('.modal-overlay:has(.modal-container)').evaluateAll(nodes => nodes.map(node => node.id));
  for (const id of ids) {
    await page.evaluate(id => document.getElementById(id).classList.remove('hidden'), id);
    const dialog = page.locator(`#${id} .modal-container`).first();
    const rect = await dialog.boundingBox();
    if (rect) { expect(rect.width, id).toBeLessThanOrEqual(362); expect(rect.height, id).toBeLessThanOrEqual(742); }
    await page.evaluate(id => document.getElementById(id).classList.add('hidden'), id);
  }
});
test('canceling an actual order deletion sends no DELETE request', async ({ page }) => {
  let deletes = 0;
  page.on('request', request => { if (request.method() === 'DELETE') deletes++; });
  await page.evaluate(() => {
    APP_STATE.ordenes = [{ id: 99, folio: 'TEST-99' }];
    window.deletionFinished = false;
    deleteOrder(99).then(() => { window.deletionFinished = true; });
  });
  await expect(page.getByText(/¿Eliminar la orden TEST-99/)).toBeVisible();
  expect(deletes).toBe(0);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.deletionFinished)).toBe(true);
  expect(deletes).toBe(0);
});
test('autocomplete requests stay quiet while normal requests retain loading feedback', async ({ page }) => {
  await page.evaluate(async () => {
    window.loadingCalls = 0;
    const original = AllfixUI.loading;
    AllfixUI.loading = () => { window.loadingCalls++; return original(); };
    await fetch('/api/clientes?search=Juan', { silent: true });
    await fetch('/api/catalogos/modelos?marca_id=1&q=A55', { silent: true });
  });
  expect(await page.evaluate(() => window.loadingCalls)).toBe(0);
  await page.evaluate(() => fetch('/api/clientes'));
  expect(await page.evaluate(() => window.loadingCalls)).toBe(1);
});
test('full application creates without phone or price and never opens a ticket automatically', async ({ page }) => {
  let posted;
  await page.route('**/api/catalogos', route => route.fulfill({ json: { tipos: [], marcas: [], fallas: [], reparaciones: [], relaciones: [], puede_guardar: true } }));
  await page.route('**/api/ordenes/rapida', async route => {
    posted = route.request().postDataJSON();
    await route.fulfill({ json: { id: 100, folio: 'TEST-100' } });
  });
  await page.evaluate(() => {
    ESTABLISHMENT_CONFIG.autoPrintTicket = true;
    window.previewCalls = 0;
    window.viewOrderDetails = async () => { window.previewCalls++; };
    openQuickOrder();
  });
  await page.locator('#quick-client-name').fill('Prueba de recepción');
  for (const [field, value] of [['deviceType', 'Celular'], ['brand', 'Samsung'], ['model', 'A55']]) {
    await page.locator(`#smart-${field}`).fill(value);
  }
  for (const [field, value] of [['fallas', 'No carga'], ['reparaciones', 'Diagnóstico']]) {
    await page.locator(`#smart-${field}`).fill(value);
  }
  expect(await page.locator('#quick-order-submit').evaluate(el => el.form?.id)).toBe('quick-order-form');
  await page.locator('#quick-order-submit').click();
  await expect(page.getByText('Orden TEST-100 creada correctamente.')).toBeVisible();
  expect(posted.costo_estimado).toBe(null);
  expect(posted.clientPhone).toBe('');
  expect(await page.evaluate(() => window.previewCalls)).toBe(0);
  await expect(page.locator('#receipt-modal')).toBeHidden();
  expect(posted.model).toBe('A55');
  expect(posted.fallas).toEqual(['No carga']);
  expect(posted.reparaciones).toEqual(['Diagnóstico']);
});
test('submit from the footer reveals the first missing required field', async ({ page }) => {
  await page.route('**/api/catalogos', route => route.fulfill({ json: { tipos: [], marcas: [], fallas: [], reparaciones: [], relaciones: [], puede_guardar: false } }));
  await page.evaluate(() => openQuickOrder());
  await page.locator('#quick-order-submit').click();
  await expect(page.locator('#quick-client-name')).toBeFocused();
  await expect(page.locator('#quick-client-name-validation')).toBeInViewport();
  await expect(page.locator('#quick-client-name')).toHaveAttribute('aria-invalid', 'true');
});
test('additional repair has no horizontal overflow or overlapping price hint', async ({ page }) => {
  await page.evaluate(() => document.getElementById('additional-repair-modal').classList.remove('hidden'));
  for (const width of [1366, 768, 640, 390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const dimensions = await page.locator('#additional-repair-modal').evaluate(modal => {
      const body = modal.querySelector('.additional-repair-body');
      const input = modal.querySelector('.additional-repair-money-input').getBoundingClientRect();
      const note = modal.querySelector('.additional-repair-service-note').getBoundingClientRect();
      return { overflow: body.scrollWidth - body.clientWidth, separate: note.top >= input.bottom };
    });
    expect(dimensions.overflow, `width ${width}`).toBeLessThanOrEqual(1);
    expect(dimensions.separate).toBe(true);
    await page.locator('#btn-save-additional-repair').scrollIntoViewIfNeeded();
    await expect(page.locator('#btn-save-additional-repair')).toBeInViewport();
  }
});

test('equipment label and customer ticket use separate queued jobs with read-only detail requests', async ({ page }) => {
  await serialFixture(page);
  const writes = [];
  await page.route('**/ordenes/42', route => {
    writes.push(route.request().method());
    return route.fulfill({ json: { id: 42, folio: 'AFB-LABEL', clientName: 'Ana', clientPhone: '9831234567', lock_type: 'PIN', lock_pin: 'LABEL_SECRET', costo_estimado: 100, anticipo: 20 } });
  });
  const result = await page.evaluate(async () => {
    window.html2canvas = () => { throw new Error('Label must never capture HTML'); };
    APP_STATE.selectedOrderForReceipt = { id: 42, folio: 'AFB-LABEL', clientName: 'Ana', costo_estimado: 100, anticipo: 20 };
    await printReceipt();
    await Promise.all([window.printEquipmentLabel(), window.printEquipmentLabel()]);
    return [...window.printerManager.jobs.values()].map(job => ({ type: job.ticket.type, text: JSON.stringify(job.ticket), state: job.state }));
  });
  expect(writes).toEqual(['GET']);
  expect(result.map(job => job.type)).toEqual(['service', 'equipmentLabel']);
  expect(result.every(job => job.state === 'printed')).toBe(true);
  expect(result[0].text).not.toContain('LABEL_SECRET');
  expect(result[1].text).toContain('LABEL_SECRET');
});

test('order selector waits for a choice, closes with cancel and Escape, and keeps POS direct', async ({ page }) => {
  await serialFixture(page);
  await page.evaluate(() => {
    APP_STATE.selectedOrderForReceipt = { id: 42, folio: 'AFB-CHOICE', clientName: 'Ana', costo_estimado: 100 };
  });
  await page.locator('#btn-print-action').evaluate(button => button.click());
  await expect(page.locator('#order-print-selector')).toBeVisible();
  expect(await page.evaluate(() => printerManager.jobs.size)).toBe(0);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('#order-print-selector')).not.toBeVisible();
  await page.evaluate(() => requestReceiptPrint());
  await page.keyboard.press('Escape');
  await expect(page.locator('#order-print-selector')).not.toBeVisible();
  await page.evaluate(() => requestReceiptPrint());
  await page.locator('#order-print-customer').click();
  await expect(page.locator('#order-print-selector')).not.toBeVisible();
  expect(await page.evaluate(() => [...printerManager.jobs.values()].map(job => job.ticket.type))).toEqual(['service']);
  await page.evaluate(async () => {
    ESTABLISHMENT_CONFIG.autoPrintTicket = false;
    await handleCompletedSale({ folio: 'SALE-CHOICE', total: 50, metodo_pago: 'Efectivo', items: [] });
  });
  await page.locator('#btn-sale-success-print').click();
  await expect(page.locator('#order-print-selector')).not.toBeVisible();
  expect(await page.evaluate(() => [...printerManager.jobs.values()].map(job => job.ticket.type))).toEqual(['service', 'sale']);
});

test('order selector retries the same failed label job and fits mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serialFixture(page);
  await page.route('**/ordenes/42', route => route.fulfill({ json: { id: 42, folio: 'AFB-RETRY-LABEL', lock_type: 'PIN', lock_pin: 'SECRET', costo_estimado: 100 } }));
  await page.evaluate(() => {
    APP_STATE.selectedOrderForReceipt = { id: 42, folio: 'AFB-RETRY-LABEL' };
    window.__originalSend = printerManager.transports.serial.send.bind(printerManager.transports.serial);
    printerManager.transports.serial.send = async () => { throw new Error('Printer disconnected'); };
    openOrderPrintSelector();
  });
  await page.locator('#btn-print-equipment-label').click();
  await expect(page.locator('#order-print-selector-status')).toContainText('No se pudo imprimir');
  await expect(page.locator('#order-print-selector')).toBeVisible();
  const box = await page.locator('#order-print-selector').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.evaluate(() => { printerManager.transports.serial.send = window.__originalSend; });
  await page.locator('#btn-print-equipment-label').click();
  await expect(page.locator('#order-print-selector')).not.toBeVisible();
  expect(await page.evaluate(() => [...printerManager.jobs.values()].map(job => ({ type: job.ticket.type, state: job.state })))).toEqual([{ type: 'equipmentLabel', state: 'printed' }]);
});

test('list and reprint open the same selector and block clicks while sending', async ({ page }) => {
  await serialFixture(page);
  await page.evaluate(async () => {
    APP_STATE.selectedOrderForReceipt = { id: 42, folio: 'AFB-BUSY', costo_estimado: 100 };
    viewOrderDetails = async () => true;
    await printOrderTicket(42);
    window.__send = printerManager.transports.serial.send.bind(printerManager.transports.serial);
    printerManager.transports.serial.send = async (...args) => {
      await new Promise(resolve => { window.__releasePrint = resolve; });
      return window.__send(...args);
    };
  });
  await expect(page.locator('#order-print-selector')).toBeVisible();
  expect(await page.evaluate(() => printerManager.jobs.size)).toBe(0);
  await page.locator('#order-print-customer').click();
  await expect(page.locator('#order-print-customer')).toBeDisabled();
  await expect(page.locator('#btn-print-equipment-label')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#order-print-selector')).toBeVisible();
  await page.evaluate(() => window.__releasePrint());
  await expect(page.locator('#order-print-selector')).not.toBeVisible();
  await page.locator('#btn-reprint-service').evaluate(button => button.click());
  await expect(page.locator('#order-print-selector')).toBeVisible();
  expect(await page.evaluate(() => printerManager.jobs.size)).toBe(1);
  await page.locator('#order-print-selector-close').click();
  await expect(page.locator('#order-print-selector')).not.toBeVisible();
});
