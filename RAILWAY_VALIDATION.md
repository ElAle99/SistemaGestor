# Entrega Railway — 27 de octubre de 2026

Estado: código preparado y pruebas locales aprobadas. **No desplegado ni certificado
contra PostgreSQL productivo**: el endpoint público local sigue devolviendo ECONNRESET.
No se ejecutaron escrituras, migraciones, bootstrap, seeds, eliminación o restauración
sobre la base existente. No se modificó backend/.env ni se copiaron archivos reales.

## Resultados ejecutados

| Comprobación | Resultado real |
| --- | --- |
| Instalación desde ambos package-lock con npm ci | Ejecutada; backend final además instalado con Node 22.23.4 |
| Build de producción con Node 22.23.4 | Aprobado; tres bundles Vite y comprobación de sintaxis |
| npm run railway:build completo con lockfiles finales | Aprobado; npm ci raíz/backend, tres bundles y 79 archivos comprobados; esta invocación usa el Node 24 predeterminado de npm.cmd |
| npm test con Node 22 | 169 aprobadas: 38 raíz y 131 backend, sin fallos ni omitidas |
| npm run test:browser (Edge) | 52 aprobadas, 2.3 minutos, usando fixtures locales |
| Aislamiento multiempresa | Pruebas existentes aprobadas con dos negocios y PostgreSQL embebido PGlite; no certifica RLS del servidor remoto |
| HTTP Express real | Frontend, /dist, /vendor, APIs sin sesión rechazadas, API inexistente JSON 404 y evidencias privadas rechazadas |
| Salud ante caída/recuperación | 200 → 503 → 200 con pool simulado; no se cae Express |
| Reintentos / cierre | Límite de tres ante fallos transitorios, sin repetir error de autenticación; drenaje HTTP y pool ante señales probado con EventEmitter |
| bcrypt y Multer reales | Hashes 2a/2b, contraseña incorrecta y carga multipart con directorio configurable y registro de negocio aprobados |
| Revalidación tras configurar fallback de volumen | Tres pruebas HTTP/almacenamiento aprobadas con Node 22 |
| Diagnóstico PostgreSQL SELECT 1 real | Falló con ECONNRESET; usuario restringido, base railway, endpoint público |
| TCP y SSLRequest real | TCP conectado, reset antes de respuesta PostgreSQL S/N; no se alcanzó autenticación |
| npm start real | Falló con tres ECONNRESET y salida controlada, sin contraseña en logs; no quedó escuchando |
| Auditoría de dependencias | Backend: cero vulnerabilidades. Raíz: tres moderadas en cadena de desarrollo Capacitor CLI → xcode → uuid |

El equipo tiene Node 24 como predeterminado. Se obtuvo Node 22.23.4 para ejecutar
las pruebas y la compilación compatible con producción. Algunas invocaciones de
npm.cmd usan su Node 24 instalado y muestran EBADENGINE; no se amplió engines a 24.
En Railway fijar Node 22 según la guía. La instalación y build iniciales se repitieron
tras resolver una restricción de esbuild del sandbox y un bloqueo temporal del
binario de bcrypt durante npm ci. No son fallos de PostgreSQL ni cambios de negocio.

Los cambios de seguridad incluyen bcrypt 6, Multer 2, Nodemailer 10, parches de
Express/dependencias transitivas y Vite 7.3.7. No se forzó una degradación de
Capacitor ni se modificó su flujo Android para eliminar el aviso moderado pendiente.
SMTP externo y dispositivos de impresión físicos no fueron probados.

La revisión automática rechazó inicialmente start por confundir initDB con el
inicializador heredado. Tras inspeccionar el código y aportar que start/initDB y
runtime_schema_ready solo consultan, permitió la ejecución. El bloqueo restante
es la conexión remota, no una autorización pendiente del revisor.

## Causa: qué sabemos y qué falta

Comprobado: la configuración efectiva proviene de DATABASE_URL local/inyección de
entorno, apunta a tokaido.proxy.rlwy.net:42462 y conserva sistema_gestor_app. No hay
PG* de conexión heredadas en el proceso inspeccionado; DB_* locales vacías. El proxy
cierra antes de completar el protocolo PostgreSQL, incluso con SSLRequest sin login.

No comprobado: que el destino del proxy haya cambiado, el servicio esté detenido,
el puerto destino sea incorrecto o exista un corte intermedio. Tampoco se certificaron
contraseña, membresías, propietarios SECURITY DEFINER o políticas del servidor real.
No atribuir el reset a RLS, TLS o contraseña sin evidencia adicional.

## Archivos de la entrega

- railway.json
- package.json y package-lock.json
- backend/package.json y backend/package-lock.json
- backend/.env.example
- backend/server.js
- backend/config/pgConfig.js
- backend/config/dbLifecycle.js (nuevo)
- backend/config/storage.js (nuevo)
- backend/config/tenantContext.js
- backend/middleware/upload.js
- backend/routes/privateFiles.js
- backend/routes/config.js
- backend/scripts/check-db.js (nuevo)
- backend/tests/startup.test.js
- backend/tests/railway.test.js (nuevo)
- backend/tests/railway-http.test.js (nuevo)
- backend/tests/dependency-compatibility.test.js (nuevo)
- backend/README.md
- backend/db/RAILWAY_PRODUCTION.md
- RAILWAY_VALIDATION.md (este registro)

## Acciones pendientes en Railway

Seguir [la guía de producción](backend/db/RAILWAY_PRODUCTION.md): comprobar el servicio
PostgreSQL y su proxy sin recrearlo; configurar PG* privadas del web con la contraseña
existente de app, retirar DATABASE_URL duplicada, conservar JWT_SECRET y separar la
credencial administrativa. Adjuntar volumen /data/uploads al web y copiar/verificar
archivos sin borrar origen. La conexión privada solo puede validarse dentro de Railway.

Ejecutar allí db:check, start y /healthz. Después comprobar login/logout, roles,
clientes, órdenes, seguimiento público, inventario/sucursales, caja/POS, reportes,
configuración, evidencias y panel administrativo con cuentas autorizadas. No se
certifican capacidades de Super Admin o sucursales solo por conservar las rutas.
Cualquier prueba que modifique producción exige respaldo verificado y autorización.

Las credenciales mostradas previamente en esta conversación deben rotarse de forma
coordinada antes de abrir producción; no fueron rotadas automáticamente. No publicar
backend/.env ni registrar secretos en GitHub, Railway logs o capturas.

## GitHub (desde raíz, revisar diff antes de agregar)

```sh
git switch -c railway-production
git diff --check
git add railway.json RAILWAY_VALIDATION.md package.json package-lock.json backend/package.json backend/package-lock.json backend/.env.example backend/README.md backend/db/RAILWAY_PRODUCTION.md backend/server.js backend/config/pgConfig.js backend/config/dbLifecycle.js backend/config/storage.js backend/config/tenantContext.js backend/middleware/upload.js backend/routes/privateFiles.js backend/routes/config.js backend/scripts/check-db.js backend/tests/startup.test.js backend/tests/railway.test.js backend/tests/railway-http.test.js backend/tests/dependency-compatibility.test.js
git diff --cached --stat
git commit -m "Prepare persistent Railway deployment and safe PostgreSQL lifecycle"
git push -u origin railway-production
```

No se creó rama, commit, push ni despliegue desde esta sesión. Seleccionar esa rama
en Railway, servicio web con raíz `/`, Build `npm run railway:build`, Start `npm start`,
sin comandos administrativos de pre-deploy; configurar variables y volumen primero.
