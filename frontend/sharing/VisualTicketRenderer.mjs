
// Draw directly at sharing resolution; no printer settings, HTML capture or ESC/POS bytes.
export async function renderShareTicket(ticket) {
  const width = 800, margin = 48, content = width - margin * 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Este navegador no permite generar la imagen.');
  const commands = []; let y = 48;
  const font = (size, bold = false) => `${bold ? '700' : '400'} ${size}px "Courier New", monospace`;
  function wrap(value, maxWidth, face) {
    ctx.font = face; const lines = []; let line = '';
    for (const word of String(value).split(/\s+/)) {
      if (line && ctx.measureText(line + ' ' + word).width > maxWidth) { lines.push(line); line = ''; }
      for (const char of (line ? ' ' : '') + word) {
        if (ctx.measureText(line + char).width > maxWidth) { lines.push(line); line = ''; }
        line += char;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  function drawText(value, {size = 25, bold = false, center = false} = {}) {
    const face = font(size, bold);
    for (const line of wrap(value, content, face)) {
      const top = y; commands.push(() => { ctx.font = face; ctx.textAlign = center ? 'center' : 'left'; ctx.fillText(line, center ? width / 2 : margin, top); });
      y += Math.ceil(size * 1.4);
    }
  }
  for (const block of ticket.blocks) {
    if (block.kind === 'rule') {
      y += 18; const top = y;
      commands.push(() => { ctx.beginPath(); ctx.setLineDash([7, 7]); ctx.moveTo(margin, top); ctx.lineTo(width - margin, top); ctx.stroke(); ctx.setLineDash([]); }); y += 26;
    } else if (block.kind === 'text') {
      if (['label','thanks'].includes(block.style)) y += 14;
      drawText(block.text, { size: block.style === 'brand' ? 44 : block.style === 'label' ? 22 : 25,
        bold: ['brand','title','label','thanks','item'].includes(block.style), center: ['brand','title','center','thanks'].includes(block.style) });
    } else if (block.kind === 'amount') {
      const size = block.strong ? 28 : 25, face = font(size, block.strong);
      if (block.strong) y += 14;
      ctx.font = face; const valueWidth = ctx.measureText(block.value).width;
      const lines = wrap(block.label, content - valueWidth - 24, face);
      const top = y;
      commands.push(() => {
        ctx.font = face; ctx.textAlign = 'left'; lines.forEach((line,i) => ctx.fillText(line, margin, top + i * 36));
        ctx.textAlign = 'right'; ctx.fillText(block.value, width - margin, top);
      }); y += Math.max(1,lines.length) * 36 + 8;
    }
  }
  if (y > 30000) throw new Error('El comprobante es demasiado largo para una sola imagen.');
  canvas.width = width; canvas.height = Math.ceil(y + 48);
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,canvas.height);
  ctx.fillStyle = '#171717'; ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.textBaseline = 'top';
  commands.forEach(draw => draw());
  const blob = await new Promise((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo generar el PNG.')), 'image/png'));
  return { blob, pixelWidth: width, pixelHeight: canvas.height };
}
