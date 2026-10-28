# Producción principal: Railway

## Arquitectura y alcance

Un servicio web desde la raíz del repositorio, con Node 22 y Railpack. Express
sirve frontend y API. La base PostgreSQL existente permanece en su servicio actual,
en el mismo proyecto y entorno. No crear otra base ni importar encima de la actual.
`railway.json` es la única configuración de despliegue activa. No hay Dockerfile,
vercel.json, render.yaml ni nixpacks.toml en este repositorio. El documento de Render
se conserva exclusivamente como referencia histórica; no guía el despliegue actual.

Build: `npm run railway:build` (instala ambos lockfiles y ejecuta `npm run build`).
Start: `npm start`. Root Directory: `/` (raíz del repositorio, no `backend`).
No configurar pre-deploy, bootstrap, seeds o migraciones en Build/Start.
Node está limitado por engines y `.node-version`; usar `RAILPACK_NODE_VERSION=22`
en Railway si hay una selección de versión previa en el panel.

El build crea `frontend/dist/order-catalog.{js,css}`, `printer-service.js` y
`share-ticket.js`; después valida sintaxis del backend y scripts del frontend.
El build no necesita ni debe conectarse a PostgreSQL.

## Variables del servicio web

| Variable | Configuración |
| --- | --- |
| NODE_ENV | `production` |
| RAILPACK_NODE_VERSION | `22` |
| PGHOST | `${{Postgres.RAILWAY_PRIVATE_DOMAIN}}` |
| PGPORT | `5432`, confirmar el puerto interno del servicio existente |
| PGDATABASE | `${{Postgres.PGDATABASE}}` |
| PGUSER | `sistema_gestor_app` |
| PGPASSWORD | contraseña **existente** de sistema_gestor_app, como secreto |
| JWT_SECRET | conservar el secreto actual, sin publicarlo |
| DB_SSL | `false` para el contenedor estándar sin TLS nativo en la red privada |
| DB_SSL_REJECT_UNAUTHORIZED | `true` o ausente; nunca false |
| PUBLIC_APP_URL | URL HTTPS definitiva del servicio web |
| FRONTEND_URL | misma URL HTTPS sin slash final |
| UPLOAD_DIR | `/data/uploads`, con volumen adjunto en esa ruta |
| SEED_DEFAULT_ADMIN | `false` |
| ALLOW_USER_CREATION | `false` salvo decisión explícita de permitir registro |

Sustituir **Postgres** por el nombre real del servicio PostgreSQL mediante el
selector de referencias del panel. En servicio web → Variables → New Variable,
crear cada PG* anterior. Para PGPASSWORD introducir el secreto del usuario app,
**no** una referencia a Postgres.PGPASSWORD, que suele ser administrativa.
No modificar PGUSER/PGPASSWORD/DATABASE_URL del servicio PostgreSQL.

Eliminar `DATABASE_URL` del servicio web si se elige la configuración PG*: una URL
existente prevalece sobre todos los PG* y DB_*. Revisar también variables compartidas.
Retirar DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME antiguos y cualquier PG* duplicada.
No inyectar `MIGRATION_DATABASE_URL` al web; queda solo en herramientas administrativas.
El archivo local backend/.env no se sube a GitHub ni a Railway.

Alternativa equivalente usando una única URL, conservando el rol app:

```text
DATABASE_URL=postgresql://sistema_gestor_app:${{APP_DB_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}
```

`APP_DB_PASSWORD` debe contener la contraseña existente codificada para URL si
tiene caracteres reservados. Preferir PG* para no necesitar codificación.
No usar `${{Postgres.DATABASE_URL}}` directamente para el runtime.

Precedencia exacta: `DATABASE_URL` no vacía > `PG*` > `DB_*` heredadas.
backend/config/env.js carga backend/.env sin reemplazar variables inyectadas.
pgConfig ya no carga otro .env dependiente del directorio de trabajo.
Producción exige DATABASE_URL o un conjunto PG* completo, y JWT_SECRET.

## Red, TLS y diagnóstico del reset

