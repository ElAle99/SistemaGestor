# Interfaz Allfix

La capa visual se aplica sobre las vistas existentes. No cambia contratos HTTP, tablas,
cálculos financieros ni permisos. La orden rápida conserva su pantalla única.

## Componentes compartidos

- `frontend/css/design-system.css`: tokens de color, tipografía, espaciado y superficies;
  controles, tablas, estados, modales y adaptaciones. Las reglas visuales son de pantalla
  para conservar los formatos impresos existentes.
- `frontend/ui/theme.js`: adapta los tokens CSS a Ant Design.
- `frontend/ui/feedback.jsx`: host React de Notification, Modal y Spin.
  `AllfixUI.notify(texto, tipo)` admite success, error, warning e info.
  `await AllfixUI.confirm(texto)` devuelve booleano; cancelar nunca ejecuta la acción.
  `AllfixUI.loading()` devuelve una función de finalización idempotente.
  Las notificaciones repetidas se agrupan y hay un máximo de tres visibles.
- `frontend/js/formFeedback.js`: `withFormFeedback(handler)` conserva el handler
  asíncrono original, bloquea otro envío del mismo formulario y restaura controles en finally.
- `frontend/js/ui.js`: menú colapsable, atajos que reutilizan controles autorizados,
  aviso offline, nombres accesibles y validación de campos.
- `frontend/js/responsive.js` y `frontend/css/responsive.css`: navegación móvil,
  tablas como tarjetas, foco en diálogos y calendario compacto existentes.

No agregues nuevos `alert()` ni `confirm()` nativos. Para mensajes nuevos pasa el tipo
explícitamente; los avisos heredados tienen clasificación automática por su texto.
Conserva errores propios de un campo junto al control correspondiente.

## Verificación

`npm run build`, `npm test`, `npm run test:browser`.
Las pruebas visuales usan el HTML y renderizadores reales, datos/API simulados y Edge
headless. Cubren las 11 vistas a 1920, 1366, 768, 390 y 360 px, navegación por permisos,
confirmaciones, envíos duplicados, modales móviles y regresiones de la orden rápida.
No sustituyen pruebas con datos de producción, dispositivos físicos o impresora real.
