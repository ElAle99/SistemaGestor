# Retirada de QR y Cotizaciones — 2026-10-14

Antes del cambio había **1 cotización**, sin orden vinculada. No existe una columna
tracking_token en la base conectada. Las referencias con ese nombre en pruebas son
datos sintéticos para comprobar que no se filtren campos privados.

Se retiraron menú, vista, modal, filtros, notificaciones, consultas, conversión a
orden y eventos de calendario de Cotizaciones. El polling compartido se conservó
para inventario. Se eliminó backend/routes/cotizaciones.js y sus servicios exclusivos
de ordenService.js. /api/cotizaciones y /cotizaciones, incluidos subpaths históricos,
responden 410; #cotizaciones no puede abrir una vista retirada. No hay una matriz
persistida independiente de permisos de módulos: la navegación/acciones disponibles
se aplican también a los negocios nuevos, que no reciben el módulo retirado.

**Se conserva cotizaciones y sus datos, índices, secuencia y RLS.** Existen relaciones
a órdenes y negocios, así como una FK desde documento_archivos y un trigger de
normalización de archivos. La limpieza de orden_id al eliminar una orden permanece
para no romper la integridad de un archivo histórico. Una migración posterior deberá
decidir cómo archivar/eliminar la cotización y sus posibles adjuntos antes de retirar
esas relaciones. No se ejecutó una migración destructiva ni se cambiaron políticas.

QR ya no tiene opción de interfaz, datos autorizados de seguimiento, bloques del
comprobante PNG ni renderizado canvas. Se quitaron los estilos exclusivos y la
dependencia qrcode. Preferencias antiguas showQr=true se normalizan siempre a false.
Para respetar la restricción explícita del usuario **TicketBuilder, EscPosEncoder,
PrinterManager y los transportes permanecen sin editar en esta retirada**: las
ramas genéricas QR existentes en builder/codificador quedan inactivas por ausencia
de datos de seguimiento y por la configuración normalizada. El ticket de prueba
tampoco codifica QR. No se agregó seguimiento público ni se modificaron folios o
la consulta interna autenticada por folio.

Los mecanismos y plantillas generales de servicio/equipo/POS permanecen; solo se
retiró el contenido QR en las capas autorizadas y visuales. La comparación completa
con el respaldo inicial confirmó que los valores originales de todas las tablas
siguen intactos, incluida la cotización conservada.
