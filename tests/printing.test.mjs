import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TicketBuilder } from '../frontend/printing/TicketBuilder.mjs';
import { buildBusinessHeader, businessIdentity, businessLegalLines } from '../frontend/printing/BusinessIdentity.mjs';
import { buildShareTicket } from '../frontend/sharing/ShareTicketBuilder.mjs';
import { authorizeTicketData } from '../frontend/printing/authorizedData.mjs';
import { EscPosEncoder } from '../frontend/printing/EscPosEncoder.mjs';
import { normalizeConfig, createPreferences } from '../frontend/printing/config.mjs';
import { PrinterManager } from '../frontend/printing/PrinterManager.mjs';
import { WebSerialPrinter, WebUsbPrinter, NativePrinter } from '../frontend/printing/transports.mjs';
import { connectionDiagnostics, printerError } from '../frontend/printing/diagnostics.mjs';
import { paperProfile } from '../frontend/printing/profiles.mjs';
import { QzTrayPrinter } from '../frontend/printing/QzTrayPrinter.mjs';

test('configured business header is compact and shared by service, sale and visual identity', () => {
  const config = { name: 'Taller Norte', address: 'Calle Uno 25', phone: '555 123', whatsapp: '555 456', ticketLogoUrl: '/uploads/norte.png', redes_sociales: '{"facebook":"Norte"}', terms: 'Terminos de reparacion' };
  const identity = businessIdentity(config);
  assert.deepEqual(buildBusinessHeader(identity).map(line => line.text), ['Taller Norte', 'Calle Uno 25', 'Tel: 555 123', 'WhatsApp: 555 456']);
  for (const type of ['service', 'sale']) {
    const ticket = new TicketBuilder().build({ type, data: authorizeTicketData(type, { folio: 'F-1' }, config) });
    assert.equal(ticket.lines[0].text, 'Taller Norte');
    assert.equal(ticket.logoUrl, '/uploads/norte.png');
    assert.doesNotMatch(JSON.stringify(ticket), /Facebook|Norte\"\}/);
    assert.equal(JSON.stringify(ticket).includes('Terminos de reparacion'), type === 'service');
    const visual = buildShareTicket(type, { folio: 'F-1' }, config);
    assert.equal(visual.blocks[0].text, 'Taller Norte');
    assert.ok(visual.blocks.some(block => block.text === 'Calle Uno 25'));
  }
  const label = new TicketBuilder().build({ type: 'equipmentLabel', data: authorizeTicketData('equipmentLabel', { folio: 'F-1' }, config) });
  assert.equal(label.lines[0].text, 'Taller Norte');
  assert.doesNotMatch(JSON.stringify(label), /Calle Uno|555|Terminos|facebook/);
});

test('business name alone and empty optional fields never fabricate identity or blank lines', () => {
  const config = { name: 'Taller Centro', phone: '   ', whatsapp: null, address: '', terms: null };
  assert.deepEqual(buildBusinessHeader(businessIdentity(config)).map(line => line.text), ['Taller Centro']);
  assert.deepEqual(buildBusinessHeader(businessIdentity({})), []);
  const ticket = new TicketBuilder().build({ type: 'service', data: authorizeTicketData('service', { folio: 'F-1' }, config) });
  assert.doesNotMatch(JSON.stringify(ticket), /Allfix|ALLFIX|No disponible|Sin informacion|REPARACI/);
  assert.equal(ticket.logoUrl, '');
  assert.ok(ticket.lines.every(line => line.kind !== 'text' || line.text.trim()));
});

test('phone and WhatsApp referring to the same number appear once', () => {
  const identity = businessIdentity({ name: 'Taller', phone: '555 123', whatsapp: '555123' });
  assert.deepEqual(buildBusinessHeader(identity).map(line => line.text), ['Taller', 'Tel / WhatsApp: 555123']);
  const png = buildShareTicket('service', { folio: 'F-1' }, { name: 'Taller', phone: '555123', whatsapp: '555123' });
  assert.equal(png.blocks.filter(block => block.text?.includes('555123')).length, 1);
});

test('long configured service terms survive the existing 58 mm encoder without truncation', async () => {
  const terms = ('Condiciones del servicio y entrega. ').repeat(90) + 'FIN DEL CONTRATO';
  const config = { name: 'Taller', terms };
  assert.equal(businessLegalLines(businessIdentity(config)).map(line => line.text).join(' '), terms);
  const data = authorizeTicketData('service', { folio: 'F-1' }, config);
  const ticket = new TicketBuilder().build({ type: 'service', data });
  const bytes = await new EscPosEncoder().encode(ticket, normalizeConfig({ paperWidth: '58mm', showLogo: false }));
  const output = Buffer.from(bytes).toString('latin1');
  assert.match(output.replace(/[\r\n]/g, ' '), /FIN DEL CONTRATO/);
  assert.equal((output.match(/Condiciones/g) || []).length, 90);
});

test('explicit tenant identities never cross between thermal or visual tickets', () => {
  const businesses = [{ negocio_id: 1, name: 'Negocio Uno' }, { negocio_id: 2, name: 'Negocio Dos' }];
  for (const type of ['service', 'sale', 'equipmentLabel']) {
    for (const business of businesses) {
      const raw = { negocio_id: business.negocio_id, folio: 'F-1' };
      const data = authorizeTicketData(type, raw, business);
      const ticket = new TicketBuilder().build({ type, data });
      assert.equal(ticket.lines[0].text, business.name);
      assert.doesNotMatch(JSON.stringify(data), /negocio_id/);
      assert.throws(() => authorizeTicketData(type, raw, businesses.find(item => item.negocio_id !== raw.negocio_id)), /mismo negocio/);
      assert.throws(() => authorizeTicketData(type, raw, { name: 'Global' }), /mismo negocio/);
      if (type !== 'equipmentLabel') {
        assert.equal(buildShareTicket(type, raw, business).blocks[0].text, business.name);
        assert.throws(() => buildShareTicket(type, raw, businesses.find(item => item.negocio_id !== raw.negocio_id)), /mismo negocio/);
      }
    }
  }
  assert.throws(() => authorizeTicketData('service', {}, businesses[0]), /mismo negocio/);
  assert.throws(() => authorizeTicketData('service', {}, { identityUnavailable: true }), /mismo negocio/);
});

function qzFixture() {
  let active = false; const calls = []; let connectCalls = 0; let fail = false; let closed;
  const api = {
    websocket: { isActive: () => active, connect: async () => { connectCalls++; active = true; },
      disconnect: async () => { active = false; closed?.(); }, setClosedCallbacks: callback => { closed = callback; } },
    printers: { find: async () => ['Microsoft Print to PDF', 'POS-58'] },
    configs: { create: (name, options) => ({ name, options }) },
    print: async (config, data) => { if (fail) throw new Error('Printer offline'); calls.push({ config, data }); }
  };
  return { api, calls, transport: new QzTrayPrinter(api), get connectCalls() { return connectCalls; }, set fail(value) { fail = value; } };
}

test('QZ transports unchanged bytes as RAW base64 and never chooses a default Windows printer', async () => {
  const q = qzFixture();
  assert.equal(q.connectCalls, 0);
  await q.transport.connect(normalizeConfig(), { request: true });
  assert.equal(q.transport.connected, false);
  assert.deepEqual(q.transport.printers, ['Microsoft Print to PDF', 'POS-58']);
  await q.transport.connect(normalizeConfig({ qzPrinterName: 'POS-58' }));
  const bytes = new Uint8Array([0,27,64,29,40,107,164,130,255,10]);
  await q.transport.send(bytes);
  assert.deepEqual(q.calls[0].config, { name: 'POS-58', options: { copies: 1, forceRaw: true, jobName: 'Ticket Allfix' } });
  assert.deepEqual(q.calls[0].data.map(({type,format,flavor}) => ({type,format,flavor})), [{type:'raw',format:'command',flavor:'base64'}]);
  assert.deepEqual(new Uint8Array(Buffer.from(q.calls[0].data[0].data, 'base64')), bytes);
  await q.transport.disconnect();
  await assert.rejects(q.transport.send(bytes), /desconectado/);
  await assert.rejects(q.transport.connect(normalizeConfig({qzPrinterName:'POS-58'})), /Conectar impresora/);
  assert.equal(q.connectCalls, 1);
});

test('Windows automatic uses QZ, keeps queue/copies/retry and falls back only before a send', async () => {
  const q = qzFixture(), h = harness();
  h.manager.transports.qz = q.transport;
  h.manager.transports.usb = { api: { getDevices: async () => [] }, connect: async () => { throw new Error('Must not use USB'); } };
  h.manager.savePreferences({ connection: 'auto', qzPrinterName: 'POS-58', copies: 2, showLogo: false });
  assert.equal(h.manager.resolveMethod(), 'qz');
  await h.manager.connect({request:true});
  await h.manager.refreshDevices();
  h.manager.selectDevice('qz:POS-58');
  assert.equal(h.manager.readPreferences().printerName, 'POS-58');
  const result = await h.manager.print(request());
  assert.equal(q.calls.length, 2);
  assert.equal(h.manager.jobs.get(result.jobId).state, 'printed');
  assert.doesNotMatch(Buffer.from(q.calls[0].data[0].data,'base64').toString('latin1'), /PRIVATE_/);
  q.fail = true;
  await assert.rejects(h.manager.print({...request(),reprint:true}), /No se pudo enviar/);
  const failed = [...h.manager.jobs.values()].find(job => job.state === 'failed');
  q.fail = false; await h.manager.retry(failed.id);
  assert.equal(failed.state, 'printed'); assert.equal(q.calls.length, 4);
  await q.transport.disconnect();
  h.manager.devices = [{method:'serial',device:{}}]; assert.equal(h.manager.resolveMethod(), 'serial');
  h.manager.devices = [{method:'usb',device:{}}]; assert.equal(h.manager.resolveMethod(), 'browser');
  h.manager.transports.usb.canAutoConnect = () => true; assert.equal(h.manager.resolveMethod(), 'usb');
  h.manager.transports.native = {}; assert.equal(h.manager.resolveMethod(), 'native');
  clearInterval(h.manager.timer);
});

test('QZ unavailability preserves real detail without pretending to detect installation', async () => {
  const q = qzFixture(); q.api.websocket.connect = async () => { throw new Error('Unable to establish connection with QZ Tray'); };
  await assert.rejects(q.transport.discover(), error => /Si no está instalado/.test(error.message) && error.printerDiagnostic.message === 'Unable to establish connection with QZ Tray');
  assert.equal(q.transport.available, false);
  q.transport.seen = true;
  await assert.rejects(q.transport.discover(), /está cerrado o no responde/);
});

test('usbprint Access denied blocks subsequent opening in this session and explains the Windows driver', async () => {
  let opens = 0;
  const device = { vendorId: 1, productId: 2, productName: 'POS-58', open: async () => {
    opens++; throw new DOMException("Failed to execute 'open' on 'USBDevice': Access denied", 'SecurityError');
  } };
  const usb = new WebUsbPrinter({ getDevices: async () => [device] });
  await assert.rejects(usb.connect(normalizeConfig(), { diagnostics: { isSecureContext:true } }), error => /usbprint/.test(error.message) && error.printerDiagnostic.phase === 'open');
  assert.equal(usb.canAutoConnect(device), false);
  await assert.rejects(usb.connect(normalizeConfig()), /esta sesión/);
  assert.equal(opens, 1);
});

test('paper profiles supply defaults and unknown models use generic ESC/POS', () => {
  const config = normalizeConfig();
  assert.equal(config.connection, 'auto');
  for (const [key, value] of Object.entries(paperProfile('58mm'))) assert.equal(config[key], value);
  assert.equal(config.dots, 384); assert.equal(config.columns, 32); assert.equal(config.codepage, 'cp850');
  assert.equal(normalizeConfig({ printerName: 'Unknown USB printer' }).codepageMapping, 'epson');
  assert.equal(normalizeConfig({ paperWidth: '80mm' }).dots, 576);
});

test('diagnostics contain environment primitives and preserve original DOMException details', () => {
  const diagnostics = connectionDiagnostics({ location: { origin: 'http://localhost:5000' }, isSecureContext: true,
    navigator: { serial: {}, usb: {}, userActivation: { isActive: true } } });
  assert.equal(diagnostics.origin, 'http://localhost:5000'); assert.equal(diagnostics.isSecureContext, true);
  assert.equal(diagnostics.navigatorSerial, true); assert.equal(diagnostics.navigatorUsb, true); assert.equal(diagnostics.androidBridge, false);
  for (const [name, phase, text] of [
    ['NotAllowedError', 'select', /Permiso denegado/], ['AbortError', 'select', /cancelada/],
    ['NotFoundError', 'select', /cancelada/], ['NotFoundError', 'open', /no encontrado/],
    ['NotSupportedError', 'open', /no es compatible/], ['NetworkError', 'open', /Error al abrir/],
    ['NetworkError', 'claim', /controlador de Windows/], ['AbortError', 'write', /Escritura interrumpida/],
    ['SecurityError', 'claim', /problema no es localhost/], ['InvalidStateError', 'open', /estado válido/]
  ]) {
    const original = new DOMException('Original device error', name);
    const result = printerError(original, { phase, method: 'usb', diagnostics });
    assert.match(result.message, text); assert.equal(result.name, name); assert.equal(result.cause, original);
    assert.equal(result.printerDiagnostic.message, 'Original device error');
  }
  const security = new DOMException('Access denied', 'SecurityError');
  assert.match(printerError(security, { diagnostics }).message, /contexto es seguro/);
  assert.match(printerError(security, { diagnostics: { isSecureContext: false } }).message, /no es un contexto seguro/);
  assert.match(printerError(security, { method: 'usb', diagnostics: { ...diagnostics, usbPolicy: false } }).message, /política de permisos/);
});

test('permission pickers run immediately, without awaiting device enumeration', async () => {
  for (const method of ['serial', 'usb']) {
    let requested = false, enumerated = false;
    const api = {
      requestPort() { requested = true; return Promise.reject(new DOMException('User cancelled', 'NotFoundError')); },
      requestDevice() { requested = true; return Promise.reject(new DOMException('User cancelled', 'NotFoundError')); },
      getPorts() { enumerated = true; return Promise.resolve([]); }, getDevices() { enumerated = true; return Promise.resolve([]); }
    };
    const transport = method === 'serial' ? new WebSerialPrinter(api) : new WebUsbPrinter(api);
    const promise = transport.connect(normalizeConfig(), { request: true, selectNew: true });
    assert.equal(requested, true); assert.equal(enumerated, false);
    await assert.rejects(promise, error => error.name === 'NotFoundError' && /cancelada/.test(error.message));
  }
});

test('automatic connection reuses an authorized device and its name without another picker', async () => {
  let requested = false, opened = false;
  const device = { productName: 'POS-5890', opened: false, open: async () => { opened = true; },
    configurations: [{ configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0,
      interfaceClass: 7, endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] }] }] }],
    selectConfiguration: async () => {}, claimInterface: async () => {}, selectAlternateInterface: async () => {} };
  const secondDevice = { ...device, productName: 'Second printer' };
  const authorized = [device];
  const usb = new WebUsbPrinter({ getDevices: async () => authorized, requestDevice() { requested = true; authorized.push(secondDevice); return Promise.resolve(secondDevice); } });
  const storage = new Map();
  const manager = new PrinterManager({ preferences: createPreferences({ getItem: key => storage.get(key), setItem: (key,value) => storage.set(key,value) }), transports: { usb }, fallback: {} });
  try {
    await manager.refreshDevices(); assert.equal(requested, false);
    await manager.connect({ request: true });
    assert.equal(opened, true); assert.equal(requested, false);
    assert.equal(manager.readPreferences().printerName, 'POS-5890'); assert.equal(manager.status().method, 'usb');
    await manager.connect({ request: true, selectNew: true });
    await manager.refreshDevices();
    assert.equal(manager.selectedDevice.device, secondDevice);
    assert.equal(manager.readPreferences().printerName, 'Second printer');
    usb.api.requestDevice = () => Promise.reject(new DOMException('Cancelled', 'NotFoundError'));
    await assert.rejects(manager.connect({ request: true, selectNew: true }), /cancelada/);
    assert.equal(usb.connected, true); assert.equal(usb.device, secondDevice);
  } finally { clearInterval(manager.timer); }
});

