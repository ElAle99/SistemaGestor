# Railway: provisionar el login de runtime sin relajar seguridad

Revisión: 2026-10-15. Este procedimiento reutiliza scripts/harden-tenancy.js y las
migraciones existentes v1–v8. No ejecutar CREATE ROLE/GRANT alternativos ni copiar
las credenciales locales a producción. No se ha conectado ni migrado Railway desde
esta sesión.

El error de pgConfig.js es correcto: el backend no puede usar el DATABASE_URL
administrativo que Railway publica para su servicio PostgreSQL. Esa URL se conserva
para el job de migraciones, no para server.js.

## 1. Respaldo y destino

Detener los escritores de producción y obtener un respaldo recuperable del volumen
PostgreSQL desde Railway antes de migrar. Usar el mismo entorno y base existentes;
no crear otra base ni importar el respaldo local de Allfix.

Crear un job/servicio temporal de migraciones con el mismo código de
SistemaGestor/ImpresionFinal2.0, raíz del repositorio y acceso a la red privada del
mismo proyecto/entorno. Instalar las dependencias del backend. No configurar un
servidor HTTP ni healthcheck HTTP en ese job, ni ejecutar la migración como build
command del backend. Evitar reinicios/repeticiones automáticas del job.

## 2. Contraseña y variables

Generar una contraseña en una terminal local privada, no en logs de Railway:

```
node -e "console.log(require('node:crypto').randomBytes(36).toString('base64url'))"
```

Guardar el resultado en un gestor de contraseñas y como APP_DB_PASSWORD en Railway.
No escribir el valor en archivos del repositorio, comandos con contraseñas literales
o capturas. Base64url evita caracteres que necesiten escape en URL o literales SQL
del script existente. Para una cuenta ya existente, reutilizar la contraseña actual;
cambiarla también cambia la credencial del rol y requiere coordinar otros procesos.

Las expresiones siguientes suponen que el servicio PostgreSQL se llama **Postgres**
y usa su puerto interno habitual 5432. Sustituir el nombre por el real usando el
selector de referencias de Railway. Si el puerto interno difiere, conservar el de
su URL privada. PGDATABASE debe ser la base de producción existente.

En el job administrativo:

| Variable | Valor |
| --- | --- |
| NODE_ENV | production |
| MIGRATION_DATABASE_URL | `${{Postgres.DATABASE_URL}}` |
| APP_DB_PASSWORD | contraseña nueva almacenada como secreto |
| DATABASE_URL | `postgresql://sistema_gestor_app:${{APP_DB_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.PGDATABASE}}` |

**DATABASE_URL se configura antes de crear el rol.** El script necesita leer la
contraseña deseada, pero no se conecta con esta URL durante el aprovisionamiento.
Solo conecta mediante config/migrationDb.js y MIGRATION_DATABASE_URL.

No cambiar PGUSER, PGPASSWORD ni DATABASE_URL dentro del propio servicio PostgreSQL:
son las credenciales administrativas del contenedor y del panel de Railway.

## 3. Comando exacto dentro de Railway

Desde la raíz del repositorio, con esas variables y dependencias instaladas:

```
npm --prefix backend run migrate:security
```

Equivalente: `node backend/scripts/harden-tenancy.js`. Si el directorio de trabajo
ya es backend: `npm run migrate:security`.

Este comando crea primero el respaldo lógico en backend/db/backups, aplica v1/v2
si faltan y después las migraciones de endurecimiento v3–v8. initTenancy confirma
v1/v2 en su propia transacción; v3–v8 se aplican en otra con advisory lock. Si una
fase falla, no iniciar el backend ni borrar versiones: revisar el error y retomar
con el mismo comando. No se promete atomicidad de las dos fases juntas.

Se crea sistema_gestor_tenant NOLOGIN/NOSUPERUSER/NOBYPASSRLS y
sistema_gestor_app LOGIN/NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE,
sin membresías administrativas, con los mismos permisos y FK validados localmente.
No se modifican los SQL de políticas para adaptarlos a Railway. La versión final
tiene **36 tablas protegidas**, incluidas las 32 originales, todas con ENABLE/FORCE.

