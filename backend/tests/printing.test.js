const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function printerHarness(qzOverrides = {}) {
  const jobs = [];
  const window = { qz: {
    websocket: { isActive: () => true }, printers: {},
    configs: { create: (printer, options) => ({ printer, options }) },
    print: async (config, data) => jobs.push({ config, data }),
    ...qzOverrides
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/qzPrinterService.js'), 'utf8'), {
    window, console, localStorage: { getItem: () => null }
  });
  return { service: window.qzPrinterService, jobs };
}

test('detection shares the connection and returns all installed printers without duplicates', async () => {
  let active = false;
  let connections = 0;
  const { service } = printerHarness({
    websocket: {
      isActive: () => active,
      connect: async () => { connections++; active = true; }
    },
    printers: {
      find: async (...args) => {
        assert.equal(active, true);
        assert.equal(args.length, 0);
        return ['USB', 'Network', 'Bluetooth', 'USB', '', null];
      },
      getDefault: async () => 'Network'
    }
  });
  const [printers, defaultPrinter] = await Promise.all([service.getPrinters(), service.getDefaultPrinter()]);
  assert.deepEqual(Array.from(printers), ['USB', 'Network', 'Bluetooth']);
  assert.equal(defaultPrinter, 'Network');
  assert.equal(connections, 1);
});

test('detection can retry after an immediate connection failure and explains how to connect', async () => {
  let attempts = 0;
  const { service } = printerHarness({
    websocket: {
      isActive: () => false,
      connect: () => {
        if (++attempts === 1) throw new Error('Failed to start');
        return Promise.resolve();
      }
    },
    printers: { find: async () => [] }
  });
  await assert.rejects(service.getPrinters(), error => /Abre QZ Tray/.test(error.userMessage));
  assert.deepEqual(Array.from(await service.getPrinters()), []);
  assert.equal(attempts, 2);
});

for (const paperWidth of ['58mm', '80mm']) {
  test(`${paperWidth} uses real DPI and preserves a long receipt without fitting to a page`, async () => {
    const { service, jobs } = printerHarness();
    await service.printImageTicket({ printerName: 'Test', paperWidth, density: 203,
      pixelHeight: 4000, imageData: 'data:image/png;base64,AAAA' });
    const { options } = jobs[0].config;
    assert.equal(options.units, 'in');
    assert.equal(options.density, 203);
    assert.equal(options.scaleContent, false);
    assert.equal(options.colorType, 'blackwhite');
    assert.equal(options.interpolation, 'nearest-neighbor');
    assert.ok(Math.abs(options.size.width * 25.4 - parseInt(paperWidth)) < 0.001);
    assert.ok(options.size.height >= 4000 / 203);
    assert.equal(jobs[0].data[0].data, 'AAAA');
  });
}

test('invalid image height is rejected without submitting a print job', async () => {
  const { service, jobs } = printerHarness();
  await assert.rejects(service.printImageTicket({ printerName: 'Test', imageData: 'AAAA', pixelHeight: 0 }),
    error => error.code === 'TICKET_SIZE_INVALID');
  assert.equal(jobs.length, 0);
});

test('test ticket also uses inch-based density and black text', async () => {
  const { service, jobs } = printerHarness();
  await service.printTestTicket({ printerName: 'Test', paperWidth: '58mm' });
  assert.equal(jobs[0].config.options.density, 203);
  assert.equal(jobs[0].config.options.units, 'in');
  assert.equal(jobs[0].config.options.colorType, 'blackwhite');
  assert.match(jobs[0].data[0].data, /font: bold/);
});

test('thermal conversion produces opaque black and white pixels', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/app.js'), 'utf8');
  const start = source.indexOf('function normalizeReceiptCanvasForThermalPrint(');
  const end = source.indexOf('async function sendReceiptPreviewToPrinter(', start);
  const pixels = new Uint8ClampedArray([0, 0, 0, 255, 180, 180, 180, 255, 255, 255, 255, 255]);
  const context = { fillRect() {}, drawImage() {}, getImageData: () => ({ data: pixels }), putImageData() {} };
  const canvas = { getContext: () => context };
  const sandbox = { document: { createElement: () => canvas } };
  vm.runInNewContext(source.slice(start, end), sandbox);
  const output = sandbox.normalizeReceiptCanvasForThermalPrint({ width: 15, height: 10 }, 3);
  assert.equal(output.width, 3);
  assert.equal(output.height, 2);
  assert.equal(context.imageSmoothingEnabled, true);
  assert.deepEqual(Array.from(pixels), [0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
});
