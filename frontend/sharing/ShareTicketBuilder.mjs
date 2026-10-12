import { authorizeTicketData } from '../printing/authorizedData.mjs';

const money = value => Number(value).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
// Visual template only. Reuse the allowlist, never the printable DOM or thermal template.
export function buildShareTicket(type, raw, business = {}) {
  const data = authorizeTicketData(type, raw, business);
  const blocks = [];
  const text = (value, style = 'body') => { if (value) blocks.push({ kind: 'text', text: String(value), style }); };
  const field = (label, value) => { if (value != null && value !== '') text(`${label}: ${value}`); };
  const rule = () => blocks.push({ kind: 'rule' });
  const total = (label, value, strong = false) => blocks.push({ kind: 'amount', label, value: value == null ? 'Por definir' : money(value), strong });
  text('ALLFIX BACALAR', 'brand');
  text('Reparación de equipos móviles', 'center');
  if (data.businessContact) text(`Contacto: ${data.businessContact}`, 'center');
  rule();
  text(({ service: 'COMPROBANTE DE SERVICIO', sale: 'COMPROBANTE DE VENTA', cashClosing: 'CORTE DE CAJA' })[type], 'title');
  field('Folio', data.folio); field('Fecha', data.date); field('Estado', data.status);
  rule();
  if (type === 'service') {
    field('Cliente', data.customerName); field('Equipo', data.deviceType);
    field('Marca / modelo', [data.brand, data.model].filter(Boolean).join(' '));
    if (data.fault) { text('FALLA REPORTADA', 'label'); text(data.fault); }
    if (data.service) { text('SERVICIO SOLICITADO', 'label'); text(data.service); }
    field('Entrega estimada', data.estimatedDelivery);
    rule(); total('Costo estimado', data.estimate); total('Anticipo', data.advance); total('SALDO PENDIENTE', data.pending, true);
  } else if (type === 'sale') {
    text('PRODUCTOS / SERVICIOS', 'label');
    for (const item of data.items) {
      text(item.name, 'item'); total(`${item.quantity} × ${money(item.unitPrice)}`, item.amount);
    }
    rule(); total('Subtotal', data.subtotal);
    if (data.discount) total('Descuento', data.discount);
    total('TOTAL', data.total, true); field('Pago', data.paymentMethod);
  } else {
    for (const [key, label] of Object.entries({ opening:'Fondo inicial', sales:'Ventas', repairs:'Reparaciones', advances:'Anticipos', income:'Entradas', expenses:'Salidas', expected:'Esperado', counted:'Contado', difference:'Diferencia' })) {
      if (data[key] != null) total(label, data[key], key === 'counted');
    }
  }
  rule();
  if (data.publicTrackingUrl) { blocks.push({ kind: 'qr', value: data.publicTrackingUrl }); text('Consulta el estado de tu equipo', 'center'); }
  text('Gracias por su preferencia', 'thanks');
  text('Conserve este comprobante', 'center');
  return { type, folio: data.folio || 'comprobante', blocks };
}
