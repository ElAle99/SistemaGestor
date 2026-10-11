import { Capacitor, registerPlugin } from '@capacitor/core';
import { ThermalPrinter } from '@delicity/capacitor-thermal-printer';
import { createPrinterService } from './printerCore.mjs';

window.printerService = createPrinterService({
  native: Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
  plugin: ThermalPrinter,
  discoveryPermissions: registerPlugin('AllfixBluetoothPermissions'),
  storage: window.localStorage,
  browserPrint: ticket => {
    if (!ticket.test) {
      if (!window.printReceiptBrowser?.(ticket.paperWidth)) throw new Error('No hay un ticket listo para imprimir.');
      return;
    }
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px';
    document.body.append(frame);
    frame.contentDocument.write('<html><head><title>Prueba Allfix</title></head><body style="font:16px monospace"><h2>ALLFIX</h2><p>Prueba de impresión</p><p>á é í ó ú ñ · $123.45</p></body></html>');
    frame.contentDocument.close();
    frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }
});
