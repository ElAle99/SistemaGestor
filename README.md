# Sistema Gestor de Órdenes de Servicio para Allfix Bacalar

Sistema web integral desarrollado para administrar las operaciones de un taller de reparación de dispositivos electrónicos.

Centraliza la gestión de clientes, órdenes de servicio, garantías, inventario, ventas, caja, cotizaciones, calendario, reportes, usuarios y generación de tickets térmicos.

El proyecto utiliza un frontend desarrollado con HTML, CSS y JavaScript, un backend REST con Node.js y Express, y PostgreSQL como sistema de base de datos.

---

## Estado del proyecto

* Versión del backend: `1.0.0`
* Rama principal: `main`
* Commit de referencia: `5eb93da`
* Idioma principal: español
* Aplicación web servida por el mismo backend
* Base de datos PostgreSQL
* Inicialización automática del esquema al arrancar el servidor

---

## Funcionalidades

### Dashboard

* Resumen general de la operación del taller.
* Indicadores de órdenes, clientes e inventario.
* Actividad reciente.
* Notificaciones.
* Accesos rápidos.

### Clientes

* Registro y edición de clientes.
* Nombre y apellidos.
* Teléfono principal y teléfonos alternativos.
* Correo electrónico.
* Dirección.
* Contacto preferido.
* Notas.
* Historial de órdenes de servicio.

### Órdenes de servicio

* Creación de órdenes con folio único.
* Registro de dispositivo, marca, modelo, color, IMEI y número de serie.
* Registro de falla y servicio solicitado.
* Inspección visual del equipo.
* Registro de accesorios.
* PIN, contraseña o patrón de desbloqueo.
* Evidencias fotográficas.
* Firma del cliente.
* Asignación de técnico.
* Costos estimados.
* Anticipo.
* Refacciones.
* Mano de obra.
* Saldo pendiente.
* Estados de reparación.
* Historial de cambios.
* Identificación de órdenes retrasadas.
* Consulta pública mediante folio.
* Ticket de recepción.
* Etiqueta térmica.

### Garantías

* Garantías asociadas a órdenes entregadas.
* Vigencia y condiciones.
* Servicio cubierto.
* Registro de ingresos por garantía.
* Diagnóstico.
* Validación, aceptación o rechazo.
* Evidencias fotográficas.
* Historial.
* Costos relacionados.
* Seguimiento hasta su resolución y entrega.

### Inventario

* Productos, accesorios y refacciones.
* Código interno.
* Código de barras.
* Categorías.
* Precio de compra y venta.
* Stock disponible.
* Stock mínimo.
* Fotografías.
* Movimientos de inventario.
* Refacciones relacionadas con órdenes.
* Validación de existencias.

### Punto de venta

* Carrito de productos y servicios.
* Cobro de órdenes pendientes.
* Venta de productos.
* Descuentos.
* Pagos en efectivo.
* Transferencias.
* Pagos mixtos.
* Referencias de transferencia.
* Cálculo de cambio.
* Generación de tickets de venta.

### Caja

* Apertura de caja.
* Monto inicial.
* Entradas y salidas.
* Movimientos asociados con ventas y órdenes.
* Resumen de caja activa.
* Cierre de caja.
* Monto contado.
* Total esperado.
* Diferencias.
* Historial de cortes.

### Cotizaciones

* Registro de solicitudes de cotización.
* Información del cliente.
* Información del equipo.
* Fotografías.
* Observaciones.
* Estados de seguimiento.
* Conversión de cotización en orden de servicio.

### Calendario

* Registro de eventos.
* Fecha de inicio y fin.
* Tipos de eventos.
* Colores.
* Asociación con órdenes de servicio.
* Planificación de reparaciones.

### Reportes

* Ingresos.
* Reparaciones.
* Ventas.
* Información financiera por periodos.

### Configuración

