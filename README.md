# Sistema Gestor AllFix Bacalar

Sistema web integral para administrar un taller de reparación de dispositivos. Centraliza clientes, órdenes de servicio, garantías, inventario, ventas, caja, cotizaciones, calendario, reportes, usuarios y emisión de tickets térmicos.

El proyecto utiliza un frontend construido con HTML, CSS y JavaScript, un backend REST con Node.js y Express, y PostgreSQL como base de datos.

## Estado del proyecto

- Versión del backend: `1.0.0`.
- Rama principal: `main`.
- Estado restaurado de referencia: commit `5eb93da`.
- Idioma principal de la interfaz: español.
- Aplicación de página única servida por el mismo backend.
- El esquema de PostgreSQL se crea y actualiza automáticamente al iniciar el servidor.

## Funcionalidades

### Dashboard

- Resumen operativo del taller.
- Indicadores de órdenes, clientes, inventario y actividad.
- Notificaciones y accesos rápidos.

### Clientes

- Registro y edición de clientes.
- Nombre, apellidos, teléfono principal y teléfonos alternativos.
- Correo, dirección, contacto preferido y notas.
- Consulta del historial de órdenes de cada cliente.
- Baja lógica o eliminación controlada según el flujo del sistema.

### Órdenes de servicio

- Creación de órdenes con folio único.
- Registro del equipo, marca, modelo, color, IMEI, serie y descripción.
- Registro de falla, inspección visual, accesorios y servicio solicitado.
- Datos de bloqueo: PIN, contraseña o patrón.
- Evidencias fotográficas y firma del cliente.
- Asignación de técnico.
- Costos estimados, anticipo, refacciones y saldo.
- Estados e historial de cambios.
- Consulta pública mediante folio.
- Identificación de órdenes retrasadas.
- Ticket de recepción y etiqueta térmica.

### Garantías

- Garantía asociada a una orden entregada.
- Vigencia, condiciones, servicio cubierto y fechas.
- Ingresos por garantía.
- Diagnóstico, validación, aceptación o rechazo.
- Fotografías, historial y costos relacionados.
- Seguimiento hasta la resolución y entrega.

### Inventario

- Productos, accesorios y refacciones.
- Código interno y código de barras.
- Categorías, costo, precio, stock y stock mínimo.
- Fotografías de productos.
- Movimientos de inventario.
- Refacciones asignadas a órdenes.
- Control y validación de existencias.

### Punto de venta

- Carrito de productos y servicios de reparación.
- Cobro de órdenes pendientes.
- Venta de productos.
- Descuentos.
- Pagos en efectivo, transferencia o modalidad mixta.
- Referencias de transferencia.
- Cálculo de cambio.
- Generación de tickets de venta.

### Caja

- Apertura de caja.
- Monto inicial.
- Entradas y salidas manuales.
- Movimientos relacionados con ventas y pagos.
- Resumen de caja activa.
- Cierre, monto contado, total esperado y diferencia.
- Historial de cortes.

### Cotizaciones

- Registro público de solicitudes de cotización.
- Datos del cliente y del equipo.
- Fotografías y observaciones.
- Estados de seguimiento.
- Conversión de una cotización en orden de servicio.

### Calendario

- Eventos internos.
- Fechas de inicio y fin.
- Tipos y colores.
- Asociación opcional con órdenes.
- Consulta de órdenes para planificación.

### Reportes

- Ingresos.
- Reparaciones.
- Ventas.
- Exportación y presentación de información financiera.

### Configuración

- Nombre, dirección y teléfono del establecimiento.
- WhatsApp y redes sociales.
- Términos legales.
- Logo general y logo para tickets.
- Impresora térmica.
- Papel de 58 u 80 mm.
- Modo de impresión.
- Gestión de usuarios.

### Usuarios y seguridad

- Roles disponibles:
  - `Administrador`
  - `Técnico`
  - `Recepcionista`
- Autenticación mediante JWT.
- Contraseñas protegidas con bcrypt.
- Activación y desactivación de usuarios.
- Edición del perfil propio.
- Cambio y recuperación de contraseña.
- Restricciones administrativas en rutas sensibles.

## Tecnologías

### Frontend

- HTML5.
- CSS3.
- JavaScript sin framework.
- Font Awesome.
- FullCalendar.
- Day.js.
- JsBarcode.
- html2canvas.
- jsPDF y jsPDF-AutoTable.

