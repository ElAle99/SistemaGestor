# Android Offline bigint v2

Version de migracion: `20261108_android_offline_bigint_v2`. Ambas tablas nuevas definen `negocio_id bigint`, igual que `ordenes_servicio` y `app_tenant_id()`. No se modifica esa funcion de negocio ni `allocate_order_folio(integer)` (su argumento es el ano). Se mantiene el contrato existente de identidades como enteros seguros de JavaScript: la correccion permite tenants superiores a int32, sin convertir IDs imprecisos silenciosamente. El bloqueo de sincronizacion recibe el tenant como cadena decimal.

## Actualizacion sin perdida de datos

El CLI ejecuta el esquema y `db/android-offline-bigint.sql` dentro de una transaccion con bloqueo asesor. La conversion integer a bigint valida la politica original, toma ACCESS EXCLUSIVE y retira/recrea solo esa politica dentro de la transaccion: PostgreSQL no permite ALTER TYPE mientras exista esa dependencia. Mantiene ENABLE/FORCE RLS, filas, PK, indices y ACL. Una politica imprevista, tipo incompatible o error provoca rollback de ambas tablas, incluida cualquier conversion parcial.

Es repetible: si ya son bigint no convierte de nuevo; conserva los grants minimos SELECT/INSERT en recibos y SELECT/INSERT/UPDATE en sesiones y revoca PUBLIC. `--check` informa `tenantTypes` y `bigintReady`; acepta integer como actualizacion pendiente. Apply exige bigint en ambas tablas antes de COMMIT. No transforma tablas ni filas de negocio existentes.

La espera maxima de locks es 5 s y cada sentencia tiene 60 s. Reservar una ventana, revisar volumen/espacio y disponer de recuperacion: ALTER TYPE puede reescribir tablas e indices. Si hay timeout, revisar bloqueos y no desactivar RLS ni ampliar permisos para continuar.

## Verificacion local

Auditoria final con Node 22.23.4: 191 pruebas aprobadas (38 impresion/compartir y 153 backend). Nuevas pruebas: instalacion limpia, conversion poblada, doble ejecucion, preservacion exacta de recibos/sesiones/indices/PK/politicas/ACL, rollback total ante politica inesperada y tenants 3000000001/3000000002 con RLS y permisos minimos. La integracion HTTP ahora usa bigint y tenants superiores a int32 para CRUD, idempotencia, conflictos y renovacion.

TLS directo a `ep-blue-lab-bdnti3ov.c-8.us-east-2.aws.neon.tech`: TLS 1.3, cadena CA y hostname verificados mediante PostgreSQL SSLRequest. No se enviaron credenciales ni SQL durante ese handshake; no sustituye probar el login del CLI con su credencial administrativa.

El responsable confirma que la migracion se aplico dos veces en `allfix-staging-offline`, las tres columnas son bigint y la validacion funcional termino `VALIDACION COMPLETA OK`, con limpieza verificada. Esta auditoria no repite migraciones ni consultas a produccion. Los pasos siguientes quedan como procedimiento reproducible, no como validaciones todavia pendientes de staging.

Archivos modificados o nuevos, bajo `backend/`:

- `db/android-offline.sql`, `db/android-offline-bigint.sql`, `db/androidMigration.js`.
- `routes/android.js`.
- `tests/android-migration-bigint.test.js`, `tests/android-sync-integration.test.mjs`.
- `scripts/check-staging-tls.cjs`, `scripts/update-android-staging-bigint.ps1`.
- `ANDROID-OFFLINE-DEPLOY.md`, `ANDROID-OFFLINE-BIGINT.md`.

## Procedimiento de staging

Desde la raiz de `codex/offline-release-integration`, con Node 22 en PATH:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\backend\scripts\update-android-staging-bigint.ps1 -Mode Check
```

El script solicita la API key y URL administrativa directa mediante entradas ocultas. Verifica por API el proyecto, rama exacta `allfix-staging-offline` y endpoint `ep-blue-lab-bdnti3ov`, despues host y base `allfix_db`. Rechaza production, pooler, `.env` y TLS sin verificacion. Usa el CLI existente, restaura variables y no guarda ni imprime secretos.

Para ejecutar la actualizacion de staging preparada, durante la ventana elegida:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\backend\scripts\update-android-staging-bigint.ps1 -Mode Apply
```

1. Registrar un punto de recuperacion y evidencia previa de las filas/politicas/grants, sin exportar tokens. No basta comparar conteos.
2. Confirmar `bigintReady: true`, bigint en ambas columnas, ENABLE/FORCE RLS, politicas tenant, PK, indices y grants minimos.
3. Comparar recibos UUID/hash/resultado y sesiones hash/familia/estado/caducidad antes/despues, incluidos timestamps. Repetir Apply en staging y comprobar que no cambian filas ni protecciones.
4. Ejecutar `backend/scripts/validate-android-staging.ps1`, ya adaptado a ESTE backend corregido. Ver [instrucciones del validador](scripts/ANDROID-STAGING-VALIDATION.md). Comprueba CRUD, replay, conflictos, rotacion/revocacion, permisos y RLS con dos tenants temporales >2147483647. No conecta APK ni pendientes y no ejecuta migraciones.
5. Registrar evidencia y repetir el preflight de produccion del parche actualizado. El procedimiento anterior de produccion fijado a 51edf765 queda obsoleto para v2. No se autoriza aqui aplicar en produccion, publicar GitHub, desplegar Render ni activar offline.
