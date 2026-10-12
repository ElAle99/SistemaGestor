# Impresión ESC/POS: auditoría, implementación y validación

Estado: implementación y pruebas de software realizadas. El usuario confirmó impresión física correcta mediante QZ Tray en su POS-5890. Esta confirmación no implica validación física de otros transportes, modelos o interrupciones durante el envío.

## Auditoría del flujo anterior

Antes de editar código se revisaron los manifiestos, fuentes frontend/backend, rutas, pruebas, scripts Android y referencias de impresión en todo el repositorio, excluyendo artefactos y dependencias instaladas.

| Ubicación | Flujo encontrado | Decisión |
| --- | --- | --- |
| `frontend/js/app.js` | `printReceipt` → `sendReceiptPreviewToPrinter` → captura HTML reducida a 384/576 dots en Android; `window.print` en web | Sustituido por modelo autorizado → PrinterManager. Se retiraron captura térmica, umbral global y generadores de texto DOM duplicados sin consumidores. |
| `frontend/js/receiptShare.js` | Prepara y reutiliza PNG de 1200 px; descarga, Web Share de archivos, alternativa de descarga + WhatsApp | Conservado; exclusivamente digital. `shareServiceTicket` no utiliza bytes ESC/POS. |
| `frontend/js/app.js` | `viewOrderDetails`, `viewVentaDetails`, `printOrderTicket`, `printSelectedCajaCorte`, último ticket POS | Datos del backend a una proyección explícita, misma plantilla en impresión y reimpresión. La vista visual sigue independiente. |
| `frontend/js/quickOrder.js` | Guardado exitoso primero; imprimir desde acción explícita | Sigue usando el punto central `printReceipt`. |
| `frontend/services/printerCore.mjs` | Descubrimiento Bluetooth y envío de imagen/texto; doble ruta de formatos | Retirado, sustituido por adaptadores y PrinterManager. |
| `frontend/services/printerService.js` | Entrada de Vite y puente Capacitor | Conserva una fachada pequeña; expone `window.printerManager` y proyecta datos permitidos. |
| `frontend/js/printerConfig.js`, `frontend/index.html` | Preferencias locales, carga de logo, controles limitados a Android | Amplía conexión, capacidades, ancho, tabla de caracteres, QR, logo, copias, reconexión y estado. |
| `backend/routes/config.js`, `backend/services/ticketPrinterService.js` | Endpoint autenticado `/api/config/imprimir-ticket`; Windows System.Drawing por PowerShell | Conservado por compatibilidad: sigue teniendo una ruta consumidora. La aplicación nueva NO lo llama ni lo utiliza como fallback automático. |
| `frontend/js/app.js`, `backend/server.js` | jsPDF/autotable para informes financieros; `window.print` dentro de documentos de reportes | Conservados: no son código muerto de tickets. |
| `frontend/index.html`, `backend/server.js` | html2canvas y JsBarcode servidos en `/vendor`; gráficos/barcodes del comprobante visual | Conservados para WhatsApp y vista visual. |
| Manifiestos y fuentes | QZ Tray ausente al iniciar la refactorización; integración antigua encontrada en el historial | En la revisión Windows se añadió `qz-tray@2.3.0` y `QzTrayPrinter.mjs` como transporte RAW de los bytes actuales. No se recuperaron las plantillas antiguas ni se duplicó la cola. Ver `QZ_TRAY_SETUP.md`. |
| QR | `qrcode@1.5.4` declarado en backend sin import consumidor; QR de prueba en plugin nativo anterior | Se reutiliza exactamente 1.5.4 en raíz para fallback navegador. Eliminada declaración backend sin uso. ESC/POS usa QR nativo. |
| Seguimiento | Existe consulta pública `/api/ordenes/folio/:folio`, pero no tracking_token ni página pública por token | No se inventa endpoint ni se reemplaza silenciosamente el modelo de seguridad. QR de servicio solo con `publicTrackingUrl`/`tracking_url` HTTPS explícita del backend autorizado. |

## Arquitectura

`app.js` → `authorizeTicketData(type, raw, business)` → `printerManager.print({type, data, printerConfig, jobKey})` → `TicketBuilder` → estructura neutral → `EscPosEncoder` → bytes → transporte.

