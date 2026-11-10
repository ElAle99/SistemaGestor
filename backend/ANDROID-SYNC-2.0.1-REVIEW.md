# Allfix Gestor 2.0.1: revisión del parche de sincronización

Validado el 10 de noviembre de 2026, sobre `sistema-final-99`, commit base `a75de1574266f3204528e1990508f92efeba29ea`.

## Comportamiento

Una petición de eliminación puede aplicarse aunque el teléfono pierda la respuesta. El nuevo `POST /api/android/operations/cancel` compite por el mismo bloqueo transaccional de negocio que `/operations` y utiliza el UUID, hash y ámbito negocio/usuario existentes:

- Si ya hay recibo, devuelve exactamente su resultado; no finge deshacer una operación aplicada.
- Si aún no existe, guarda un recibo `cancelled:true`. Los reintentos posteriores de esa operación devuelven ese recibo y no ejecutan la mutación.
- Si se reutiliza el UUID con otro contenido, responde 409.

`GET /api/android/capabilities` conserva `protocol:1` y `refresh:true`, y añade `cancellation:true`. Sigue siendo obligatorio habilitar la extensión mediante su configuración existente; este PR no cambia esa configuración. Las eliminaciones futuras también registran folio y estado en `auditoria_ordenes` dentro de la misma transacción. Si no se puede guardar la auditoría, el borrado se revierte.

## Compatibilidad con las APK y las colas pendientes

No se modifican migraciones, esquema SQLite, JWT, sesiones existentes, UUID, versiones base, hashes ni recibos anteriores. Tampoco se modifica el applicationId, firma ni binario de ninguna APK.

Las pruebas incluyen código extraído de las APK inspeccionadas, sin datos de usuario, SQLite ni credenciales:

| Fixture | Procedencia |
| --- | --- |
| `tests/fixtures/allfix-installed-1.0/offline-model.js` | Modelo de cola de la APK instalada, versionCode 1. |
| `tests/fixtures/allfix-2.0.1/offline-model.js` y `offline.js` | Motor offline de la APK 2.0.1, versionCode 2. |

Los manifiestos guardan los SHA-256 de sus archivos. La APK 2.0.1 tiene SHA-256 `0beeda38a904194b94078594758b01c2109afc80377aba25c732c986202d6bfb`. `.gitattributes` conserva los bytes de los fixtures en Windows y Linux.

Se comprobó el envío de crear, editar, estado y eliminar generados por el modelo instalado, incluidos sus reintentos exactos. Una operación antigua sin versión base sigue recibiendo 409, sin eliminar la orden ni crear un recibo de éxito; el modelo 2.0.1 conserva su eliminación pendiente al cargar y combinar esa cola. El parche no repara ni descarta automáticamente los conflictos históricos.

La APK 1.0 no invoca la ruta nueva. La APK 2.0.1 la utiliza después de comprobar la capacidad anunciada. Los recibos de cancelación corresponden a operaciones canceladas explícitamente por el cliente nuevo; no debe forzarse un downgrade de la APK tras utilizarlos.

## Pruebas aprobadas

Entorno: Node `22.23.4`; dependencias instaladas con los lockfiles de esta rama. Se generaron primero los tres bundles del frontend, necesarios para la prueba HTTP existente.

- Suite completa: **194 pruebas aprobadas**, 0 fallos: 38 de impresión/compartir y 156 del backend.
- Compilación de catálogo, impresora y compartir aprobada; comprobación sintáctica de 92 archivos JavaScript aprobada.
- Pruebas específicas de cancelación, auditoría/rollback, compatibilidad de ambas APK y extensión deshabilitada por defecto aprobadas después de los ajustes finales del validador.
- Integración con el backend de esta rama, iniciado exclusivamente en loopback, contra Neon **allfix-staging-offline**, rama `br-dawn-heart-bd3sqd27`, base `allfix_db`: **VALIDACION COMPLETA OK**.

La integración de Staging comprobó TLS/hostname, migración bigint v2 y rol runtime restringido antes de crear fixtures. Cubrió:

1. Creación, edición, cambio de estado, concurrencia e idempotencia.
2. Cliente 2.0.1 real: guardar sin red, reabrir, reconectar y perder una respuesta después del commit sin duplicar.
3. Conflicto, comparación de versiones del modelo, reaplicación explícita y borrador conservado.
4. Cancelar una eliminación pendiente y reconocer una eliminación ya aplicada sin inventar una restauración.
5. Cola generada por la APK instalada 1.0 y replay de sus cuatro tipos de operación.
6. Renovación, rotación, reutilización, logout y revocación de sesión; aislamiento HTTP/RLS entre negocios.
7. Carrera simultánea entre aplicar y cancelar, con un único resultado definitivo y replay sin nuevas mutaciones.
8. Limpieza verificada: cero negocios restantes del marcador `offline-test-ac24073948ebc2e0`.

Solo se crearon y eliminaron fixtures sintéticos en dos negocios exclusivos de Staging. No se ejecutaron migraciones ni consultas de escritura contra producción. No se usaron tokens del teléfono; las sesiones del ensayo utilizaron una clave JWT efímera.

Para repetir localmente: generar los bundles con `npm run build:catalog`, ejecutar `npm test` y `npm --prefix backend run build`, usando Node 22. El validador adicional se ejecuta con `node backend/scripts/validate-android-sync-staging.cjs`: recibe por stdin una línea JSON con `branchId`, `branchName`, `production:false`, `runtime` y `owner`. Las dos conexiones deben ser DIRECTAS al host fijado de Staging; se pasan mediante entrada protegida, nunca como argumentos ni en archivos versionados. El validador reutiliza las comprobaciones de host/base/TLS/bigint existentes y rechaza otros destinos antes de crear fixtures. No requiere la APK ni archivos Android externos al PR.

## Riesgos y pasos pendientes

- La instalación física sobre el teléfono y la apertura de su SQLite/Keystore siguen pendientes; las pruebas de motor y protocolo no sustituyen esa comprobación. Este PR no instala APKs.
- Al actualizar el cliente, una cola antes bloqueada podría avanzar y aplicar eliminaciones que sean válidas. Revisar las eliminaciones y conflictos pendientes antes de reconectar o pulsar reintento global. Las órdenes reales investigadas anteriormente no se tocaron en este ensayo.
- La causa histórica exacta de la desaparición de AFB-2026-10004 sigue sin poder atribuirse con la auditoría disponible. El nuevo registro de eliminación mejora la trazabilidad futura, sin restaurar ni modificar esa orden.
- No se añadieron dependencias ni se cambiaron lockfiles. `npm ci` informó vulnerabilidades moderadas preexistentes; su actualización queda fuera de este parche.
- Render mantiene auto-deploy para `sistema-final-99`; las previews de PR están desactivadas. Crear esta rama y su PR no publica el cambio. Un merge futuro puede activar el despliegue y requiere autorización aparte.

No se hizo merge, deploy, push a `sistema-final-99`, modificación de Neon Producción ni instalación en el teléfono.