const builder = new TicketBuilder();
const service = { folio: 'AFB-42', clientName: 'José Muñoz', deviceType: 'Celular', brand: 'Marca', model: 'Modelo',
  falla_reportada: 'No enciende', servicio_solicitado: 'Reparación', costo_estimado: 1000, anticipo: 250,
  dateIn: '2026-10-10', status: 'Recibido', publicTrackingUrl: 'https://example.com/seguimiento/token-publico',
  lock_pin: 'PRIVATE_PIN', lock_pass: 'PRIVATE_PASS', lock_pattern: 'PRIVATE_PATTERN', imei: 'PRIVATE_IMEI',
  serial: 'PRIVATE_SERIAL', clientPhone: 'PRIVATE_PHONE', clientEmail: 'PRIVATE_EMAIL', inspeccion_obs: 'PRIVATE_NOTES',
  tracking_token: 'PRIVATE_TOKEN_TEXT', jwt: 'PRIVATE_JWT', negocio_id: 'PRIVATE_TENANT', id: 'PRIVATE_ID' };

test('service allowlist omits private fields from model and bytes, tracking URLs never enter the ticket', async () => {
  const ticket = builder.build({ type: 'service', data: authorizeTicketData('service', service, { negocio_id: service.negocio_id }) });
  assert.doesNotMatch(JSON.stringify(ticket), /PRIVATE_/);
  assert.match(JSON.stringify(ticket), /750.00/);
  const text = ticket.lines.filter(line => line.kind === 'text').map(line => line.text).join('\n');
  assert.doesNotMatch(text, /token-publico|https:|09:00/);
  const bytes = await new EscPosEncoder().encode(ticket, normalizeConfig());
  assert.doesNotMatch(Buffer.from(bytes).toString('latin1'), /PRIVATE_/);
  assert.equal(ticket.lines.some(line=>line.kind==='qr'),false);
  assert.equal(Buffer.from(bytes).includes(Buffer.from('token-publico')),false);
  assert.equal(normalizeConfig({showQr:true}).showQr,false);
  assert.ok(bytes.includes(0xa4)); // ñ in CP850
});

