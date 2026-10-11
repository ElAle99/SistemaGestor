// No ticket/customer data is persisted here. Preferences belong to this device.
export function createPrinterService({ native, plugin, storage, browserPrint, discoveryPermissions }) {
  const key = 'allfix_printer_v2';
  let busy = false;
  let activePrinterId = '';
  const readPreferences = () => {
    let saved = {};
    try { saved = JSON.parse(storage.getItem(key) || '{}'); } catch {}
    return { printerName: '', printerId: '', paperWidth: storage.getItem('allfix_paper_width') || '58mm', autoPrint: storage.getItem('allfix_auto_print') !== 'false', cut: false, ...saved };
  };
  const savePreferences = values => {
    const prefs = { ...readPreferences(), ...values };
    prefs.paperWidth = prefs.paperWidth === '80mm' ? '80mm' : '58mm';
    storage.setItem(key, JSON.stringify(prefs));
    return prefs;
  };
  async function ready() {
    const permissions = await plugin.requestPermissions();
    if (['bluetoothScan', 'bluetoothConnect'].some(key => permissions[key] && permissions[key] !== 'granted')) throw new Error('Permiso Bluetooth denegado. Autorízalo en los ajustes de Android.');
    if (!(await plugin.isBluetoothEnabled()).enabled) throw new Error('Bluetooth apagado. Actívalo para imprimir.');
  }
  async function getPrinters() {
    if (!native) return [];
    await ready();
    if (discoveryPermissions && !(await discoveryPermissions.ensureDiscovery()).granted) throw new Error('Permiso de ubicación denegado. Android 8–11 lo requiere para buscar Bluetooth.');
    const { printers } = await plugin.discoverPrinters({ sources: ['bluetooth', 'ble'], includePaired: true, timeoutMs: 8000 });
    return [...new Map(printers.map(p => [p.id, p])).values()];
  }
  async function connectPrinter(printerId = readPreferences().printerId) {
    if (!native) return { connected: false };
    if (!printerId) throw new Error('Selecciona y guarda una impresora en Configuración > Impresoras.');
    await ready();
    const result = await plugin.connectPrinter({ printerId, forceAdapter: 'escpos', paperWidthMm: parseInt(readPreferences().paperWidth), timeoutMs: 15000 });
    if (!result.connected) throw new Error('La impresora está desconectada. Verifica su alimentación y emparejamiento.');
    activePrinterId = printerId;
    return result;
  }
  async function savePrinter(printer) {
    if (native) {
      await connectPrinter(printer.id);
      await plugin.setDefaultPrinter({ printerId: printer.id });
    }
    return savePreferences({ printerId: printer.id, printerName: printer.name || printer.id });
  }
  async function printTicket(ticket = {}) {
    if (busy) throw new Error('Ya hay una impresión en curso.');
    busy = true;
    try {
      const prefs = readPreferences();
      if (!native) { await browserPrint(ticket); return { success: true, printerName: 'el diálogo del navegador', browser: true }; }
      if (!ticket.items && !ticket.imageData?.startsWith('data:image/')) throw new Error('No hay una imagen de ticket válida para imprimir.');
      const printerId = ticket.printerId || prefs.printerId;
      await connectPrinter(printerId);
      const paper = parseInt(ticket.paperWidth || prefs.paperWidth);
      const common = { printerId, autoReconnect: true, timeoutMs: 30000 };
      const result = ticket.items
        ? await plugin.printText({ ...common, items: ticket.items, paperWidthMm: paper, encoding: 'WPC1252', cut: prefs.cut, feedLines: 4 })
        : await plugin.printImage({ ...common, image: { base64: ticket.imageData }, render: { paperWidthMm: paper, widthDots: paper === 80 ? 576 : 384, grayscale: false, dithering: 'none', cut: prefs.cut, feedLines: 4 } });
      if (!result.success) throw new Error('La impresora no confirmó el envío. Revisa el papel y la conexión antes de reintentar.');
      return { ...result, printerName: prefs.printerName || printerId };
    } catch (error) {
      throw new Error(error.message || 'Falló la impresión. Verifica Bluetooth y la impresora.');
    } finally { busy = false; }
  }
  const testPrint = (options = {}) => printTicket({ ...options, test: true, items: [
    { type: 'text', text: 'ALLFIX\nPrueba de impresión\n', style: { bold: true, align: 'center' } },
    { type: 'text', text: 'á é í ó ú ñ  $123.45\n58 / 80 mm · ESC/POS\n' },
    { type: 'qrcode', value: 'ALLFIX-TEST', align: 'center' },
    { type: 'barcode', value: 'ALLFIX123', symbology: 'CODE128' }
  ] });
  return {
    isNative: () => native, readPreferences, savePreferences, getPrinters, connectPrinter, savePrinter,
    getSavedPrinter: () => { const p = readPreferences(); return p.printerId ? { id: p.printerId, name: p.printerName } : null; },
    disconnectPrinter: async (printerId = activePrinterId || readPreferences().printerId) => {
      if (native && printerId) await plugin.disconnectPrinter({ printerId });
      activePrinterId = '';
    },
    getStatus: async () => {
      if (!native) return { bluetooth: null, connection: 'browser' };
      const bluetooth = (await plugin.isBluetoothEnabled()).enabled;
      const printerId = activePrinterId || readPreferences().printerId;
      let state = { connection: 'disconnected' };
      if (bluetooth && printerId) {
        try { state = await plugin.getPrinterStatus({ printerId }); } catch {}
      }
      return { ...state, bluetooth };
    },
    printTicket, printImageTicket: printTicket, testPrint, printTestTicket: testPrint,
    printOrder: printTicket, printSale: printTicket, printAdvancePayment: printTicket,
    printLiquidation: printTicket, printCashClose: printTicket, reprint: printTicket
  };
}
