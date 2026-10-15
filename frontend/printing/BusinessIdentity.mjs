// Identity comes from the existing establishment configuration, never a template default.
const text = value => String(value ?? '').normalize('NFC').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim();
export function businessIdentity(config = {}, raw = {}) {
  const owner = raw.negocio_id == null ? null : String(raw.negocio_id);
  const scope = config.negocio_id == null ? null : String(config.negocio_id);
  if (config.identityUnavailable || (owner !== null && owner !== scope) || (scope !== null && owner === null)) {
    throw new Error('No se pudo verificar que el comprobante y el establecimiento pertenecen al mismo negocio.');
  }
  return {
    name: text(config.name ?? config.nombre), address: text(config.address ?? config.direccion),
    phone: text(config.phone ?? config.telefono), whatsapp: text(config.whatsapp),
    terms: text(config.terms ?? config.terminos_legales),
    logoUrl: text(config.ticketLogoUrl || config.logoUrl || config.logo_ticket_url || config.logo_url),
    // Social profiles remain available without extending the compact thermal header.
    socials: config.redes_sociales ?? ''
  };
}

export function businessContactLines(business = {}) {
  const { phone, whatsapp } = business;
  const number = value => String(value || '').replace(/\D/g, '');
  if (phone && whatsapp && number(phone) && number(phone) === number(whatsapp)) return [`Tel / WhatsApp: ${whatsapp}`];
  return [phone && `Tel: ${phone}`, whatsapp && `WhatsApp: ${whatsapp}`].filter(Boolean);
}

export function buildBusinessHeader(business = {}, { compact = false } = {}) {
  const lines = business.name ? [{ kind: 'text', text: business.name, align: 'center', bold: true, ...(compact ? {} : { large: true }) }] : [];
  if (!compact) {
    if (business.address) lines.push({ kind: 'text', text: business.address, align: 'center' });
    lines.push(...businessContactLines(business).map(value => ({ kind: 'text', text: value, align: 'center' })));
  }
  return lines;
}

// Keep each line below the existing encoder's text safety limit. Its existing columns wrap at 58 mm.
export function businessLegalLines(business = {}) {
  const words = text(business.terms).split(/\s+/).filter(Boolean), lines = [];
  let current = '';
  for (const word of words) {
    for (let offset = 0; offset < word.length; offset += 1000) {
      const part = word.slice(offset, offset + 1000);
      if (current && current.length + part.length + 1 > 1000) { lines.push({ kind: 'text', text: current }); current = ''; }
      current += (current ? ' ' : '') + part;
    }
  }
  if (current) lines.push({ kind: 'text', text: current });
  return lines;
}
