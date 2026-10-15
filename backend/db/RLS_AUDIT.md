# Auditoría RLS y aislamiento de tenant — 2026-10-14

Informe histórico del estado anterior. Los hallazgos se corrigieron posteriormente;
véase RLS_HARDENING.md: auditoría real final **168/168**, sin fallos críticos.

**Resultado: no aprobado para dar por terminado el aislamiento multiempresa.**
Se auditó el servidor local Node.js y la base real indicada por su configuración,
no solamente PostgreSQL embebido o un rol simulado. No se modificaron políticas,
credenciales, lógica operativa, frontend ni mecanismos de impresión durante esta
auditoría. Se añadieron este informe y un ejecutor de pruebas reproducible.

## Rol real y límites de FORCE RLS

| Contexto comprobado | Rol | Propietario de tablas | Superusuario | BYPASSRLS |
| --- | --- | --- | --- | --- |
| Login de la conexión / `session_user` | `postgres` | Sí | Sí | Sí |
| `current_user` en petición autenticada | `sistema_gestor_tenant` | No | No | No |
| Después de `RESET ROLE` en esa misma conexión | `postgres` | Sí | Sí | Sí |

El rol tenant también es NOLOGIN, NOCREATEROLE y NOCREATEDB, sin membresías
ascendentes. `postgres` es miembro de ese rol. `createTenantPool` cambia el rol
efectivo y establece `app.negocio_id`, pero no cambia la identidad privilegiada
con la que se autenticó la conexión.

Se reprodujo, dentro de transacciones revertidas, que `RESET ROLE` permite
recuperar `postgres` y leer el cliente del otro negocio. Esto demuestra una
capacidad del login SQL; no se descubrió un endpoint que acepte SQL arbitrario
ni se afirma que un cliente HTTP pueda enviar `RESET ROLE` directamente.

Las 32 tablas protegidas tienen tanto ENABLE como FORCE ROW LEVEL SECURITY.
El rol efectivo tenant no es propietario, por lo que ENABLE ya le aplica RLS.
FORCE añade protección para propietarios ordinarios, pero **no limita a un
superusuario ni a un rol BYPASSRLS**. Añadir otro FORCE no resuelve este hallazgo.
El pool de peticiones necesita un login propio sin estos privilegios, separado
del utilizado para migraciones y consultas de autenticación estrictamente acotadas.

El entorno verificado es `NODE_ENV=development`. No hay un despliegue de
producción accesible/verificable en esta sesión. El código de producción utiliza
la misma resolución de variables: SUPABASE_DATABASE_URL, DATABASE_URL o DB_USER
y otras DB_*. Esto no demuestra cuál es el rol efectivo de un servidor de
producción externo. **Producción queda sin certificar**, no asumida equivalente
al entorno local.

## Cobertura de tablas y permisos

RLS y FORCE están activos en:

- configuracion, configuracion_sistema, usuarios, clientes, ordenes_servicio;
- historial_estados, evidencias_orden, auditoria_ordenes;
- inventario, movimientos_inventario, orden_refacciones,
  orden_reparaciones_adicionales;
- ventas, ventas_detalle, cajas, caja_movimientos;
- cotizaciones, eventos_calendario;
- garantias, ingresos_garantia, historial_garantias, fotos_garantia, costos_garantia;
- password_reset_tokens;
- tipos_equipo, marcas, modelos_equipo, fallas_catalogo, reparaciones_catalogo,
  falla_reparaciones;
- negocio_logos y negocios.

Las políticas de datos privados tienen USING y WITH CHECK con
`negocio_id = app_tenant_id()`. El registro de negocios filtra por su id. Los seis
catálogos admiten lectura de entradas compartidas con negocio_id NULL; el rol
tenant no puede escribir esas entradas compartidas.

catalogo_migraciones, tenant_migraciones y order_folio_counters no tienen RLS,
pero el rol tenant no tiene SELECT. No se encontraron vistas públicas adicionales
que expongan estos datos. La única función SECURITY DEFINER ejecutable por el
rol tenant es allocate_order_folio: administra el contador, exige tenant y no
devuelve identidad ni registros de otro negocio. Las funciones de triggers
initialize_business_config y track_order_folio no son ejecutables directamente
por el rol tenant.

No hay una tabla separada de existencias: stock está en inventario y los cambios
se registran en movimientos_inventario. Tampoco hay una tabla general de archivos:
existen registros de evidencias/fotos/logos, pero los bytes se sirven desde disco.

## Defensa de aplicación y autoridad del tenant

authMiddleware verifica la firma del JWT y consulta al usuario por decoded.id.
Su negocio_id, rol, actividad y versión de sesión salen de PostgreSQL. Un claim
negocio_id del JWT no establece el tenant. AsyncLocalStorage transmite el tenant
validado al pool. Sin tenant, las tablas privadas no devuelven registros.

La prueba HTTP con dos usuarios realmente autenticados confirmó que un
negocio_id ajeno en query, body, headers y un JWT firmado con el id del usuario
original no permite cambiar de negocio. Configuración filtra explícitamente por
req.user.negocio_id y verifica la pertenencia de los logos. Catálogos también
filtran explícitamente y validan los padres antes de crear relaciones.

**No se cumple todavía la exigencia de no depender solamente de RLS para filtrar
filas:** diversas consultas de usuarios, clientes, órdenes/detalles, ventas,
inventario, caja, garantías, eventos, reportes y dashboard utilizan id, folio o
filtros funcionales sin un predicado SQL de negocio_id. Su aislamiento de filas
depende del contexto autenticado y de RLS. Ejemplos concretos:

- services/ordenService.js: getAllOrdenes y getOrdenById;
- routes/users.js: listado de usuarios;
- routes/inventario.js: listado, detalle y actualizaciones;
- routes/reportes.js y routes/dashboard.js: agregaciones;
- services/cajaService.js y services/garantiaService.js: consultas por id/estado.

Además, updateCliente devuelve `{ id, ...data }` sin comprobar rowCount y su ruta
responde 200. La prueba comprobó que la fila ajena queda intacta, pero ese endpoint
puede aparentar éxito aunque RLS haya actualizado cero filas; debería devolver
404. No debe confundirse el éxito de la comprobación de integridad con un rechazo
HTTP correcto. Este detalle adicional se identificó revisando la implementación;
el ejecutor actual comprueba integridad, no exige 404 en esa actualización.

Ninguna de las 32 tablas protegidas depende *solo* de filtrado de aplicación
para sus filas. El problema inverso existe: consultas que dependen de RLS sin el
filtro explícito adicional solicitado. Las relaciones de catálogos dependen de
validación de aplicación; RLS de las filas no valida sus referencias.

La consulta pública `/api/ordenes/folio/:folio` usa intencionalmente un contexto
privilegiado y devuelve una lista limitada de información pública. Es una excepción
al aislamiento autenticado por diseño; no debe presentarse como un endpoint que
siempre rechaza consultar otro negocio. Esta auditoría no cambió ese flujo.

## Prueba real A/B y hallazgos reproducidos

Ejecutor: `node backend/scripts/audit-tenant-live.js`, con Node local activo.
El script usa el mismo pool, variables de conexión y createTenantPool del servidor.
No modifica .env y no imprime contraseñas ni tokens. Crea dos negocios temporales
con usuarios, clientes, órdenes, ventas de total cero, productos y tipos privados;
autentica ambos por `/api/auth/login` y limpia los fixtures en finally.

Resultado final: **97 comprobaciones, 90 satisfactorias y 7 fallidas**. Los
duplicados A→B y B→A corresponden a los mismos hallazgos, no a siete defectos
independientes. El ejecutor termina con código 2 cuando encuentra incumplimientos.

Satisfactorias:

- Configuración propia aunque query/header/body/JWT indiquen otro negocio;
  actualización del body no modifica configuración ajena.
- Lectura ajena de clientes, órdenes e inventario devuelve 404; actualización
  ajena de cliente no cambia datos; eliminación ajena devuelve 404.
- Listas de usuarios y ventas no incluyen al otro tenant.
- Crear un evento con la orden de otro tenant falla por la relación protegida.
- SELECT/UPDATE/DELETE con negocio_id ajeno no devuelve/modifica/elimina filas
  bajo el rol efectivo en las 31 tablas que tienen la columna negocio_id, o recibe
  rechazo de permisos. Las tablas sin fixtures se complementaron con inspección
  de sus políticas; no se presume cobertura de todos sus endpoints.
- Orden con cliente de otro tenant falla con PostgreSQL 23503 al comprobar
  restricciones diferidas.
- Consulta privada sin tenant devuelve cero registros.

Hallazgos:

1. **Login SQL privilegiado (A→B y B→A):** RESET ROLE recupera postgres y la
   consulta ajena devuelve una fila. FORCE no lo impide.
2. **Relación de catálogo (A→B y B→A):** SQL puede insertar una marca propia
   cuyo tipo_equipo_id es privado del otro negocio. El endpoint valida el padre,
   pero la base no impone esa pertenencia en la relación.
3. **Referencias de auditoría (A→B y B→A):** SQL puede insertar una fila propia
   en auditoria_ordenes con orden_id y usuario_id ajenos. RLS comprueba el tenant
   de la fila, no esas referencias. La eventual corrección debe conservar registros
   históricos de órdenes eliminadas, sin introducir una FK que los destruya.
4. **Archivo privado:** se creó una evidencia de B con visible_cliente=false;
   GET /uploads/<archivo> con el token de A devolvió **200**. express.static en
   server.js sirve el archivo sin comprobar sesión/propietario. routes/uploads.js
   contiene otro montaje estático. Los logos públicos son una excepción de marca;
   la evidencia privada no debe tratarse como branding público. RLS del registro
   no protege los bytes del archivo.

No se invocaron cobros, impresión, movimientos financieros o cambios de stock.
Las inserciones SQL de prueba se limpiaron; los ensayos de escrituras SQL se
revirtieron. Las secuencias de ids pueden avanzar por los fixtures, como ocurre
con cualquier inserción/rollback de PostgreSQL.

## Integridad final y validación

- Negocios existentes tras limpiar: 1; negocios temporales restantes: 0.
- Órdenes históricas: 47; ventas: 17; configuración: 1.
- La configuración de Allfix coincide íntegramente con configuracion_antes de
  la migración, excluyendo únicamente el negocio_id añadido.
- El hash de todas las configuraciones antes/después del ensayo coincide.
- Compilación backend: 63 archivos JavaScript comprobados.
- Suite backend: 115 pruebas satisfactorias. Esas pruebas previas no detectaban
  los cuatro hallazgos de esta auditoría real.

La salida detallada local está en db/backups/rls-audit-final.json (ignorada por
Git). No se hizo push. No se consideran resueltos los hallazgos por haber pasado
la suite habitual; esta auditoría no certifica el aislamiento para producción.