* Nombre del establecimiento.
* Dirección.
* Teléfono.
* WhatsApp.
* Redes sociales.
* Términos legales.
* Logo general.
* Logo para tickets.
* Configuración de impresora térmica.
* Papel de 58 mm y 80 mm.
* Gestión de usuarios.

---

## Usuarios y seguridad

Roles disponibles:

* `Administrador`
* `Técnico`
* `Recepcionista`

Características de seguridad:

* Autenticación mediante JWT.
* Contraseñas protegidas con bcrypt.
* Activación y desactivación de usuarios.
* Edición del perfil.
* Cambio de contraseña.
* Recuperación de contraseña.
* Restricciones de acceso según rol.
* Protección de rutas administrativas.

---

## Tecnologías

### Frontend

* HTML5
* CSS3
* JavaScript
* Font Awesome
* FullCalendar
* Day.js
* JsBarcode
* html2canvas
* jsPDF
* jsPDF-AutoTable

### Backend

* Node.js
* Express 4
* PostgreSQL
* `pg`
* JSON Web Tokens
* bcrypt
* Multer
* Nodemailer
* CORS
* QRCode

### Infraestructura

* Windows
* PostgreSQL local
* Railway
* Railway PostgreSQL
* Supabase PostgreSQL

---

## Arquitectura

```text
Navegador
   |
   | HTTP / JSON + JWT
   v
Node.js + Express
backend/server.js
   |
   |-- Sirve frontend/
   |-- Expone /api/*
   |-- Procesa archivos
   |-- Gestiona autenticación
   |-- Ejecuta reglas de negocio
   |
   v
PostgreSQL
```

El frontend y la API pueden operar desde el mismo dominio.

También pueden utilizar dominios independientes mediante la configuración de CORS.

---

## Estructura del repositorio

```text
SistemaGestor/
├── backend/
│   ├── config/
│   ├── db/
│   │   └── migrations/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── .env.example
│   ├── schema_all_tables.sql
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── css/
│   │   └── style.css
│   ├── img/
│   ├── js/
│   │   └── app.js
│   └── index.html
├── package.json
└── README.md
```

---

## Requisitos

* Node.js 18 o superior.
* npm.
* PostgreSQL.
* Navegador web moderno.

Para impresión directa:

* Windows.
* PowerShell.
* Impresora instalada en la computadora donde se ejecuta el backend.

---

## Instalación local

Clona el repositorio:

```bash
git clone <URL_DEL_REPOSITORIO>
cd SistemaGestor
```

Instala las dependencias:

```bash
npm install
npm --prefix backend install
```

Crea el archivo de variables de entorno.

En Windows:

```powershell
Copy-Item backend/.env.example backend/.env
```

En Linux o macOS:

```bash
cp backend/.env.example backend/.env
```

Configura PostgreSQL y JWT:

```env
NODE_ENV=development
PORT=5000

JWT_SECRET=CAMBIA_ESTE_VALOR_POR_UN_SECRETO_LARGO

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=tu_password
DB_NAME=sistema_gestor
```

Inicia el sistema:

```bash
npm start
```

Abre en el navegador:

```text
http://localhost:5000
```

Para desarrollo:

```bash
npm run dev
```

---

## Variables de entorno

Las variables disponibles se encuentran documentadas en:

```text
backend/.env.example
```

