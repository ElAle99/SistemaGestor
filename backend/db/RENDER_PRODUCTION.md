# Render: despliegue web y decisión obligatoria de PostgreSQL

## Estado y compatibilidad

El build web está preparado para Node 22 (`>=22.12.0 <23`). **No se declara listo un despliegue con Render Managed PostgreSQL sin verificar sus permisos reales:** la arquitectura auditada actual requiere un administrador SUPERUSER o BYPASSRLS + CREATEROLE como propietario de las capacidades `SECURITY DEFINER` que consultan tablas con FORCE RLS (por ejemplo `auth_login`, `auth_user_by_id`, `public_logo` y los triggers de identidades). Sin ese bypass del propietario administrativo, esas funciones quedan sujetas a las políticas y la autenticación sin contexto tenant no funciona. El runtime nunca necesita ni debe tener ese privilegio.

Render documenta que no ofrece acceso superusuario a su PostgreSQL administrado. Esto por sí solo no demuestra incompatibilidad: un propietario administrativo con BYPASSRLS también puede atravesar FORCE RLS. La documentación consultada no garantiza que la credencial entregada disponga de BYPASSRLS + CREATEROLE. Sí documenta usuarios SQL no gestionados y soporte de `pgcrypto`. PostgreSQL soporta RLS/FORCE, políticas y claves compuestas; esto no demuestra que la credencial administrada tenga los permisos para ejecutar esta arquitectura. El preflight rechaza una conexión sin SUPERUSER ni BYPASSRLS + CREATEROLE antes de escribir datos. Un resultado favorable solo comprueba esos atributos: no sustituye la migración, la verificación de propietarios/permisos ni la auditoría A/B. No se han ejecutado comandos contra una cuenta Render real; su compatibilidad completa queda sin certificar.

No utilizar el panel “New default credential” para crear el runtime: es rotación de credenciales administradas, no una garantía de permisos mínimos. No desactivar FORCE RLS, no añadir políticas globales y no asignar BYPASSRLS al runtime. Si faltan los permisos administrativos requeridos, una adaptación a PostgreSQL administrado requeriría un rediseño explícito de propietarios/capacidades y una nueva auditoría; queda fuera de este cambio.

Alternativa compatible conservando las políticas: alojar el Web Service en Render y conectar PostgreSQL que permita administración con los atributos y propiedad requeridos, separada del runtime (por ejemplo una instancia existente compatible, o PostgreSQL autogestionado en un Private Service con disco persistente). Esto exige administrar backups, restauraciones, actualizaciones y disponibilidad. No se ha creado ni migrado infraestructura automáticamente.

Fuentes oficiales consultadas:

- https://render.com/docs/postgresql-pg-repack (sin acceso superusuario)
- https://render.com/docs/postgresql-credentials (usuarios SQL y credenciales administradas)
- https://render.com/docs/postgresql-extensions (`pgcrypto`)
- https://render.com/docs/postgresql-creating-connecting (URL interna y externa)
- https://render.com/docs/node-version
- https://render.com/docs/disks
- https://render.com/docs/web-services

## Build y Web Service

1. Conectar el repositorio GitHub y seleccionar la rama deseada. Runtime **Node**, Root Directory vacío (raíz del repositorio), misma región que PostgreSQL. No seleccionar `backend` como raíz.
2. Build Command: `npm run render:build`. Ejecuta `npm ci --include=dev`, `npm --prefix backend ci --include=dev` y `npm run build`. Ambos lockfiles están versionados. No hace falta otro `npm install`, ni instalación global de Vite. No configurar `ignore-scripts`: bcrypt necesita su instalación nativa/precompilada.
3. Start Command: `npm start`. Solo inicia Node/Express, sin DDL, seeds ni migraciones. Health Check Path: `/healthz`. El servidor escucha `0.0.0.0` y el `PORT` asignado por Render (5000 solo fallback).
4. Configurar las variables siguientes antes de iniciar y preparar PostgreSQL por separado. No habilitar migraciones automáticas en Pre-Deploy ni encadenarlas a Start.
5. Express sirve `frontend/index.html`, fuentes estáticas y `frontend/dist` desde paths absolutos calculados con `__dirname`; Vite genera `order-catalog.js`, `order-catalog.css`, `printer-service.js` y `share-ticket.js`. `base href="/"` mantiene assets desde la raíz también en rutas SPA profundas. `/vendor` utiliza las dependencias instaladas en backend. No subir `node_modules` ni `dist` a Git.