La URL local inspeccionada usa el proxy público `tokaido.proxy.rlwy.net:42462`,
base railway y login sistema_gestor_app; no había PG* de conexión heredadas en el
proceso de diagnóstico. Los DB_* locales estaban vacíos. La URL administrativa
separada no se utiliza para el runtime.

Comprobado desde este entorno: TCP conecta al proxy, pero una petición PostgreSQL
SSLRequest recibe ECONNRESET antes de recibir S/N. SELECT 1 también falla con
ECONNRESET. El protocolo no llegó a autenticar ni consultar RLS. Eso no demuestra
contraseña equivocada, permisos insuficientes o que sea necesario activar TLS.

Hipótesis pendientes: destino/puerto del TCP proxy desactualizado, PostgreSQL
detenido o no escuchando, cierre en el proxy/red intermedia. Para distinguirlas:

1. Abrir el servicio PostgreSQL existente en Railway y comprobar estado, eventos,
   logs, espacio del volumen y puerto de escucha. No recrearlo.
2. En Settings → Networking, verificar que el TCP proxy apunte al puerto real de
   PostgreSQL y comparar host/puerto actuales con los locales.
3. Configurar el web con PGHOST privado según la tabla. Ambos servicios deben estar
   en el mismo proyecto **y entorno**. No usar ese dominio desde la laptop.
4. Desde una shell **dentro del contenedor web** ejecutar `npm run db:check`.
   Debe mostrar endpoint private, usuario app, SELECT 1 y validación de seguridad OK.
   `railway run` corre localmente y no vuelve accesible el DNS privado en la laptop.
5. Si el privado funciona y el público falla, el problema queda localizado al
   camino público. Actualizar el proxy local solo con los valores reales del panel.

No se puede certificar la causa interna del proxy sin acceso al panel/logs del
servicio. No se cambió la URL local a un dominio privado inaccesible desde Windows.

La red privada Railway cifra transporte mediante WireGuard. DB_SSL=false selecciona
el protocolo PostgreSQL sin TLS nativo en ese túnel; no desactiva validación de un
certificado. Si el endpoint real soporta/requiere TLS, usar DB_SSL=true y, si procede,
DB_SSL_CA con su CA confiable. No usar rejectUnauthorized=false. Se normalizan los
parámetros sslmode para evitar que pg reemplace silenciosamente las opciones TLS.
Para usar el proxy público verificar primero su configuración de cifrado real;
no asumir que un proxy TCP añade TLS al servidor PostgreSQL.

## Arranque, pool y seguridad

El servicio escucha `0.0.0.0:$PORT`; Railway proporciona PORT. Local por defecto 5000.
Valida SELECT 1, privilegios del login/membresías/propiedad y runtime_schema_ready.
Nunca usa postgres como alternativa, ni ejecuta initLegacySchema o migraciones.
Se conserva SET LOCAL por transacción y el wrapper que separa negocio_id.
No se alteraron SQL de RLS/FORCE RLS, roles ni datos de producción.

Tres intentos de validación, solo ante fallos transitorios, con esperas de 1 y 2 s.
Credenciales inválidas, permisos o esquema incorrecto fallan sin repetir.
Nunca se reintentan ventas, cobros ni otras escrituras. El pool descarta sockets
inactivos con errores sin producir un evento error sin listener. Las solicitudes
posteriores pueden abrir conexiones nuevas después de una caída temporal.
Railway limita reinicios por fallo a tres; no se programa reinicio infinito.

Valores por defecto: pool 10, conexión 5 s, inactividad 30 s, sentencia 30 s,
consulta 35 s, keepalive activo. Ajustes opcionales documentados en .env.example.
Los códigos del diagnóstico no incluyen URL completa, contraseña ni mensaje remoto.

`GET /healthz`: SELECT 1, HTTP 200 si responde; HTTP 503 si no. No expone secretos.
No acepta tráfico hasta superar las validaciones iniciales. Railway verifica salud
durante despliegue; configurar monitoreo externo para disponibilidad continua.
SIGTERM/SIGINT drenan HTTP y cierran pool; límite 10 s, drenaje Railway 15 s.
Se confía en un salto de proxy para HTTPS/cookies e IP del limitador; mantener un
solo ingreso Railway y comprobar cabeceras si se añade otro CDN/proxy.
Limitadores en memoria: mantener una réplica o diseñar almacenamiento compartido.