| Variable                | Uso                                |
| ----------------------- | ---------------------------------- |
| `NODE_ENV`              | Entorno de ejecución               |
| `PORT`                  | Puerto HTTP                        |
| `JWT_SECRET`            | Firma de tokens JWT                |
| `DATABASE_URL`          | Conexión completa a PostgreSQL     |
| `SUPABASE_DATABASE_URL` | Conexión alternativa a Supabase    |
| `DB_HOST`               | Host de PostgreSQL                 |
| `DB_PORT`               | Puerto de PostgreSQL               |
| `DB_USER`               | Usuario                            |
| `DB_PASSWORD`           | Contraseña                         |
| `DB_NAME`               | Base de datos                      |
| `DB_SSL`                | Configuración SSL                  |
| `FRONTEND_URL`          | URL del frontend                   |
| `ALLOWED_ORIGINS`       | Orígenes permitidos por CORS       |
| `CORS_CREDENTIALS`      | Credenciales CORS                  |
| `SEED_DEFAULT_ADMIN`    | Creación del administrador inicial |
| `ADMIN_USERNAME`        | Usuario administrador              |
| `ADMIN_PASSWORD`        | Contraseña del administrador       |
| `ADMIN_NAME`            | Nombre del administrador           |
| `ALLOW_USER_CREATION`   | Creación pública de usuarios       |
| `SMTP_HOST`             | Servidor SMTP                      |
| `SMTP_PORT`             | Puerto SMTP                        |
| `SMTP_USER`             | Usuario SMTP                       |
| `SMTP_PASS`             | Contraseña SMTP                    |
| `SMTP_FROM`             | Remitente                          |
| `PUBLIC_APP_URL`        | URL pública del sistema            |

No deben almacenarse archivos `.env`, contraseñas, tokens o cadenas de conexión reales en el repositorio.

---

## PostgreSQL

Puede utilizarse una cadena completa:

```env
DATABASE_URL=postgresql://usuario:password@host:5432/base
```