## Variables (valores secretos solo en el gestor de secretos)

Web Service:

| Variable | Valor |
| --- | --- |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22.23.3` (versión probada y fijada en `.node-version`); engines limita `<23` |
| `JWT_SECRET` | secreto aleatorio independiente, persistente entre deploys |
| `DATABASE_URL` | `postgresql://sistema_gestor_app:<password-url-encoded>@<host-interno>:5432/<base>` |
| `FRONTEND_URL` | `https://<servicio>.onrender.com` (o dominio personalizado) |
| `PUBLIC_APP_URL` | el mismo origen HTTPS, usado en enlaces de recuperación |
| `ALLOWED_ORIGINS` | opcional, orígenes HTTPS adicionales exactos separados por comas |
| `CORS_CREDENTIALS` | `false` para el despliegue mismo origen; `true` solo si hay necesidad explícita y orígenes exactos |
| `DB_SSL` | según endpoint/proveedor, no copiar valores sin comprobar TLS |
| `DB_SSL_REJECT_UNAUTHORIZED` | `true` al usar TLS con CA verificable |

No configurar `MIGRATION_DATABASE_URL`, `ADMIN_PASSWORD`, `APP_DB_PASSWORD` ni credenciales administrativas en el Web Service. Quitar antiguos `DB_USER=postgres`, passwords locales y referencias automáticas a la URL administrativa. Si la URL del panel contiene el dueño administrativo, **no copiarla como DATABASE_URL**: sustituir usuario y password por los del runtime manteniendo host/puerto/base. No registrar URLs completas en logs.

Solo entorno administrativo temporal (equipo autorizado con acceso a la base o job privado separado):

- `NODE_ENV=production` (evita que el script reescriba `.env` local).
- `MIGRATION_DATABASE_URL=postgresql://<administrador>:<password>@<host>:5432/<base>`.
- `DATABASE_URL` con el futuro login `sistema_gestor_app` y su password. Se configura antes de que exista el rol; el script conecta exclusivamente con la URL administrativa.
- Para bootstrap únicamente: `CONFIRM_EMPTY_DATABASE=yes`, `INITIAL_BUSINESS_NAME`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (mínimo 16 caracteres), `ADMIN_NAME`. Valores propios del negocio, nunca datos de Allfix por defecto.
- El script obtiene la contraseña del runtime desde `DATABASE_URL`; **APP_DB_PASSWORD no es una variable leída por Node**. Puede usarse como secreto auxiliar del proveedor para componer esa URL, pero no es obligatoria.
- Mismas variables TLS que correspondan al endpoint administrativo. SMTP es opcional salvo que se utilice recuperación por correo: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

Generar cada secreto por separado en una terminal privada y guardarlo en el gestor de contraseñas, sin capturarlo en logs compartidos:

```sh
node -e "console.log(require('node:crypto').randomBytes(36).toString('base64url'))"
```

El password base64url evita problemas de codificación al formar la URL. No usar una misma clave para JWT, administrador y runtime. Mantener JWT estable para no invalidar sesiones en cada deploy.

## De una base vacía al arranque

### Si se evalúa Render Managed PostgreSQL

Crear PostgreSQL desde New > Postgres, en la misma región, con un plan y backups adecuados. Restringir acceso externo. Copiar su URL administrativa **solo** al entorno de administración como `MIGRATION_DATABASE_URL`; usar URL interna desde jobs en la misma región/red, externa con TLS desde el equipo autorizado. Instalar los dos contextos con el build anterior y ejecutar:

```sh
npm run db:preflight
```

Consultar además `SELECT current_user, session_user, rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname=current_user`. Si no tiene SUPERUSER ni BYPASSRLS + CREATEROLE, el preflight falla: detenerse, sin bootstrap ni aprobación del servicio. Crear roles vía panel no resuelve por sí mismo el propietario de las funciones FORCE RLS. Si pasa, comprobar propiedad/grants del esquema y ejecutar bootstrap, validación runtime y auditoría A/B en esa instancia antes de considerar soportada la arquitectura. Si Render no entrega esos atributos, elegir PostgreSQL compatible o autorizar un rediseño con nueva auditoría. No se presupone que una cuenta administrada pueda otorgarse BYPASSRLS.

