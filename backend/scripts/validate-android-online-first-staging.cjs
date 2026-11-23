'use strict';
// No dotenv, CLI secrets, migrations, external HTTP backend, adb or APK access.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const {Pool} = require('pg');
const root = path.resolve(__dirname, '../..');
const report = message => process.stdout.write(message + '\n');
// Dependencies must never print request bodies, tokens, URLs or database errors.
for (const method of ['log','error','warn','info','debug']) console[method] = () => {};
let admin, pool, server, marker, stage = 'preflight';
let checkName = 'inicio', safeCause = 'No se pudo completar la comprobacion.';
function checkpoint(name, cause) { checkName=name; safeCause=cause; }
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
const tables = ['caja_movimientos','caja_sesiones','cajas','android_sync_receipts','android_refresh_sessions','historial_estados','auditoria_ordenes','ordenes_servicio','clientes','usuarios','orden_identidades','entidad_identidades','negocio_logos','archivos','configuracion_sistema','configuracion','order_folio_counters'];
async function main() {
  // Credentials arrive over a non-echoed stdin pipe, never command arguments or files.
  const input=await new Promise((resolve,reject)=>{
    if(process.stdin.isTTY)process.stdin.setRawMode(true);
    process.stdin.resume();
    let text='';process.stdin.setEncoding('utf8');
    process.stdin.on('data',chunk=>{
      text+=chunk;if(text.length>32768)return reject(Error('Input too large'));
      if(/[\r\n]/.test(text)){process.stdin.pause();try{resolve(JSON.parse(text.trim()));}catch{reject(Error('Invalid input'));}}
    });
  });
  assert.equal(input.branchId,'br-dawn-heart-bd3sqd27');
  assert.equal(input.branchName,'allfix-staging-offline');
  assert.equal(input.production,false);
  const endpoint={id:'ep-blue-lab-bdnti3ov',host:'ep-blue-lab-bdnti3ov.c-8.us-east-2.aws.neon.tech'};
  process.env.DATABASE_URL=input.runtime;
  process.env.MIGRATION_DATABASE_URL=input.owner;
  process.env.JWT_SECRET=crypto.randomBytes(48).toString('hex');
  function checked(raw, label) {
    checkpoint(label+'-formato','La URL PostgreSQL no tiene un formato valido. Pegala completa en la entrada oculta.');
    const url = new URL(raw);
    safeCause='La URL debe usar postgres o postgresql.';
    assert.ok(['postgres:','postgresql:'].includes(url.protocol));
    safeCause='La URL debe contener usuario, password y nombre de base de datos.';
    assert.ok(url.username && url.password && url.pathname.length>1);
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
    assert.equal(url.hostname.split('.')[0].replace(/-pooler$/,''),endpoint.id);
    if (endpoint.host) assert.equal(url.hostname.replace('-pooler.','.'),endpoint.host.replace('-pooler.','.'));
    url.search=''; return url;
  }
  const runtime = checked(process.env.DATABASE_URL,'runtime'), owner = checked(process.env.MIGRATION_DATABASE_URL,'administrativa');
  checkpoint('coincidencia-conexiones','Las conexiones runtime y administrativa deben apuntar al mismo host de staging.');
  assert.equal(runtime.hostname.replace('-pooler.','.'),owner.hostname.replace('-pooler.','.'));
  safeCause='Las conexiones runtime y administrativa indican bases diferentes.';
  assert.equal(runtime.pathname,owner.pathname);
  safeCause='Runtime y administrador deben usar usuarios diferentes.';
  assert.notEqual(runtime.username,owner.username);
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
  const identity=(await admin.query('SELECT current_database() db, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  checkpoint('base-administrativa','La base conectada no coincide con la base de staging solicitada.');
  assert.equal(identity.db,decodeURIComponent(owner.pathname.slice(1)));
  checkpoint('permisos-administrativos','La credencial administrativa no tiene SUPERUSER ni BYPASSRLS; usa el administrador autorizado de staging.');
  assert.ok(identity.rolsuper||identity.rolbypassrls);
  checkpoint('configuracion-runtime','Credencial runtime administrativa o configuracion PostgreSQL rechazada por el backend. Usa el login restringido de staging.');
  ({pool}=require('../config/db')); pool.on('error',()=>{});
  checkpoint('conexion-runtime','No se pudo conectar con runtime; revisa su credencial, red y permisos.');
  await pool.query('SELECT 1');
  checkpoint('permisos-runtime','No se pudo validar el rol runtime o el esquema requerido por el backend.');
  await require('../config/db').initDB();
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
    const r=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
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
      f.id=(await c.query('INSERT INTO negocios(nombre) VALUES($1) RETURNING id',[f.name])).rows[0].id;
      const password=crypto.randomBytes(24).toString('hex');
      f.user=(await c.query("INSERT INTO usuarios(negocio_id,username,password,rol,nombre) VALUES($1,$2,$3,'Administrador',$2) RETURNING id",[f.id,f.name,await require('bcrypt').hash(password,10)])).rows[0].id;
      await c.query('COMMIT'); fixtures.push(f);
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
  report('PASS creacion, edicion, estado, reintentos concurrentes, idempotencia y conflictos');
  stage='compuerta y recibos online-first';
  assert.equal((await req('/capabilities')).body.onlineCreate,true);
  process.env.ANDROID_RETIRE_LEGACY_WRITES='true';
  const online={...create,operationId:crypto.randomUUID(),flow:'online-first',data:{...create.data,clientName:marker+'-online'}};
  assert.equal((await op({...online,flow:undefined})).status,426);
  const receipt=await op(online); assert.equal(receipt.status,200); assert.ok(receipt.body.order.folio);
  assert.deepEqual((await req('/receipts/'+online.operationId)).body,receipt.body);
  assert.equal((await req('/receipts/'+online.operationId,undefined,b)).status,404);
  assert.equal((await op(online)).body.orderId,receipt.body.orderId);
  assert.equal((await op({...online,data:{...online.data,model:'changed'}})).status,409);
  process.env.ANDROID_RETIRE_LEGACY_WRITES='false';
  report('PASS compuerta, recibos online-first, reintento y aislamiento');
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
  const {withTenant}=require('../config/tenantContext');
  for (const [actor,other] of [[a,b],[b,a]]) await withTenant(actor.id,async()=>{
    for (const table of ['ordenes_servicio','android_sync_receipts','android_refresh_sessions']) {
      assert.equal((await pool.query('SELECT 1 FROM '+table+' WHERE negocio_id=$1',[other.id])).rowCount,0);
      try {
        assert.equal((await pool.query('UPDATE '+table+' SET negocio_id=negocio_id WHERE negocio_id=$1',[other.id])).rowCount,0);
      } catch (error) {
        // Receipts are intentionally INSERT/SELECT only for the runtime role.
        assert.equal(error.code,'42501');
      }
    }
    const c=await pool.connect();
    try {await c.query('BEGIN'); await assert.rejects(()=>c.query('INSERT INTO android_sync_receipts(negocio_id,usuario_id,operation_id,request_hash,result) VALUES($1,$2,$3,$4,$5)',[other.id,other.user,crypto.randomUUID(),'0'.repeat(64),'{}']),e=>e.code==='42501');}
    finally {await c.query('ROLLBACK');c.release();}
  });
  report('PASS aislamiento HTTP y RLS bidireccional con rol runtime');
  stage='eliminacion';
  const deletion={operationId:crypto.randomUUID(),kind:'delete',orderId:first.orderId,baseVersion:changed.body.version};
  const removed=await op(deletion); assert.equal(removed.status,200); assert.equal(removed.body.deleted,true);
  assert.equal((await op(deletion)).status,200);
  assert.deepEqual((await req('/orders')).body.orders.map(row=>row.order.id),[receipt.body.orderId]);
  report('PASS eliminacion y replay de eliminacion de fixture sintetico');
  const pending={operationId:crypto.randomUUID(),kind:'create',data:{...create.data,model:'Cancel-before-apply'}};
  const cancelled=await req('/operations/cancel',pending);
  assert.equal(cancelled.status,200);assert.equal(cancelled.body.cancelled,true);
  assert.equal((await op(pending)).body.cancelled,true);
  assert.deepEqual((await req('/orders')).body.orders.map(row=>row.order.id),[receipt.body.orderId]);
  const late=await req('/operations/cancel',deletion);
  assert.equal(late.body.deleted,true);assert.notEqual(late.body.cancelled,true);
  report('PASS cancelacion atomica, replay y confirmacion de eliminacion ya aplicada');
  stage='creacion avanzada y compatibilidad web';
  const cash=await request('/api/caja/abrir',{monto_inicial:0},a.token);
  assert.ok([200,201].includes(cash.status),'Synthetic cash register open');
  const advanced={...online,kind:'create-full',operationId:crypto.randomUUID(),
    data:{...online.data,clientName:marker+'-full',model:marker+'-full',costo_estimado:150,anticipo:40,metodo_pago_anticipo:'Efectivo'}};
  const advancedRetries=await Promise.all([op(advanced),op(advanced),op(advanced)]);
  for(const result of advancedRetries)assert.equal(result.status,200);
  const full=advancedRetries[0].body;
  assert.ok(full.order.folio);
  assert.equal(new Set(advancedRetries.map(r=>r.body.orderId)).size,1);
  assert.deepEqual((await req('/receipts/'+advanced.operationId)).body,full);
  assert.equal((await req('/receipts/'+advanced.operationId,undefined,b)).status,404);
  assert.equal((await op({...advanced,data:{...advanced.data,anticipo:50}})).status,409);
  const publicDetail=await request('/api/ordenes/'+full.orderId,undefined,a.token);
  assert.equal(publicDetail.status,200);
  assert.equal(publicDetail.body.folio,full.order.folio);
  assert.equal(Number(publicDetail.body.anticipo),40);
  const movements=await admin.query("SELECT count(*)::int AS n FROM caja_movimientos WHERE negocio_id=$1 AND referencia_tipo='orden' AND referencia_id=$2",[a.id,full.orderId]);
  assert.equal(movements.rows[0].n,1);
  const quickAdvance={...online,operationId:crypto.randomUUID(),
    data:{...online.data,clientName:marker+'-quick-cash',costo_estimado:150,anticipo:30}};
  const quickCash=await op(quickAdvance);
  assert.equal(quickCash.status,200);
  assert.equal((await op(quickAdvance)).body.orderId,quickCash.body.orderId);
  const quickCashMovements=await admin.query("SELECT count(*)::int AS n FROM caja_movimientos WHERE negocio_id=$1 AND referencia_tipo='orden' AND referencia_id=$2",[a.id,quickCash.body.orderId]);
  assert.equal(quickCashMovements.rows[0].n,1);
  const web=await request('/api/ordenes/rapida',{...create.data,clientName:marker+'-web'},a.token);
  assert.equal(web.status,201);
  assert.ok(web.body.folio);
  const compatible=await op({...create,operationId:crypto.randomUUID(),data:{...create.data,clientName:marker+'-legacy'}});
  assert.equal(compatible.status,200);
  assert.ok(compatible.body.version);
  assert.ok(compatible.body.order.folio);
  report('PASS editor completo y recepcion rapida con anticipo unico, recibos, web y APK anteriores');

}
async function cleanup() {
  if (!fixtures.length) return;
  const c=await admin.connect();
  try {
    await c.query('BEGIN'); await c.query('SET CONSTRAINTS ALL DEFERRED');
    for (const f of fixtures) {
      const own=(await c.query('SELECT nombre FROM negocios WHERE id=$1 FOR UPDATE',[f.id])).rows[0];
      assert.equal(own?.nombre,f.name); assert.ok(f.name.startsWith(marker));
      for (const table of tables) {
        const exists=(await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='negocio_id'",[table])).rowCount;
        if(exists) await c.query('DELETE FROM '+table+' WHERE negocio_id=$1',[f.id]);
      }
      await c.query('DELETE FROM negocios WHERE id=$1 AND nombre=$2',[f.id,f.name]);
    }
    await c.query('COMMIT');
    for (const f of fixtures) assert.equal((await c.query('SELECT 1 FROM negocios WHERE id=$1',[f.id])).rowCount,0);
    report('PASS limpieza de fixtures verificada');
  } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
}
(async()=>{
  let failed=false;
  try {await main();} catch (error) {
    failed=true;
    report(stage==='preflight'?'FAIL comprobacion: '+checkName+' | '+diagnostic(error):'FAIL fase: '+stage+' (detalles sensibles suprimidos)');
  }
  finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    try {await cleanup();} catch {failed=true;report('FAIL limpieza: conserva el marcador '+marker+' para recuperacion manual; no se amplio el alcance.');}
    await Promise.allSettled([pool?.end(),admin?.end()]);
  }
  report(failed?'VALIDACION NO CERTIFICADA':'VALIDACION COMPLETA OK'); process.exitCode=failed?1:0;
})();
