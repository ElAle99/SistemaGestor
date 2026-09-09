# Configuración de QZ Tray para Allfix Bacalar

La impresión directa ocurre entre el navegador, QZ Tray y las impresoras instaladas en la computadora. Railway continúa atendiendo la aplicación, la API y PostgreSQL, pero no detecta ni controla impresoras.

## Requisitos

- Windows con la impresora térmica instalada y operativa.
- QZ Tray instalado y abierto.
- Chrome o Edge.
- Acceso al Sistema Gestor Allfix Bacalar.
- Papel configurado en el controlador de Windows (normalmente 58 mm).

## Configuración inicial

1. Instala QZ Tray desde su sitio oficial.
2. Verifica en Windows que la impresora pueda imprimir una página de prueba.
3. Abre QZ Tray y déjalo ejecutándose en el área de notificaciones.
4. Abre `https://sistemagestorallfix-production-f8c7.up.railway.app`.
5. Inicia sesión.
6. Ve a **Configuración > Impresión**.
7. Presiona **Actualizar impresoras**.
8. Autoriza la conexión cuando QZ Tray muestre el aviso.
9. Selecciona exactamente la impresora que corresponda.
10. Selecciona **58 mm**.
11. Elige si deseas impresión automática.
12. Presiona **Guardar configuración**.
13. Presiona **Imprimir prueba** y vuelve a autorizar QZ Tray si lo solicita.

La impresora, el ancho de papel y la impresión automática se guardan en el almacenamiento local del navegador. Cada computadora puede tener su propia selección. Estos valores no se guardan globalmente en PostgreSQL.

## Uso diario

- Mantén QZ Tray abierto antes de imprimir directamente.
- **Imprimir ticket** envía el ticket actual por QZ Tray.
- **Impresión normal** abre el diálogo de impresión del navegador.
- **Último ticket** vuelve a cargar la última venta; imprimirlo no registra una venta nueva.
- Si cambia una impresora, vuelve a **Configuración > Impresión** y presiona **Actualizar impresoras**.

## Si QZ Tray está cerrado o no está instalado

El resto del sistema sigue funcionando. Al intentar conectar se mostrará que QZ Tray no está disponible. Puedes:

1. Abrir o instalar QZ Tray.
2. Volver a **Configuración > Impresión**.
3. Presionar **Actualizar impresoras**.
4. O utilizar **Impresión normal** en la vista previa del ticket.

Un fallo de impresión después de crear una orden o una venta no revierte ni repite la operación guardada. Utiliza el botón de impresión del ticket ya generado para reintentar.

## Si QZ no detecta la impresora

1. Confirma que la impresora aparece en **Configuración > Bluetooth y dispositivos > Impresoras y escáneres** de Windows.
2. Imprime una página de prueba desde Windows.
3. Cierra y vuelve a abrir QZ Tray.
4. Recarga el Sistema Gestor.
5. Presiona **Actualizar impresoras**.
6. No renombres la impresora desde el sistema: se utiliza exactamente el nombre que entrega Windows mediante QZ Tray.

## HTTPS, Railway y CORS

No se requieren `QZ_HOST`, `QZ_PORT`, `QZ_URL` ni otras variables de QZ en Railway. QZ Tray utiliza su conexión local segura predeterminada. No desactives HTTPS ni la seguridad del navegador.

Para solicitudes de frontend separadas del backend, `ALLOWED_ORIGINS` debe incluir, sin slash final:

`https://sistemagestorallfix-production-f8c7.up.railway.app`

Cuando Express sirve frontend y API bajo ese mismo dominio, el origen también es aceptado como mismo origen. Los orígenes locales de desarrollo existentes se conservan.

## Firma y funcionamiento silencioso

Esta primera integración usa los avisos y permisos normales de QZ Tray. No contiene claves privadas, certificados demo ni secretos en el frontend.

Para una autorización completamente firmada y silenciosa falta adquirir/configurar un certificado válido de QZ Tray. En esa fase:

- el certificado público se entrega al cliente mediante `qz.security.setCertificatePromise(...)`;
- el texto a firmar se envía al backend;
- la clave privada permanece exclusivamente en Railway;
- el backend devuelve una firma SHA512 para `qz.security.setSignaturePromise(...)`.

No agregues una clave privada a React/JavaScript, `localStorage`, variables `VITE_*` ni archivos públicos.
