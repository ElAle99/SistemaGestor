import { paperProfile, compatibilityMapping } from './profiles.mjs';
export { paperProfile } from './profiles.mjs';
const number = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
export function normalizeConfig(input = {}) {
  const wide = input.paperWidth === '80mm';
  const profile = paperProfile(wide ? '80mm' : '58mm');
  const compatibilityProfile = ['auto', 'generic', 'pos-5890', 'xprinter', 'mpt'].includes(input.compatibilityProfile) ? input.compatibilityProfile : 'auto';
  return {
    connection: ['auto', 'qz', 'serial', 'usb', 'native', 'browser'].includes(input.connection) ? input.connection : 'auto',
    qzPrinterName: String(input.qzPrinterName || '').slice(0, 250),
    printerName: String(input.printerName || '').slice(0, 100),
    printerId: String(input.printerId || '').slice(0, 150),
    paperWidth: wide ? '80mm' : '58mm',
    printableMm: number(input.printableMm, profile.printableMm, 20, wide ? 80 : 58),
    dots: Math.floor(number(input.dots, profile.dots, 160, 832) / 8) * 8,
    columns: Math.floor(number(input.columns, profile.columns, 16, 64)),
    dpi: number(input.dpi, profile.dpi, 180, 600),
    copies: Math.floor(number(input.copies, 1, 1, 5)),
    feedLines: Math.floor(number(input.feedLines, profile.feedLines, 1, 12)),
    baudRate: number(input.baudRate, 9600, 1200, 115200),
    chunkSize: Math.floor(number(input.chunkSize, 512, 64, 4096)),
    chunkDelay: number(input.chunkDelay, 20, 0, 200),
    codepage: ['cp850', 'cp858', 'windows1252', 'ascii'].includes(input.codepage) ? input.codepage : 'cp850',
    compatibilityProfile,
    codepageMapping: compatibilityMapping(compatibilityProfile, input.printerName),
    autoPrint: input.autoPrint !== false, showQr: false,
    showLogo: input.showLogo === true, cut: input.cut === true
  };
}

export function createPreferences(storage, defaultConnection = 'auto') {
  let scope = 'default';
  const key = () => `allfix_printing_v4:${scope}`;
  return {
    setScope(value) { scope = String(value || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || 'default'; },
    read() {
      try {
        const saved = JSON.parse(storage.getItem(key()) || 'null');
        const old = JSON.parse(storage.getItem(`allfix_printing_v3:${scope}`) || storage.getItem('allfix_printer_v2') || '{}');
        return normalizeConfig(saved || { ...old, connection: defaultConnection });
      } catch { return normalizeConfig({ connection: defaultConnection }); }
    },
    save(values) {
      const config = normalizeConfig({ ...this.read(), ...values });
      // Explicit whitelist: never serialize a ticket, customer, token or device permission.
      storage.setItem(key(), JSON.stringify(config));
      return config;
    }
  };
}