### Alternativa verificable: PostgreSQL compatible, con superusuario solo administrativo

Si se autogestiona dentro de Render: crear un Private Service Docker con una versión PostgreSQL fijada compatible con la versión origen (evitar downgrade), disco persistente en el PGDATA de la imagen oficial y variables `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` como secretos. Por ejemplo, PostgreSQL 16 oficial usa `/var/lib/postgresql/data`; comprobar la versión elegida antes de montar. No publicar un Web Service HTTP para PostgreSQL. Usar el hostname privado de ese servicio y puerto 5432, sin endpoints SQL públicos innecesarios. El rol de inicialización será administrativo; nunca suministrarlo al servidor web. Configurar backups externos y probar una restauración antes de producción. El TLS de una red privada y el cifrado de la conexión deben evaluarse explícitamente; no simular TLS desactivando la validación de certificados.

Con el entorno administrativo configurado y desde raíz:

```sh
npm run db:preflight
npm run db:bootstrap
```

`db:bootstrap` ejecuta primero el CLI que exige una base pública sin tablas, reutiliza `initLegacySchema` y la migración existente de garantías, crea el catálogo base y un administrador inicial, y después ejecuta el mismo `migrate:security`. No utiliza `schema_all_tables.sql` (contiene limpieza histórica y un nombre fijo). No ejecutarlo en una base con datos. La creación inicial reutiliza DDL legado, no es una única transacción global: si falla, detenerse e inspeccionar esa nueva base; no reintentar sobre producción ni borrar tablas automáticamente. No arrancar backend hasta terminar todas las migraciones y verificaciones.

El CLI de seguridad conserva el backup previo, verifica órdenes/ventas/configuración y aplica las migraciones existentes v1-v8. Mantener ese backup fuera del contenedor efímero; complementarlo con un backup nativo PostgreSQL restaurable, roles/propietarios y copia de archivos. Mantener las credenciales administrativas fuera del proceso web.

Para una base existente: primero backup nativo restaurable y archivos, parar escritores y ejecutar **solo**:

```sh
npm run db:preflight
npm --prefix backend run migrate:security
```

No ejecutar bootstrap, no copiar Allfix para crear otro negocio, no restaurar dumps de producción sobre la base equivocada. Una migración de la instancia local debe preservar propietarios de capacidades; importar sin propietarios requiere reconstrucción administrativa explícita y verificación, no un restore ciego con runtime.

## Verificación obligatoria antes de activar tráfico

En un proceso separado con **solo DATABASE_URL runtime**, cargar la configuración e iniciar la misma validación del servidor:

```sh
node -e "const {pool,initDB}=require('./backend/config/db');initDB().then(()=>pool.query('SELECT current_user,session_user')).then(r=>console.log(r.rows)).catch(()=>{console.error('Validacion runtime fallida');process.exitCode=1}).finally(()=>pool.end())"
```

Ambos usuarios deben ser `sistema_gestor_app`. La validación también rechaza ancestros privilegiados, propietarios y versiones de migración faltantes. Conectar usando exactamente esa URL en un cliente SQL y comprobar en sentencias separadas:

```sql
SELECT current_user,session_user;
SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb
FROM pg_roles WHERE rolname IN ('sistema_gestor_app','sistema_gestor_tenant');
SELECT parent.rolname FROM pg_auth_members m
JOIN pg_roles parent ON parent.oid=m.roleid
JOIN pg_roles child ON child.oid=m.member WHERE child.rolname='sistema_gestor_app';
RESET ROLE;
SELECT current_user,session_user;
SET ROLE postgres; -- debe fallar; también probar el nombre real del administrador
```

No ejecutar estas pruebas dentro de una misma transacción abortada. RESET ROLE nunca debe elevar privilegios. La única membresía del app debe ser el rol tenant no LOGIN. Desde el administrador verificar:

```sql
SELECT c.relname,pg_get_userbyid(c.relowner) owner,c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
ORDER BY c.relname;
```

