# Catálogos de recepción rápida

## Archivos de esta implementación

- Interfaz: `frontend/catalog/main.jsx`, `frontend/catalog/catalogClient.js`, `frontend/catalog/style.css`, `frontend/index.html`, `frontend/js/quickOrder.js`.
- Backend: `backend/services/catalogService.js`, `backend/services/quickOrderService.js`, `backend/routes/catalogos.js`, `backend/routes/ordenes.js`, `backend/middleware/auth.js`, `backend/server.js`, `backend/config/db.js`.
- Datos: `backend/db/catalogSeed.js`, `backend/db/initCatalog.js`, `backend/db/migrations/20260926_catalogos.sql`.
- Configuración: `package.json`, `package-lock.json`, `vite.config.mjs`, `.gitignore`, `backend/.env.example`; se añadió `CATALOGO_NEGOCIO_ID=1` al `.env` local sin cambiar credenciales.
- Pruebas: `backend/tests/catalog.test.js`, `backend/tests/quick-order.test.js`, `tests/browser/catalog.spec.cjs`, `playwright.config.cjs`.
- Documentación: `CATALOGOS.md`. Los cambios anteriores del formulario rápido se conservaron.

## Uso

En la recepción rápida ambos teléfonos son opcionales. Sin teléfono se crea un cliente
independiente; no se agrupan clientes por contactos vacíos. Tras guardar se conserva
la confirmación y el ticket se abre únicamente con «Imprimir ticket» o «Ver orden».
La actualización posterior recarga clientes y órdenes, y caja si hubo anticipo,
sin recargar inventario, usuarios, cotizaciones ni todos los demás módulos.

Seleccionar Equipo → Marca → Modelo. Se puede buscar sin distinguir mayúsculas ni acentos. Los modelos se consultan por marca, con hasta 50 coincidencias por búsqueda. Fallas y reparaciones usan tags de Ant Design; Enter confirma texto personalizado. Las reparaciones asociadas a cualquiera de las fallas seleccionadas aparecen primero como «Sugerida»; no se seleccionan automáticamente.

Equipo, Marca y Modelo son campos de texto con sugerencias de Ant Design AutoComplete. Lo escrito se conserva inmediatamente, sin pulsar «Agregar», Enter ni confirmar al salir. Se puede elegir una sugerencia o usar texto nuevo. Los valores nuevos se guardan automáticamente en el catálogo del negocio al crear la orden, dentro de la misma transacción. Si la orden falla, el aprendizaje también se revierte. Sin contexto de negocio autorizado se permite texto manual, pero no se guarda en el catálogo. Cambiar equipo limpia marca, modelo, fallas y reparaciones; cambiar marca limpia modelo.

## Instalación y compilación

La interfaz existente era HTML/JavaScript. Los cinco selectores ahora son una isla React + Ant Design, compilada con Vite e integrada en el formulario existente. El resto de la aplicación mantiene sus rutas y componentes.

```sh
npm install
npm --prefix backend install
npm run build
npm start
```

`npm run dev` compila los selectores y arranca el backend con nodemon. Después de editar `frontend/catalog`, ejecutar `npm run build:catalog` y recargar. `frontend/dist` es generado y no se versiona. El formulario original sigue disponible si el bundle no se carga.

Al arrancar el backend, `initCatalog` aplica `backend/db/migrations/20260926_catalogos.sql` y los datos de `catalogSeed.js` en una transacción con bloqueo de migración. No ejecuta el archivo general `schema_all_tables.sql` ni elimina tablas. La versión de semilla impide duplicar/recrear datos en cada arranque.

## Negocio y permisos

Esta copia no incluye multiempresa ni multisucursal para órdenes/clientes. **El aislamiento implementado aquí pertenece al catálogo; no convierte los demás módulos en multiempresa.**

- Si la fila autenticada de `usuarios` tiene una columna `negocio_id`, se usa ese valor consultado desde PostgreSQL. Un valor nulo deshabilita escrituras privadas; no cae al negocio de la instalación.
- En la estructura original, donde dicha columna no existe, configurar `CATALOGO_NEGOCIO_ID` con un entero positivo y exclusivo para el negocio de la instalación. La configuración local y `.env.example` usan `1` para esta instalación de un solo negocio. No compartir esa identificación entre negocios distintos conectados a la misma base.
- Sin contexto de negocio solo se permite leer el catálogo global y usar texto manual, sin aprenderlo.
- El backend ignora `negocio_id` enviado por el cliente o en claims del JWT. Cada consulta limita lecturas a global + negocio autenticado y comprueba también los padres de los elementos.
- Las altas requieren sesión autenticada, igual que la creación de órdenes. La desactivación requiere Administrador y solo permite entradas privadas del propio negocio. Ningún endpoint de usuario modifica el catálogo global.

## Estructura

`tipos_equipo` → `marcas` → `modelos_equipo`; `fallas_catalogo` y `reparaciones_catalogo` pertenecen a un tipo. `falla_reparaciones` permite sugerencias múltiples. Todas tienen `negocio_id` (nulo = global). `catalogo_migraciones` registra versiones. Las claves normalizadas y los índices únicos previenen duplicados por negocio/padre. Las órdenes siguen almacenando los nombres, no dependen de la permanencia de un ID del catálogo.

Las listas múltiples se validan en servidor (1–20 elementos, máximo 250 caracteres por elemento) y se escriben separadas por saltos de línea en `falla_reportada` y `servicio_solicitado`. Las peticiones antiguas con texto simple siguen funcionando. La edición avanzada, pagos, seguimiento, impresión e historial conservan esos campos. No se infieren asociaciones falla↔reparación de tags que solo coinciden en una orden.

## API y administración sin modificar código

Todas las rutas requieren `Authorization: Bearer …`.

| Método y ruta | Función |
| --- | --- |
| `GET /api/catalogos` | Tipos, marcas, fallas, reparaciones y relaciones visibles; indica `puede_guardar`. |
| `GET /api/catalogos/modelos?marca_id=ID&q=A55` | Buscar modelos de una marca visible (máximo 50). |
| `POST /api/catalogos/:kind` | Crear o reutilizar un elemento. `kind`: `tipos`, `marcas`, `modelos`, `fallas`, `reparaciones`. |
| `POST /api/catalogos/relaciones` | Agregar una sugerencia privada con `falla_id` y `reparacion_id` del mismo tipo de equipo. |
| `DELETE /api/catalogos/:kind/:id` | Desactivar un elemento privado (Administrador), sin afectar órdenes antiguas. |
| `POST /api/ordenes/rapida` | Acepta además `fallas: string[]`, `reparaciones: string[]`, `guardar_catalogo: boolean`. |

Ejemplo: para agregar un modelo enviar `{"nombre":"Red Magic 9 Pro","parent_id":123}` a `/api/catalogos/modelos`, donde `123` es una marca visible. Para fallas/reparaciones, `parent_id` es el tipo de equipo; para marcas también es el tipo; para tipos no se envía padre. La respuesta contiene el ID reutilizable inmediatamente. Para corregir una entrada privada se puede desactivar y agregar la correcta; no hay una pantalla de administración adicional.

## Pruebas

`npm test`: regresiones y pruebas de catálogos sobre PostgreSQL embebido (PGlite), aislamiento, migración idempotente, búsquedas y rollback. `npm run test:browser`: pruebas de los componentes compilados en Edge headless con API simulada. Requiere Edge instalado; se puede adaptar `channel` en `playwright.config.cjs` para otro navegador. No reemplazan una verificación contra la base desplegada o una impresora física.