test('POS has its own fields, no nested order detail or internal IDs', async () => {
  const data = authorizeTicketData('sale', { id: 'PRIVATE_ID', observaciones_ticket: 'PRIVATE_NOTE', total: 100, subtotal: 120,
    descuento: 20, metodo_pago: 'Efectivo', items: [{ nombre: 'Cable', cantidad: 2, precio_unitario: 60, orden: service, descripcion: 'PRIVATE_DESCRIPTION' }] });
  const ticket = builder.build({ type: 'sale', data });
  assert.doesNotMatch(JSON.stringify(ticket), /PRIVATE_|José|lock_/);
  assert.match(JSON.stringify(ticket), /TOTAL: \$100.00/);
  for (const paperWidth of ['58mm', '80mm']) assert.ok((await new EscPosEncoder().encode(ticket, normalizeConfig({ paperWidth }))).length > 50);
});

test('cash closing selects numeric summary, omits user, observations and identifiers', () => {
  const data = authorizeTicketData('cashClosing', { id: 'PRIVATE_ID', usuario_nombre: 'PRIVATE_USER', observaciones: 'PRIVATE_NOTE', resumen: { fondo_inicial: 100 }, monto_contado: 200 });
  assert.doesNotMatch(JSON.stringify(builder.build({ type: 'cashClosing', data })), /PRIVATE_/);
});

