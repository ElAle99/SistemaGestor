const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(native = false) {
    const elements = new Map();
    const calls = { downloads: 0, shares: 0, opens: 0, captures: 0 };
    let observerCallback;
    let warmup;
    const element = { outerHTML: 'first receipt', querySelector: () => ({ textContent: 'Venta #42' }) };
    const get = id => {
        if (!elements.has(id)) elements.set(id, { innerHTML: 'WhatsApp', removeAttribute() {}, classList: { contains: () => false }, addEventListener(_, fn) { this.click = fn; } });
        return elements.get(id);
    };
    const navigator = native ? {
        canShare: ({ files }) => files[0].type === 'image/png',
        share: async ({ files }) => { calls.shares++; assert.equal(files[0].name, 'Venta-42.png'); }
    } : {};
    vm.runInNewContext(fs.readFileSync('frontend/js/receiptShare.js', 'utf8'), {
        document: { getElementById: get, body: { appendChild() {} }, createElement: () => ({ click() { calls.downloads++; }, remove() {} }) },
        navigator, window: { open() { calls.opens++; }, visualTickets: {
            build: () => ({ folio: 'Venta #42', content: element.outerHTML }),
            generateShareTicketImage: async () => { calls.captures++; return { blob: new Blob(['png'], { type: 'image/png' }) }; }
        } },
        APP_STATE: { selectedOrderForReceipt: {} }, ESTABLISHMENT_CONFIG: {},
        getActiveReceiptElement: () => element, detectConfiguredTicketPaper: () => '80mm',
        html2canvas() {}, captureReceiptPreviewImage: async () => {
            calls.captures++;
            return { blob: new Blob(['png'], { type: 'image/png' }) };
        },
        MutationObserver: class { constructor(callback) { observerCallback = callback; } observe() {} },
        File, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        clearTimeout() {}, setTimeout(callback, delay) { if (delay === 120) warmup = callback; }
    });
    return { calls, get, element, navigator, async prewarm() {
        observerCallback([{ target: {} }]);
        warmup();
        await new Promise(resolve => setImmediate(resolve));
    } };
}

test('downloads the active receipt and refreshes after content changes', async () => {
    const { calls, get, element } = setup();
    await get('btn-download-receipt-png').click();
    element.outerHTML = 'second receipt';
    await get('btn-download-receipt-png').click();
    assert.equal(calls.downloads, 2);
    assert.equal(calls.captures, 2);
});

test('visual templates use the safe allowlist for service and POS, with no invented QR', async () => {
    const { buildShareTicket } = await import('../frontend/sharing/ShareTicketBuilder.mjs');
    const privateFields = { lock_pin:'SECRET_PIN', imei:'SECRET_IMEI', clientPhone:'SECRET_PHONE', tracking_token:'SECRET_TOKEN', notas:'SECRET_NOTES', id:'SECRET_ID' };
    const service = buildShareTicket('service', { ...privateFields, folio:'AFB-42', clientName:'José Muñoz', fecha_creacion:'2026-10-11T12:30:00', costo_estimado:1000, anticipo:200 });
    assert.doesNotMatch(JSON.stringify(service), /SECRET_/);
    assert.match(JSON.stringify(service), /800.00/);
    assert.equal(service.blocks.some(block => block.kind === 'qr'), false);
    const qr = buildShareTicket('service', { publicTrackingUrl:'https://example.com/seguimiento/real' });
    assert.equal(qr.blocks.filter(block => block.kind === 'qr').length, 0);
    assert.equal(qr.blocks.some(block => block.text?.includes('/seguimiento/real')), false);
    const sale = buildShareTicket('sale', { ...privateFields, total:50, items:[{nombre:'Cable',cantidad:2,precio_unitario:25,orden:privateFields}] });
    assert.doesNotMatch(JSON.stringify(sale), /SECRET_/);
    assert.match(JSON.stringify(sale), /Cable/);
});

test('shares the PNG on a fresh click and handles cancellation', async () => {
    const { calls, get, navigator } = setup(true);
    await get('btn-share-receipt-whatsapp').click();
    assert.equal(calls.shares, 0);
    await get('btn-share-receipt-whatsapp').click();
    assert.equal(calls.shares, 1);
    navigator.share = async () => { throw Object.assign(new Error(), { name: 'AbortError' }); };
    await get('btn-share-receipt-whatsapp').click();
    assert.match(get('receipt-share-status').textContent, /cancelado/);
    assert.equal(calls.downloads, 0);
    assert.equal(get('btn-share-receipt-whatsapp').disabled, false);
});

test('unsupported browsers download the PNG and open WhatsApp', async () => {
    const { calls, get } = setup();
    await get('btn-share-receipt-whatsapp').click();
    await get('btn-share-receipt-whatsapp').click();
    assert.equal(calls.downloads, 1);
    assert.equal(calls.opens, 1);
    assert.match(get('receipt-share-status').textContent, /Adjunta el PNG/);
});

test('opening a receipt prepares it once and the first click shares immediately', async () => {
    const { calls, get, prewarm } = setup(true);
    await prewarm();
    assert.equal(calls.captures, 1);
    await get('btn-share-receipt-whatsapp').click();
    assert.equal(calls.shares, 1);
    assert.equal(calls.captures, 1);
});

test('a quick capture shares on the first click while user activation remains', async () => {
    const { calls, get, navigator } = setup(true);
    navigator.userActivation = { isActive: true };
    await get('btn-share-receipt-whatsapp').click();
    assert.equal(calls.shares, 1);
});

test('digital capture preserves resolution and skips thermal thresholding', async () => {
    const source = fs.readFileSync('frontend/js/app.js', 'utf8');
    const captureFunction = source.slice(source.indexOf('async function captureReceiptPreviewImage('), source.indexOf('function printReceiptBrowser('));
    let removed = false;
    const node = { classList: { remove() {} }, getBoundingClientRect: () => ({ width: 300 }) };
    const context = {
        normalizeTicketPaper: () => '80mm', getThermalPrintWidthPx: () => 576,
        document: { fonts: { ready: Promise.resolve() }, body: { appendChild() {} }, createElement: () => ({ style: {}, dataset: {}, appendChild() {}, remove() { removed = true; } }) },
        refreshReceiptOptionalSections() {},
        html2canvas: async (_, options) => {
            assert.equal(options.scale, 4);
            return { width: 1200, height: 3000, toBlob(callback) { callback(new Blob(['png'])); } };
        },
        normalizeReceiptCanvasForThermalPrint() { assert.fail('Digital images must not be reduced to thermal resolution'); }
    };
    vm.createContext(context);
    vm.runInContext(captureFunction, context);
    const result = await context.captureReceiptPreviewImage({ cloneNode: () => node }, '80mm', { digital: true });
    assert.equal(result.pixelWidth, 1200);
    assert.equal(result.pixelHeight, 3000);
    assert.ok(result.blob instanceof Blob);
    assert.equal(removed, true);
});
