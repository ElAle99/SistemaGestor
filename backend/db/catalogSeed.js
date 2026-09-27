// Initial data only: runtime relationships live in PostgreSQL, never in the form.
const split = text => text.split('|');
const brands = {
  Celular: 'Apple|Samsung|Xiaomi|Redmi|POCO|Motorola|Honor|Huawei|Realme|Oppo|Vivo|OnePlus|Infinix|Tecno|ZTE|Nokia|Otro',
  Laptop: 'HP|Dell|Lenovo|ASUS|Acer|MSI|Apple|Huawei|Samsung|Microsoft|Otro',
  Tablet: 'Apple|Samsung|Lenovo|Huawei|Xiaomi|Honor|Amazon|Otro',
  Control: 'Xbox|PlayStation|Nintendo|8BitDo|GameSir|Genérico|Otro',
  Consola: 'PlayStation|Xbox|Nintendo|Otro',
  Bocina: 'JBL|Sony|Bose|Marshall|Harman Kardon|Xiaomi|Genérica|Otro',
  Smartwatch: 'Apple|Samsung|Huawei|Xiaomi|Amazfit|Honor|Garmin|Otro',
  Otro: 'Otro'
};
const faults = {
  Celular: 'Pantalla rota|Pantalla no da imagen|Touch no funciona|Touch falla por zonas|Líneas en pantalla|Mancha negra|Pantalla parpadea|Pantalla verde/blanca|No carga|Carga lento|Carga intermitente|No reconoce cargador|Centro de carga flojo|Se descarga rápido|Batería inflada|Se apaga|No enciende|Se queda en logo|Se reinicia|Bootloop|Equipo mojado|Bocina no funciona|Auricular no funciona|Micrófono no funciona|Sonido bajo/distorsionado|Cámara trasera no funciona|Cámara frontal no funciona|Cámara vibra|Cámara no enfoca|Botón de encendido no funciona|Botones de volumen no funcionan|No reconoce SIM|Sin señal|Wi-Fi falla|Bluetooth falla|Face ID falla|Huella falla|Problema de software|Bloqueo|Otro',
  Laptop: 'No enciende|No carga|Batería dañada|Batería inflada|Batería dura poco|Pantalla rota|Pantalla negra|Pantalla parpadea|Teclado no funciona|Algunas teclas fallan|Touchpad no funciona|Se calienta demasiado|Ventilador hace ruido|Se apaga sola|Está lenta|No inicia Windows|Pantallazo azul|Disco no detectado|Bisagra rota|Carcasa dañada|Puerto USB no funciona|HDMI no funciona|Wi-Fi falla|Cámara no funciona|Sin audio|Otro',
  Tablet: 'Pantalla rota|Touch no funciona|No carga|Carga lento|Batería dura poco|Batería inflada|No enciende|Se queda en logo|Botones fallan|Bocina no funciona|Micrófono no funciona|Cámara falla|Wi-Fi falla|Software|Otro',
  Control: 'Drift joystick izquierdo|Drift joystick derecho|Joystick no responde|Botones no responden|Botón se queda presionado|Gatillo L2/LT falla|Gatillo R2/RT falla|L1/LB falla|R1/RB falla|No enciende|No carga|Se desconecta|No sincroniza|Puerto USB dañado|Batería dañada|Jack de audífonos no funciona|Vibración no funciona|Otro',
  Consola: 'No enciende|No da imagen|Puerto HDMI dañado|Imagen intermitente|Se calienta|Se apaga|Ventilador hace ruido|No lee discos|Lector hace ruido|Almacenamiento falla|Wi-Fi falla|Control no sincroniza|Error de sistema|Otro',
  Bocina: 'No enciende|No carga|Batería dura poco|Se apaga sola|No reproduce sonido|Sonido bajo|Sonido distorsionado|Speaker dañado|Bluetooth no conecta|Botones no funcionan|Puerto de carga dañado|Otro',
  Smartwatch: 'Pantalla rota|Touch no funciona|No carga|Batería dura poco|No enciende|Botón no funciona|No sincroniza|Sensor no funciona|Software|Otro',
  Otro: 'Otro'
};
const models = {
  Celular: {
    Apple: split('iPhone X|iPhone XR|iPhone XS|iPhone 11|iPhone 11 Pro|iPhone 11 Pro Max|iPhone 12|iPhone 12 Pro|iPhone 12 Pro Max|iPhone 13|iPhone 13 Pro|iPhone 13 Pro Max|iPhone 14|iPhone 14 Pro|iPhone 14 Pro Max|iPhone 15|iPhone 15 Pro|iPhone 15 Pro Max|iPhone 16'),
    Samsung: ['Samsung Galaxy A55 5G', 'Samsung Galaxy A54 5G', 'Samsung Galaxy S24'],
    Xiaomi: ['Xiaomi 14'], Motorola: ['Moto G54']
  },
  Control: { Xbox: ['Xbox Series', 'Xbox One'], PlayStation: ['DualSense', 'DualShock 4'], Nintendo: ['Joy-Con', 'Pro Controller'] },
  Consola: { PlayStation: ['PlayStation 5', 'PlayStation 4'], Xbox: ['Xbox Series X', 'Xbox Series S'], Nintendo: ['Switch', 'Switch OLED'] }
};
const groups = {
  pantalla: split('Cambio de pantalla|Cambio de cristal|Cambio de módulo completo|Diagnóstico'),
  carga: split('Limpieza centro de carga|Cambio centro de carga|Cambio flex de carga|Reparación línea de carga|Diagnóstico de placa'),
  bateria: split('Cambio de batería|Diagnóstico de consumo|Reparación de placa'),
  humedad: split('Mantenimiento por humedad|Limpieza ultrasónica|Reparación de placa|Diagnóstico'),
  joystick: split('Limpieza de joystick|Cambio de joystick|Cambio de potenciómetro|Calibración|Reparación de placa'),
  calor: split('Mantenimiento interno|Limpieza de ventilador|Cambio de pasta térmica|Cambio de ventilador|Diagnóstico'),
  bisagra: split('Reparación de bisagra|Cambio de bisagra|Reconstrucción de carcasa|Cambio de carcasa'),
  hdmi: split('Cambio puerto HDMI|Reparación línea HDMI|Reparación circuito HDMI|Diagnóstico de placa')
};

// Seed mappings are data preparation, not conditional UI logic.
function suggestedRepairs(type, fault) {
  if (fault === 'Equipo mojado') return groups.humedad;
  if (type === 'Control' && /Drift|Joystick/.test(fault)) return groups.joystick;
  if (type === 'Laptop' && /calienta|Ventilador|apaga sola/.test(fault)) return groups.calor;
  if (type === 'Laptop' && /Bisagra|Carcasa/.test(fault)) return groups.bisagra;
  if (type === 'Consola' && /HDMI|imagen|Imagen/.test(fault)) return groups.hdmi;
  if (/Pantalla|Touch|pantalla|Mancha/.test(fault)) return groups.pantalla;
  if (/carga|cargador|Carga/.test(fault) && !/descarga/.test(fault)) return groups.carga;
  if (/Batería|descarga/.test(fault)) return groups.bateria;
  return ['Diagnóstico'];
}

module.exports = { brands, faults, models, suggestedRepairs, split };
