import { normalizeConfig } from './config.mjs';
import { TicketBuilder } from './TicketBuilder.mjs';
import { EscPosEncoder } from './EscPosEncoder.mjs';
import { printerError } from './diagnostics.mjs';

export class PrinterManager {
  constructor({ preferences, transports, fallback, builder = new TicketBuilder(), encoder = new EscPosEncoder(), now = Date.now }) {
    Object.assign(this, { preferences, transports, fallback, builder, encoder, now });
    this.jobs = new Map(); this.tail = Promise.resolve(); this.sequence = 0; this.listeners = new Set();
    this.active = null; this.generation = 0; this.ttl = 15 * 60 * 1000;
    this.devices = []; this.selectedDevice = null;
    this.timer = setInterval(() => this.prune(), 60000); this.timer.unref?.();
  }
  capabilities() { return { qz: Boolean(this.transports.qz), serial: Boolean(this.transports.serial), usb: Boolean(this.transports.usb), native: Boolean(this.transports.native), browser: true }; }
  resolveMethod(config = this.readPreferences()) {
    if (config.connection !== 'auto') return config.connection;
    if (this.transports.native) return 'native';
    if (this.transports.qz) {
      if (this.transports.qz.available !== false) return 'qz';
      if (this.devices.some(item => item.method === 'serial')) return 'serial';
      if (this.devices.some(item => item.method === 'usb' && this.transports.usb?.canAutoConnect?.(item.device))) return 'usb';
      return 'browser';
    }
    if (this.selectedDevice) return this.selectedDevice.method;
    const active = Object.keys(this.transports).find(key => this.transports[key] === this.active && this.active?.connected);
    return active || this.devices.find(item => item.method === 'serial')?.method || this.devices.find(item => item.method === 'usb' && this.transports.usb?.canAutoConnect?.(item.device))?.method
      || (this.transports.usb && !this.transports.usb.blocked?.size ? 'usb' : this.transports.serial ? 'serial' : 'browser');
  }
  async refreshDevices() {
    const devices = [];
    const results = await Promise.allSettled([
      this.transports.usb?.api?.getDevices?.() || [], this.transports.serial?.api?.getPorts?.() || []
    ]);
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== 'fulfilled') continue;
      const method = i === 0 ? 'usb' : 'serial';
      for (const [index, device] of results[i].value.entries()) {
        const info = device.getInfo?.() || {};
        devices.push({ id: `${method}:${index}`, method, device,
          name: device.productName || (info.usbVendorId ? `Impresora serie USB (${info.usbVendorId.toString(16)})` : 'Impresora serie') });
      }
    }
    for (const name of this.transports.qz?.printers || []) devices.unshift({ id: `qz:${name}`, method: 'qz', device: name, name });
    this.devices = devices;
    const selected = this.selectedDevice?.device || (this.active?.connected && (this.active.device || this.active.port || this.active.name));
    this.selectedDevice = devices.find(item => item.device === selected) || null;
    return devices.map(({ id, method, name }) => ({ id, method, name }));
  }
  selectDevice(id) {
    this.selectedDevice = this.devices.find(item => item.id === id) || null;
    if (this.selectedDevice?.method === 'qz') {
      this.savePreferences({ qzPrinterName: this.selectedDevice.name, printerName: this.selectedDevice.name });
      if (this.transports.qz.qz.websocket.isActive()) this.transports.qz.name = this.selectedDevice.name;
    }
  }
  readPreferences() { return this.preferences.read(); }
  savePreferences(values) { return this.preferences.save(values); }
  setScope(scope) { if (this.scope === scope) return; this.scope = scope; this.clear(); this.preferences.setScope(scope); }
  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(job) { for (const listener of this.listeners) { try { listener({ id: job.id, type: job.ticket?.type, state: job.state, error: job.error || '' }); } catch {} } }
  prune() {
    for (const [id, job] of this.jobs) if (!['pending', 'printing'].includes(job.state) && this.now() - job.updated > this.ttl) this.jobs.delete(id);
  }
  async connect(options = {}) {
    const config = this.readPreferences();
    const method = config.connection === 'auto' && !this.transports.native && this.transports.qz && options.request ? 'qz' : this.resolveMethod(config);
    const diagnostics = this.getDiagnostics?.() || {};
    this.lastDiagnostic = { ...diagnostics, method };
    console.debug('[Impresora: conexión]', this.lastDiagnostic);
    const transport = this.transports[method];
    const candidates = this.devices.filter(item => item.method === method);
    const chosen = this.selectedDevice?.method === method ? this.selectedDevice : candidates.length === 1 ? candidates[0] : null;
    try {
      if (['serial', 'usb'].includes(method) && diagnostics.isSecureContext === false) throw Object.assign(new Error('Insecure context'), { name: 'SecurityError' });
      if (!transport) throw Object.assign(new Error('El método elegido no está disponible. Selecciona uno de los métodos indicados.'), { name: 'NotSupportedError' });
      // No awaited enumeration, discovery or disconnect before the picker.
      await transport.connect(config, { ...options, diagnostics, device: options.selectNew ? undefined : chosen?.device });
      if (this.active && this.active !== transport) await this.active.disconnect();
      this.active = transport;
      this.selectedDevice = this.devices.find(item => item.device === (transport.device || transport.port || transport.name)) || null;
      const name = transport.describe?.().name || config.printerName;
      this.savePreferences({ printerName: name });
      return { connected: transport.connected, method, printerName: name };
    } catch (error) {
      const explained = printerError(error, { method, diagnostics });
      this.lastDiagnostic = { ...this.lastDiagnostic, error: explained.printerDiagnostic };
      console.debug('[Impresora: error]', this.lastDiagnostic);
      throw explained;
    }
  }
  async disconnect() { if (this.active) await this.active.disconnect(); this.active = null; }
  status() {
    const method = this.resolveMethod();
    return { connection: this.active === this.transports[method] && this.active?.connected ? 'connected' : 'disconnected', method };
  }
  print({ type, data, printerConfig = {}, reprint = false, jobKey = '' }) {
    this.prune();
    return this.enqueue(this.builder.build({ type, data }), normalizeConfig({ ...this.readPreferences(), ...printerConfig }), reprint, jobKey);
  }
  enqueue(ticket, config, reprint = false, jobKey = '') {
    const fingerprint = JSON.stringify([jobKey, ticket, config]);
    for (const existing of this.jobs.values()) {
      if (existing.fingerprint !== fingerprint) continue;
      if (['pending', 'printing'].includes(existing.state)) return existing.promise;
      if (!reprint && existing.state === 'printed' && this.now() - existing.updated < 2000) return existing.promise;
      if (!reprint && existing.state === 'failed') return this.retry(existing.id);
    }
    if (this.jobs.size >= 20) {
      const oldest = [...this.jobs.values()].find(job => !['printing', 'pending'].includes(job.state));
      if (oldest) this.jobs.delete(oldest.id);
      else return Promise.reject(new Error('Cola de impresión llena. Espera a que terminen los trabajos.'));
    }
    const job = { id: ++this.sequence, jobKey, ticket, config, fingerprint, state: 'pending', updated: this.now(), generation: this.generation };
    this.jobs.set(job.id, job);
    return this.schedule(job);
  }
  schedule(job) {
    job.state = 'pending'; job.error = ''; this.emit(job);
    job.promise = this.tail.then(async () => {
      if (job.generation !== this.generation) throw new Error('Trabajo cancelado al cerrar o cambiar la sesión.');
      job.state = 'printing'; this.emit(job);
      try {
        const method = this.resolveMethod(job.config);
        const transport = this.transports[method];
        let result;
        if (job.config.connection === 'browser' || !transport) result = await this.fallback.print(job.ticket, job.config);
        else {
          if (this.active && this.active !== transport) await this.active.disconnect();
          this.active = transport;
          // Printing never opens a permission picker after payment.
          await transport.connect(job.config, { request: false });
          const bytes = await this.encoder.encode(job.ticket, job.config);
          for (let copy = 0; copy < job.config.copies; copy++) {
            if (job.generation !== this.generation) throw new Error('Impresión cancelada.');
            await transport.send(bytes, job.config);
          }
          result = { success: true, printerName: job.config.printerName || job.config.connection };
        }
        job.state = 'printed'; job.updated = this.now(); this.emit(job);
        // printed means transmitted/dialog opened; it is not paper acknowledgement.
        return { ...result, jobId: job.id };
      } catch (error) {
        job.state = 'failed'; job.updated = this.now(); job.error = error.message; this.emit(job);
        error.jobId = job.id; throw error;
      }
    });
    this.tail = job.promise.catch(() => {});
    return job.promise;
  }
  retry(id) {
    this.prune();
    const job = this.jobs.get(Number(id));
    if (!job) return Promise.reject(new Error('El ticket expiró. Abre de nuevo la orden o venta para reimprimir.'));
    if (job.state !== 'failed') return job.promise;
    job.config = this.readPreferences(); job.fingerprint = JSON.stringify([job.jobKey, job.ticket, job.config]);
    return this.schedule(job);
  }
  reprintLast(type) {
    this.prune();
    const job = [...this.jobs.values()].reverse().find(entry => entry.ticket?.type === type);
    if (!job) return Promise.reject(new Error('No hay ticket reciente. Abre la orden o venta para reimprimir.'));
    return this.enqueue(job.ticket, this.readPreferences(), true, job.jobKey);
  }
  clear() { this.generation++; this.jobs.clear(); this.disconnect().catch(() => {}); }
}