### Backend

- Node.js.
- Express 4.
- PostgreSQL mediante `pg`.
- JSON Web Tokens.
- bcrypt.
- Multer.
- Nodemailer.
- CORS.
- QRCode.

### Infraestructura compatible

- Ejecución local en Windows.
- PostgreSQL local.
- Railway con PostgreSQL.
- Supabase PostgreSQL mediante cadena de conexión.

## Arquitectura

```text
Navegador
   |
   | HTTP/JSON + JWT
   v
Express (backend/server.js)
   |-- sirve frontend/
   |-- expone /api/*
   |-- procesa archivos en backend/uploads/
   |-- impresión local en Windows
   v
PostgreSQL
```

El frontend y la API pueden operar desde el mismo dominio. También es posible separar orígenes configurando CORS.

## Estructura del repositorio

```text
SistemaGestor/
├── backend/
│   ├── config/                 # Entorno, PostgreSQL e inicialización
│   ├── db/
│   │   └── migrations/         # Migraciones SQL complementarias
│   ├── middleware/             # JWT, roles, límites y archivos
│   ├── routes/                 # Endpoints REST
│   ├── services/               # Reglas de negocio e impresión
│   ├── .env.example            # Plantilla de variables
│   ├── schema_all_tables.sql   # Esquema SQL de referencia
│   ├── package.json
│   └── server.js               # Entrada del servidor
├── frontend/
│   ├── css/style.css
│   ├── img/
│   ├── js/app.js
│   └── index.html
├── package.json                # Scripts delegados al backend
└── README.md
```

## Requisitos

- Node.js 18 o superior.
- npm.
- PostgreSQL accesible.
- Un navegador moderno.
- Para impresión directa local:
  - Windows.
  - Impresora instalada en la misma computadora que ejecuta el backend.
  - PowerShell disponible.

## Instalación local

Clona el repositorio y entra al directorio:

```bash
git clone <URL_DEL_REPOSITORIO>
cd SistemaGestor
```

Instala las dependencias del proyecto y del backend:

```bash
npm install
npm --prefix backend install
```

Crea el archivo de entorno:

```powershell
Copy-Item backend/.env.example backend/.env
```

En Linux o macOS:

```bash
cp backend/.env.example backend/.env
```

Configura al menos PostgreSQL y el secreto JWT:

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

Abre:

```text
http://localhost:5000
```

Para desarrollo con reinicio automático:

```bash
npm run dev
```

## Variables de entorno

Todas las variables disponibles están documentadas en `backend/.env.example`.

| Variable | Uso |
|---|---|
| `NODE_ENV` | Entorno: `development` o `production`. |
| `PORT` | Puerto HTTP. Por defecto: `5000`. |
| `JWT_SECRET` | Secreto para firmar tokens. Obligatorio en producción. |
| `DATABASE_URL` | Cadena completa de PostgreSQL, recomendada en Railway. |
| `SUPABASE_DATABASE_URL` | Cadena alternativa para Supabase. |
| `DB_HOST` | Host de PostgreSQL cuando no se usa una URL completa. |
| `DB_PORT` | Puerto de PostgreSQL. Por defecto: `5432`. |
| `DB_USER` | Usuario de PostgreSQL. |
| `DB_PASSWORD` | Contraseña de PostgreSQL. |
| `DB_NAME` | Base de datos. |
| `DB_SSL` | Activa SSL explícitamente. |
| `DB_SSL_REJECT_UNAUTHORIZED` | Controla la validación del certificado SSL. |
| `DB_POOL_MAX` | Máximo de conexiones del pool. |
| `DB_IDLE_TIMEOUT_MS` | Tiempo de inactividad del pool. |
| `DB_CONNECTION_TIMEOUT_MS` | Tiempo máximo para conectar. |
| `FRONTEND_URL` | Origen permitido del frontend. |
| `ALLOWED_ORIGINS` | Lista de orígenes CORS separada por comas. |
| `CORS_CREDENTIALS` | Habilita credenciales CORS. |
| `DB_RUN_LEGACY_CLEANUP` | Ejecuta limpieza heredada al iniciar. Usar con precaución. |
| `SEED_DEFAULT_ADMIN` | Crea un administrador inicial desde variables. |
| `ADMIN_USERNAME` | Usuario del administrador inicial. |
| `ADMIN_PASSWORD` | Contraseña del administrador inicial. |
| `ADMIN_NAME` | Nombre visible del administrador inicial. |
| `ALLOW_USER_CREATION` | Interruptor temporal para creación pública de usuarios. |
| `SMTP_HOST` | Servidor SMTP. |
| `SMTP_PORT` | Puerto SMTP. |
| `SMTP_USER` | Usuario SMTP. |
| `SMTP_PASS` | Contraseña SMTP. |
| `SMTP_FROM` | Remitente de recuperación de contraseña. |
| `PUBLIC_APP_URL` | URL pública usada en enlaces de recuperación. |

