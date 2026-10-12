import { printerError } from './diagnostics.mjs';
export { printerError } from './diagnostics.mjs';

async function timed(task, milliseconds = 15000) {
  let timer;
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Escritura interrumpida o sin respuesta. Reconecta; el ticket puede estar parcialmente impreso.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function blocks(bytes, config, write) {
  for (let offset = 0; offset < bytes.length; offset += config.chunkSize) {
    await timed(write(bytes.subarray(offset, offset + config.chunkSize)));
    if (config.chunkDelay && offset + config.chunkSize < bytes.length) await new Promise(resolve => setTimeout(resolve, config.chunkDelay));
  }
}

export class WebSerialPrinter {
  constructor(api) { this.api = api; this.port = null; this.connected = false;
    api?.addEventListener?.('disconnect', event => { if (event.target === this.port || event.port === this.port) this.connected = false; });
  }
  async connect(config, { request = false, selectNew = false, device, diagnostics } = {}) {
    if (!this.api) throw new Error('Web Serial no está disponible. Usa otro método de impresión.');
    if (this.connected && this.baudRate === config.baudRate && !selectNew && (!device || device === this.port)) return;
    let phase = 'select';
    try {
      let selected = device || (!selectNew && this.port);
      if (!selected && request) {
        // First asynchronous operation: selector stays on the initiating click stack.
        selected = await this.api.requestPort();
      }
      phase = 'recover';
      if (!selected) { const ports = await this.api.getPorts(); if (ports.length === 1) selected = ports[0]; }
      if (!selected) throw new Error('Impresora no conectada. Pulsa Conectar impresora para seleccionar el puerto.');
      if (this.port?.writable) await this.disconnect();
      this.port = selected;
      phase = 'open';
      await this.port.open({ baudRate: config.baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
      this.baudRate = config.baudRate;
      this.connected = true;
    } catch (error) { if (phase !== 'select') this.connected = false; throw printerError(error, { phase, method: 'serial', diagnostics }); }
  }
  describe() {
    const info = this.port?.getInfo?.() || {};
    return { name: info.usbVendorId ? `Impresora serie USB (${info.usbVendorId.toString(16)}:${info.usbProductId?.toString(16) || '?'})` : 'Impresora serie' };
  }
  async send(bytes, config) {
    if (!this.connected || !this.port?.writable) throw new Error('Impresora desconectada. Reconecta antes de reintentar.');
    const writer = this.port.writable.getWriter();
    this.writer = writer;
    try { await blocks(bytes, config, part => writer.write(part)); }
    catch (error) {
      this.connected = false;
      writer.abort().catch(() => {});
      throw printerError(error, { method: 'serial', phase: 'write' });
    } finally { writer.releaseLock(); this.writer = null; }
  }
  async disconnect() {
    this.connected = false;
    if (this.writer) await timed(this.writer.abort(), 2000).catch(() => {});
    if (this.port) await timed(this.port.close(), 2000).catch(() => {});
    this.port = null;
  }
}

export class WebUsbPrinter {
  constructor(api) { this.api = api; this.connected = false; this.device = null; this.blocked = new Set(); this.verified = new Set();
    api?.addEventListener?.('disconnect', event => { if (event.device === this.device) this.connected = false; });
  }
  key(device) { return JSON.stringify([device?.vendorId, device?.productId, device?.serialNumber, device?.productName]); }
  canAutoConnect(device) { return this.verified.has(this.key(device)) && !this.blocked.has(this.key(device)); }
  async connect(config, { request = false, selectNew = false, device, diagnostics } = {}) {
    if (!this.api) throw new Error('WebUSB no está disponible en este navegador.');
    if (this.connected && !selectNew && (!device || device === this.device)) return;
    let phase = 'select';
    try {
      let selected = device || (!selectNew && this.device);
      if (!selected && request) {
        selected = await this.api.requestDevice({ filters: [{ classCode: 7 }] });
      }
      phase = 'recover';
      if (!selected) { const devices = await this.api.getDevices(); if (devices.length === 1) selected = devices[0]; }
      if (!selected) throw new Error('No hay una impresora USB autorizada. Pulsa Conectar impresora.');
      if (this.blocked.has(this.key(selected))) throw new Error('Esta impresora no admite acceso USB directo en esta sesión. Usa QZ Tray o Impresión normal.');
      if (this.device?.opened) await this.disconnect();
      this.device = selected;
      phase = 'open';
      await this.device.open();
      // Only USB printer-class interfaces with a bulk OUT endpoint; never guess vendor protocols.
      let selectedInterface;
      for (const configuration of this.device.configurations || []) {
        for (const iface of configuration.interfaces) for (const alt of iface.alternates) {
          const endpoint = alt.endpoints.find(ep => ep.direction === 'out' && ep.type === 'bulk');
          if (alt.interfaceClass === 7 && endpoint && !selectedInterface) selectedInterface = { configuration, iface, alt, endpoint };
        }
      }
      if (!selectedInterface) throw new Error('Dispositivo USB incompatible: se requiere interfaz de impresora con salida bulk ESC/POS. Usa Impresión normal.');
      phase = 'configure';
      await this.device.selectConfiguration(selectedInterface.configuration.configurationValue);
      this.interfaceNumber = selectedInterface.iface.interfaceNumber;
      phase = 'claim';
      await this.device.claimInterface(this.interfaceNumber);
      await this.device.selectAlternateInterface(this.interfaceNumber, selectedInterface.alt.alternateSetting);
      this.endpoint = selectedInterface.endpoint.endpointNumber;
      this.connected = true;
      this.verified.add(this.key(this.device));
    } catch (error) {
      if (phase === 'open' && error.name === 'SecurityError' && /access denied/i.test(error.message)) this.blocked.add(this.key(this.device));
      if (phase !== 'select') await this.disconnect();
      throw printerError(error, { phase, method: 'usb', diagnostics });
    }
  }
  describe() { return { name: this.device?.productName || 'Impresora USB' }; }
  async send(bytes, config) {
    if (!this.connected) throw new Error('Impresora USB desconectada.');
    try {
      await blocks(bytes, config, async part => {
        const result = await this.device.transferOut(this.endpoint, part);
        if (result.status !== 'ok' || result.bytesWritten !== part.length) throw new Error('Escritura USB interrumpida. Reconecta; puede haber una impresión parcial.');
      });
    } catch (error) { await this.disconnect(); throw printerError(error, { method: 'usb', phase: 'write' }); }
  }
  async disconnect() {
    this.connected = false;
    if (this.device?.opened) {
      if (this.interfaceNumber != null) await timed(this.device.releaseInterface(this.interfaceNumber), 2000).catch(() => {});
      await timed(this.device.close(), 2000).catch(() => {});
    }
    this.device = null;
  }
}

export class NativePrinter {
  constructor(plugin, discoveryPermissions) { this.plugin = plugin; this.discoveryPermissions = discoveryPermissions; this.connected = false; }
  async ready() {
    const permissions = await this.plugin.requestPermissions();
    if (['bluetoothScan', 'bluetoothConnect'].some(key => permissions[key] && permissions[key] !== 'granted')) throw new Error('Permiso Bluetooth denegado. Revisa los ajustes de Android.');
    if (!(await this.plugin.isBluetoothEnabled()).enabled) throw new Error('Bluetooth apagado. Actívalo para conectar.');
  }
  async discover() {
    await this.ready();
    if (this.discoveryPermissions && !(await this.discoveryPermissions.ensureDiscovery()).granted) throw new Error('Android requiere permiso de ubicación para buscar dispositivos.');
    return (await this.plugin.discoverPrinters({ sources: ['bluetooth'], includePaired: true, timeoutMs: 8000 })).printers;
  }
  async connect(config) {
    if (this.connected && this.id === config.printerId) return;
    if (!config.printerId) throw new Error('Selecciona una impresora Bluetooth en Configuración > Impresoras.');
    await this.ready();
    const result = await this.plugin.connectPrinter({ printerId: config.printerId, forceAdapter: 'escpos', paperWidthMm: parseInt(config.paperWidth), timeoutMs: 15000 });
    if (!result.connected) throw new Error('Impresora Bluetooth desconectada.');
    this.id = config.printerId; this.connected = true;
  }
  async send(bytes, config) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    try {
      const result = await this.plugin.printText({ printerId: this.id, items: [{ type: 'raw', bytesBase64: btoa(binary) }],
        paperWidthMm: parseInt(config.paperWidth), cut: false, feedLines: 0, autoReconnect: false, timeoutMs: 30000 });
      if (!result.success) throw new Error('Envío Bluetooth interrumpido. Revisa el papel y reconecta.');
    } catch (error) { this.connected = false; throw printerError(error); }
  }
  async disconnect() {
    this.connected = false;
    if (this.id) await this.plugin.disconnectPrinter({ printerId: this.id });
    this.id = null;
  }
}
