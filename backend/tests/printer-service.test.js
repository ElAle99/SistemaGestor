const test = require('node:test');
const assert = require('node:assert/strict');
async function harness(native = true, overrides = {}) {
  const { createPrinterService } = await import('../../frontend/services/printerCore.mjs');
  const jobs = [], saved = new Map();
  let browser = 0;
  const plugin = {
    requestPermissions: async () => ({ bluetoothConnect: 'granted', location: 'unavailable' }),
    isBluetoothEnabled: async () => ({ enabled: true }),
    discoverPrinters: async () => ({ printers: [{ id: 'bluetooth:A', name: 'Printer', address: 'A' }] }),
    connectPrinter: async () => ({ connected: true }),
    setDefaultPrinter: async () => ({}),
    getPrinterStatus: async () => ({ connection: 'connected' }),
    printImage: async data => { jobs.push(data); return { success: true }; },
    printText: async data => { jobs.push(data); return { success: true }; },
    ...overrides
  };
  const service = createPrinterService({ native, plugin, storage: { getItem: k => saved.get(k), setItem: (k,v) => saved.set(k,v) }, browserPrint: () => browser++ });
  return { service, jobs, get browser() { return browser; } };
}
test('web uses browser and never invokes Bluetooth', async () => {
  const h = await harness(false, { requestPermissions() { throw Error('Bluetooth called'); } });
  assert.deepEqual(await h.service.getPrinters(), []);
  await h.service.printSale({});
  assert.equal(h.browser, 1);
});
test('native discovers MAC and persists default locally; 58/80 mm render and cut', async () => {
  const h = await harness();
  const [printer] = await h.service.getPrinters();
  assert.equal(printer.address, 'A');
  await h.service.savePrinter(printer);
  assert.equal(h.service.getSavedPrinter().id, printer.id);
  for (const [paperWidth, dots] of [['58mm',384], ['80mm',576]]) {
    h.service.savePreferences({ paperWidth, cut: true });
    await h.service.printOrder({ imageData: 'data:image/png;base64,AAAA' });
    const job = h.jobs.at(-1);
    assert.equal(job.render.widthDots, dots);
    assert.equal(job.render.cut, true);
    assert.equal(job.autoReconnect, true);
    assert.equal(job.image.base64, 'data:image/png;base64,AAAA');
  }
});
test('Bluetooth off and denied permissions stop the job', async () => {
  for (const overrides of [
    { isBluetoothEnabled: async () => ({ enabled: false }) },
    { requestPermissions: async () => ({ bluetoothConnect: 'denied' }) }
  ]) {
    const h = await harness(true, overrides);
    h.service.savePreferences({ printerId: 'A' });
    await assert.rejects(h.service.printTicket({ imageData: 'data:image/png;base64,AAAA' }), /Bluetooth/);
    assert.equal(h.jobs.length, 0);
  }
});
test('failed print is reported and not retried; concurrent jobs are rejected', async () => {
  let finish, calls = 0;
  const h = await harness(true, { printImage: async () => { calls++; return new Promise(resolve => finish = resolve); } });
  h.service.savePreferences({ printerId: 'A' });
  const job = h.service.printCashClose({ imageData: 'data:image/png;base64,AAAA' });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(h.service.printAdvancePayment({}), /curso/);
  finish({ success: false });
  await assert.rejects(job, /confirmó/);
  assert.equal(calls, 1);
});