Deben mantenerse las 36 tablas protegidas con ambas banderas y sin dueño runtime. Verificar también los propietarios de las funciones SECURITY DEFINER. Ejecutar la auditoría A/B existente en un entorno de staging administrado, con el servidor iniciado y URLs runtime/admin separadas: `node backend/scripts/audit-tenant-live.js` (`AUDIT_SERVER_URL=https://<staging>`). Crea y elimina fixtures; no ejecutarla contra producción sin una ventana y respaldo. Debe conservar 168/168; no sustituirla por una conexión de prueba artificial. Probar login, creación de orden, POS/cobro, archivos privados y logs antes de aceptar tráfico.

## Disco, HTTPS y siguientes versiones

- Logos, evidencias, fotos de inventario/garantía y adjuntos usan `backend/uploads`. En Render el filesystem común es efímero. Para conservarlos sin modificar rutas ni autorización, un Web Service de pago puede montar un disco en `/opt/render/project/src/backend/uploads` (Root Directory del servicio vacío como arriba). Copiar los archivos actuales con nombres originales y verificar sus registros por tenant antes de abrir tráfico. No montar todo backend ni node_modules. No hay migración de archivos automática.
- Backups JSON en `backend/db/backups` también son efímeros: extraerlos a almacenamiento privado duradero. Los temporales del servicio de impresión antiguo no son almacenamiento de evidencias. La impresión QZ actual sigue ejecutándose en el equipo del negocio.
- Disco persistente implica restricciones de escalado/despliegue; no está disponible durante build/pre-deploy. Como evolución podría usarse almacenamiento de objetos privado con URLs autorizadas, pero no se implementa sin autorización. `/uploads` permanece detrás de la ruta de autorización existente; nunca añadir `express.static` para esa carpeta.
- Render termina HTTPS; usar el mismo origen HTTPS para API y frontend. Cookies privadas siguen HttpOnly, Secure en producción y SameSite Strict; JWT sigue el flujo actual. CORS usa `FRONTEND_URL`/`ALLOWED_ORIGINS` exactos, sin wildcard con credenciales, y localhost solo en desarrollo. Para dominio personalizado actualizar ambos orígenes y enlaces públicos.
- No se cambia QZ Tray: comprobar en un equipo real con QZ instalado que la página HTTPS conecta al websocket seguro local, con certificado/confianza QZ y autorizaciones existentes. Render no puede acceder al USB del cliente. Una prueba automatizada de navegador no certifica impresión física ni la confianza del certificado local. Probar cliente, etiqueta, venta, PNG/compartir/descargar antes de operar.
- Nuevas versiones: backup si hay migraciones, ejecutar CLI administrativo manual separado si corresponde, verificar rol/RLS, desplegar el build y el start anteriores, comprobar `/healthz`, login y assets. No sustituir DATABASE_URL por la credencial default del proveedor ni añadir migraciones a npm start.

## Validación ejecutada

Validado en Windows con Node 22.23.3: instalación en una copia sin node_modules, .env ni dist mediante `render:build`, con NODE_ENV=production; tres bundles Vite y comprobación de sintaxis backend correctos. Todos los imports runtime cargaron sin módulos faltantes. Comprobación de nombres con distinción de mayúsculas en 24 referencias HTML: sin diferencias. Smoke HTTP independiente de DB: 13 rutas/assets, CORS permitido/rechazado y rechazo de rutas privadas correctos. `npm test`: 38 casos impresión/compartir y 123 backend aprobados; navegador: 52 aprobados.

El intento real de `npm start` en esa copia llegó a la validación PostgreSQL pero la URL runtime disponible en el entorno local apunta a Railway y devolvió ECONNRESET, también al probar TLS con verificación. No se cambiaron esa URL, secretos ni datos de producción. Por tanto, **el arranque completo con base real no está validado**. No se ejecutaron migraciones sobre Railway ni Render. El bootstrap y sus migraciones iniciales se verificaron en PGlite; esto no certifica privilegios ni pgcrypto del proveedor.

La instalación reportó advisories existentes: raíz 5 (4 moderados y 1 alto), backend 12 (4 moderados, 6 altos y 2 críticos). No se aplicó audit fix ni se cambiaron versiones de paquetes; requieren revisión separada antes de aprobar producción. Sin una instancia Render y sus credenciales no se certifica PostgreSQL administrado, ejecución Linux, TLS del proveedor, disco ni impresión física remota. La ausencia documentada de superusuario no permite deducir por sí sola los demás atributos administrativos.
