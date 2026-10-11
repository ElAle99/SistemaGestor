// No persistent/shared browser cache: a new reception reloads the current user's scope.
export const normalize = text => String(text || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export async function requestCatalog(path = '', signal) {
  const response = await fetch(`/api/catalogos${path}`, { signal, silent: true });
  if (!response.ok) throw new Error('No se pudo cargar el catálogo. Puedes escribir manualmente.');
  return response.json();
}
export function uniqueNames(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const name = normalize(row.nombre);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
export function optionsFor(catalog, values) {
  const type = catalog.tipos.find(row => normalize(row.nombre) === normalize(values.deviceType));
  const brands = catalog.marcas.filter(row => row.tipo_equipo_id === type?.id);
  const brand = brands.find(row => normalize(row.nombre) === normalize(values.brand));
  const faults = catalog.fallas.filter(row => row.tipo_equipo_id === type?.id);
  const repairs = catalog.reparaciones.filter(row => row.tipo_equipo_id === type?.id);
  const faultIds = new Set(faults.filter(row => values.fallas.some(name => normalize(name) === normalize(row.nombre))).map(row => row.id));
  const suggested = new Set(catalog.relaciones.filter(link => faultIds.has(link.falla_id)).map(link => link.reparacion_id));
  return { type, brand, brands, faults, repairs: [...repairs].sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id))), suggested };
}