## Fotografías, evidencias y documentos

Antes: backend/uploads. Ahora UPLOAD_DIR configurable y el mismo directorio se usa
para cargas, entrega autenticada y logos de impresión. Se mantienen /uploads y
/api/archivos, el registro archivos, el control por negocio y las cookies privadas.
No se agregó express.static sobre uploads ni se hicieron públicos los documentos.

Crear un volumen **del servicio web** y montarlo en `/data/uploads`; el volumen del
servicio PostgreSQL no conserva archivos del web. railway.json exige este montaje
y una sola réplica.
Si UPLOAD_DIR está ausente se usa RAILWAY_VOLUME_MOUNT_PATH cuando Railway lo inyecta.
Un volumen vacío no copia archivos anteriores automáticamente. Antes de cambiar
UPLOAD_DIR, respaldar origen y destino,
inventariar nombres/tamaños y hashes SHA-256 y copiar todos los archivos sin borrar
el origen ni sobrescribir nombres en conflicto. Verificar hashes en destino y
acceso autenticado/denegado por negocio antes de retirar el almacenamiento anterior.
La copia real requiere acceso al almacenamiento de origen y autorización si hay
riesgo; no se ejecutó en esta sesión. No modificar URLs guardadas en PostgreSQL.

Los despliegues con volumen pueden tener breve indisponibilidad al reemplazarse.
Configurar respaldos del volumen y de PostgreSQL, con copia externa y restauración
verificada en un entorno separado. Cloudflare R2 es alternativa para varias réplicas,
pero requiere un adaptador autenticado y migración verificada conservando URLs;
no se implementó un cambio parcial que exponga evidencias.

## Pruebas y aceptación antes de abrir producción

```sh
npm run railway:build
npm test
npm run test:browser
npm run db:check
npm start
```

Los tests HTTP de Railway usan Express real con pool simulado: no certifican la
base productiva. Las pruebas RLS usan PostgreSQL embebido PGlite con datos desechables.
El registro de resultados de esta preparación está en RAILWAY_VALIDATION.md en raíz.

En Railway: comprobar /, /healthz, bundles /dist y /vendor, login/logout, roles y
permisos; comparar accesos de dos negocios a clientes, órdenes, seguimiento por token,
evidencias, inventario, POS, caja, reportes y configuración. No crear ventas/pruebas
con datos reales sin autorización y respaldo verificado. Validar stock por sucursal
y separación de Super Admin con cuentas y esquema reales: este cambio no añade
esas capacidades ni certifica que ya existan. No aplicar migraciones para corregir
un problema de red. Si falta esquema, revisar un plan administrativo independiente
con respaldo verificado y autorización explícita; no ejecutar db:bootstrap.

Tickets/etiquetas: los bundles y pruebas se conservan. Railway Linux no puede usar
la impresora Windows conectada al backend; configurar QZ Tray en la PC del operador,
diálogo del navegador o transporte Android. La impresión física requiere prueba allí.
SMTP debe configurarse y probarse con un destinatario autorizado; no se envió correo.

## GitHub y despliegue

Revisar `git diff` y `git status --short`; no incluir .env, uploads, logs ni backups.
Crear una rama, agregar explícitamente los archivos de esta entrega, commit y push.
En Railway conectar esa rama al servicio web del proyecto y entorno de la base
existente; raíz `/`, Railpack, Build y Start indicados, sin pre-deploy administrativo.
Configurar variables y volumen antes de desplegar; generar dominio HTTPS, completar
PUBLIC_APP_URL/FRONTEND_URL y volver a desplegar si cambian. Si /healthz no pasa,
revisar logs y db:check, sin reemplazar credenciales app por administrativas.

Fuentes oficiales:
- https://docs.railway.com/networking/private-networking/how-it-works
- https://docs.railway.com/deployments/healthchecks
- https://docs.railway.com/volumes
- https://railway.com/railway.schema.json
- https://node-postgres.com/features/ssl
