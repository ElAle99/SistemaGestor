# Consulta individual de versión Android 2.0.3

Base: `sistema-final-99`, commit `6cd69e9bb684c8475c3bf02d8c2c9506d47737a7`.

Una instalación limpia recibe primero `/api/ordenes`, que no contiene la versión canónica. La APK 2.0.2 intenta obtenerla de `/api/android/orders`: este endpoint consulta secuencialmente los detalles de todas las órdenes. En una medición de solo lectura sobre Neon Staging, con 45 órdenes, la lista heredada tardó 1.653 ms y el snapshot Android 84.991 ms. El timeout del cliente era 30.000 ms. El cliente atrapaba el fallo y continuaba creando una eliminación con `baseVersion:null`; después la clasificaba como conflicto. Una instalación limpia reproduce el problema sin corrupción de SQLite ni relaciones financieras.

Este parche añade `orderLookup:true` a las capacidades del protocolo 1 y `GET /api/android/orders/:id`, autenticado, limitado al negocio por el servicio/RLS existente y con `Cache-Control:no-store`. Devuelve `{order,version}` con el mismo DTO y función canónica que usa la comprobación de concurrencia de `/operations`. Una orden ausente o de otro negocio devuelve HTTP 404 y código `ANDROID_ORDER_NOT_FOUND`; un identificador inválido devuelve 400. No modifica órdenes, colas, migraciones, sesiones, UUID, hashes ni recibos. Los clientes anteriores siguen usando los endpoints existentes.

La APK 2.0.3 obtiene esta versión antes de confirmar y registrar una eliminación online. Valida el DTO, normaliza el identificador y el negocio para SQLite/UI, y conserva la versión opaca recibida sin recalcularla. Un error de consulta no crea una operación inválida. Tras la confirmación del usuario persiste el UUID/baseVersion antes del envío, espera la respuesta HTTP y solo entonces retira la orden y actualiza las vistas. Un cambio posterior a la consulta sigue produciendo un 409 real. Los reintentos conservan el mismo UUID y contenido. Las operaciones heredadas sin versión requieren revisión explícita; no se rebajan automáticamente.

Sin `orderLookup:true`, la nueva APK conserva compatibilidad con el backend publicado: comparte el snapshot en curso y permite hasta 120 segundos para obtener una versión válida. Esta compatibilidad evita el conflicto artificial, pero no elimina la lentitud inicial del endpoint completo. Para usar la ruta rápida hace falta publicar este parche después de su revisión y autorización; no se ha desplegado.

## Validación

- Node 22.23.4; lockfiles sin cambios. 156 pruebas backend y 38 de impresión/compartir aprobadas; tres bundles y revisión sintáctica de 92 archivos aprobados.
- Regresión HTTP: capacidad anunciada, versión individual idéntica a la de `/operations`, `no-store`, aislamiento de otro negocio, identificadores inválidos y consulta individual independiente de fallos de la lista completa.
- Cliente Android: 69 pruebas aprobadas, incluyendo instalación limpia, IDs recibidos como cadenas, DTO inválido/ajeno, errores 401/403/404/500/503, conservación de la versión revisada, CAS, UUID idempotente y fallback de protocolo 1 con snapshot compartido y timeout de 120 segundos.
- Interfaz real generada: almacenamiento vacío, snapshot completo retenido, eliminaciones desde lista y detalle sin esperar ese snapshot, indicador hasta confirmación HTTP, estadísticas inmediatas, prevención de resurrección por respuesta antigua y persistencia al recargar. Comparación de conflictos y UI Administrador/Técnico de 320–1280 px aprobadas con fixtures locales.
- Consulta individual de solo lectura de la orden copiada a Staging: HTTP 200, 2.356 ms, 4.984 bytes, versión de 64 caracteres. El DTO real convertido conserva `id:number`, `negocio_id:string` y la versión exacta. No se exportan datos personales.
- El validador `android/scripts/validate-online-staging.cjs`, del proyecto Android de trabajo, permite `ALLFIX_TEST_BACKEND_DIR` para usar esta rama. Rechaza destinos distintos de Staging y recibe conexiones por stdin protegido; crea exclusivamente fixtures sintéticos en negocios propios y verifica su limpieza.
- Ejecución completa contra Neon Staging: **VALIDACION COMPLETA OK**, fixtures `offline-test-fb06c19db7084855`, limpieza verificada. Incluyó instalación limpia/DTO real, lookup 503, eliminación online/offline, reinicio/reconexión, replay tras respuesta perdida, cola antigua, conflictos/versiones, HTTP 500, sesiones, RLS y carrera aplicar/cancelar. Dos ejecuciones anteriores detectaron defectos de aislamiento/expectativas del validador, se limpiaron y no se contaron como aprobadas.

## Límites y publicación

No se ha hecho merge, deploy ni escritura en Neon Producción. Render sigue en `sistema-final-99`, con auto-deploy habilitado y previews desactivadas: un merge puede desplegar y requiere autorización independiente. No se ha probado físicamente una actualización en el teléfono en esta intervención; la APK nueva sí coincide en firma/applicationId con la APK 2.0.2 de referencia, incrementa versionCode y conserva todos los DEX nativos.

La medición es de Staging y no garantiza una latencia idéntica de Render/Producción. El snapshot completo sigue siendo costoso; este parche elimina su dependencia para la eliminación online, sin cambiar su contrato ni intentar una optimización masiva de consultas. Una pérdida de respuesta después del commit mantiene la operación pendiente hasta recibir su recibo idempotente.
