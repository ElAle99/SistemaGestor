# Despliegue controlado: Android Offline v1

## Integracion local preparada

Repositorio de destino: `ElAle99/SistemaGestor`, rama `sistema-final-99`.
Base: `6f3367073cab542529703f02fba0f154899b221c`, commit publicado en Render segun confirmacion del responsable. Las referencias locales `sistema-final-99` y `sistemagestor/sistema-final-99` coinciden con esa base; no se consulto Render ni se actualizo el remoto.

Fuente: `bf64b7d9a16330a2d06bf86353ad62c62b7a9c7f`, rama `codex/allfix-offline-integration`, descendiente directo de la base. Integracion preparada en `codex/offline-release-integration`, en un worktree separado. Los 11 archivos del parche pertenecen exclusivamente al backend, su migracion, pruebas y documentacion; no hubo conflictos de aplicacion. No se incorporan los scripts locales de credenciales/staging ni archivos no versionados del checkout fuente.

El responsable confirma que el parche supero la validacion completa contra Neon Staging en `allfix-staging-offline`. Esa ejecucion es evidencia aportada por el responsable: esta preparacion no vuelve a conectar staging ni produccion. Los resultados locales de esta rama se registran en el commit de integracion y en la entrega al responsable.

Validacion de esta rama con Node 22.23.4: `npm run build` aprobado (tres bundles y 85 archivos JavaScript); `npm test` aprobado (38 pruebas de impresion/compartir y 138 de backend, 176 en total, sin fallos ni omisiones). Se retiraron las variables de conexion heredadas del proceso de pruebas; el checkout no contiene `.env`. No se ejecutaron migraciones externas ni se contacto la APK. El codigo de los diez archivos restantes coincide exactamente con `bf64b7d`; solo este documento se actualiza respecto de la fuente.

Archivos afectados, todos dentro de `backend/`:

- `ANDROID-OFFLINE-DEPLOY.md`
- `config/tenantContext.js`
- `db/android-offline.sql`
- `db/androidMigration.js`
- `package.json`
- `routes/android.js`
- `scripts/migrate-android-offline.js`
- `server.js`
- `services/androidSyncProtocol.js`
- `tests/android-offline.test.js`
- `tests/android-sync-integration.test.mjs`

Los archivos web, Android, impresion, caja/POS, dependencias y lockfiles permanecen iguales a la rama de destino. El checkout original conserva sus modificaciones locales; no se integra trabajo no confirmado como parte de este parche.

## Alcance del backend

- Rutas `/api/android/capabilities`, `/orders`, `/operations`, `/session`, `/refresh`, `/logout`; protocolo 1. Solo se habilitan cuando `ANDROID_OFFLINE_ENABLED` vale exactamente `true`. No se configura ni activa esa variable en esta integracion.
- Recibo persistente por UUID en la misma transaccion que la escritura, reintentos idempotentes y bloqueo de fila/version para conflictos con ediciones web. Reutiliza `allocate_order_folio` y los servicios existentes de recepcion, estado y eliminacion.
- Edicion offline limitada a campos descriptivos; sin cobros, anticipos, caja, ventas ni aprendizaje de catalogo offline. Borrado sujeto a permisos y vinculos financieros.
- Refresh de tipo separado, hash en DB, rotacion, limite absoluto de 30 dias y revocacion por familia/session_version; acceso de 8 horas con el `JWT_SECRET` existente. Respuestas `Cache-Control: no-store`.
- `withAtomicClient` comparte exclusivamente el cliente de la operacion offline con servicios anidados; las operaciones web conservan el comportamiento anterior fuera de ese contexto.
- El arranque del backend no importa ni ejecuta migraciones.

## Migracion manual, pendiente de autorizacion

`backend/db/android-offline.sql` corresponde a `20261107_android_offline_v1`: dos tablas nuevas (`android_sync_receipts`, `android_refresh_sessions`), ENABLE/FORCE RLS, politicas tenant y dos indices. El CLI aplica grants minimos al rol runtime existente. No altera las tablas de negocio ni sus politicas, no crea roles ni cambia passwords.

Con credenciales inyectadas temporalmente en un entorno administrativo autorizado:

