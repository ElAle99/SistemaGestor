# Sistema Gestor AllFix - Backend

Backend Express + PostgreSQL para el sistema gestor de ordenes, inventario, POS, cotizaciones, calendario e impresion de tickets.

## Requisitos

- Node.js 18 o superior
- npm
- PostgreSQL local o una base PostgreSQL en Supabase

## Instalacion

```bash
npm install
```

## Configuracion Local

Copia `backend/.env.example` como `backend/.env` y configura tus valores locales:

```env
PORT=5000
DB_USER=
DB_PASSWORD=
DB_HOST=
DB_PORT=
DB_NAME=
JWT_SECRET=
```

## Configuracion Con Railway PostgreSQL

En Railway agrega PostgreSQL al proyecto y usa la variable `DATABASE_URL` que Railway genera para el servicio.

```env
NODE_ENV=production
PORT=
JWT_SECRET=
DATABASE_URL=
ALLOWED_ORIGINS=
```

Si `SUPABASE_DATABASE_URL` o `DATABASE_URL` existen, el backend ignora `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` y `DB_NAME`.

## Ejecutar

```bash
npm start
```

El servidor levanta en:

```text
http://localhost:5000
```

Al iniciar, el backend crea o actualiza las tablas necesarias antes de aceptar solicitudes. Si falta `JWT_SECRET` o falla la inicializacion de PostgreSQL, el proceso termina con error.

El primer administrador se registra desde la configuracion inicial cuando todavia no existe ninguno. Tambien puedes crearlo con `SEED_DEFAULT_ADMIN=true` y las variables `ADMIN_USERNAME`, `ADMIN_PASSWORD` y `ADMIN_NAME`; desactiva esta opcion despues del primer arranque. No hay un usuario ni una contrasena predeterminados.

`ALLOW_USER_CREATION=true` permite el registro publico de Tecnicos y Recepcionistas. Los administradores adicionales se crean desde la gestion autenticada de usuarios.

## Validacion

Desde la raiz del proyecto:

```bash
npm test
npm run build
```

Las pruebas de regresion usan los modulos reales con limites HTTP y PostgreSQL simulados. Cubren ventas, stock, autorizacion, registro publico, limites de intentos y arranque; no sustituyen las pruebas de integracion con PostgreSQL ni la verificacion visual en navegador. `build` comprueba todos los archivos JavaScript, sin generar un bundle.

## Cambios de seguridad y compatibilidad

- El arranque agrega `usuarios.session_version` sin eliminar datos. Los tokens anteriores a esta actualizacion dejan de ser validos; los usuarios deben iniciar sesion nuevamente.
- Cambiar contrasena, rol o estado invalida sesiones. Cada solicitud autenticada consulta el estado y rol actuales del usuario.
- `/api/ventas` y `/api/pos/venta` usan el mismo servicio transaccional. El servidor calcula importes con los precios del catalogo y rechaza precios desactualizados, cantidades invalidas, productos repetidos y stock insuficiente. Agrupa las cantidades de cada producto en una sola linea.
- Login, recuperacion, registro, consulta publica de folios y cotizaciones publicas tienen limites de solicitudes. Los contadores son locales al proceso; un despliegue con varias replicas requiere un limitador compartido o en el proxy. Configura la confianza en proxies segun la infraestructura antes de depender de limites por IP detras de un proxy.
- `db/init.js` y `db/database.js` son entradas compatibles al inicializador y pool principales; ya no mantienen un esquema alternativo ni crean usuarios fijos.

El sistema sigue orientado a un solo negocio. El aislamiento de empresas y la division del frontend en modulos requieren un trabajo de arquitectura separado.

## Impresion Directa De Tickets

La impresion directa funciona desde el backend de Windows. Para usarla como punto de venta:

- El backend debe correr en la misma PC donde esta instalada la impresora.
- Configura la impresora en el panel `Configuracion > Impresion de Tickets`.
- El ticket se manda por `/api/configuracion/imprimir-ticket` sin abrir el dialogo del navegador.
