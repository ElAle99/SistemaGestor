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

Al iniciar, el backend crea o actualiza las tablas necesarias y deja listo el usuario administrador sin imprimir credenciales en consola:

```text
Usuario: allfix
```

## Impresion Directa De Tickets

La impresion directa funciona desde el backend de Windows. Para usarla como punto de venta:

- El backend debe correr en la misma PC donde esta instalada la impresora.
- Configura la impresora en el panel `Configuracion > Impresion de Tickets`.
- El ticket se manda por `/api/configuracion/imprimir-ticket` sin abrir el dialogo del navegador.
