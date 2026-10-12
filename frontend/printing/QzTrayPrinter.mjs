// Transport only: the caller supplies complete, already encoded ESC/POS bytes.
export class QzTrayPrinter {
  constructor(qz) {
    this.qz = qz; this.name = ''; this.printers = []; this.available = null; this.seen = false; this.pending = null;
    qz.websocket.setClosedCallbacks?.(() => { this.available = false; });
  }
  get connected() { return Boolean(this.name && this.qz.websocket.isActive()); }
  describe() { return { name: this.name }; }
  error(error, phase) {
    const original = String(error?.message || error);
    let message;
    if (/denied|not allowed|blocked|rejected/i.test(original)) message = 'QZ Tray rechazó la solicitud. Revisa su aviso de autorización y los permisos de acceso local del navegador.';
    else if (phase === 'connect') message = this.seen
      ? 'QZ Tray está cerrado o no responde. Ábrelo en esta computadora y pulsa Conectar.'
      : 'QZ Tray no está disponible. Si no está instalado, instálalo desde qz.io/download; si ya está instalado, ábrelo en esta computadora. Puedes usar Impresión normal como respaldo.';
    else message = phase === 'write' ? 'No se pudo enviar el ticket. Comprueba QZ Tray, la impresora y la cola de Windows antes de reintentar.' : 'No se pudo obtener la lista de impresoras de Windows. Revisa la autorización en QZ Tray.';
    const result = new Error(message, { cause: error }); result.name = error?.name || 'Error';
    result.printerDiagnostic = { name: result.name, message: original.slice(0,1000), phase, method: 'qz' };
    return result;
  }
  async discover() {
    if (!this.qz.websocket.isActive()) {
      if (!this.pending) this.pending = this.qz.websocket.connect({ host: ['localhost'], usingSurf: false, retries: 0 })
        .then(() => { this.available = true; this.seen = true; })
        .catch(error => { this.available = false; throw this.error(error, 'connect'); })
        .finally(() => { this.pending = null; });
      await this.pending;
    }
    try {
      this.printers = await this.qz.printers.find();
      this.available = true; this.seen = true;
      return this.printers;
    } catch (error) { throw this.error(error, 'discover'); }
  }
  async connect(config, { request = false, selectNew = false, device } = {}) {
    if (!request && !this.qz.websocket.isActive()) throw new Error('QZ Tray está desconectado. Pulsa Conectar impresora antes de imprimir.');
    if (request) await this.discover();
    const name = device || config.qzPrinterName;
    if (!name || !this.printers.includes(name)) {
      this.name = '';
      if (request) return; // UI displays the discovered spooler queues, no arbitrary default printer.
      throw new Error('Selecciona una impresora instalada en Windows y pulsa Conectar.');
    }
    this.name = name;
  }
  async send(bytes) {
    if (!this.connected) throw new Error('QZ Tray está desconectado. No se pudo enviar el ticket.');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    try {
      // Copies are handled by PrinterManager. Base64 preserves every byte, including CP850 and QR commands.
      await this.qz.print(this.qz.configs.create(this.name, { copies: 1, forceRaw: true, jobName: 'Ticket Allfix' }),
        [{ type: 'raw', format: 'command', flavor: 'base64', data: btoa(binary) }]);
    } catch (error) { throw this.error(error, 'write'); }
  }
  async disconnect() {
    this.name = '';
    if (this.qz.websocket.isActive()) await this.qz.websocket.disconnect();
  }
}