test('ESC/POS command injection is stripped, unsupported Unicode falls back safely', async () => {
  const ticket = builder.build({ type: 'sale', data: { items: [{ name: '\x1b@\x1dV🙂中文 ñ', quantity: 1 }] } });
  for (const codepage of ['cp850', 'cp858', 'windows1252', 'ascii']) {
    const bytes = await new EscPosEncoder().encode(ticket, normalizeConfig({ codepage }));
    assert.ok(bytes.length);
  }
  assert.doesNotMatch(ticket.lines.map(line => line.text).join(''), /\x1b|\x1d/);
});

test('QR can be disabled and invalid public URLs are never rendered', async () => {
  const ticket = builder.build({ type: 'service', data: authorizeTicketData('service', service, { negocio_id: service.negocio_id }) });
  const bytes = await new EscPosEncoder().encode(ticket, normalizeConfig({ showQr: false }));
  assert.equal(Buffer.from(bytes).includes(Buffer.from('token-publico')), false);
  const invalid = authorizeTicketData('service', { ...service, publicTrackingUrl: 'https://example.com/?jwt=SECRET' }, { negocio_id: service.negocio_id });
  assert.equal(Object.hasOwn(invalid,'publicTrackingUrl'), false);
});

function harness(overrides = {}) {
  const storage = new Map(); let sends = 0; let time = 0;
  const preferences = createPreferences({ getItem: key => storage.get(key), setItem: (key,value) => storage.set(key,value) }, 'serial');
  const transport = { connected: false, async connect() { this.connected = true; }, async send() { sends++; }, async disconnect() { this.connected = false; }, ...overrides };
  const manager = new PrinterManager({ preferences, transports: { serial: transport }, fallback: { print: async () => ({ browser: true }) }, now: () => time });
  return { manager, storage, transport, get sends() { return sends; }, advance() { time += 1000000; } };
}
const request = () => ({ type: 'service', data: authorizeTicketData('service', service, { negocio_id: service.negocio_id }) });

