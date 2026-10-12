import { publicTrackingUrl, safeText } from './TicketBuilder.mjs';
const amount = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const date = value => {
  if (!value) return '';
  // Do not fabricate an intake time when the API supplies only a date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? safeText(value) : parsed.toLocaleString('es-MX');
};
export function authorizeTicketData(type, raw = {}, business = {}) {
  const common = { businessContact: safeText(business.whatsapp || business.phone), logoUrl: business.ticketLogoUrl || 'img/logoallfix-ticket.png' };
  if (type === 'service') {
    const estimate = raw.pendiente_presupuesto || raw.costo_estimado == null ? null : amount(raw.costo_estimado);
    return { ...common, folio: safeText(raw.folio), date: date(raw.fecha_creacion || raw.dateIn),
      status: safeText(raw.status), customerName: safeText(raw.clientName), deviceType: safeText(raw.deviceType),
      brand: safeText(raw.brand), model: safeText(raw.model), fault: safeText(raw.falla_reportada),
      service: safeText(raw.servicio_solicitado), estimate, advance: amount(raw.anticipo),
      pending: raw.estado_pago === 'Pagado' ? 0 : estimate == null ? null : Math.max(0, estimate - amount(raw.anticipo)),
      estimatedDelivery: date(raw.estimatedDate),
      // Only a public URL explicitly returned by the authorized API. Never construct an invented route.
      publicTrackingUrl: publicTrackingUrl(raw.publicTrackingUrl || raw.tracking_url) };
  }
  if (type === 'equipmentLabel') {
    const optional = value => {
      const text = safeText(value);
      return /^(?:no proporcionado|ninguno|ninguna|n\/a)$/i.test(text) ? '' : text;
    };
    const value = raw.costo_real ?? (raw.pendiente_presupuesto ? null : raw.costo_estimado);
    const total = value == null ? null : Math.max(0, amount(value));
    const advance = Math.max(0, amount(raw.anticipo));
    const lock = safeText(raw.lock_type).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return { folio: safeText(raw.folio), customerName: optional(raw.clientName), phone: optional(raw.clientPhone),
      deviceType: optional(raw.deviceType), brand: optional(raw.brand), model: optional(raw.model),
      service: optional(raw.servicio_solicitado || raw.falla_reportada),
      secretLabel: lock === 'pin' ? 'PIN' : 'Contraseña',
      secret: lock === 'pin' ? optional(raw.lock_pin) : lock === 'contrasena' ? optional(raw.lock_pass) : '',
      total, advance, pending: raw.estado_pago === 'Pagado' ? 0 : total == null ? null
        : Math.max(0, (Math.round(total * 100) - Math.round(advance * 100)) / 100) };
  }
  if (type === 'sale') return { ...common, folio: safeText(raw.folio), date: date(raw.fecha),
    items: (raw.items || []).map(item => ({ name: safeText(item.nombre || 'Servicio / producto'),
      quantity: amount(item.cantidad), unitPrice: amount(item.precio_unitario), amount: amount(item.precio_unitario) * amount(item.cantidad) })),
    subtotal: amount(raw.subtotal ?? raw.total), discount: amount(raw.descuento), total: amount(raw.total),
    paymentMethod: safeText(raw.metodo_pago), cash: amount(raw.efectivo_recibido ?? raw.monto_recibido),
    transfer: amount(raw.transferencia_recibida), change: amount(raw.cambio) };
  if (type === 'cashClosing') {
    const summary = raw.resumen || {};
    return { ...common, date: date(raw.fecha_cierre || raw.fecha_apertura), opening: amount(summary.fondo_inicial),
      sales: amount(summary.ventas_pos_efectivo), repairs: amount(summary.cobros_reparaciones_efectivo), advances: amount(summary.anticipos),
      payments: amount(summary.abonos), income: amount(summary.entradas_manuales), expenses: amount(summary.salidas_manuales),
      expected: amount(raw.total_esperado ?? summary.total_esperado), counted: raw.monto_contado == null ? null : amount(raw.monto_contado),
      difference: raw.diferencia == null ? null : amount(raw.diferencia), transfers: amount(summary.transferencias), cards: amount(summary.tarjeta) };
  }
  throw new Error('No hay datos autorizados para este tipo de ticket.');
}
