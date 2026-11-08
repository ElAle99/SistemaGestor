# Publicacion controlada: Android Offline bigint v2

## Estado auditado

Rama local `codex/offline-release-integration`, basada en `sistema-final-99` / `6f3367073cab542529703f02fba0f154899b221c`. El commit `51edf765` integra la extension inicial; el siguiente commit local incorpora bigint v2, validadores y sus pruebas. Para publicar en una base 6f33670 se necesita la rama completa, incluidos AMBOS commits, o un squash equivalente. No aplicar solamente el ultimo commit sobre 6f33670: depende de la extension inicial.

El responsable confirma que GitHub y Render continuan en `ElAle99/SistemaGestor`, rama `sistema-final-99`, commit `6f33670`, con auto-deploy activado. Tambien confirma que la migracion bigint se aplico dos veces en `allfix-staging-offline` y que el validador real finalizo `VALIDACION COMPLETA OK`, incluidas sesiones, permisos, RLS y limpieza. Esta auditoria usa esa evidencia aportada; no vuelve a conectar staging ni produccion ni consulta secretos de Render.

La evidencia y comandos especificos estan en [bigint v2](ANDROID-OFFLINE-BIGINT.md) y [validacion funcional](scripts/ANDROID-STAGING-VALIDATION.md). Los scripts versionados contienen solo codigo y metadatos no secretos del destino staging; solicitan credenciales ocultas en memoria. No se incluyen los archivos privados, bases, backups, logs, bundles ni parches de trabajo locales.

## Comportamiento y feature flag

- Se montan las rutas `/api/android/capabilities`, `/orders`, `/operations`, `/session`, `/refresh`, `/logout`; protocolo 1.
- Solo estan habilitadas si `ANDROID_OFFLINE_ENABLED` vale exactamente `true`. Sin variable, o con otro valor, todas responden 501 antes de consultar las tablas offline. La prueba HTTP del servidor verifica este estado por defecto. El validador solo activa la variable en su propio proceso local y restaura el entorno PowerShell.
- `withAtomicClient` limita el cliente compartido a la transaccion offline. La escritura de negocio y el recibo persistente son atomicos; reintentos por UUID son idempotentes y los conflictos preservan cambios web.
- Se reutilizan recepcion, asignacion de folio, estado y eliminacion existentes. No hay cobros, anticipos, ventas ni aprendizaje de catalogo offline. El borrado exige permisos y ausencia de vinculos financieros.
- Las sesiones refresh usan hash en DB, rotacion, caducidad absoluta y revocacion por familia/session_version. Se conserva el JWT_SECRET actual; no se guarda en APK ni en Git.
- Web, Android, impresion, caja/POS, dependencias y lockfiles permanecen iguales a 6f33670. El arbol original con trabajo local se conserva intacto.

## Render: compatibilidad revisada

El servidor conserva PORT, escucha 0.0.0.0 en produccion, ofrece `/healthz` con SELECT de disponibilidad y drena conexiones ante SIGTERM. `npm start` solo inicia Express: no ejecuta seeds, migraciones ni DDL. Las herramientas de staging no son importadas por el servidor.

Se mantiene Node 22 (`>=22.12.0 <23`); `.node-version` fija 22.23.3. La auditoria local usa 22.23.4, dentro del mismo rango. El build desde la raiz genera los tres bundles actuales y valida sintaxis. Comandos efectivos compatibles con los manifests:

```text
Build: npm ci --include=dev && npm --prefix backend ci --include=dev && npm run build
Start: npm start
Health: /healthz
```

El manifest actual NO define `render:build`, aunque el documento historico RENDER_PRODUCTION.md menciona ese alias. No configurarlo sin crearlo/revisarlo. Antes de publicar, contrastar el Build Command efectivo del servicio con el comando anterior; esta auditoria no modifica la configuracion remota ni los manifests para resolver una discrepancia documental previa. El script existente `railway:build` ejecuta la misma secuencia de build, sin migraciones.