- `MIGRATION_DATABASE_URL`: conexion administrativa directa al destino aprobado.
- `ANDROID_RUNTIME_ROLE`: nombre del login runtime actual, sin SUPERUSER ni BYPASSRLS.
- TLS con verificacion de certificados. Nunca guardar credenciales en Git, APK o logs.

Desde `backend`, solo cuando se autorice expresamente el destino:

```powershell
npm run db:android:check
npm run db:android:apply
```

`check` es de lectura y verifica capacidades existentes y EXECUTE del runtime. `apply` utiliza una transaccion y bloqueo de migracion; un error revierte todo. La repetibilidad ya forma parte de la evidencia previa de pruebas. No ejecutar migraciones antiguas de tenancy/RLS como atajo ni agregar `apply` a build/start/pre-deploy. No basta ejecutar el SQL suelto: faltarian el preflight y los grants del CLI.

## Validacion local reproducible

Usar Node 22 (`>=22.12.0 <23`) y dependencias del lockfile. En un checkout con dependencias instaladas:

```powershell
npm run build
npm test
```

El build genera los tres bundles existentes de catalogo, impresion y compartir, y comprueba sintaxis. `npm test` ejecuta regresiones de impresion/compartir y la suite backend, incluida la integracion HTTP offline. Estas pruebas emplean PGlite o adaptadores aislados; no equivalen por si solas a la validacion real de staging ya confirmada por el responsable. Dejar sin definir `ALLFIX_TEST_POSTGRES_URL` para este recorrido local.

La integracion HTTP cubre idempotencia, perdida de respuesta, rollback, edicion, estados, conflictos, aislamiento, restricciones financieras, borrado y replay, caducidad/rotacion/reutilizacion/logout/revocacion de sesiones. Las pruebas de migracion usan adaptadores aislados; no migran produccion.

## Pasos pendientes antes de publicar y desplegar

1. Revisar el commit y el resultado de pruebas; confirmar nuevamente que el HEAD de `sistema-final-99` no cambio desde `6f33670`. Si cambio, integrar la diferencia y repetir las comprobaciones afectadas.
2. Obtener autorizacion de publicacion. No hacer push/merge mientras un auto-deploy pueda publicar sin aprobacion. Esta preparacion solo crea un commit local; no crea PR ni publica GitHub.
3. Antes de cualquier migracion de produccion, aprobar destino exacto, backup/punto de recuperacion y plan de recuperacion. Ejecutar el CLI manualmente solo tras autorizacion; retirar despues la credencial administrativa. Nunca inyectarla al runtime de Render.
4. Publicar e integrar exclusivamente el commit revisado en la rama vinculada; mantener la extension deshabilitada durante el primer despliegue autorizado. Conservar `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL` y los origenes CORS actuales.
5. Verificar login web, ordenes, impresion y caja/POS. Confirmar `https://localhost` dentro de `ALLOWED_ORIGINS` sin eliminar origenes existentes; cualquier cambio en Render necesita autorizacion separada.
6. Habilitar `ANDROID_OFFLINE_ENABLED` y desplegar solo despues de autorizacion expresa. Verificar capabilities autenticado (200 con protocolo 1 y refresh), anonimo (401 cuando habilitado) y preflight CORS. No imprimir tokens.
7. Las pruebas con APK, datos persistentes y operaciones pendientes son una etapa posterior que requiere autorizacion; esta preparacion no conecta la APK ni toca su cola. Conservar sus datos y resolver conflictos de forma explicita.

Deshabilitada, la extension responde 501; faltas de esquema/servicio 503, sesion invalida 401, permisos 403, conflictos 409 y restricciones funcionales 422.

## Recuperacion y limites

Si hay incidencias, deshabilitar la extension solo con autorizacion y conservar las tablas: eliminarlas destruiria recibos/sesiones y afectaria la idempotencia. No rebobinar secuencias ni restaurar toda la base como respuesta rutinaria: podria perder escrituras web posteriores. Si se revierte el backend, hacerlo al SHA anterior revisado, tambien con autorizacion.

El snapshot consulta detalles por orden; medir su rendimiento con volumen representativo. La perdida de respuesta al rotar refresh puede revocar la familia al reintentar y requerir login; conservar la cola. La revocacion remota no se conoce sin red; no se promete sesion offline indefinida. Bluetooth e intercambio fisico de archivos requieren dispositivo real.
