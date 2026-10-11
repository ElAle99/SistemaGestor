const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(native = false) {
    const elements = new Map();
    const calls = { downloads: 0, shares: 0, opens: 0, captures: 0 };
    const element = { outerHTML: 'first receipt', querySelector: () => ({ textContent: 'Venta #42' }) };
    const get = id => {
        if (!elements.has(id)) elements.set(id, { innerHTML: 'WhatsApp', addEventListener(_, fn) { this.click = fn; } });
        return elements.get(id);
    };
    const navigator = native ? {
        canShare: ({ files }) => files[0].type === 'image/png',
        share: async ({ files }) => { calls.shares++; assert.equal(files[0].name, 'Venta-42.png'); }
    } : {};
    vm.runInNewContext(fs.readFileSync('frontend/js/receiptShare.js', 'utf8'), {
        document: { getElementById: get, body: { appendChild() {} }, createElement: () => ({ click() { calls.downloads++; }, remove() {} }) },
        navigator, window: { open() { calls.opens++; } },
        getActiveReceiptElement: () => element, detectConfiguredTicketPaper: () => '80mm',
        html2canvas() {}, captureReceiptPreviewImage: async () => { calls.captures++; return { imageData: 'data:image/png;base64,aGVsbG8=' }; },
        File, Uint8Array, atob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, setTimeout() {}
    });
    return { calls, get, element, navigator };
}

test('downloads the active receipt and refreshes after content changes', async () => {
    const { calls, get, element } = setup();
    await get('btn-download-receipt-png').click();
    element.outerHTML = 'second receipt';
    await get('btn-download-receipt-png').click();
    assert.equal(calls.downloads, 2);
    assert.equal(calls.captures, 2);
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