O variables independientes:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=sistema_gestor
```

Al iniciar el servidor, la configuración de base de datos:

1. Comprueba la conexión.
2. Crea las tablas faltantes.
3. Agrega columnas necesarias.
4. Crea índices.
5. Inicializa la configuración general.
6. Inicializa el módulo de garantías.
7. Puede crear el administrador inicial.

El esquema principal se encuentra en:

```text
backend/schema_all_tables.sql
```

---

## Tablas principales

* `usuarios`
* `clientes`
* `ordenes_servicio`
* `historial_estados`
* `evidencias_orden`
* `inventario`
* `orden_refacciones`
* `movimientos_inventario`
* `ventas`
* `ventas_detalle`
* `cajas`
* `caja_movimientos`
* `cotizaciones`
* `eventos_calendario`
* `configuracion`
* `configuracion_sistema`
* `password_reset_tokens`
* `garantias`
* `ingresos_garantia`
* `historial_garantias`
* `fotos_garantia`
* `costos_garantia`

---

## Primer administrador

Puede configurarse mediante variables de entorno:

```env
SEED_DEFAULT_ADMIN=true
ADMIN_USERNAME=administrador
ADMIN_PASSWORD=UNA_CONTRASENA_SEGURA
ADMIN_NAME=Administrador General
```

Después de crearlo:

```env
SEED_DEFAULT_ADMIN=false
```

---

## API

La API utiliza el prefijo:

```text
/api
```

Las rutas privadas requieren:

```http
Authorization: Bearer <TOKEN_JWT>
```

### Endpoints principales

| Prefijo              | Función               |
| -------------------- | --------------------- |
| `/api/setup`         | Configuración inicial |
| `/api/auth`          | Autenticación         |
| `/api/users`         | Usuarios              |
| `/api/clientes`      | Clientes              |
| `/api/ordenes`       | Órdenes de servicio   |
| `/api/inventario`    | Inventario            |
| `/api/ventas`        | Ventas                |
| `/api/pos`           | Punto de venta        |
| `/api/caja`          | Caja                  |
| `/api/cotizaciones`  | Cotizaciones          |
| `/api/calendario`    | Calendario            |
| `/api/eventos`       | Eventos               |
| `/api/reportes`      | Reportes              |
| `/api/configuracion` | Configuración         |
| `/api/dashboard`     | Dashboard             |
| `/api/garantias`     | Garantías             |
| `/api/uploads`       | Archivos              |

---

## Archivos y fotografías

Los archivos se almacenan en:

```text
backend/uploads/
```

Tamaño máximo:

```text
10 MB
```

Formatos permitidos:

* JPEG
* JPG
* PNG
* WEBP
* GIF
* PDF
* DOC
* DOCX

El directorio `backend/uploads/` se encuentra ignorado por Git.

En producción debe utilizarse almacenamiento persistente para evitar la pérdida de archivos durante despliegues o reinicios.

---

## Impresión de tickets

El sistema permite generar:

* Ticket de recepción.
* Ticket de venta.
* Ticket de corte.
* Etiqueta térmica.

Formatos compatibles:

* 58 mm.
* 80 mm.

El frontend genera el ticket y lo convierte en imagen mediante `html2canvas`.

Posteriormente lo envía a:

```text
/api/configuracion/imprimir-ticket
```

La impresión directa utiliza PowerShell y `System.Drawing.Printing`.

### Requisitos

* Backend ejecutándose en Windows.
* Impresora instalada localmente.
* PowerShell disponible.
* Impresora seleccionada en la configuración del sistema.

### Railway

Un servidor alojado en Railway no puede controlar directamente una impresora USB conectada a la computadora del usuario.

Para este escenario se requiere un sistema de impresión local o utilizar el diálogo de impresión del navegador.

---

## Despliegue en Railway

Variables mínimas:

```env
NODE_ENV=production
JWT_SECRET=UN_SECRETO_LARGO_Y_ALEATORIO
DATABASE_URL=${{Postgres.DATABASE_URL}}
ALLOWED_ORIGINS=https://tu-dominio.example
PUBLIC_APP_URL=https://tu-dominio.example
```

Build:

```bash
npm ci && npm --prefix backend ci
```

Inicio:

```bash
npm start
```

El servidor utiliza automáticamente la variable `PORT` proporcionada por Railway.

---

## Scripts disponibles

```bash
npm start
npm run dev
npm run build
```

| Script          | Acción                          |
| --------------- | ------------------------------- |
| `npm start`     | Inicia el servidor              |
| `npm run dev`   | Inicia el servidor con Nodemon  |
| `npm run build` | Valida la sintaxis del proyecto |

---

## Validación

```bash
npm run build
```

Actualmente realiza:

```bash
node --check backend/server.js
node --check frontend/js/app.js
```

El proyecto aún no cuenta con una suite completa de pruebas automatizadas.

---

## Seguridad

Para producción:

* Utilizar un `JWT_SECRET` seguro.
* Utilizar contraseñas fuertes.
* Mantener `ALLOW_USER_CREATION=false`.
* Desactivar `SEED_DEFAULT_ADMIN` después del primer uso.
* Limitar `ALLOWED_ORIGINS`.
* Utilizar HTTPS.
* No publicar `.env`.
* No almacenar credenciales en logs.
* Realizar respaldos periódicos.
* Proteger el acceso a PostgreSQL.

---

## Copias de seguridad

Respaldo:

```bash
pg_dump "$DATABASE_URL" > respaldo.sql
```

Restauración:

```bash
psql "$DATABASE_URL" < respaldo.sql
```

---

## Limitaciones conocidas

* La impresión directa depende de Windows.
* Los archivos necesitan almacenamiento persistente en producción.
* El limitador de solicitudes se almacena en memoria.
* No existe una suite completa de pruebas automatizadas.
* Parte importante del frontend se encuentra concentrada en un único archivo JavaScript.
* Se recomienda migrar progresivamente a migraciones SQL completamente versionadas.

---

## Mejoras futuras

* Pruebas unitarias.
* Pruebas de integración.
* Pruebas end-to-end.
* Migraciones SQL versionadas.
* Almacenamiento externo de evidencias.
* Logs estructurados.
* Monitoreo.
* Documentación OpenAPI.
* Modularización del frontend.
* Sistema de impresión local para producción.
* Integración continua.

---

## Licencia

El repositorio no incluye actualmente un archivo `LICENSE`.

No debe asumirse permiso de distribución, modificación o uso fuera del alcance autorizado por el propietario.
