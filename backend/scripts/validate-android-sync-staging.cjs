'use strict';
// No dotenv, CLI secrets, migrations, external HTTP backend, adb or APK access.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const {Pool} = require('pg');
const {TARGET,checkedConnection,requireBigint,verifyTLS}=require('./validate-android-staging.cjs');
const report = message => process.stdout.write(message + '\n');
// Dependencies must never print request bodies, tokens, URLs or database errors.
if(require.main===module)for (const method of ['log','error','warn','info','debug']) console[method] = () => {};
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
const tables = ['android_sync_receipts','android_refresh_sessions','historial_estados','auditoria_ordenes','ordenes_servicio','clientes','usuarios','orden_identidades','entidad_identidades','negocio_logos','archivos','configuracion_sistema','configuracion','order_folio_counters'];
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
    process.stdin.once('end',()=>reject(Error('Missing staging input')));
  });
  assert.equal(input.branchId,'br-dawn-heart-bd3sqd27');
  assert.equal(input.branchName,'allfix-staging-offline');
  assert.equal(input.production,false);
  process.env.JWT_SECRET=crypto.randomBytes(48).toString('hex');
  const runtime=checkedConnection(input.runtime,'runtime');
  const owner=checkedConnection(input.owner,'administrativa');
  checkpoint('coincidencia-conexiones','Las conexiones runtime y administrativa deben apuntar al mismo host de staging.');
  assert.equal(runtime.hostname.replace('-pooler.','.'),owner.hostname.replace('-pooler.','.'));
  safeCause='Las conexiones runtime y administrativa indican bases diferentes.';
  assert.equal(runtime.pathname,owner.pathname);
  safeCause='Runtime y administrador deben usar usuarios diferentes.';
  assert.notEqual(runtime.username,owner.username);
  report('Destino verificado: '+TARGET.name+' / '+TARGET.endpoint+' / '+TARGET.database);
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
  await verifyTLS(admin,TARGET.host,'tls-administrativa');
  requireBigint(await require('../db/androidMigration').inspect(admin,decodeURIComponent(runtime.username)));
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
  stage='cliente offline real y reconexion';
  await validateOfflineClient(req,op,a);
  stage='compatibilidad APK instalada';
  await validateLegacyClient(req,op,a,create.data);
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
  assert.equal((await req('/orders')).body.orders.length,0);
  report('PASS eliminacion y replay de eliminacion de fixture sintetico');
  const pending={operationId:crypto.randomUUID(),kind:'create',data:{...create.data,model:'Cancel-before-apply'}};
  const cancelled=await req('/operations/cancel',pending);
  assert.equal(cancelled.status,200);assert.equal(cancelled.body.cancelled,true);
  assert.equal((await op(pending)).body.cancelled,true);
  assert.equal((await req('/orders')).body.orders.length,0);
  const late=await req('/operations/cancel',deletion);
  assert.equal(late.body.deleted,true);assert.notEqual(late.body.cancelled,true);
  report('PASS cancelacion atomica, replay y confirmacion de eliminacion ya aplicada');
  stage='carrera aplicar contra cancelar';
  const racing={operationId:crypto.randomUUID(),kind:'create',data:{...create.data,model:'Synthetic race'}};
  const [applyRace,cancelRace]=await Promise.all([op(racing),req('/operations/cancel',racing)]);
  assert.equal(applyRace.status,200);assert.equal(cancelRace.status,200);
  assert.deepEqual(applyRace.body,cancelRace.body);
  const beforeRetry=(await req('/orders')).body.orders.length;
  assert.deepEqual((await op(racing)).body,applyRace.body);
  assert.equal((await req('/orders')).body.orders.length,beforeRetry);
  report('PASS carrera aplicar/cancelar: un recibo definitivo y replay sin mutaciones adicionales');
}
function clientFixture(file){
  const fs=require('node:fs');
  const folder=path.join(__dirname,'../tests/fixtures/allfix-2.0.1');
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
  assert.equal(manifest.applicationId,'mx.allfix.gestor');
  assert.equal(manifest.versionCode,2);
  assert.equal(manifest.apkSha256,'0beeda38a904194b94078594758b01c2109afc80377aba25c732c986202d6bfb');
  assert.ok(Object.hasOwn(manifest.files,file));
  const bytes=fs.readFileSync(path.join(folder,file));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),manifest.files[file]);
  return bytes.toString('utf8');
}
async function validateLegacyClient(req,operation,actor,data){
  const fs=require('node:fs'),vm=require('node:vm');
  const folder=path.join(__dirname,'../tests/fixtures/allfix-installed-1.0');
  const bytes=fs.readFileSync(path.join(folder,'offline-model.js'));
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),manifest.files['offline-model.js']);
  const context={};vm.runInNewContext(bytes.toString('utf8'),context);
  const model=context.AllfixOfflineModel,user={id:actor.user,negocio_id:actor.id,rol:'Administrador'};
  let pending=model.apply(model.fresh(),[],{kind:'create',data:{...data,model:'Installed queue fixture'}},user,crypto.randomUUID());
  for(const change of [{kind:'update',data:{model:'Legacy edit'}},{kind:'status',data:{estado:'En reparación'}},{kind:'delete',data:{}}])pending=model.apply(pending.state,pending.queue,{...change,orderId:-1},user,crypto.randomUUID());
  while(pending.queue.length){
    const entry=pending.queue[0],wire={operationId:entry.operationId,kind:entry.kind,orderId:entry.orderId,data:entry.data,baseVersion:entry.baseVersion};
    const confirmed=await operation(wire);assert.equal(confirmed.status,200);
    assert.deepEqual((await operation(wire)).body,confirmed.body);
    pending=model.acknowledge(pending.state,pending.queue,entry,confirmed.body);
  }
  assert.equal(Object.keys(pending.state.orders).length,0);
  report('PASS cola de APK instalada 1.0: crear, editar, estado y eliminar con UUID originales y replay');
}
async function validateOfflineClient(req,operation,actor){
  const vm=require('node:vm'),fs=require('node:fs');
  let savedSession=(await req('/session',{})).body;
  let disk={queue:[]},connected=false,loseNext=false;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const api='https://staging.invalid/api';
  // This transport reaches only the ephemeral backend bound to 127.0.0.1.
  const backendOrigin='http://127.0.0.1:'+server.address().port;
  const network=async(url,options={})=>{
    if(!connected)throw new TypeError('offline fixture');
    const path=new URL(url).pathname;
    assert.ok(path.startsWith('/api/'));
    const response=await fetch(backendOrigin+path,{...options,signal:AbortSignal.timeout(20000)});
    if(path==='/api/android/operations' && response.ok && loseNext){loseNext=false;throw new TypeError('lost response fixture');}
    return response;
  };
  const reopen=async()=>{
    const stored=new Map(),local=new Map();
    const storage=m=>({getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)});
    const plugin={restoreSession:async()=>({session:clone(savedSession)}),saveSession:async({session})=>{savedSession=clone(session);},readState:async()=>clone(disk),commitState:async value=>{disk=clone({state:value.state,queue:value.queue});}};
    const ctx={window:null,location:{href:'https://staging.invalid/',origin:'https://staging.invalid'},SISTEMA_GESTOR_API_URL:api,
      URL,Response,Headers,atob,Date,FormData,crypto:{randomUUID:crypto.randomUUID},setTimeout(){},setInterval(){},addEventListener(){},
      document:{hidden:false,querySelectorAll:()=>[],getElementById:()=>null,addEventListener(){}},
      Capacitor:{getPlatform:()=> 'android',registerPlugin:()=>plugin},fetch:network,
      sessionStorage:storage(stored),localStorage:storage(local),APP_STATE:{currentUser:savedSession.user,ordenes:[]},
      persistSession(){},clearSessionState(){},showLoginContainer(){},stopInventoryPolling(){},renderOrdenes(){},renderDashboard(){}};
    ctx.window=ctx;vm.createContext(ctx);
    for(const file of ['offline-model.js','offline.js'])vm.runInContext(clientFixture(file),ctx);
    await ctx.AllfixOffline.restore();
    return {ctx,request:async(route,method,data)=>{
      const r=await ctx.fetch(api+route,{method,body:data?JSON.stringify(data):undefined});
      return {status:r.status,body:await r.json()};
    }};
  };
  let app=await reopen();
  const created=await app.request('/ordenes/rapida','POST',{clientName:marker+'-offline',deviceType:'Celular',brand:'TEST',model:'Offline',falla_reportada:'Synthetic',servicio_solicitado:'Synthetic',anticipo:0});
  assert.equal(created.status,202);const localId=created.body.id;
  assert.equal((await app.request('/ordenes/'+localId,'PUT',{model:'Offline edit'})).status,202);
  assert.equal((await app.request('/ordenes/'+localId+'/status','PATCH',{estado:'En reparación'})).status,202);
  assert.equal(disk.queue.length,3);
  const immutable=disk.queue[0].operationId;
  connected=true;loseNext=true;await app.ctx.AllfixOffline.refresh();
  assert.equal(disk.queue.length,3);assert.equal(disk.queue[0].operationId,immutable);
  app=await reopen();await app.ctx.AllfixOffline.retry();assert.equal(disk.queue.length,0);
  let row=Object.values(disk.state.orders).find(o=>o.model==='Offline edit');assert.ok(row);assert.equal(row.status,'En reparación');
  const createdCount=(await admin.query('SELECT count(*)::int n FROM android_sync_receipts WHERE negocio_id=$1 AND operation_id=$2',[actor.id,immutable])).rows[0].n;
  assert.equal(createdCount,1);
  connected=false;await app.request('/ordenes/'+row.id,'PUT',{model:'Keep local'});
  const remote=(await req('/orders')).body.orders.find(o=>o.order.id===row.id);
  assert.equal((await operation({operationId:crypto.randomUUID(),kind:'status',orderId:row.id,baseVersion:remote.version,data:{estado:'Retrasado'}})).status,200);
  connected=true;await app.ctx.AllfixOffline.refresh();assert.equal(disk.queue[0].state,'conflict');
  const conflictedId=disk.queue[0].operationId;
  await app.ctx.AllfixOffline.resolve(conflictedId,'local');assert.notEqual(disk.queue[0].operationId,conflictedId);
  assert.equal(disk.state.drafts.length,1);await app.ctx.AllfixOffline.retry();assert.equal(disk.queue.length,0);
  row=disk.state.orders[row.id];assert.equal(row.model,'Keep local');assert.equal(row.status,'Retrasado');
  connected=false;await app.request('/ordenes/'+row.id,'DELETE');
  await app.ctx.AllfixOffline.resolve(disk.queue[0].operationId,'cancel');
  assert.equal(disk.queue.length,0);assert.equal(disk.state.orders[row.id]._pendingDelete,undefined);
  await app.request('/ordenes/'+row.id,'DELETE');connected=true;loseNext=true;
  await app.ctx.AllfixOffline.refresh();assert.equal(disk.queue.length,1);
  await assert.rejects(()=>app.ctx.AllfixOffline.resolve(disk.queue[0].operationId,'cancel'));
  assert.equal(disk.queue.length,0);assert.equal(disk.state.orders[row.id],undefined);
  report('PASS cliente Android real: offline, reinicio, reconexion, respuesta perdida, idempotencia, conflicto, borrador, cancelar y eliminar fixture');
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
async function run(){
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
}
if(require.main===module)run().catch(()=>{report('VALIDACION NO CERTIFICADA');process.exitCode=1;});
module.exports={clientFixture};