El estado local no certifica un despliegue Linux en Render ni su configuracion privada. Referencias oficiales revisadas: [deploys](https://render.com/docs/deploys), [health checks](https://render.com/docs/health-checks).

## Migracion manual

Version `20261108_android_offline_bigint_v2`. El esquema crea ambas tablas con negocio_id bigint. La actualizacion v1 convierte integer a bigint sin borrar filas, con ACCESS EXCLUSIVE y reconstruccion de la politica original dentro de una unica transaccion; mantiene ENABLE/FORCE RLS, PK, indices y ACL. El CLI valida tipos y funciones antes de aplicar y exige bigint antes de COMMIT. Grants minimos: SELECT/INSERT en recibos; SELECT/INSERT/UPDATE en sesiones; sin DELETE ni grants a PUBLIC. No se crean roles ni se modifican tablas de negocio.

`--check` es de lectura y muestra tipos y bigintReady. `--apply` solo se ejecuta con autorizacion para el destino exacto. Nunca agregarlo a start, build ni pre-deploy. Las credenciales administrativas se inyectan temporalmente, con TLS verificado, y se retiran al terminar; nunca van al runtime de Render.

## Validacion final local

`npm run build`: tres bundles y 87 archivos JavaScript. `npm test`: 191 pruebas, 38 de impresion/compartir y 153 backend, sin fallos ni omisiones. Incluye instalacion limpia, conversion poblada y doble apply en PostgreSQL embebido, preservacion de recibos/sesiones/PK/indices/politicas/ACL, rollback, tenants > int32, CRUD, concurrencia, idempotencia, conflictos, sesiones, permisos y guardas/limpieza del validador. La prueba HTTP adicional verifica que las seis rutas permanecen deshabilitadas con el flag ausente. Se valida tambien sintaxis de las herramientas PowerShell y CJS/MJS.

La suite local usa adaptadores y PostgreSQL embebido; la evidencia funcional real de staging es independiente y fue confirmada por el responsable. No se ejecutaron migraciones remotas ni operaciones de APK durante esta auditoria.

## Pendiente antes de publicar

1. Confirmar nuevamente el SHA remoto y revisar el nuevo commit local junto con 51edf765. Obtener autorizacion explicita para publicar la rama completa: auto-deploy puede desplegar al actualizar sistema-final-99.
2. Repetir el preflight de produccion con v2, verificar destino/TLS, backup y ventana aprobada; aplicar manualmente solo cuando se autorice. El procedimiento local anterior fijado a 51edf765 no sirve para v2. Verificar tipos, politicas, indices y grants despues de aplicar, sin repetir apply en produccion solo como demostracion.
3. Antes de la publicacion que pueda disparar Render, confirmar que el flag de produccion permanece ausente o false y que el Build Command es valido. Conservar DATABASE_URL y JWT_SECRET. Cualquier cambio remoto necesita autorizacion separada.
4. Tras un despliegue autorizado, comprobar health, login, ordenes web, impresion y caja/POS. Verificar CORS para https://localhost sin retirar origenes existentes. No fabricar movimientos financieros en produccion.
5. Autorizar por separado habilitacion offline y pruebas de APK; no tocar datos ni operaciones pendientes de la app instalada durante la preparacion.

Riesgos conocidos: conversion integer a bigint requiere una ventana de locks (5 s de espera, 60 s por sentencia); los IDs siguen sujetos al limite de enteros seguros de JavaScript; el snapshot consulta detalles por orden y debe medirse con volumen grande. La perdida de respuesta de refresh puede requerir login conservando la cola. Ninguno de estos puntos autoriza migracion, publicacion o activacion.

Recuperacion: conservar recibos/sesiones y no rebobinar secuencias. Deshabilitar el flag o volver al SHA anterior solo con autorizacion. Un rollback de codigo no revierte la migracion ni las escrituras web; no restaurar toda la base rutinariamente.