test('queue serializes and deduplicates double clicks and records states', async () => {
  const h = harness(); const states = []; h.manager.onChange(job => states.push(job.state));
  const a = h.manager.print(request()); const b = h.manager.print(request());
  assert.equal(a, b); await Promise.all([a,b]);
  assert.equal(h.sends, 1); assert.deepEqual(states, ['pending', 'printing', 'printed']);
  await h.manager.reprintLast('service'); assert.equal(h.sends, 2);
  assert.equal(h.storage.size, 0);
});

test('disconnect during send fails once, preserves snapshot and supports explicit retry', async () => {
  let calls = 0;
  const h = harness({ async send() { calls++; if (calls === 1) throw new Error('Impresora desconectada'); } });
  await assert.rejects(h.manager.print(request()), /desconectada/);
  const job = [...h.manager.jobs.values()][0]; assert.equal(job.state, 'failed'); assert.equal(calls, 1);
  await h.manager.retry(job.id); assert.equal(calls, 2); assert.equal(job.state, 'printed');
  assert.doesNotMatch(JSON.stringify(job.ticket), /PRIVATE_/);
});

test('two distinct transactions with identical content are both printed', async () => {
  const h = harness();
  await Promise.all([h.manager.print({ ...request(), jobKey: 'sale:1' }), h.manager.print({ ...request(), jobKey: 'sale:2' })]);
  assert.equal(h.sends, 2);
});

