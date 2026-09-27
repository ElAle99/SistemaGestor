// Reception checklists are independent of reported faults and repair catalogs.
const list = value => value.split('|');
const mobileInspection = list('Pantalla rota|Tapa rota|Rayones|Golpes|Marco doblado|Cámara dañada|Centro de carga dañado|Botones dañados|Bandeja SIM faltante|Señales de humedad|Equipo abierto/manipulado|Sin daños visibles|Otro');
const mobileAccessories = list('Cargador|Cable|Funda|Bandeja SIM|Memoria SD|Caja|Adaptador|Ninguno|Otro');
const commonInspection = list('Golpes/rayones|Equipo abierto/manipulado|Sin daños visibles|Otro');
const commonAccessories = list('Cargador|Cable|Caja|Ninguno|Otro');
const checklists = {
  celular: [mobileInspection, mobileAccessories],
  tablet: [mobileInspection, mobileAccessories],
  laptop: [list('Pantalla rota|Carcasa rota|Bisagras dañadas|Teclado dañado|Touchpad dañado|Tornillos faltantes|Puerto de carga dañado|Puertos dañados|Golpes/rayones|Equipo abierto/manipulado|Sin daños visibles|Otro'), list('Cargador|Cable de corriente|Mouse|Funda/mochila|Adaptador|Caja|Ninguno|Otro')],
  control: [list('Joystick roto|Botones dañados|Gatillos dañados|Carcasa rota|Tornillos faltantes|Puerto de carga dañado|Golpes/rayones|Equipo abierto/manipulado|Sin daños visibles|Otro'), list('Cable USB|Batería|Tapa de batería|Adaptador|Caja|Ninguno|Otro')],
  consola: [list('Carcasa dañada|Puerto HDMI dañado|Puerto de carga/energía dañado|Botones dañados|Tornillos faltantes|Golpes/rayones|Equipo abierto/manipulado|Sin daños visibles|Otro'), list('Cable de corriente|HDMI|Control|Base|Fuente de poder|Caja|Ninguno|Otro')],
  bocina: [list('Malla dañada|Carcasa dañada|Puerto de carga dañado|Botones dañados|Golpes/rayones|Señales de humedad|Equipo abierto/manipulado|Sin daños visibles|Otro'), list('Cable de carga|Cargador|Correa|Caja|Ninguno|Otro')]
};
export function receptionOptions(type) {
  const name = String(type || '').trim().toLowerCase();
  const [inspection, accessories] = Object.hasOwn(checklists, name) ? checklists[name] : [commonInspection, commonAccessories];
  return { inspection, accessories };
}
