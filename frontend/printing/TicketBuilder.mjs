export const safeText = value => String(value ?? '').normalize('NFC')
  .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
const money = value => `$${(Number.isFinite(Number(value)) ? Number(value) : 0).toFixed(2)}`;
const line = (text, options = {}) => ({ kind: 'text', text: safeText(text), ...options });
const field = (label, value) => value === undefined || value === null || value === '' ? [] : [line(`${label}: ${safeText(value)}`)];
const separator = { kind: 'separator' };

export function publicTrackingUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || /(?:jwt|access_token|authorization)=/i.test(url.search)) return '';
    return url.href.length <= 500 ? url.href : '';
  } catch { return ''; }
}

export function serviceTicket(data) {
  const lines = [line('ORDEN DE SERVICIO', { align: 'center', bold: true }), ...field('Folio', data.folio),
    ...field('Fecha', data.date), ...field('Estado', data.status), separator,
    ...field('Cliente', data.customerName), ...field('Equipo', data.deviceType),
    ...field('Marca', data.brand), ...field('Modelo', data.model),
    ...field('Falla', data.fault), ...field('Servicio', data.service), separator,
    ...field('Costo estimado', data.estimate == null ? null : money(data.estimate)),
    ...field('Anticipo', money(data.advance)), ...field('Saldo pendiente', data.pending == null ? 'Por definir' : money(data.pending)),
    ...field('Entrega estimada', data.estimatedDelivery)];
  const url = publicTrackingUrl(data.publicTrackingUrl);
  if (url) lines.push({ kind: 'qr', value: url }, line('Consulta el estado de tu orden', { align: 'center' }));
  lines.push(...field('Folio', data.folio), line('Conserve este ticket.', { align: 'center' }));
  return lines;
}

export function equipmentLabelTicket(data) {
  if (!safeText(data.folio)) throw new Error('La etiqueta requiere el folio de la orden.');
  return [line('ALLFIX BACALAR', { align: 'center' }),
    line(`FOLIO: ${safeText(data.folio)}`, { bold: true }),
    ...field('Cliente', data.customerName), ...field('Celular', data.phone),
    ...field('Equipo', [data.deviceType, data.brand, data.model].filter(Boolean).join(' ')), separator,
    ...(data.service ? [line(`SERVICIO: ${data.service}`, { bold: true })] : []),
    ...field(data.secretLabel || 'PIN', data.secret),
    ...field('Total', data.total == null ? null : money(data.total)),
    ...(data.advance > 0 ? field('Anticipo', money(data.advance)) : []),
    ...(data.pending == null ? [] : [line(`SALDO PENDIENTE: ${money(data.pending)}`, { bold: true })])];
}

export function saleTicket(data) {
  const lines = [line('COMPROBANTE DE VENTA', { align: 'center', bold: true }),
    ...field('Folio', data.folio), ...field('Fecha', data.date), separator];
  for (const item of (data.items || []).slice(0, 300)) {
    lines.push(line(item.name), line(`${Number(item.quantity) || 0} x ${money(item.unitPrice)} = ${money(item.amount)}`));
  }
  lines.push(separator);
  if (Number(data.discount) > 0 || Number(data.subtotal) !== Number(data.total)) lines.push(...field('Subtotal', money(data.subtotal)));
  if (Number(data.discount)) lines.push(...field('Descuento', money(data.discount)));
  lines.push(line(`TOTAL: ${money(data.total)}`, { bold: true }), ...field('Pago', data.paymentMethod));
  const method = safeText(data.paymentMethod).toLowerCase();
  if (['efectivo', 'mixto'].includes(method)) lines.push(...field('Efectivo recibido', money(data.cash)));
  if (['transferencia', 'mixto'].includes(method) && Number(data.transfer) > 0) lines.push(...field('Transferencia', money(data.transfer)));
  if (['efectivo', 'mixto'].includes(method)) lines.push(...field('Cambio', money(data.change)));
  lines.push(line('Gracias por su preferencia.', { align: 'center' }));
  return lines;
}

export function cashClosingTicket(data) {
  const lines = [line('CORTE DE CAJA', { align: 'center', bold: true }), ...field('Fecha', data.date), separator];
  for (const [key, label] of Object.entries({ opening: 'Fondo inicial', sales: 'Ventas efectivo', repairs: 'Cobros de servicio', advances: 'Anticipos', payments: 'Abonos', income: 'Entradas', expenses: 'Salidas', expected: 'Total esperado', counted: 'Dinero contado', difference: 'Diferencia', transfers: 'Transferencias', cards: 'Tarjeta' })) {
    if (data[key] != null) lines.push(...field(label, money(data[key])));
  }
  return lines;
}

export class TicketBuilder {
  build({ type, data = {} }) {
    if (type === 'equipmentLabel') return { type, lines: equipmentLabelTicket(data), logoUrl: '' };
    const template = { service: serviceTicket, sale: saleTicket, cashClosing: cashClosingTicket,
      test: () => [line('PRUEBA ESC/POS', { bold: true }), line('ñ Ñ á é í ó ú ¿Qué? ¡Sí! $123.45'), { kind: 'qr', value: 'https://example.com/' }] }[type];
    if (!template) throw new Error('Tipo de ticket no compatible.');
    // Templates select fields explicitly. Raw objects and internal identifiers never enter the queue.
    return { type, lines: [line('Allfix Bacalar', { align: 'center', bold: true, large: true }),
      line('Servicio técnico y accesorios', { align: 'center' }),
      ...field('Contacto', data.businessContact), separator, ...template(data)],
      logoUrl: typeof data.logoUrl === 'string' ? data.logoUrl : '' };
  }
}
