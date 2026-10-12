import { Capacitor, registerPlugin } from '@capacitor/core';
import { ThermalPrinter } from '@delicity/capacitor-thermal-printer';
import { PrinterManager } from '../printing/PrinterManager.mjs';
import { createPreferences } from '../printing/config.mjs';
import { WebSerialPrinter, WebUsbPrinter, NativePrinter } from '../printing/transports.mjs';
import { BrowserPrintFallback } from '../printing/BrowserPrintFallback.mjs';
import { authorizeTicketData } from '../printing/authorizedData.mjs';
import { connectionDiagnostics } from '../printing/diagnostics.mjs';
import { paperProfile } from '../printing/profiles.mjs';
import qz from 'qz-tray';
import { QzTrayPrinter } from '../printing/QzTrayPrinter.mjs';

const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const transports = {};
if (window.isSecureContext && navigator.serial) transports.serial = new WebSerialPrinter(navigator.serial);
if (window.isSecureContext && navigator.usb) transports.usb = new WebUsbPrinter(navigator.usb);
if (native) transports.native = new NativePrinter(ThermalPrinter, registerPlugin('AllfixBluetoothPermissions'));
// Only the JS client is bundled. QZ Tray desktop must be installed/opened by the user on this Windows PC.
if (!native && /^Win/i.test(navigator.platform)) transports.qz = new QzTrayPrinter(qz);
const preferences = createPreferences(window.localStorage, 'auto');
const manager = new PrinterManager({ preferences, transports, fallback: new BrowserPrintFallback() });
manager.getDiagnostics = () => ({ ...connectionDiagnostics(window, native), qzClient: Boolean(transports.qz), qzConnected: Boolean(transports.qz?.qz.websocket.isActive()) });
// Permission enumeration only. Device pickers are never invoked during startup.
manager.refreshDevices().catch(() => {});
window.printerManager = manager;
window.authorizeTicketData = authorizeTicketData;
// Compatibility facade for existing application and configuration entry points.
window.printerService = {
  isNative: () => native,
  diagnostics: () => manager.lastDiagnostic || manager.getDiagnostics(),
  paperProfile,
  refreshDevices: () => manager.refreshDevices(), selectDevice: id => manager.selectDevice(id),
  readPreferences: () => manager.readPreferences(), savePreferences: values => manager.savePreferences(values),
  getPrinters: () => transports.native?.discover() || Promise.resolve([]),
  getSavedPrinter: () => { const p = manager.readPreferences(); return p.printerId ? { id: p.printerId, name: p.printerName } : null; },
  connectPrinter: (id, options = {}) => { if (id) manager.savePreferences({ printerId: id }); return manager.connect({ request: true, ...options }); },
  disconnectPrinter: () => manager.disconnect(), getStatus: async () => manager.status(),
  savePrinter: async printer => manager.savePreferences({ printerId: printer.id, printerName: printer.name }),
  testPrint: (printerConfig = {}) => manager.print({ type: 'test', data: {}, printerConfig, reprint: true })
};
window.addEventListener('pagehide', () => manager.clear());
const failedJobs = new Map();
manager.onChange(job => {
  const status = document.getElementById('receipt-print-status');
  if (status) status.textContent = ({ pending: 'Ticket en cola', printing: 'Enviando ticket…', printed: 'Ticket enviado; comprueba la impresión.', failed: 'Ticket pendiente: ' + job.error })[job.state];
  if (job.state === 'failed') failedJobs.set(job.type, job.id);
  if (job.state === 'printed') failedJobs.delete(job.type);
  const retry = document.getElementById('btn-retry-receipt');
  if (retry) { retry.hidden = job.state !== 'failed'; retry.dataset.jobId = job.id; }
  const saleRetry = document.getElementById('btn-sale-retry-print');
  if (saleRetry) saleRetry.hidden = !failedJobs.has('sale');
});
for (const id of ['btn-retry-receipt', 'btn-sale-retry-print']) {
  const button = document.getElementById(id);
  button?.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const reconnectQz = Boolean(transports.qz && ['auto', 'qz'].includes(manager.readPreferences().connection));
      if (reconnectQz || manager.resolveMethod() !== 'browser') await manager.connect({ request: reconnectQz });
      await manager.retry(id === 'btn-sale-retry-print' ? failedJobs.get('sale') : button.dataset.jobId);
      window.AllfixUI?.notify('Ticket reenviado. Comprueba que no haya una copia parcial anterior.');
    } catch (error) { window.AllfixUI?.notify(error.message); }
    finally { button.disabled = false; }
  });
}
document.getElementById('btn-reprint-service')?.addEventListener('click', () => {
  window.openOrderPrintSelector?.({ reprint: true });
});
