'use strict';
// No dotenv, CLI secrets, migrations, external HTTP backend, adb or APK access.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const {Pool} = require('pg');
const root = path.resolve(__dirname, '../..');
const report = message => process.stdout.write(message + '\n');
// Dependencies must never print request bodies, tokens, URLs or database errors.
// Console redaction is installed only when this executable runs, not on import.
let admin, pool, server, marker, stage = 'preflight';
let checkName = 'inicio', safeCause = 'No se pudo completar la comprobacion.';
function checkpoint(name, cause) { checkName=name; safeCause=cause; }
const permissionChecks=Object.freeze({
  'permisos.asignar-tecnico':{expected:1,unit:'filas'},
  'permisos.tecnico-no-crea':{expected:403,unit:'HTTP'},
  'permisos.tecnico-no-elimina':{expected:403,unit:'HTTP'},
  'permisos.restaurar-admin':{expected:1,unit:'filas'},
  'permisos.anticipo-offline':{expected:422,unit:'HTTP'},
  'permisos.anonimo':{expected:401,unit:'HTTP'}
});
class SafeCheckFailure extends Error {
  constructor(name,obtained){
    super('Safe validation failure');
    this.check=name;this.obtained=obtained;
  }
}
function expectPermission(name,obtained){
  assert.ok(Object.hasOwn(permissionChecks,name));
  if(obtained!==permissionChecks[name].expected)
    throw new SafeCheckFailure(name,Number.isSafeInteger(obtained)?String(obtained):'no numerico');
}
async function expectPermissionQuery(name,query){
  assert.ok(Object.hasOwn(permissionChecks,name));
  let result;
  try{result=await query();}catch(error){
    // Never copy database messages, details, offending rows, SQL or parameters.
    const causes={'23514':'SQLSTATE 23514 (restriccion CHECK)','42501':'SQLSTATE 42501 (privilegio insuficiente)','23503':'SQLSTATE 23503 (referencia no valida)','28P01':'SQLSTATE 28P01 (autenticacion rechazada)'};
    throw new SafeCheckFailure(name,Object.hasOwn(causes,error?.code)?causes[error.code]:'error SQL no clasificado');
  }
  expectPermission(name,result?.rowCount);
}
async function expectPermissionRequest(name,request){
  assert.ok(Object.hasOwn(permissionChecks,name));
  let result;
  try{result=await request();}catch{throw new SafeCheckFailure(name,'sin respuesta HTTP verificable');}
  expectPermission(name,result?.status);
}
function permissionFailure(error){
  if(!(error instanceof SafeCheckFailure)||!Object.hasOwn(permissionChecks,error.check))return null;
  const spec=permissionChecks[error.check];
  return 'FAIL comprobacion: '+error.check+' | esperado: '+spec.unit+' '+spec.expected+' | obtenido: '+error.obtained;
}
function technicianRoleForConstraint(definition){
  // Narrow compatibility with the existing CHECK. No schema/role/grant changes.
  // Prefer canonical UTF-8; otherwise use only the known legacy encoding.
  assert.equal(typeof definition,'string');
  for(const candidate of ['T\u00e9cnico','T\u00c3\u00a9cnico'])
    if(definition.includes("'"+candidate+"'"))return candidate;
  throw new Error('No known technician role in CHECK');
}
function diagnostic(error) {
  // Only fixed local text is printable. Never interpolate message, stack, SQL or HTTP bodies.
  const causes = {
    '28P01':'Autenticacion PostgreSQL rechazada: revisa usuario y password de esta credencial.',
    '28000':'El servidor rechazo la autorizacion de esta credencial.',
    '3D000':'La base de datos indicada no existe en el destino verificado.',
    '42501':'El rol no tiene permisos para esta comprobacion.',
    '42883':'Falta una funcion requerida del esquema.',
    '42P01':'Falta una tabla requerida del esquema.',
    ENOTFOUND:'No se pudo resolver DNS; revisa la conexion de red y el host introducido.',
    EAI_AGAIN:'La resolucion DNS fallo temporalmente.',
    ECONNREFUSED:'Conexion rechazada por el destino verificado.',
    ECONNRESET:'La conexion fue interrumpida.',
    ETIMEDOUT:'Se agoto el tiempo de conexion.',
    CERT_HAS_EXPIRED:'Certificado TLS vencido; no se desactivo su verificacion.',
    DEPTH_ZERO_SELF_SIGNED_CERT:'Certificado TLS autofirmado rechazado.',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:'No se pudo verificar la cadena TLS.',
    SELF_SIGNED_CERT_IN_CHAIN:'Cadena TLS no confiable; revisa certificados o proxy local.',
    ERR_TLS_CERT_ALTNAME_INVALID:'El certificado TLS no corresponde al host verificado.'
  };
  const code=error?.code || error?.cause?.code;
  if (Object.hasOwn(causes,code)) return causes[code];
  if (['TimeoutError','AbortError'].includes(error?.name)) return 'Se agoto el tiempo de la comprobacion.';
  if (checkName==='permisos-runtime') {
    if (error?.message==='El login de runtime tiene privilegios inseguros.') return 'Runtime rechazado: privilegios elevados, propiedad de tablas RLS o cambio de rol efectivo.';
    if (error?.message==='Ejecuta las migraciones administrativas antes de iniciar el servidor.') return 'runtime_schema_ready no confirma el esquema requerido. Se detuvo sin ejecutar migraciones.';
  }
  return safeCause;
}
const fixtures = [];
let cleanupTables=[];
let stopped=false;
const requests=new AbortController();
const TARGET=Object.freeze({project:'green-mouse-83526553',branch:'br-dawn-heart-bd3sqd27',name:'allfix-staging-offline',endpoint:'ep-blue-lab-bdnti3ov',host:'ep-blue-lab-bdnti3ov.c-8.us-east-2.aws.neon.tech',database:'allfix_db'});
const tables = ['android_sync_receipts','android_refresh_sessions','evidencias_orden','auditoria_ordenes','historial_estados','eventos_calendario','caja_movimientos','cajas','ventas_detalle','ventas','ordenes_servicio','clientes','inventario','marcas','tipos_equipo','usuarios','negocio_logos','archivos','orden_identidades','entidad_identidades','configuracion_sistema','configuracion'];
function verifyIdentity(branch,endpoint){
  assert.equal(branch?.id,TARGET.branch);assert.equal(branch.name,TARGET.name);
  assert.equal(branch.project_id,TARGET.project);assert.ok(!branch.default&&!branch.protected);
  assert.equal(endpoint?.id,TARGET.endpoint);assert.equal(endpoint.branch_id,TARGET.branch);
  assert.equal(endpoint.project_id,TARGET.project);assert.equal(endpoint.host,TARGET.host);
  assert.equal(endpoint.type,'read_write');assert.ok(!endpoint.disabled);
}
function requireBigint(inspection){
  assert.equal(inspection.version,'20261108_android_offline_bigint_v2');
  assert.equal(inspection.bigintReady,true);
  for(const table of ['ordenes_servicio','android_sync_receipts','android_refresh_sessions'])
    assert.ok(inspection.tenantTypes.some(t=>t.table_name===table&&t.tenant_type==='bigint'));
}
async function verifyTLS(native,hostname,label){
  checkpoint(label,'La conexion directa no confirma TLS con certificado y hostname verificados.');
  const c=await native.connect();
  try{
    const stream=c.connection.stream;
    assert.ok(stream.encrypted&&stream.authorized);
    assert.equal(stream.servername,hostname);
    assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,TARGET.database);
    report('PASS '+label+': certificado y hostname verificados, '+stream.getProtocol());
  }finally{c.release();}
}
function checkedConnection(raw, label) {
  checkpoint(label+'-formato','La URL PostgreSQL no tiene un formato valido. Pegala completa en la entrada oculta.');
  const url = new URL(raw);
  safeCause='La URL debe usar postgres o postgresql.';
  assert.ok(['postgres:','postgresql:'].includes(url.protocol));
  safeCause='La URL debe contener usuario, password y nombre de base de datos.';
  assert.ok(url.username && url.password);
  assert.equal(url.pathname,'/'+TARGET.database);
  safeCause='Solo se permite el puerto PostgreSQL 5432.';
  assert.ok(!url.port || url.port==='5432');
  safeCause='No se permiten fragmentos en la URL; verifica la codificacion de caracteres del password.';
  assert.ok(!url.hash);
  safeCause='La URL contiene parametros no permitidos; solo se admiten sslmode y channel_binding.';
  for (const key of url.searchParams.keys()) assert.ok(['sslmode','channel_binding'].includes(key));
  checkpoint(label+'-tls','La URL debe incluir sslmode=require o sslmode=verify-full; se mantiene la verificacion de certificados.');
  assert.ok(['require','verify-full'].includes(url.searchParams.get('sslmode')));
  checkpoint(label+'-endpoint','El host no pertenece a neon.tech o no coincide con el endpoint verificado de allfix-staging-offline. Usa la URL de esa rama.');
  assert.ok(url.hostname.endsWith('.neon.tech'));
  assert.equal(url.hostname,TARGET.host);
  url.search=''; return url;
}

