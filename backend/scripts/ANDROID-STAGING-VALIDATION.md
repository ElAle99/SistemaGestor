# Validacion funcional real de staging con bigint

Desde la raiz del repositorio, en PowerShell con Node 22 en PATH:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\backend\scripts\validate-android-staging.ps1
```

Solicita tres entradas ocultas: API key de Neon, URL PostgreSQL DIRECTA runtime (`sistema_gestor_app`) y URL PostgreSQL DIRECTA administrativa (`allfix_db_owner`). Ambas URLs deben apuntar a `allfix_db` en `ep-blue-lab-bdnti3ov.c-8.us-east-2.aws.neon.tech`, con `sslmode=require` o `verify-full`. No usar pooler. Los secretos permanecen en memoria; no guardarlos como argumentos, en archivos ni en el chat. Las variables de PowerShell se restauran al terminar.

Antes de escribir, consulta por HTTPS el proyecto fijado `green-mouse-83526553`, rama ID `br-dawn-heart-bd3sqd27`/nombre `allfix-staging-offline` y endpoint ID `ep-blue-lab-bdnti3ov`. Rechaza production, otra base, roles incorrectos, rama predeterminada/protegida, endpoint deshabilitado o tipo distinto de read-write. Comprueba TLS real en ambas conexiones autenticadas: cifrado, certificado autorizado y hostname exacto. No confunde esta comprobacion con `pg_stat_ssl` del salto interno de Neon.

Usa exclusivamente los modulos de `codex/offline-release-integration`, comprueba sus rutas reales, version `20261108_android_offline_bigint_v2` y el bloqueo tenant corregido. Exige bigint en ordenes y ambas tablas offline, `app_tenant_id()` bigint, ENABLE/FORCE RLS, politicas tenant originales, grants minimos y runtime sin privilegios elevados. Imprime una huella del router local para identificar la fuente probada; no carga `.env` ni ejecuta migraciones.

Inicia el servidor real y sus servicios en un puerto aleatorio de `127.0.0.1`, con clave JWT efimera exclusiva. Solo habilita offline en ese proceso local. Crea dos tenants de prueba con IDs aleatorios >2147483647, reservados sin colision y sin cambiar la secuencia de negocios; usuarios, clientes y ordenes son nuevos. Prueba creacion, edicion, estado, snapshot de sincronizacion, tres reintentos concurrentes idempotentes, UUID reutilizado con otro contenido, conflicto por version obsoleta y acceso ajeno, permisos de tecnico/admin, rechazo de pagos offline y acceso anonimo, renovacion/rotacion/reuso/logout/revocacion, RLS bidireccional con datos en ambos tenants, borrado y replay de borrado.

La limpieza corre en finally, tambien ante errores y señales SIGINT/SIGTERM manejables. Cierra primero el servidor y drena el pool runtime para impedir escrituras tardias; despues valida IDs/nombres/marcador, elimina solo filas de esos tenants en una transaccion administrativa y comprueba ausencia de residuos antes de COMMIT. Reintenta hasta tres veces ante errores transitorios; ante identidad inesperada revierte sin ampliar el alcance. El resultado solo es `VALIDACION COMPLETA OK` si pruebas y limpieza quedaron verificadas. Si la limpieza no se confirma, informa fallo y conserva en pantalla el marcador `offline-test-...` para recuperacion segura.

Un cierre forzado, apagado o perdida prolongada de la base puede impedir cualquier finally: no matar el proceso ni cerrar la terminal durante la prueba. No es posible garantizar limpieza remota en esas condiciones. Las secuencias de usuarios/clientes/ordenes y el contador compartido de folios pueden avanzar al probar servicios reales; no se rebobinan, para evitar afectar actividad concurrente. No se modifican filas de negocios preexistentes, pagos reales, APK o su cola.

Verificacion de preparacion: sintaxis PowerShell/Node y once pruebas locales del validador (guardas de destino/TLS/bigint, compatibilidad de roles, diagnosticos seguros y limpieza transaccional). Junto con cuatro pruebas del protocolo/migracion y una integracion HTTP aislada: 16 pruebas aprobadas. No se repitio la suite completa ni se ejecutaron fixtures remotos durante esta correccion.

## Correccion del fallo de la fase permisos

La consulta de solo lectura al catalogo de staging confirmo que `usuarios_rol_check` admite el literal heredado de tecnico con dos caracteres Unicode U+00C3/U+00A9 en lugar de U+00E9. El primer UPDATE del test usaba la forma canonica U+00E9; la restriccion lo rechaza con SQLSTATE 23514, antes de enviar las peticiones HTTP de permisos. Una prueba PostgreSQL embebida reproduce ese rechazo exacto. No es un error por falta de UPDATE/DELETE sobre recibos o sesiones.

El validador consulta esa restriccion antes de crear fixtures y elige exclusivamente una de dos representaciones conocidas: canonica preferida o heredada si es la que admite el esquema. El valor se pasa como parametro y se aplica solamente al usuario temporal; no cambia la restriccion ni normaliza usuarios existentes. Las dos formas siguen siendo roles sin permiso para crear/eliminar ordenes segun el protocolo actual. Cualquier otra representacion detiene la ejecucion. La restauracion del rol administrador del fixture corre en finally; la limpieza de tenants sigue intacta.

Los seis pasos de permisos tienen diagnosticos individuales: asignar tecnico, impedir creacion, impedir eliminacion, restaurar administrador, rechazar anticipos y rechazar acceso anonimo. Solo se muestran nombres fijos, HTTP/filas numericos y causas SQL predefinidas. Ejemplo:

```text
FAIL comprobacion: permisos.asignar-tecnico | esperado: filas 1 | obtenido: SQLSTATE 23514 (restriccion CHECK)
FAIL comprobacion: permisos.tecnico-no-crea | esperado: HTTP 403 | obtenido: 401
```

No se imprimen errores originales, cuerpos HTTP, filas rechazadas, parametros SQL, tokens, URLs ni datos de clientes. No se necesitan grants adicionales; conservar recibos con SELECT/INSERT y sesiones con SELECT/INSERT/UPDATE, sin DELETE y con ENABLE/FORCE RLS.

El responsable confirma que la validacion real completa corregida finalizo `VALIDACION COMPLETA OK`: sincronizacion, permisos, autenticacion, sesiones, RLS y limpieza aprobados. Esta auditoria final no vuelve a crear fixtures remotos. El comando anterior se conserva para reproduccion autorizada.
