# Comprobantes visuales para compartir

Flujo independiente: datos de la orden/venta → `authorizeTicketData` (lista permitida existente, sin cambios) → `ShareTicketBuilder` → `VisualTicketRenderer` → PNG → vista previa, descarga o Web Share.

El generador dibuja texto y líneas sobre canvas blanco de 800 px. No lee ni captura el DOM del ticket, no depende de html2canvas, de las preferencias de papel ni de una impresora. Reutiliza `qrcode` únicamente si la orden trae una URL pública de seguimiento válida; no construye URLs ni imprime el token como texto. Las plantillas de servicio y POS son visuales e independientes de las térmicas. Se conserva también una plantilla de resumen de caja con campos autorizados.

Desde el comprobante existente: **Vista previa para compartir**, **Descargar PNG** o **Enviar por WhatsApp**. Web Share abre las aplicaciones compatibles del dispositivo. Sin soporte para compartir archivos, se descarga el PNG y se abre WhatsApp con un texto; el usuario debe adjuntar el archivo manualmente. La imagen se prepara anticipadamente y se reutiliza mientras no cambien sus datos; la vista previa libera su URL temporal al cerrar o cambiar el comprobante. No se guardan imágenes ni datos de clientes en localStorage.

Mediciones con Edge y ejemplos de prueba: servicio con falla, reparación e importes, 107391 bytes (105 KiB); venta sencilla, 67284 bytes (66 KiB). El peso aumenta con la longitud y el QR; no se garantiza un máximo de 400 KB para ventas largas ni se añade relleno para alcanzar un mínimo. Los comprobantes que exceden 30000 px de contenido se rechazan con un mensaje, sin truncar productos silenciosamente.

No se modificaron `frontend/printing/*`, `frontend/services/printerService.js` ni el flujo físico de `app.js`. Los hashes de los módulos térmicos se compararon antes/después sin cambios. Las pruebas verifican RAW QZ, cola/reconexión, cobro único y bytes de servicio/POS/caja. No se envió una nueva impresión física durante este ajuste.

Construcción: `npm run build`. Validación: `npm test` y pruebas Playwright de QZ, ESC/POS, exportación PNG, Web Share y vista previa móvil. Los datos privados de prueba presentes tanto en el modelo original como en el DOM no aparecen en los textos dibujados.