Nunca subas `backend/.env` ni credenciales reales al repositorio.

## Configuración de PostgreSQL

### Mediante `DATABASE_URL`

```env
DATABASE_URL=postgresql://usuario:password@host:5432/base
```

Cuando existe `SUPABASE_DATABASE_URL` o `DATABASE_URL`, los campos individuales `DB_*` se ignoran.

### Mediante variables separadas

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=sistema_gestor
```

### Inicialización

Al arrancar, `backend/config/db.js`:

1. Comprueba la conexión.
2. Crea las tablas que falten.
3. Agrega columnas e índices compatibles con versiones anteriores.
4. Inicializa la configuración general.
5. Inicializa el módulo de garantías.
6. Opcionalmente crea el administrador definido en el entorno.

El archivo `backend/schema_all_tables.sql` sirve como referencia del esquema. La migración `backend/db/migrations/20260718_garantias.sql` contiene las tablas específicas de garantías.

## Tablas principales

- `usuarios`
- `clientes`
- `ordenes_servicio`
- `historial_estados`
- `evidencias_orden`
- `inventario`
- `orden_refacciones`
- `movimientos_inventario`
- `ventas`
- `ventas_detalle`
- `cajas`
- `caja_movimientos`
- `cotizaciones`
- `eventos_calendario`
- `configuracion`
- `configuracion_sistema`
- `password_reset_tokens`
- `garantias`
- `ingresos_garantia`
- `historial_garantias`
- `fotos_garantia`
- `costos_garantia`

## Primer administrador

Si no existe un administrador, la pantalla inicial permite crear el primero.

También puede crearse mediante variables:

```env
SEED_DEFAULT_ADMIN=true
ADMIN_USERNAME=administrador
ADMIN_PASSWORD=UNA_CONTRASENA_SEGURA
ADMIN_NAME=Administrador General
```

Después del primer arranque exitoso:

```env
SEED_DEFAULT_ADMIN=false
```

No mantengas la creación pública de usuarios habilitada permanentemente en producción.

## API

La API utiliza el prefijo:

```text
/api
```

Las rutas privadas esperan:

```http
Authorization: Bearer <TOKEN_JWT>
```

### Grupos de endpoints

| Prefijo | Responsabilidad |
|---|---|
| `/api/setup` | Estado inicial y creación controlada de usuarios. |
| `/api/auth` | Inicio de sesión y recuperación de contraseña. |
| `/api/users` | Usuarios, perfil, contraseña y configuración de acceso. |
| `/api/clientes` | CRUD e historial de clientes. |
| `/api/ordenes` | Órdenes, estados, evidencias e historial. |
| `/api/inventario` | Productos, stock y fotografías. |
| `/api/ventas` | Consulta y creación de ventas. |
| `/api/pos` | Ventas POS y cobro de órdenes. |
| `/api/caja` | Apertura, movimientos, cierre e historial. |
| `/api/cotizaciones` | Cotizaciones y conversión a orden. |
| `/api/calendario` | Eventos y órdenes para calendario. |
| `/api/eventos` | CRUD alternativo de eventos. |
| `/api/reportes` | Ingresos, reparaciones y ventas. |
| `/api/configuracion` | Negocio, logos, impresoras, tickets y usuarios. |
| `/api/dashboard` | Estadísticas del dashboard. |
| `/api/garantias` | Garantías, ingresos, fotos, costos e historial. |
| `/api/uploads` | Acceso controlado a archivos subidos. |

### Rutas públicas relevantes

- Consulta de orden por folio.
- Creación pública de cotizaciones.
- Estado de configuración inicial.
- Inicio de sesión y recuperación de contraseña.

El resto de las rutas requiere autenticación, y algunas requieren rol de administrador.

## Archivos y fotografías

- Multer guarda archivos en `backend/uploads/`.
- Tamaño máximo: 10 MB por archivo.
- Formatos permitidos:
  - JPEG/JPG
  - PNG
  - WEBP
  - GIF
  - PDF
  - DOC
  - DOCX

`backend/uploads/` está ignorado por Git.

En Railway, el disco local puede ser efímero. Para conservar archivos después de reinicios o despliegues, configura un volumen persistente o migra los archivos a almacenamiento de objetos.

## Impresión de tickets y etiquetas

El sistema genera:

- Ticket de recepción.
- Ticket de venta.
- Ticket de corte.
- Etiqueta térmica.
- Perfiles de 58 y 80 mm.

El frontend:

1. Construye el ticket en HTML.
2. Lo captura como imagen mediante html2canvas.
3. Lo normaliza para impresión térmica.
4. Envía la imagen a `/api/configuracion/imprimir-ticket`.

El backend utiliza PowerShell y `System.Drawing.Printing` para enviar el trabajo a la impresora.

### Requisitos de impresión directa

- El backend debe ejecutarse en Windows.
- La impresora debe estar instalada en esa misma computadora.
- La cuenta que ejecuta Node debe tener acceso a la impresora.
- Debe seleccionarse la impresora en `Configuración > Impresión de tickets`.

### Limitación en Railway

Un backend alojado en Railway normalmente se ejecuta en Linux y no puede acceder a una impresora USB conectada a la computadora del usuario. Instalar una dependencia únicamente en Railway no elimina esta limitación física.

Para impresión directa desde un dominio se necesita una de estas arquitecturas:

- Backend o agente local en Windows.
- Aplicación de escritorio.
- Puente local de impresión.
- Diálogo nativo del navegador.

La implementación incluida en este estado del proyecto corresponde al flujo de impresión directa local existente en el commit `5eb93da`.

## Despliegue en Railway

### Variables mínimas

```env
NODE_ENV=production
JWT_SECRET=UN_SECRETO_LARGO_Y_ALEATORIO
DATABASE_URL=${{Postgres.DATABASE_URL}}
ALLOWED_ORIGINS=https://tu-dominio.example
PUBLIC_APP_URL=https://tu-dominio.example
```

### Comandos recomendados desde la raíz

Build:

```bash
npm ci && npm --prefix backend ci
```

Start:

```bash
npm start
```

Si Railway usa `backend` como directorio raíz:

```bash
npm ci
npm start
```

El servidor respeta automáticamente la variable `PORT` suministrada por Railway.

### Dominio y CORS

Si frontend y backend usan el mismo dominio, el servidor permite el mismo origen.

Para dominios separados:

```env
FRONTEND_URL=https://frontend.example
ALLOWED_ORIGINS=https://frontend.example,https://admin.example
```

No agregues `/` al final de los orígenes.

## Scripts disponibles

Desde la raíz:

```bash
npm start
npm run dev
npm run build
```

| Script | Acción |
|---|---|
| `npm start` | Inicia `backend/server.js`. |
| `npm run dev` | Inicia el backend con Nodemon. |
| `npm run build` | Comprueba la sintaxis del servidor y del frontend. |

Desde `backend/` están disponibles los mismos scripts principales.

## Validación

La validación actual de compilación es:

```bash
npm run build
```

Este comando ejecuta:

```bash
node --check backend/server.js
node --check frontend/js/app.js
```

Actualmente no existe una suite formal de pruebas automatizadas configurada en `package.json`. Los archivos `backend/test_app.js` y `backend/test_pos.js` son utilidades de comprobación manual y no sustituyen pruebas unitarias o de integración.

## Seguridad

Recomendaciones para producción:

- Utiliza un `JWT_SECRET` largo y aleatorio.
- Usa contraseñas fuertes.
- Desactiva `SEED_DEFAULT_ADMIN` después del primer uso.
- Mantén `ALLOW_USER_CREATION=false`.
- Limita `ALLOWED_ORIGINS`.
- Usa HTTPS.
- No publiques `.env`.
- No registres contraseñas, tokens ni cadenas de conexión.
- Revisa periódicamente `npm audit`.
- Respalda PostgreSQL.
- Protege y respalda el almacenamiento de archivos.
- Restringe el acceso de red a la base de datos.

El limitador de solicitudes incluido funciona en memoria. En despliegues con múltiples instancias conviene reemplazarlo por un almacén compartido, por ejemplo Redis.

## Copias de seguridad

Se recomienda respaldar:

- Base PostgreSQL.
- Directorio o volumen de archivos subidos.
- Logos personalizados.
- Variables de entorno.
- Configuración de la impresora local.

Ejemplo con `pg_dump`:

```bash
pg_dump "$DATABASE_URL" > respaldo.sql
```

Restauración:

```bash
psql "$DATABASE_URL" < respaldo.sql
```

## Solución de problemas

### El servidor no conecta a PostgreSQL

- Revisa `DATABASE_URL` o los campos `DB_*`.
- Comprueba host, puerto, usuario y contraseña.
- Verifica SSL cuando uses un proveedor administrado.
- Confirma que la base acepte conexiones desde el servidor.

### Error de CORS

- Agrega el origen exacto a `FRONTEND_URL` o `ALLOWED_ORIGINS`.
- No incluyas una barra final.
- Reinicia el backend después de cambiar variables.

### El sistema no crea el administrador

- Revisa que no exista ya otro administrador.
- Si usas el entorno, configura las tres variables `ADMIN_*`.
- Activa `SEED_DEFAULT_ADMIN=true` solo durante el arranque necesario.

### Las imágenes desaparecen en Railway

El disco puede ser efímero. Usa un volumen persistente o almacenamiento externo.

### No aparecen impresoras

- Confirma que el backend se ejecuta en Windows.
- Verifica que la impresora esté instalada para el mismo usuario.
- Revisa que PowerShell esté disponible.
- Prueba la impresora desde Windows antes de usar el sistema.

### La impresión funciona localmente pero no en el dominio

El servidor remoto no puede controlar directamente el USB de la computadora cliente. Se necesita un componente local o el diálogo del navegador.

### El navegador muestra una versión anterior

- Recarga con `Ctrl + F5`.
- Limpia la caché.
- Confirma que el despliegue usa el commit esperado.
- Comprueba si `origin/main` contiene los cambios locales.

## Flujo recomendado de desarrollo

1. Crea una rama:

   ```bash
   git switch -c feature/nombre-del-cambio
   ```

2. Ejecuta el sistema:

   ```bash
   npm run dev
   ```

3. Valida:

   ```bash
   npm run build
   git diff --check
   ```

4. Revisa los cambios:

   ```bash
   git status
   git diff
   ```

5. Crea el commit:

   ```bash
   git add .
   git commit -m "Descripción clara del cambio"
   ```

Evita reescribir `main` en un repositorio compartido. Para restaurar funcionalidad publicada, es preferible crear un commit de reversión.

## Limitaciones conocidas

- La impresión directa incluida depende de Windows.
- Los archivos locales requieren almacenamiento persistente en producción.
- El rate limiting está almacenado en memoria.
- No existe una suite automatizada completa.
- El frontend está concentrado principalmente en un archivo JavaScript grande.
- La inicialización automática de esquema facilita el despliegue, pero las migraciones versionadas deberían ser la estrategia principal a largo plazo.

## Mejoras recomendadas

- Agregar pruebas unitarias, de integración y end-to-end.
- Implementar migraciones versionadas para todos los cambios de esquema.
- Usar almacenamiento de objetos para evidencias y logos.
- Incorporar logs estructurados.
- Añadir monitoreo y alertas.
- Documentar la API con OpenAPI.
- Dividir el frontend en módulos.
- Implementar un puente de impresión local mantenible para despliegues web.
- Agregar CI para ejecutar validaciones automáticamente.

## Licencia

El repositorio no incluye actualmente un archivo `LICENSE`. Hasta que se agregue una licencia explícita, no debe asumirse permiso de redistribución o uso fuera del alcance autorizado por el propietario.

## Soporte y mantenimiento

Antes de reportar un problema incluye:

- Commit desplegado.
- Entorno: local o Railway.
- Sistema operativo.
- Navegador.
- Mensaje exacto del error.
- Ruta o módulo afectado.
- Pasos para reproducirlo.
- Logs del backend sin credenciales ni datos sensibles.

