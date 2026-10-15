# Corrección del aislamiento — 2026-10-14

Este documento sustituye la conclusión pendiente de RLS_AUDIT.md; ese informe
se conserva como evidencia del estado anterior. Los resultados finales de la
auditoría real se guardan localmente en db/backups/rls-approved-live.json.

**Resultado local: 168/168 comprobaciones de aislamiento satisfactorias, cero
fallos críticos pendientes.** Compilación completa aprobada, 117 pruebas de backend
y 51 pruebas de navegador aprobadas; las pruebas de tickets/transporte también
pasaron. La primera ejecución de navegador tuvo dos fallos de tiempo durante la
compilación concurrente; los dos casos y la suite completa posterior pasaron.

La comparación íntegra de todas las filas y columnas originales con el primer
respaldo (`full-before-rls-1791987973517.json`) fue satisfactoria. Se mantienen:
configuración 1, órdenes 47, ventas 17, clientes 54, cajas 2, movimientos de caja 30,
auditorías 9, garantías 5 e historial de estados 140. Solo se añadieron metadatos,
columnas generadas, restricciones y versiones de migración; no se recreó Allfix
ni se cambiaron folios. Los fixtures temporales fueron eliminados.

## Conexiones y despliegue

El servidor usa exclusivamente DATABASE_URL (o DB_* de runtime) y se conecta como
**sistema_gestor_app**, LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB,
NOCREATEROLE, NOREPLICATION. No posee ninguna tabla protegida. Su única membresía
es sistema_gestor_tenant, que es NOLOGIN y no tiene miembros ascendentes ni
privilegios administrativos. No se ejecuta SET ROLE en el pool de runtime.
RESET ROLE conserva el login sistema_gestor_app.

CONNECT, USAGE de public, secuencias necesarias y permisos de datos se heredan del
rol de políticas restringido. La secuencia de negocios no está disponible para
runtime; no puede aprovisionar negocios ni modificar sus registros o identidades
históricas. CREATE en public y TEMPORARY público fueron revocados. No puede
desactivar RLS, cambiar políticas/propietarios, crear roles ni concederse postgres.

**MIGRATION_DATABASE_URL** usa el administrador existente (`postgres` en esta
instalación). Solo config/migrationDb.js y los scripts CLI la utilizan. El servidor
no importa ese módulo ni ejecuta inicialización DDL, seeds o migraciones al iniciar.
Su inicio comprueba el login, todos sus roles ascendentes, propietarios y la versión
de esquema; si encuentra privilegios inseguros o migraciones pendientes, no escucha.
Los nombres administrativos habituales se rechazan antes de crear la conexión.

Producción debe configurar dos credenciales diferentes, sin compartir el login:

- DATABASE_URL: credencial no privilegiada de sistema_gestor_app.
- MIGRATION_DATABASE_URL: credencial administrativa para el job CLI de migraciones.
- JWT_SECRET: conservar/configurar el secreto de autenticación; no está versionado.
- DB_SSL y DB_SSL_REJECT_UNAUTHORIZED según el servidor PostgreSQL.

Comandos manuales, con escritores detenidos:

```
npm --prefix backend run backup
npm --prefix backend run migrate:security
npm --prefix backend start
```

El script realiza respaldo completo y aplica v3–v8 en una transacción con advisory
lock y comprobaciones de integridad. Reejecutarlo no reaplica migraciones ni rota
la contraseña configurada de runtime. El ajuste automático de .env es exclusivamente
local; producción exige una DATABASE_URL de runtime ya suministrada por su gestor
de secretos y nunca intenta escribir .env. No se
versionan contraseñas ni respaldos. Una instalación nueva primero necesita el
esquema base y v1/v2 en el job administrativo, antes del endurecimiento.
La primera cuenta/negocio se aprovisiona por el administrador de plataforma;
las rutas públicas de registro responden 403. Los administradores autenticados
siguen creando usuarios exclusivamente dentro de su negocio.

El despliegue externo de producción no fue accesible en esta sesión. Se validó la
base conectada y el servidor local; la configuración y el guard quedan preparados
para producción, sin afirmar que sus credenciales externas ya estén instaladas.

## Tenant y transacciones

El JWT se verifica en Node; id, rol, actividad, versión de sesión y negocio se
contrastan con usuarios mediante una función SQL acotada. negocio_id no se toma
de claims, body, query ni headers. AsyncLocalStorage mantiene el tenant validado.

Cada unidad de trabajo inicia BEGIN y aplica
`set_config('app.negocio_id', tenantValidado, true)` (**SET LOCAL**). Las
transacciones explícitas de servicios financieros conservan sus límites y cálculos.
Las consultas individuales tienen una transacción corta propia. COMMIT/ROLLBACK
elimina automáticamente el contexto; el socket no vuelve al pool hasta finalizar.
No existe el antiguo set_config(..., false) ni una conexión administrativa oculta.
withSystemContext no otorga privilegios al pool de runtime.

