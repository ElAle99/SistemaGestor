import { loadMonochromeLogo } from './EscPosEncoder.mjs';

export class BrowserPrintFallback {
  async print(ticket, config) {
    const frame = document.createElement('iframe');
    frame.title = 'Impresión de ticket';
    frame.style.cssText = 'position:fixed;left:-10000px;width:400px;height:600px';
    document.body.append(frame);
    const cleanupTimer = setTimeout(() => frame.remove(), 120000);
    try {
    const doc = frame.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><head><title>Ticket Allfix</title></head><body></body></html>');
    doc.close();
    const style = doc.createElement('style');
    style.textContent = `@page{size:${parseInt(config.paperWidth)}mm auto;margin:0}body{margin:0;width:${config.printableMm}mm;font:12px monospace;color:#000;background:#fff}p{margin:3px 0;white-space:pre-wrap;overflow-wrap:anywhere}.copy{break-after:page}.copy:last-child{break-after:auto}`;
    doc.head.append(style);
    const logo = config.showLogo && ticket.logoUrl ? await loadMonochromeLogo(ticket.logoUrl, config) : null;
    // Same authorized model as ESC/POS; never print the operational order DOM.
    for (let copy = 0; copy < config.copies; copy++) {
      const section = doc.createElement('section'); section.className = 'copy';
      if (logo) {
        const canvas = doc.createElement('canvas'); canvas.width = logo.width; canvas.height = logo.height;
        canvas.getContext('2d').putImageData(logo, 0, 0);
        canvas.style.cssText = 'display:block;max-width:100%;height:auto;margin:auto';
        canvas.style.width = `${logo.width / config.dpi * 25.4}mm`;
        section.append(canvas);
      }
      for (const item of ticket.lines) {
        if (item.kind === 'qr') {
          continue;
        }
        const p = doc.createElement('p');
        p.textContent = item.kind === 'separator' ? '-'.repeat(config.columns) : item.text;
        p.style.textAlign = item.align || 'left';
        if (item.bold) p.style.fontWeight = 'bold';
        if (item.large) p.style.fontSize = '18px';
        section.append(p);
      }
      doc.body.append(section);
    }
    frame.contentWindow.addEventListener('afterprint', () => { clearTimeout(cleanupTimer); frame.remove(); }, { once: true });
    frame.contentWindow.focus();
    frame.contentWindow.print();
    return { browser: true, success: true, printerName: 'diálogo del navegador', warning: 'Confirma la impresión en el diálogo del navegador.' };
    } catch (error) { clearTimeout(cleanupTimer); frame.remove(); throw error; }
  }
}