- `frontend/printing/authorizedData.mjs`: lista explícita de campos comerciales. Nunca recorre ni serializa la orden completa para imprimir. `jobKey` identifica la transacción únicamente en memoria de cola, nunca se pasa al codificador ni se imprime.
- `TicketBuilder.mjs`: plantillas `serviceTicket`, `saleTicket`, `cashClosingTicket`, prueba. No leen el DOM ni APIs de transporte. Órdenes y etiquetas físicas usan el ticket seguro de servicio.
- `EscPosEncoder.mjs`: texto, alineación, negrita, tamaño, QR nativo, avance y corte opcional. CP850 por defecto; CP858, Windows1252 o sustitución ASCII. Se eliminan controles ESC de los textos para impedir comandos inyectados. Perfiles de tabla Epson, POS-5890, Xprinter, MPT según el equipo.
- Logo opcional: solo el logo se dibuja en canvas, fondo opaco blanco, proporción conservada, ancho <= dots, píxeles estrictamente blanco/negro y raster ESC/POS. Nunca se captura todo el ticket para enviarlo al dispositivo.
- `transports.mjs`: WebSerialPrinter, WebUsbPrinter y NativePrinter. Envían bytes; no contienen plantillas. Se puede añadir un adaptador BLE sin modificar plantillas. No se usa Web Bluetooth para Classic/SPP.
- `BrowserPrintFallback.mjs`: documento aislado construido con la misma estructura autorizada y texto real. QR mediante la librería existente; logo monocromo. Único `window.print` de tickets. Las impresiones de informes continúan separadas.
- `config.mjs`: preferencias con lista permitida por navegador/dispositivo y clave de negocio/sucursal cuando la sesión suministra esos identificadores; ámbito default para instalaciones sin sucursales. No almacena tickets, clientes, URLs QR o permisos físicos.

Valores iniciales nuevos: 58 mm, 48 mm imprimibles, 384 dots, 32 columnas, 203 DPI, 9600 baudios, una copia, avance cuatro líneas, corte desactivado. 80 mm: 72 mm imprimibles, 576 dots, 48 columnas. Valores editables; el DPI describe la resolución del cabezal y no cambia físicamente su hardware. Las preferencias existentes se migran por lista permitida.

## Conexiones y permisos

La conexión predeterminada es Automática: puente Android en la app; QZ Tray en Windows para impresoras del spooler, seguido por puertos serie autorizados, interfaces USB previamente abiertas correctamente en esta sesión y respaldo del navegador. No se abre un selector USB después de fallar QZ. La disponibilidad de una API no garantiza compatibilidad del hardware. Los métodos manuales están en Configuración avanzada. Web Serial requiere un puerto serie real o virtual expuesto por el SO; un cable USB por sí solo no implica un puerto COM.

Al cargar se enumeran permisos existentes con `getPorts()`/`getDevices()`, sin solicitar otros. Los selectores se invocan directamente desde Conectar impresora o Elegir otra impresora, antes de cualquier espera asíncrona. Imprimir y reintentar nunca abren selectores. Una cancelación conserva la conexión anterior.

WebUSB es alternativo. Se comprueban las configuraciones e interfaces de clase impresora 7 con endpoint bulk OUT. No se adivinan protocolos propietarios ni se elige arbitrariamente un endpoint. Un driver que tiene ocupada la interfaz, o un dispositivo que no implementa ESC/POS, puede impedirlo. No se instala ningún paquete para sustituir Web Serial/WebUSB.

La vista principal solo expone estado, impresora, papel, logo/QR, copias, autoimpresión y acciones de conexión/prueba. `profiles.mjs` reúne los valores de papel y la compatibilidad; un modelo desconocido usa ESC/POS genérico. `diagnostics.mjs` registra origen, contexto seguro, APIs, puente Android y políticas, junto al nombre/mensaje originales de cualquier error. El mapeo anterior convertía todos los SecurityError en una recomendación genérica de HTTPS, perdiendo la causa original.

Revisión posterior en localhost:5000: Edge informa contexto seguro, ambas APIs disponibles y ambas políticas permitidas. Windows detecta POS-58 en USB002, dispositivo YICHIP3121 POS-58 Printer con servicio usbprint y ningún puerto COM. El usuario confirmó SecurityError Access denied al abrir USB. El transporte correcto implementado para esta instalación es QZ Tray RAW por el spooler; Impresión normal permanece como respaldo. No se cambiaron controladores ni se validó impresión física. QZ Tray no se encontró instalado/ejecutándose en este equipo. Instrucciones en `QZ_TRAY_SETUP.md`.

En el APK Android se conserva Capacitor y el plugin existente. El adaptador envía un ítem `raw` base64 con los mismos bytes codificados, no una imagen ni una segunda plantilla. El plugin controla el transporte físico Android; su soporte efectivo también necesita prueba en equipo real.

Las escrituras web se dividen por defecto en bloques de 512 bytes con pausas de 20 ms, configurables en preferencias. Se mantiene el puerto entre trabajos y se libera el writer. Una escritura sin respuesta expira; errores de permisos, dispositivo ausente, puerto ocupado, desconexión y escritura parcial se presentan con instrucciones de reconexión. No se reenvía automáticamente un trabajo interrumpido.

## Cola y cobros

Estados: pending, printing, printed, failed. `printed` significa bytes entregados al transporte o diálogo abierto; no es confirmación del papel ni detección de falta de papel. Se serializan trabajos y se deduplican clics simultáneos de la misma transacción, sin descartar dos ventas distintas con igual contenido. Copias se envían completas en secuencia.