test('queue expires customer data, clears session, and preferences are scoped and whitelisted', async () => {
  const h = harness(); await h.manager.print(request());
  h.manager.savePreferences({ copies: 2, customer: service });
  assert.doesNotMatch([...h.storage.values()].join(), /PRIVATE_|customer|José/);
  h.advance(); h.manager.prune(); assert.equal(h.manager.jobs.size, 0);
  h.manager.setScope('branch-2'); assert.equal(h.manager.readPreferences().copies, 1);
  await assert.rejects(h.manager.reprintLast('service'), /No hay ticket/);
});

test('unsupported API uses browser fallback without Bluetooth requests', async () => {
  const h = harness(); h.manager.transports = {};
  assert.equal((await h.manager.print(request())).browser, true);
});

test('serial reuses authorized port, keeps it open and sends bounded chunks', async () => {
  let opens = 0, requests = 0, releases = 0; const chunks = [];
  const port = { open: async () => opens++, close: async () => {}, writable: { getWriter: () => ({ write: async bytes => chunks.push(bytes.length), releaseLock: () => releases++ }) } };
  const transport = new WebSerialPrinter({ getPorts: async () => [port], requestPort: async () => { requests++; return port; } });
  const config = normalizeConfig({ chunkSize: 64, chunkDelay: 0 });
  await transport.connect(config); await transport.connect(config);
  await transport.send(new Uint8Array(150), config);
  assert.equal(opens, 1); assert.equal(requests, 0); assert.equal(releases, 1); assert.deepEqual(chunks, [64,64,22]);
});

test('serial never prompts during automatic printing and reports permission / occupied errors', async () => {
  const transport = new WebSerialPrinter({ getPorts: async () => [], requestPort: async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); } });
  await assert.rejects(transport.connect(normalizeConfig()), /Conectar impresora/);
  await assert.rejects(transport.connect(normalizeConfig(), { request: true }), /Permiso denegado/);
  const busy = new WebSerialPrinter({ getPorts: async () => [{ open: async () => { throw Object.assign(new Error('The port is already open.'), { name: 'InvalidStateError' }); } }] });
  await assert.rejects(busy.connect(normalizeConfig()), /Puerto ocupado/);
});

test('serial interrupted write aborts and releases writer', async () => {
  let aborted = false, released = false;
  const port = { open: async () => {}, writable: { getWriter: () => ({ write: async () => { throw Object.assign(new Error(), { name: 'NetworkError' }); }, abort: async () => { aborted = true; }, releaseLock: () => { released = true; } }) } };
  const transport = new WebSerialPrinter({ getPorts: async () => [port] });
  await transport.connect(normalizeConfig()); await assert.rejects(transport.send(new Uint8Array(20), normalizeConfig()), error => error.name === 'NetworkError' && /Escritura interrumpida/.test(error.message));
  assert.ok(aborted && released); assert.equal(transport.connected, false);
});