async function main() {
  checkpoint('checkout','No se pudo verificar Git o la rama no es codex/offline-release-integration.');
  assert.equal(execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim(),'codex/offline-release-integration');
  checkpoint('version-node','Se requiere Node 22. Comprueba node --version en esta terminal.');
  assert.equal(Number(process.versions.node.split('.')[0]),22,'Node 22 required');
  for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','JWT_SECRET','ALLFIX_NEON_KEY','ALLFIX_NEON_PROJECT']) {
    checkpoint('entrada-'+key,'Falta el valor requerido; introducelo de nuevo en el prompt local.');
    assert.ok(process.env[key]?.trim());
  }
  const api = async resource => {
    checkpoint(resource.startsWith('/branches')?'api-neon-ramas':'api-neon-endpoints','No se pudo consultar la API de Neon por HTTPS; revisa red, TLS o proxy.');
    const response = await fetch('https://console.neon.tech/api/v2/projects/' + encodeURIComponent(process.env.ALLFIX_NEON_PROJECT) + resource, {
      headers:{Authorization:'Bearer '+process.env.ALLFIX_NEON_KEY},redirect:'error',signal:AbortSignal.timeout(15000)
    });
    if (response.status!==200) {
      const statusCauses={
        401:'API key rechazada o vencida. Usa una API key de Neon, no un password PostgreSQL.',
        403:'La API key no tiene acceso de lectura al proyecto o recurso solicitado.',
        404:'Project ID o recurso no encontrado, o no visible para esta API key. Comprueba ambos en Neon.',
        429:'La API de Neon limito las solicitudes; vuelve a intentar mas tarde.'
      };
      safeCause=statusCauses[response.status] || 'La API de Neon devolvio una respuesta no satisfactoria.';
      assert.fail();
    }
    safeCause='La API de Neon no devolvio JSON valido con el formato esperado.';
    return response.json();
  };
  checkpoint('proyecto-neon','El proyecto no coincide con el staging fijado.');
  assert.equal(process.env.ALLFIX_NEON_PROJECT,TARGET.project);
  const {branch}=await api('/branches/'+TARGET.branch);
  const {endpoint}=await api('/endpoints/'+TARGET.endpoint);
  checkpoint('identidad-neon','La rama, proyecto o endpoint no coincide exactamente con staging.');
  verifyIdentity(branch,endpoint);
  const runtime = checkedConnection(process.env.DATABASE_URL,'runtime'), owner = checkedConnection(process.env.MIGRATION_DATABASE_URL,'administrativa');
  checkpoint('coincidencia-conexiones','Las conexiones runtime y administrativa deben apuntar al mismo host de staging.');
  assert.equal(runtime.hostname.replace('-pooler.','.'),owner.hostname.replace('-pooler.','.'));
  safeCause='Las conexiones runtime y administrativa indican bases diferentes.';
  assert.equal(runtime.pathname,owner.pathname);
  safeCause='Runtime y administrador deben usar usuarios diferentes.';
  assert.notEqual(runtime.username,owner.username);
  assert.equal(decodeURIComponent(runtime.username),'sistema_gestor_app');
  assert.equal(decodeURIComponent(owner.username),'allfix_db_owner');
  report('Destino verificado: allfix-staging-offline / '+endpoint.id+' / '+runtime.pathname.slice(1));
  delete process.env.ALLFIX_NEON_KEY;
  // Block config/env.js entirely, so an existing .env cannot supply alternate targets or integrations.
  const envModule = require.resolve('../config/env');
  require.cache[envModule] = {id:envModule,filename:envModule,loaded:true,exports:{}};
  for (const key of Object.keys(process.env)) if (/^(PG|DB_|SMTP|MAIL|SENDGRID|TWILIO)/.test(key)) delete process.env[key];
  process.env.DATABASE_URL=runtime.toString(); process.env.DB_SSL='true';
  process.env.ANDROID_OFFLINE_ENABLED='true'; process.env.NODE_ENV='test';
  checkpoint('conexion-administrativa','No se pudo conectar o consultar la identidad administrativa; revisa su credencial, red y permisos.');
  admin=new Pool({connectionString:owner.toString(),ssl:{rejectUnauthorized:true},max:1,connectionTimeoutMillis:10000,statement_timeout:20000});
  admin.on('error',()=>{});
  await verifyTLS(admin,owner.hostname,'tls-administrativa');
  const identity=(await admin.query('SELECT current_database() db, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  checkpoint('base-administrativa','La base conectada no coincide con la base de staging solicitada.');
  assert.equal(identity.db,decodeURIComponent(owner.pathname.slice(1)));
  checkpoint('permisos-administrativos','La credencial administrativa no tiene SUPERUSER ni BYPASSRLS; usa el administrador autorizado de staging.');
  assert.ok(identity.rolsuper||identity.rolbypassrls);
  checkpoint('configuracion-runtime','Credencial runtime administrativa o configuracion PostgreSQL rechazada por el backend. Usa el login restringido de staging.');
  ({pool}=require('../config/db')); pool.on('error',()=>{});
  checkpoint('conexion-runtime','No se pudo conectar con runtime; revisa su credencial, red y permisos.');
  const {getPgPoolConfig}=require('../config/pgConfig');
  const probe=new Pool(getPgPoolConfig()); probe.on('error',()=>{});
  try {await verifyTLS(probe,runtime.hostname,'tls-runtime');} finally {await probe.end();}
  await pool.query('SELECT 1');
  checkpoint('permisos-runtime','No se pudo validar el rol runtime o el esquema requerido por el backend.');
  await require('../config/db').initDB();
  checkpoint('backend-bigint','Este ejecutable no esta cargando el backend v2 corregido del checkout actual.');
  const migration=require('../db/androidMigration');
  assert.equal(migration.VERSION,'20261108_android_offline_bigint_v2');
  for(const file of ['../db/androidMigration','../routes/android','../services/quickOrderService','../services/ordenService']) {
    const resolved=fs.realpathSync(require.resolve(file));
    assert.ok(resolved.startsWith(fs.realpathSync(path.join(root,'backend'))+path.sep));
  }
  assert.ok(fs.readFileSync(path.join(root,'backend/routes/android.js'),'utf8').includes('[String(req.user.negocio_id)]'));
  checkpoint('esquema-bigint','Las tres tablas y app_tenant_id deben usar bigint; no se ejecutan migraciones.');
  const inspection=await migration.inspect(admin,'sistema_gestor_app');
  requireBigint(inspection);
  checkpoint('politicas-offline','Las politicas offline no coinciden con el aislamiento original.');
  const policies=(await admin.query("SELECT tablename,policyname,roles::text[] AS roles,cmd,permissive,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[])",[['android_sync_receipts','android_refresh_sessions']])).rows;
  assert.equal(policies.length,2);
  for(const p of policies){
    assert.equal(p.cmd,'ALL');assert.equal(p.permissive,'PERMISSIVE');
    assert.deepEqual(p.roles,['public']);
    assert.equal(p.policyname,p.tablename==='android_sync_receipts'?'android_receipts_tenant':'android_refresh_tenant');
    for(const expression of [p.qual,p.with_check])assert.equal(expression?.replace(/[()\s]/g,''),'negocio_id=app_tenant_id');
  }
  checkpoint('grants-offline','Los permisos runtime de las tablas offline no son los minimos esperados.');
  const grants=(await admin.query("SELECT c.relname,has_table_privilege('sistema_gestor_app',c.oid,'SELECT') AS read,has_table_privilege('sistema_gestor_app',c.oid,'INSERT') AS insert,has_table_privilege('sistema_gestor_app',c.oid,'UPDATE') AS update,has_table_privilege('sistema_gestor_app',c.oid,'DELETE') AS delete,EXISTS(SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee=0) AS public_grant FROM pg_class c WHERE c.oid=ANY(ARRAY['public.android_sync_receipts'::regclass,'public.android_refresh_sessions'::regclass])")).rows;
  assert.equal(grants.length,2);
  for(const g of grants){assert.ok(g.read&&g.insert);assert.equal(g.delete,false);assert.equal(g.public_grant,false);assert.equal(g.update,g.relname==='android_refresh_sessions');}
  report('PASS backend bigint v2: '+crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'backend/routes/android.js'))).digest('hex').slice(0,16));
  checkpoint('preparacion-limpieza','No se pudo determinar el alcance seguro de limpieza.');
  const existing=(await admin.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='negocio_id' ORDER BY table_name")).rows.map(r=>r.table_name);
  cleanupTables=tables.filter(t=>existing.includes(t));
  // Every cleanup name is a fixed literal; no HTTP or credential input becomes SQL.
  assert.ok(cleanupTables.includes('android_sync_receipts')&&cleanupTables.includes('usuarios'));
  checkpoint('compatibilidad-rol-tecnico','usuarios_rol_check no contiene una representacion conocida del rol tecnico; no se modifico el esquema.');
  const roleConstraint=(await admin.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.usuarios'::regclass AND conname='usuarios_rol_check' AND contype='c'")).rows;
  assert.equal(roleConstraint.length,1);
  const technicianRole=technicianRoleForConstraint(roleConstraint[0].definition);
  for (const table of ['ordenes_servicio','android_sync_receipts','android_refresh_sessions']) {
    checkpoint('RLS-'+table,'No se pudo consultar la proteccion RLS de esta tabla.');
    const r=(await admin.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=to_regclass($1)',['public.'+table])).rows[0];
    safeCause=r?'La tabla no tiene ENABLE RLS y FORCE RLS activos. Se detuvo sin cambiar el esquema.':'La tabla requerida no existe en el destino verificado. Se detuvo sin migraciones.';
    assert.ok(r?.relrowsecurity && r.relforcerowsecurity);
  }
  process.env.PORT='0';
  process.argv.push('--dev-preview');
  delete process.env.MIGRATION_DATABASE_URL;
  checkpoint('inicio-backend-local','El backend no pudo iniciar despues de validar las conexiones y el esquema.');
  server=await require('../server').start();
  checkpoint('enlace-loopback','El servidor no esta limitado a 127.0.0.1; ejecucion rechazada.');
  assert.equal(server.address().address,'127.0.0.1');
  const origin='http://127.0.0.1:'+server.address().port;
  const request=async(route,body,token)=>{
    assert.ok(!stopped);
    const r=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([AbortSignal.timeout(20000),requests.signal])});
    return {status:r.status,body:await r.json()};
  };
  checkpoint('salud-backend-local','El backend local no confirmo disponibilidad de la base mediante healthz.');
  assert.equal((await request('/healthz')).status,200);
  marker='offline-test-'+crypto.randomBytes(8).toString('hex'); report('Fixtures: '+marker);
  stage='fixtures';
  for (const label of ['A','B']) {
    const f={name:marker+label};
    // Keep identity creation atomic: no untracked tenant on partial failure.
    const c=await admin.connect();
    try {
      await c.query('BEGIN');
      assert.ok(!stopped);
      for(let attempt=0;attempt<10&&!f.id;attempt++) {
        const candidate=crypto.randomInt(3000000000,4000000000);
        const row=(await c.query('INSERT INTO negocios(id,nombre) VALUES($1,$2) ON CONFLICT(id) DO NOTHING RETURNING id',[candidate,f.name])).rows[0];
        if(row)f.id=row.id;
      }
      assert.ok(f.id,'Could not reserve disposable bigint tenant');
      fixtures.push(f); // Track before COMMIT, including an ambiguous network acknowledgement.
      const password=crypto.randomBytes(24).toString('hex');
      f.user=(await c.query("INSERT INTO usuarios(negocio_id,username,password,rol,nombre) VALUES($1,$2,$3,'Administrador',$2) RETURNING id",[f.id,f.name,await require('bcrypt').hash(password,10)])).rows[0].id;
      await c.query('COMMIT');
      const login=await request('/api/auth/login',{username:f.name,password}); assert.equal(login.status,200); f.token=login.body.token;
    } catch(e) { await c.query('ROLLBACK'); throw e; } finally {c.release();}
  }
  const [a,b]=fixtures;
  const req=(route,body,actor=a)=>request('/api/android'+route,body,actor.token);
  const op=(body,actor=a)=>req('/operations',body,actor);
  stage='CRUD, idempotencia y conflictos';
  assert.equal((await req('/capabilities')).body.refresh,true);
  const create={operationId:crypto.randomUUID(),kind:'create',data:{clientName:marker,deviceType:'Celular',brand:'TEST',model:marker,falla_reportada:'Validacion staging',servicio_solicitado:'Prueba sin cobro',anticipo:0}};
  const copies=await Promise.all(Array.from({length:3},()=>op(create)));
  copies.forEach(r=>assert.equal(r.status,200)); assert.equal(new Set(copies.map(r=>r.body.orderId)).size,1);
  const first=copies[0].body;
  assert.equal((await admin.query('SELECT count(*)::int n FROM ordenes_servicio WHERE negocio_id=$1',[a.id])).rows[0].n,1);
  assert.equal((await admin.query('SELECT count(*)::int n FROM android_sync_receipts WHERE negocio_id=$1 AND operation_id=$2',[a.id,create.operationId])).rows[0].n,1);
  assert.equal((await op({...create,data:{...create.data,model:'different'}})).status,409);
  const edit=await op({operationId:crypto.randomUUID(),kind:'update',orderId:first.orderId,baseVersion:first.version,data:{model:marker+'-edit'}});
  assert.equal(edit.status,200); assert.equal(edit.body.order.model,marker+'-edit');
  assert.equal((await op({operationId:crypto.randomUUID(),kind:'update',orderId:first.orderId,baseVersion:first.version,data:{model:'stale'}})).status,409);
  assert.equal((await op({operationId:crypto.randomUUID(),kind:'update',orderId:first.orderId,baseVersion:edit.body.version,data:{model:'foreign'}},b)).status,409);
  const changed=await op({operationId:crypto.randomUUID(),kind:'status',orderId:first.orderId,baseVersion:edit.body.version,data:{estado:'En reparación'}});
  assert.equal(changed.status,200); assert.equal(changed.body.order.status,'En reparación');
  assert.equal((await req('/orders',undefined,b)).body.orders.length,0);
  const synced=await req('/orders'); assert.equal(synced.status,200);
  assert.equal(synced.body.orders.length,1);
  assert.equal(synced.body.orders[0].order.model,marker+'-edit');
  assert.equal(String(synced.body.orders[0].order.negocio_id),String(a.id));
  assert.equal(synced.body.orders[0].version,changed.body.version);
  report('PASS creacion, edicion, estado, reintentos concurrentes, idempotencia y conflictos');
  stage='permisos';
  await expectPermissionQuery('permisos.asignar-tecnico',()=>admin.query('UPDATE usuarios SET rol=$1 WHERE id=$2 AND negocio_id=$3',[technicianRole,a.user,a.id]));
  try{
    await expectPermissionRequest('permisos.tecnico-no-crea',()=>op({...create,operationId:crypto.randomUUID()}));
    await expectPermissionRequest('permisos.tecnico-no-elimina',()=>op({operationId:crypto.randomUUID(),kind:'delete',orderId:first.orderId,baseVersion:changed.body.version}));
  }finally{
    await expectPermissionQuery('permisos.restaurar-admin',()=>admin.query("UPDATE usuarios SET rol='Administrador' WHERE id=$1 AND negocio_id=$2",[a.user,a.id]));
  }
  await expectPermissionRequest('permisos.anticipo-offline',()=>op({...create,operationId:crypto.randomUUID(),data:{...create.data,anticipo:1}}));
  await expectPermissionRequest('permisos.anonimo',()=>request('/api/android/orders'));
  report('PASS permisos de creacion/borrado, autenticacion y rechazo de pagos offline');
  stage='sesiones';
  const session=await req('/session',{}); assert.equal(session.status,200);
  const refresh=await req('/refresh',{refreshToken:session.body.refreshToken}); assert.equal(refresh.status,200);
  assert.notEqual(refresh.body.refreshToken,session.body.refreshToken);
  assert.equal((await req('/orders',undefined,{token:refresh.body.token})).status,200);
  assert.equal((await req('/refresh',{refreshToken:session.body.refreshToken})).status,401);
  assert.equal((await req('/refresh',{refreshToken:refresh.body.refreshToken})).status,401);
  const ended=await req('/session',{}); assert.equal(ended.status,200);
  assert.equal((await req('/logout',{refreshToken:ended.body.refreshToken})).status,200);
  assert.equal((await req('/refresh',{refreshToken:ended.body.refreshToken})).status,401);
  const revoked=await req('/session',{}); assert.equal(revoked.status,200);
  await admin.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1 AND negocio_id=$2',[a.user,a.id]);
  assert.equal((await req('/refresh',{refreshToken:revoked.body.refreshToken})).status,401);
  // Restore only this disposable identity for subsequent operations.
  await admin.query('UPDATE usuarios SET session_version=session_version-1 WHERE id=$1 AND negocio_id=$2',[a.user,a.id]);
  report('PASS renovacion, rotacion, reutilizacion, logout y revocacion de sesion');
  stage='RLS';
  const bCreated=await op({...create,operationId:crypto.randomUUID(),data:{...create.data,clientName:marker+'B',model:marker+'B'}},b);
  assert.equal(bCreated.status,200);
  assert.equal((await req('/session',{},b)).status,200);
  const bSnapshot=await req('/orders',undefined,b);
  assert.equal(bSnapshot.status,200);assert.equal(bSnapshot.body.orders.length,1);
  assert.equal(bSnapshot.body.orders[0].order.id,bCreated.body.orderId);
  assert.equal(String(bSnapshot.body.orders[0].order.negocio_id),String(b.id));
  const {withTenant}=require('../config/tenantContext');
  for (const [actor,other] of [[a,b],[b,a]]) await withTenant(actor.id,async()=>{
    for (const table of ['ordenes_servicio','android_sync_receipts','android_refresh_sessions']) {
      assert.ok((await pool.query('SELECT 1 FROM '+table+' WHERE negocio_id=$1',[actor.id])).rowCount>0);
      assert.equal((await pool.query('SELECT 1 FROM '+table+' WHERE negocio_id=$1',[other.id])).rowCount,0);
      try {
        assert.equal((await pool.query('UPDATE '+table+' SET negocio_id=negocio_id WHERE negocio_id=$1',[other.id])).rowCount,0);
      } catch (error) {
        // Receipts are intentionally INSERT/SELECT only for the runtime role.
        assert.equal(error.code,'42501');
      }
    }
    for(const [sql,params] of [
      ['INSERT INTO android_sync_receipts(negocio_id,usuario_id,operation_id,request_hash,result) VALUES($1,$2,$3,$4,$5)',[other.id,other.user,crypto.randomUUID(),'0'.repeat(64),'{}']],
      ["INSERT INTO android_refresh_sessions(negocio_id,usuario_id,token_hash,family,session_version,expires_at) VALUES($1,$2,$3,$4,1,now()+interval '1 day')",[other.id,other.user,crypto.randomBytes(32).toString('hex'),crypto.randomUUID()]]
    ]){
      const c=await pool.connect();
      try{await c.query('BEGIN');await assert.rejects(()=>c.query(sql,params),e=>e.code==='42501');}
      finally{await c.query('ROLLBACK');c.release();}
    }
  });
  report('PASS aislamiento HTTP y RLS bidireccional con rol runtime');
  stage='eliminacion';
  const deletion={operationId:crypto.randomUUID(),kind:'delete',orderId:first.orderId,baseVersion:changed.body.version};
  const removed=await op(deletion); assert.equal(removed.status,200); assert.equal(removed.body.deleted,true);
  assert.equal((await op(deletion)).status,200);
  assert.equal((await req('/orders')).body.orders.length,0);
  report('PASS eliminacion y replay de eliminacion');
}
async function cleanFixtures(connection,owned,runMarker,scopedTables) {
  await connection.query('BEGIN');
  try {
    await connection.query('SET CONSTRAINTS ALL DEFERRED');
    for (const f of owned) {
      assert.ok(/^offline-test-[a-f0-9]{16}$/.test(runMarker));
      assert.ok([runMarker+'A',runMarker+'B'].includes(f.name));
      assert.ok(Number.isSafeInteger(Number(f.id))&&Number(f.id)>2147483647);
      const own=(await connection.query('SELECT nombre FROM negocios WHERE id=$1 FOR UPDATE',[f.id])).rows[0];
      if(own) {
        assert.equal(own.nombre,f.name);
        for(const table of scopedTables) {
          assert.ok(tables.includes(table));
          await connection.query('DELETE FROM '+table+' WHERE negocio_id=$1',[f.id]);
        }
        await connection.query('DELETE FROM negocios WHERE id=$1 AND nombre=$2',[f.id,f.name]);
      }
      for(const table of scopedTables) {
        assert.ok(tables.includes(table));
        assert.equal((await connection.query('SELECT 1 FROM '+table+' WHERE negocio_id=$1 LIMIT 1',[f.id])).rowCount,0);
      }
      assert.equal((await connection.query('SELECT 1 FROM negocios WHERE id=$1',[f.id])).rowCount,0);
    }
    await connection.query('COMMIT');
  } catch(error) {await connection.query('ROLLBACK');throw error;}
}
async function cleanup() {
  if(!fixtures.length)return;
  for(let attempt=1;attempt<=3;attempt++) {
    let c;
    try {
      c=await admin.connect();
      await cleanFixtures(c,fixtures,marker,cleanupTables);
      report('PASS limpieza de fixtures y ausencia de residuos verificadas'); return;
    } catch(error) {if(error.code==='ERR_ASSERTION'||attempt===3)throw error;}
    finally {c?.release();}
  }
}
async function run(){
  for(const method of ['log','error','warn','info','debug'])console[method]=()=>{};
  const stop=()=>{stopped=true;requests.abort();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  let failed=false;
  try{await main();}catch(error){
    failed=true;
    report(permissionFailure(error)||(stage==='preflight'?'FAIL comprobacion: '+checkName+' | '+diagnostic(error):'FAIL fase: '+stage+' | detalles sensibles suprimidos.'));
  }finally{
    if(server){server.closeIdleConnections?.();await new Promise(resolve=>server.close(resolve));}
    // Drain/close the runtime before admin cleanup, including handlers whose client
    // disconnected: no late refresh/receipt transaction may recreate a fixture.
    if(pool){try{await pool.end();}catch{failed=true;report('FAIL cierre del runtime; validacion no certificada.');}pool=null;}
    try{await cleanup();}catch{failed=true;report('FAIL limpieza: conserva el marcador '+marker+' para recuperacion manual; no se amplio el alcance.');}
    await Promise.allSettled([admin?.end()]);
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  }
  report(failed||stopped?'VALIDACION NO CERTIFICADA':'VALIDACION COMPLETA OK');
  process.exitCode=failed||stopped?1:0;
}
if(require.main===module)run().catch(()=>{report('FAIL finalizacion segura; validacion no certificada.');process.exitCode=1;});
module.exports={TARGET,verifyIdentity,checkedConnection,requireBigint,verifyTLS,cleanFixtures,diagnostic,checkpoint,technicianRoleForConstraint,expectPermission,expectPermissionQuery,expectPermissionRequest,permissionFailure};