La cola existe solo en memoria, con máximo 20 trabajos y expiración de 15 minutos tras completar/fallar. Se purga cada minuto, al cerrar sesión, cambiar ámbito o abandonar la página. Reintentar conserva el modelo seguro, usa las preferencias actuales y no vuelve a llamar al backend para cobrar. Revisar si salió una copia parcial antes de reintentar.

El cobro mantiene el orden existente: backend confirma transacción → actualización del estado de la aplicación → impresión. Una falla de impresión no ejecuta rollback, no revierte inventario y no repite el POST. Muestra “Venta completada, ticket pendiente de impresión” y el botón Reconectar y Reintentar. POS conserva Último ticket; órdenes ofrecen reimpresión desde el mismo modelo.

No se imprimen PIN, contraseña, patrón, IMEI, serie, teléfono/contacto privado, dirección del cliente, diagnóstico, inspección privada, IDs internos, rutas, auditoría o JWT. El token solo puede estar dentro de una URL QR validada, nunca como línea de texto. La fecha/hora real de creación se incorpora al DTO autenticado de órdenes; no se inventa una hora fija. No se modificaron tablas ni endpoints.

## Dependencias y limpieza

- Nueva: `@point-of-sale/receipt-printer-encoder@4.0.1`, export de navegador verificado con Vite.
- Reutilizada/movida: `qrcode@1.5.4`, de declaración backend sin consumidores a dependencia raíz usada por BrowserPrintFallback.
- Conservadas: html2canvas, jsPDF, jspdf-autotable, JsBarcode y dependencias Capacitor/Android; tienen consumidores actuales.
- Eliminados: `frontend/services/printerCore.mjs`, generadores `build*ReceiptText` y ayudantes de formato sin llamadas, normalización de imagen térmica y envío de captura, selección Windows obsoleta y ajuste de página del antiguo `window.print` del ticket.
- Pruebas anteriores del servicio raster fueron reemplazadas por `tests/printing.test.mjs`; las de WhatsApp se mantienen y amplían con navegador real. `npm test` ejecuta ambas y el backend.

## Validación

Se ejecutan construcción Vite, comprobaciones sintácticas JS, pruebas unitarias de autorización/bytes/cola/transportes y pruebas Edge con Playwright. Las APIs físicas son dobles de prueba; no confundir estos resultados con una impresora real. El PNG de WhatsApp se renderiza de verdad con html2canvas y se comprueba su cabecera PNG y ancho de 1200 px. Web Share se simula, no se envía un mensaje real a ningún contacto.

Resultados registrados el 11 de octubre de 2026: construcción aprobada; 21 pruebas de impresión/WhatsApp y 111 de backend aprobadas. Suite de navegador de 25 pruebas aprobada, seguida de seis pruebas de integración finales aprobadas (incluyen dos casos nuevos: cobro POS único antes de imprimir y logo monocromo). La consulta de Windows muestra impresoras virtuales y una Canon G2010; no muestra una térmica configurada ni puertos Win32_SerialPort. Esto no sustituye la detección/selección de WebUSB en el navegador del usuario.

Actualización de cierre QZ: el usuario confirmó la impresión física en POS-5890. Se regeneró el bundle con el ajuste final de reconexión, pasó la construcción completa (incluida sintaxis de 57 archivos backend) y se revisaron las diferencias sin errores. Pasaron las siete pruebas de navegador seleccionadas para QZ, reintento del mismo trabajo de venta, cobro único y WhatsApp. La ejecución anterior había aprobado 29 pruebas de impresión/WhatsApp, 111 de backend y 31 de navegador; el nuevo caso de reconexión también está aprobado.

Comprobaciones físicas adicionales no cubiertas por la confirmación general del usuario (no bloquean el cierre del ajuste QZ):

1. Registrar firmware si se investigan diferencias de comandos; QZ por spooler USB no necesita configurar baudios.
2. Configuración > Impresoras: seleccionar método, Conectar impresora, Imprimir prueba. Comprobar ñ/Ñ/acentos/¿/¡/$, ancho, legibilidad y QR con un teléfono.
3. Imprimir un servicio y una venta larga en 58 mm; verificar importes y ausencia de información privada. Probar logo si se activa. Validar 80 mm solo con equipo correspondiente.
4. Desconectar físicamente durante el envío, comprobar venta confirmada, reconectar y reintentar una sola vez. Verificar posible papel parcial, luego reimpresión del último ticket.
5. Implementar/proporcionar una URL pública real basada en tracking_token para habilitar el QR de seguimiento de servicio. No se imprimirá un QR roto mientras falte esa infraestructura.

Referencias consultadas: [ReceiptPrinterEncoder](https://github.com/at-point-of-sale/ReceiptPrinterEncoder), [comandos del codificador](https://github.com/at-point-of-sale/ReceiptPrinterEncoder/blob/main/documentation/commands.md), [Bluetooth RFCOMM y Web Serial](https://developer.chrome.com/blog/bluetooth-rfcomm-updates-web-serial), [WebUSB y compatibilidad de dispositivos](https://developer.chrome.com/docs/capabilities/build-for-webusb).