ENABLE y FORCE RLS permanecen en las 36 tablas protegidas. Las consultas sensibles
de configuración, usuarios, clientes, órdenes/evidencias, inventario, ventas,
caja, garantías, reportes y archivos incluyen además predicados explícitos con
negocio_id o app_tenant_id(), derivado del contexto autenticado.

La autenticación global previa al tenant se limita a capacidades SQL concretas:
auth_login verifica bcrypt mediante pgcrypto y devuelve identidad, nunca hashes;
resolución de sesión/email y tokens de recuperación devuelven campos mínimos.
Dentro de un tenant establecido, las resoluciones de identidad también filtran
ese negocio. Las funciones SECURITY DEFINER tienen search_path fijo, SQL
parametrizado, sin SQL dinámico de entradas HTTP y EXECUTE revocado a PUBLIC.
No conceden lectura global de tablas al login de runtime.

## Referencias

Los siete fallos originales eran cuatro defectos repetidos en ambas direcciones:
RESET ROLE (2), padre de catálogo ajeno (2), referencias de auditoría ajenas (2)
y evidencia privada descargable (1). Todos están cubiertos por la prueba nueva.

- Las FK de negocio existentes se conservan y las referencias a usuarios,
  clientes, órdenes, productos, ventas, cajas, movimientos, garantías y evidencias
  se comprueban por (id, negocio_id).
- Catálogos tienen tenant_scope generado (0 compartido o negocio propietario) y
  UNIQUE(id, tenant_scope). Cada hija tiene el scope de su padre, una CHECK que
  admite solamente 0 o su propio negocio y una FK compuesta. El servicio deriva
  ese scope del padre validado, no del payload.
- orden_identidades conserva los ids de órdenes eliminadas. Dos auditorías
  históricas sin orden viva se preservaron; sus nuevas FK apuntan a esa identidad
  y al usuario del mismo tenant.
- entidad_identidades protege referencias polimórficas de caja a orden/venta/caja,
  incluidas referencias históricas a registros eliminados. Una FK compuesta valida
  tipo, id y negocio; no se modificaron montos, saldos ni referencias existentes.
- Configuración, inventario, evidencias y fotos de garantía tienen FK de archivo y
  negocio. documento_archivos normaliza URLs de los JSON de órdenes/cotizaciones
  y las protege con FK a documento y archivo del mismo tenant.

Los triggers se usan únicamente para conservar identidades históricas y normalizar
arrays JSON, que no pueden participar directamente en una FK. **La integridad de
pertenencia la imponen las restricciones declarativas**, no una validación SQL
condicional del trigger.

## Archivos y cambios de autorización

Se quitaron ambos montajes express.static de backend/uploads: server.js y
routes/uploads.js. Las rutas /uploads/:filename, /api/uploads/uploads/:filename,
/api/uploads/:filename y /api/archivos/id/:id consultan el registro archivos.
Para privados exigen sesión vigente, negocio_id autenticado y propiedad; ajenos
devuelven 404, sin sesión 401. Solo logos registrados explícitamente como públicos
y sin referencias privadas pueden servirse sin sesión. Archivos no registrados
no tienen fallback estático ni se asignan automáticamente a Allfix.

Las nuevas subidas se registran bajo req.user.negocio_id. Para <img> del sistema
se emite una cookie de sesión de archivos HttpOnly/SameSite=Strict (Secure en
producción) después de verificar el bearer; se valida el mismo JWT y su versión de
sesión al entregar el archivo. No se modificó frontend para agregar tokens a URLs.
Los privados usan Cache-Control private/no-store, nombres estrictos, raíz fija y
sin mensajes de error que expongan rutas físicas. Las rutas codificadas, traversal
y descargas por id se comprobaron en la auditoría.

**La consulta por folio ahora también requiere autenticación y el tenant correcto.**
El seguimiento por QR pedirá sesión; se eliminó la capacidad SQL de consulta
pública entre negocios. No cambiaron el QR, los folios, los tickets ni sus APIs
de impresión. Este es un cambio de autorización necesario, no de diseño.

## Validación e integridad

La auditoría usa usuarios A/B realmente autenticados contra Node. Setup y limpieza
de fixtures usan explícitamente el pool de migración; **todas las comprobaciones de
runtime utilizan exactamente DATABASE_URL y el login sistema_gestor_app**, sin
SET ROLE artificial a un rol de prueba. Incluye lectura, actualización, borrado,
FK, roles, archivos, cookies/revocación y una conexión física reutilizada con max=1
alternando A/B, comprobando contexto limpio tras commit y rollback.

La suite embebida también aplica las nuevas restricciones de catálogos, archivos
y referencias financieras, y conserva las pruebas de cálculos/rollback existentes.
La compilación y las pruebas de tickets/transporte se ejecutan sin modificar sus
fuentes. Los resultados y la comparación integral con el primer respaldo se
detallan en el resumen final de esta sesión; no se consideran aprobados si quedan
fallos críticos. No se hizo push.
