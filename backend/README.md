# Sistema Gestor Allfix Bacalar

Servicio persistente Node.js 22 + Express + PostgreSQL multiempresa. Express sirve
`frontend/index.html`, recursos estáticos, bundles Vite y `/api` en el mismo origen.

La guía principal de producción es [Railway](db/RAILWAY_PRODUCTION.md).
No usar la URL administrativa de PostgreSQL como credencial de la aplicación.

Desde la raíz, con Node >=22.12 <23:

```sh
npm ci --include=dev
npm --prefix backend ci --include=dev
npm run build
npm test
npm start
```

En Windows puede usarse `npm.cmd`. Configuración local: copiar `.env.example` a
`.env` dentro de backend y completar secretos en privado. Variables inyectadas por
el entorno prevalecen sobre ese archivo. `npm run db:check` hace solo lecturas.
El arranque verifica conectividad, privilegios y versión del esquema; no crea
tablas, usuarios ni aplica migraciones. No ejecutar bootstrap sobre la base existente.

Para desarrollo, ejecutar `npm.cmd run dev` desde la raíz (`npm run dev` también
es válido). Compila el frontend y abre http://localhost:5000, salvo que PORT indique
otro puerto. El comando habilita `--dev-preview`: ante un fallo transitorio de red,
sirve una vista previa solo en localhost; `/healthz` y `/api` devuelven 503.
Login y datos requieren PostgreSQL. Tras corregir la conexión, escribir `rs` en
nodemon para validar de nuevo. Los errores de credenciales, permisos y esquema
siguen impidiendo el arranque. `npm start` y producción requieren una base validada.

La copia recuperada local usa PostgreSQL portátil en `.local/postgres-data`, puerto
55432 y base `allfix_local`. `npm run dev` inicia esa base automáticamente cuando
`backend/.env` apunta a ella. También se puede usar `npm run db:local:start` y
`npm run db:local:stop`. No borrar `.local`: contiene los datos y secretos locales,
la configuración anterior en `backend.env.before-local` y `restore-report.json`
con los conteos verificados. La copia corresponde al respaldo del 14 de octubre
de 2026; las cuentas y sus contraseñas originales se conservan.

La recuperación explícita para una instalación vacía de Windows x64 es:

```powershell
npm.cmd install --prefix .local/postgres-tools --ignore-scripts --save-exact @embedded-postgres/windows-x64@18.4.0-beta.17
npm.cmd run db:local:restore
npm.cmd run db:check
npm.cmd run dev
```

La restauración rechaza una base con tablas, conserva todos los valores originales
del último respaldo y aplica las migraciones de seguridad en la copia local.
No conecta ni modifica Railway.

La impresión directa del backend requiere Windows y una impresora instalada en ese
equipo. En Railway Linux se usan las alternativas del cliente: QZ Tray local,
navegador o aplicación Android. Consultar las guías de impresión de la raíz.
