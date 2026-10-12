import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { safeText } from './TicketBuilder.mjs';

export function printableText(value, ascii = false) {
  let text = safeText(value).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...');
  if (ascii) text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/¿/g, '?').replace(/¡/g, '!');
  return text.replace(ascii ? /[^\x20-\x7e]/g : /[^\x20-\x7e\u00a1-\u00ff]/g, '?');
}

export async function loadMonochromeLogo(url, config) {
  if (!url) return null;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No se pudo cargar el logo. Desactívalo o revisa el archivo.')), 5000);
    image.onload = () => { clearTimeout(timer); resolve(); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('No se pudo cargar el logo.')); };
    image.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, Math.floor(Math.min(config.dots, image.naturalWidth) / 8) * 8);
  canvas.height = Math.max(8, Math.round(canvas.width * image.naturalHeight / image.naturalWidth / 8) * 8);
  if (canvas.height > config.dots * 2) throw new Error('El logo es demasiado alto. Usa un logo horizontal.');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const tone = pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114 < 170 ? 0 : 255;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = tone; pixels.data[i + 3] = 255;
  }
  return pixels;
}

export class EscPosEncoder {
  constructor({ logoLoader = loadMonochromeLogo } = {}) { this.logoLoader = logoLoader; }
  async encode(ticket, config) {
    const encoder = new ReceiptPrinterEncoder({ language: 'esc-pos', columns: config.columns, codepageMapping: config.codepageMapping });
    encoder.initialize().codepage(config.codepage === 'ascii' ? 'cp850' : config.codepage);
    if (config.showLogo && ticket.logoUrl) {
      const logo = await this.logoLoader(ticket.logoUrl, config);
      if (logo) encoder.align('center').image(logo, { width: logo.width, height: logo.height, algorithm: 'threshold', threshold: 128 });
    }
    for (const item of ticket.lines) {
      if (item.kind === 'qr') {
        if (config.showQr) encoder.align('center').qrcode(item.value, { model: 2, size: 4, errorlevel: 'm' });
      } else if (item.kind === 'separator') {
        encoder.align('left').bold(false).size(1, 1).line('-'.repeat(config.columns));
      } else {
        encoder.align(item.align || 'left').bold(Boolean(item.bold)).size(1, item.large ? 2 : 1)
          .line(printableText(item.text, config.codepage === 'ascii'));
      }
    }
    encoder.size(1, 1).bold(false).align('left').newline(config.feedLines);
    if (config.cut) encoder.cut();
    return encoder.encode();
  }
}
