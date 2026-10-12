# Impresión RAW con QZ Tray en Windows

QZ Tray es el transporte prioritario en Windows cuando la conexión está en Automática. El cliente JavaScript `qz-tray@2.3.0` está integrado en el bundle; la aplicación de escritorio se instala por separado y no se descarga ni ejecuta automáticamente.

## Primera impresión con POS-58 / POS-5890

1. Instala manualmente QZ Tray para Windows desde https://qz.io/download/ y ábrelo desde Inicio. Debe ejecutarse en la misma computadora donde están el navegador y la impresora USB, con su icono en la bandeja junto al reloj; no basta instalarlo en el servidor remoto del SaaS.
2. Conserva la impresora POS-58 instalada en Windows (USB002 y controlador usbprint en el equipo revisado). No es necesario sustituir ese controlador por WinUSB para este transporte.
3. Abre el sistema en http://localhost:5000 y recarga con Ctrl+F5. En Configuración > Impresión, usa Automática en Configuración avanzada si habías elegido un método manual.
4. Pulsa Conectar impresora. Acepta la solicitud de confianza de QZ Tray para este sitio cuando aparezca. El estado indicará QZ Tray conectado y la lista mostrará las colas que devuelve Windows.
5. Selecciona el nombre exacto POS-58 (o POS-58 (copy 1) si ese es el instalado en USB002). El sistema mostrará el nombre seleccionado y lo guardará en las preferencias locales de esta computadora/sucursal. No selecciona automáticamente una impresora virtual.
6. Papel 58 mm, una copia, inicialmente sin logo; pulsa Imprimir prueba y acepta la autorización de QZ si aparece. Comprueba texto, acentos y avance; después activa logo/QR según soporte. Que Windows acepte el trabajo no confirma que haya salido papel.

## Qué hace el adaptador

`TicketBuilder → EscPosEncoder → PrinterManager/cola → QzTrayPrinter → spooler Windows`.
QzTrayPrinter envía el Uint8Array como `raw/command/base64`, con `forceRaw: true` y una copia por envío; PrinterManager controla copias, estados y reintentos. No crea texto, imágenes, PDF ni HTML. WhatsApp/PNG siguen independientes. Android mantiene su adaptador nativo.

En Windows, Automática intenta QZ; si no está disponible puede usar un puerto serie ya autorizado, una interfaz USB validada en esta sesión o Impresión normal. No abre un selector USB después de fallar QZ. Un SecurityError Access denied al abrir USB bloquea ese dispositivo para el resto de la sesión. Un fallo después de enviar un ticket no produce otro envío automático por un transporte distinto.

## Disponibilidad y autorizaciones

Una web no puede diferenciar con certeza entre QZ no instalado y QZ cerrado si no responde su WebSocket. Por eso el mensaje inicial explica ambas posibilidades; tras una conexión previa puede informar que está cerrado o no responde. No se simula una detección de instalación. En la revisión inicial no se encontró QZ instalado; posteriormente el usuario confirmó que QZ Tray ya envía e imprime correctamente en su POS-5890.

Esta integración usa las autorizaciones normales de QZ sin firma de producción. Puede pedir confirmación al conectar, listar e imprimir. Autoimpresión significa enviar tras confirmar el cobro, no suprimir esos avisos. Para impresión silenciosa se requiere configurar certificado confiable y firma en backend; no se han añadido endpoints ni claves privadas al navegador ni se han desactivado verificaciones.

Si el ticket queda pendiente, comprueba la cola de Windows y si salió parcialmente antes de Reconectar y Reintentar, para evitar copias duplicadas. Impresión normal sigue disponible en Configuración avanzada.

Referencias oficiales: [descarga](https://qz.io/download/), [RAW/base64](https://qz.io/docs/raw), [firma y avisos](https://qz.io/docs/signing).

Validación física: el usuario confirmó impresión correcta mediante QZ Tray en su POS-5890. La desconexión y reconexión se verificaron con dobles de prueba; no se atribuye a esa confirmación una prueba física de interrupción durante el envío.

Cierre de la validación de software: bundle regenerado, construcción completa y sintaxis aprobadas; revisión de diferencias sin errores. La prueba pendiente de Reconectar y Reintentar pasó conservando un único trabajo de venta y sin abrir WebUSB. También se comprobaron selección de POS-58, envío RAW, ausencia de QZ, cobro único y PNG para WhatsApp.
