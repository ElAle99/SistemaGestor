const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function ui({ failPrint = false, failSave = false, failPreview = false } = {}) {
  const elements = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const el = { value: '', textContent: '', children: [], events: {}, disabled: false,
      classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v),
        toggle(v, flag) { if (flag) classes.add(v); else classes.delete(v); } },
      addEventListener(type, callback) { this.events[type] = callback; },
      replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); },
      focus() {}, setCustomValidity(message) { this.validationMessage = message; }, reportValidity() { return true; },
      reset() { for (const item of elements.values()) item.value = ''; }
    };
    elements.set(id, el);
    return el;
  }
  const calls = [];
  const timers = [];
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => element(Symbol()) },
    setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout() {}, AbortController,
    BASE_API_URL: '/api', ESTABLISHMENT_CONFIG: { autoPrintTicket: true },
    async fetch(url, options) {
      calls.push({ url, options });
      return { ok: !failSave, json: async () => failSave ? { error: 'Caja cerrada' } : { id: 17, folio: 'AFB-2026-10043' } };
    },
    async viewOrderDetails(id) { calls.push({ preview: id }); return !failPreview; },
    async printReceipt() { calls.push({ print: true }); if (failPrint) throw new Error('printer unavailable'); return true; },
    async loadAllData() { calls.push({ refresh: true }); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/quickOrder.js'), 'utf8'), context);
  const form = element('quick-order-form');
  const submit = () => form.events.submit({ preventDefault() {} });
  context.openQuickOrder();
  for (const [id, value] of Object.entries({
    'quick-client-name': 'Juan Pérez', 'quick-client-phone': '9831909656', 'quick-client-alt': '9831234567',
    'quick-device': 'Celular', 'quick-brand': 'Samsung', 'quick-model': 'A55 5G',
    'quick-fault': 'No carga', 'quick-repair': 'Cambio de centro de carga', 'quick-cost': '1200', 'quick-advance': '500'
  })) element(id).value = value;
  return { element, calls, context, submit, timers };
}

test('quick form sends only reception fields and blocks duplicate in-flight submissions', async () => {
  const h = ui();
  await Promise.all([h.submit(), h.submit()]);
  const posts = h.calls.filter(c => c.url);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/ordenes/rapida');
  const payload = JSON.parse(posts[0].options.body);
  assert.equal(payload.clientPhoneAlt1, '9831234567');
  assert.equal(Object.keys(payload).length, 12); // eleven fields plus selected customer id
  assert.equal(h.element('quick-order-form').classList.contains('hidden'), true);
  assert.match(h.element('quick-order-success-message').textContent, /10043/);
  assert.ok(h.calls.some(c => c.preview === 17));
  assert.ok(h.calls.some(c => c.print));
});

test('client selection fills name and both contacts without surname splitting', () => {
  const h = ui();
  h.context.selectQuickClient({ id: 3, nombre: 'Juan', apellido_paterno: 'Pérez', telefono_principal: '123', telefono_alternativo_1: '456' });
  assert.equal(h.element('quick-client-name').value, 'Juan Pérez');
  assert.equal(h.element('quick-client-phone').value, '123');
  assert.equal(h.element('quick-client-alt').value, '456');
});

test('failed save keeps captured fields and enables correction', async () => {
  const h = ui({ failSave: true });
  await h.submit();
  assert.equal(h.element('quick-client-name').value, 'Juan Pérez');
  assert.match(h.element('quick-order-error').textContent, /Caja cerrada/);
  assert.equal(h.element('quick-order-submit').disabled, false);
  assert.ok(!h.calls.some(c => c.print));
});

test('printer failure preserves success and never restores the creation form', async () => {
  const h = ui({ failPrint: true });
  await h.submit();
  assert.equal(h.element('quick-order-form').classList.contains('hidden'), true);
  assert.match(h.element('quick-order-print-status').textContent, /guardada/);
  assert.equal(h.element('quick-order-error').classList.contains('hidden'), true);
});

test('failed preview never prints a previously opened ticket', async () => {
  const h = ui({ failPreview: true });
  await h.submit();
  assert.ok(!h.calls.some(c => c.print));
});

test('new order resets client, costs and previous success', async () => {
  const h = ui();
  await h.submit();
  h.context.openQuickOrder();
  assert.equal(h.element('quick-client-name').value, '');
  assert.equal(h.element('quick-cost').value, '');
  assert.equal(h.element('quick-order-form').classList.contains('hidden'), false);
  assert.equal(h.element('quick-order-success').classList.contains('hidden'), true);
});

test('autocomplete ignores stale results after selecting an existing client', async () => {
  const h = ui();
  let resolveSearch;
  h.context.fetch = () => new Promise(resolve => { resolveSearch = resolve; });
  h.element('quick-client-name').events.input({ target: { value: 'Juan' } });
  const pending = h.timers.at(-1)();
  h.context.selectQuickClient({ id: 3, nombre: 'Juan Pérez', telefono_principal: '123' });
  resolveSearch({ ok: true, json: async () => [{ nombre: 'Wrong result' }] });
  await pending;
  assert.equal(h.element('quick-client-name').value, 'Juan Pérez');
  assert.equal(h.element('quick-client-matches').children.length, 0);
});