test('USB validates printer class and detects partial writes', async () => {
  const device = { opened: true, open: async () => {}, close: async () => {}, selectConfiguration: async () => {}, claimInterface: async () => {},
    selectAlternateInterface: async () => {}, releaseInterface: async () => {},
    configurations: [{ configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 7, alternateSetting: 0, endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] }] }] }],
    transferOut: async (_, bytes) => ({ status: 'ok', bytesWritten: bytes.length - 1 }) };
  const transport = new WebUsbPrinter({ getDevices: async () => [device] });
  await transport.connect(normalizeConfig()); await assert.rejects(transport.send(new Uint8Array(20), normalizeConfig()), /interrumpida/);
  assert.equal(transport.connected, false);
  device.configurations[0].interfaces[0].alternates[0].interfaceClass = 255;
  await assert.rejects(transport.connect(normalizeConfig()), /incompatible/);
});

test('native Android sends encoded bytes through raw item, never image capture', async () => {
  let payload;
  const plugin = { requestPermissions: async () => ({}), isBluetoothEnabled: async () => ({ enabled: true }), connectPrinter: async () => ({ connected: true }), printText: async data => { payload = data; return { success: true }; } };
  const transport = new NativePrinter(plugin);
  const config = normalizeConfig({ printerId: 'bluetooth:test' });
  await transport.connect(config); await transport.send(new Uint8Array([27,64,65]), config);
  assert.equal(payload.items[0].type, 'raw'); assert.equal(payload.items[0].bytesBase64, 'G0BB'); assert.equal(payload.autoReconnect, false);
});

test('equipment label uses actual cost, payment status and only the selected secret', async () => {
  const raw = { ...service, costo_real: 1200, lock_type: 'PIN', clientPhone: '9831234567' };
  const data = authorizeTicketData('equipmentLabel', raw, { name: 'Taller de prueba', negocio_id: service.negocio_id });
  assert.equal(data.pending, 950);
  const ticket = builder.build({ type: 'equipmentLabel', data });
  assert.equal(ticket.lines[0].text, 'Taller de prueba');
  assert.equal(ticket.logoUrl, '');
  assert.match(JSON.stringify(ticket), /PRIVATE_PIN/);
  assert.doesNotMatch(JSON.stringify(ticket), /PRIVATE_PASS|PRIVATE_PATTERN|PRIVATE_ID/);
  assert.ok((await new EscPosEncoder().encode(ticket, normalizeConfig({ paperWidth: '58mm' }))).length);
  assert.equal(authorizeTicketData('equipmentLabel', { ...raw, estado_pago: 'Pagado' }, { negocio_id: service.negocio_id }).pending, 0);
});

test('equipment label omits absent optional data and patterns and requires folio', () => {
  const data = authorizeTicketData('equipmentLabel', { folio: 'AFB-1', costo_estimado: 50, lock_type: 'Patrón', lock_pattern: '1-2-3-4', clientName: 'No proporcionado' });
  const ticket = builder.build({ type: 'equipmentLabel', data });
  assert.doesNotMatch(JSON.stringify(ticket), /Anticipo|Patr|1-2-3-4|No proporcionado|Cliente/);
  assert.equal(data.pending, 50);
  assert.throws(() => builder.build({ type: 'equipmentLabel', data: {} }), /folio/);
});

test('sale shows zero cash change and hides cash fields for transfer', () => {
  const raw = { total: 100, subtotal: 100, metodo_pago: 'Efectivo', monto_recibido: 100, cambio: 0 };
  const cash = builder.build({ type: 'sale', data: authorizeTicketData('sale', raw) });
  assert.match(JSON.stringify(cash), /Cambio: \$0.00/);
  assert.doesNotMatch(JSON.stringify(cash), /Subtotal|Descuento/);
  const transfer = builder.build({ type: 'sale', data: authorizeTicketData('sale', { ...raw, metodo_pago: 'Transferencia' }) });
  assert.doesNotMatch(JSON.stringify(transfer), /Cambio|Efectivo recibido/);
});
