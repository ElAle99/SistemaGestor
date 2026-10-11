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
  await page.addScriptTag({ url: origin + '/dist/printer-service.js' });
  await page.addScriptTag({ url: origin + '/js/printerConfig.js' });
  await page.evaluate(() => {
    initPrinterConfigForm();
    switchView('configuracion');
    window.__prints = 0;
    window.print = () => window.__prints++;
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
