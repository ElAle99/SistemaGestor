const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