El script no arranca Node HTTP, no escribe .env en production ni imprime contraseñas.
Comprueba la configuración y los conteos de órdenes/ventas antes y después. No usar
47/17 como conteos esperados de Railway: los de producción pueden ser distintos.
El respaldo lógico generado contiene datos privados: conservarlo fuera del contenedor
efímero, junto al respaldo externo de Railway, sin publicarlo ni adjuntarlo al repo.

Este script requiere el esquema base existente (configuracion, usuarios, órdenes,
ventas, garantías y catálogos). No inicializa una base vacía. Una incompatibilidad de
esquema, scopes ambiguos, referencias inválidas o pgcrypto no disponible debe detener
el proceso; no se soluciona desactivando RLS ni eliminando registros.

## 4. Backend: sustituir la referencia administrativa

En Variables del servicio **backend**, reemplazar:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

por la URL de sistema_gestor_app definida arriba, con el mismo APP_DB_PASSWORD.
Conservar NODE_ENV=production y el JWT_SECRET existente; no rotar JWT_SECRET como
parte de esta migración. El backend normal no necesita MIGRATION_DATABASE_URL:
mantenerla solo en el job administrativo. Si ya está definida en backend, retirarla
después de separar el job. El servidor tampoco la utiliza si permanece configurada.

Eliminar del backend los antiguos DB_USER/DB_PASSWORD con postgres y referencias
administrativas de fallback que ya no sean necesarias. No confiar en
SUPABASE_DATABASE_URL: el runtime actual usa DATABASE_URL o DB_*.

Start command desde raíz: `npm start`. Desde backend: `npm start`.
No concatenar migraciones al start command. No configurar migrate:security en el
pre-deploy permanente del backend; ejecutar el job administrativo separado.
Mantener las opciones TLS existentes acordes al endpoint utilizado; no resolver
errores de certificado desactivando validación indiscriminadamente.

## 5. Verificación con la credencial de aplicación

En un contenedor con el entorno final del backend, desde raíz:

```
node -e "const {pool,initDB}=require('./backend/config/db');initDB().then(()=>pool.query('SELECT current_user,session_user')).then(r=>console.log(r.rows)).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end())"
```

El resultado debe mostrar sistema_gestor_app en ambos campos. initDB además rechaza
login/membresías privilegiadas, propiedad de tablas protegidas y esquema incompleto.
Si el comando falla, no desplegar el servidor con postgres como alternativa.

En una conexión SQL usando **la URL app**, no la administrativa:

```sql
SELECT current_user, session_user;
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname IN ('sistema_gestor_app','sistema_gestor_tenant');
SELECT parent.rolname AS membership
FROM pg_auth_members m
JOIN pg_roles child ON child.oid=m.member
JOIN pg_roles parent ON parent.oid=m.roleid
WHERE child.rolname='sistema_gestor_app';
SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity;
RESET ROLE;
SELECT current_user,session_user;
BEGIN;
SET ROLE postgres; -- Debe fallar; no ejecutar como administrador.
ROLLBACK;
```

Membresía esperada: solo sistema_gestor_tenant; los flags administrativos deben ser
false y ninguna tabla protegida debe pertenecer al runtime. RESET ROLE conserva app.
Comparar también los conteos/datos de producción con el respaldo y probar login,
órdenes y caja antes de reabrir los escritores. Los 168/168 anteriores validaron
el entorno local, no sustituyen una validación del despliegue Railway.

`railway run` ejecuta en la máquina local, no dentro de Railway. No usar directamente
URLs *.railway.internal desde la laptop: para ese caso se necesita una URL pública
administrativa por TCP proxy y una URL pública app hacia el mismo endpoint, sin
alterar las URLs privadas permanentes del backend. El job interno evita esa diferencia.

Fuentes oficiales consultadas:
- https://docs.railway.com/variables
- https://docs.railway.com/databases/postgresql
- https://docs.railway.com/networking/private-networking
- https://docs.railway.com/cli/run
- https://docs.railway.com/volumes/backups
