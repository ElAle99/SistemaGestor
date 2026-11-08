import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const tenancy=require('../config/tenantContext');
const crypto=require('node:crypto'),jwt=require('jsonwebtoken');
test('local HTTP: atomic idempotency, response loss, conflict, tenant isolation and refresh rotation/revocation',async()=>{
 const real=Boolean(process.env.ALLFIX_TEST_POSTGRES_URL);
 let admin,runtimeNative;
 if(real){
  const url=new URL(process.env.ALLFIX_TEST_POSTGRES_URL);
  if(url.hostname!=='127.0.0.1' || !url.pathname.startsWith('/allfix_offline_test_'))throw Error('Only generated loopback test databases are allowed');
  const {Pool}=require('pg');
  admin=new Pool({connectionString:url.toString(),ssl:false,max:20});
  runtimeNative=new Pool({host:url.hostname,port:Number(url.port),database:url.pathname.slice(1),user:'offline_runtime',password:process.env.ALLFIX_TEST_RUNTIME_PASSWORD,ssl:false,max:20});
 }
 const db=real?{exec:sql=>admin.query(sql),query:(...args)=>admin.query(...args),close:async()=>{await runtimeNative.end();await admin.end();}}:new PGlite();
 await db.exec(`
 CREATE FUNCTION app_tenant_id() RETURNS bigint LANGUAGE sql AS $$ SELECT nullif(current_setting('app.negocio_id',true),'')::bigint $$;
 CREATE TABLE users_test(id int primary key,negocio_id bigint,session_version int default 1,activo boolean default true,rol text default 'Administrador');
 INSERT INTO users_test(id,negocio_id) VALUES(1,3000000001),(2,3000000002);
 CREATE FUNCTION auth_user_by_id(integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id',id,'negocio_id',negocio_id,'session_version',session_version,'activo',activo,'rol',rol,'username','prueba','nombre','Prueba') FROM users_test WHERE id=$1 $$;
 CREATE FUNCTION allocate_order_folio(integer) RETURNS text LANGUAGE sql AS $$ SELECT 'TEST'::text $$;
 CREATE TABLE ordenes_servicio(id serial primary key,negocio_id bigint default app_tenant_id(),modelo text,estado text default 'Recibido');
 CREATE TABLE caja_movimientos(negocio_id bigint,referencia_tipo text,referencia_id int);
 CREATE TABLE ventas_detalle(negocio_id bigint,orden_id int);
 CREATE TABLE orden_refacciones(negocio_id bigint,orden_id int);
 `);
 await db.exec(readFileSync(new URL('../db/android-offline.sql',import.meta.url),'utf8'));
 if(real){
  const c=await admin.connect();
  try{await require('../db/androidMigration').migrate(c,'offline_runtime');}finally{c.release();}
  await db.exec("GRANT USAGE ON SCHEMA public TO offline_runtime; GRANT SELECT ON users_test TO offline_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO offline_runtime");
  for(const table of ['ordenes_servicio','caja_movimientos','ventas_detalle','orden_refacciones']){
   await db.exec('ALTER TABLE '+table+' ENABLE ROW LEVEL SECURITY; ALTER TABLE '+table+' FORCE ROW LEVEL SECURITY; CREATE POLICY test_tenant ON '+table+' USING(negocio_id=app_tenant_id()) WITH CHECK(negocio_id=app_tenant_id()); GRANT SELECT,INSERT,UPDATE,DELETE ON '+table+' TO offline_runtime');
  }
 }
 const pool=tenancy.createTenantPool(real?runtimeNative:{connect:async()=>({query:async(sql,params=[])=>{
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
   return db.query(sql,params);
 },release(){}})});
 let creations=0,failAfterWrite=false;
 const orderService={
  async getAllOrdenes(){return (await pool.query('SELECT * FROM ordenes_servicio WHERE negocio_id=app_tenant_id()')).rows;},
  async getOrdenById(id){const r=(await pool.query('SELECT * FROM ordenes_servicio WHERE negocio_id=app_tenant_id() AND id=$1',[id])).rows[0];return r?{id:r.id,negocio_id:r.negocio_id,folio:'OR-'+r.id,model:r.modelo,status:r.estado,anticipo:0}:null;},
  async deleteOrden(id){await pool.query('DELETE FROM ordenes_servicio WHERE negocio_id=app_tenant_id() AND id=$1',[id]);return true;},
  async updateOrdenEstado(id,estado){await pool.query('UPDATE ordenes_servicio SET estado=$1 WHERE negocio_id=app_tenant_id() AND id=$2',[estado,id]);return this.getOrdenById(id);}
 };
 const authModule={exports:{}};
 vm.runInNewContext(readFileSync(new URL('../middleware/auth.js',import.meta.url),'utf8'),{
  module:authModule,process:{env:{JWT_SECRET:'test-only-offline-key'}},console,
  require(name){
   if(name==='jsonwebtoken')return jwt;
   if(name==='../config/db')return {pool};
   if(name==='../config/tenantContext')return tenancy;
   if(name==='./fileSession')return {setFileSession(){}};
   if(name==='../config/env')return {};
   throw Error('Unexpected auth dependency '+name);
  }
 });
 const module={exports:{}},diagnostics=[];
 vm.runInNewContext(readFileSync(new URL('../routes/android.js',import.meta.url),'utf8').replace('function errorResponse(res,error){','function errorResponse(res,error){ diagnostics.push({code:error.code,message:error.message});'),{diagnostics,
  module,process:{env:{ANDROID_OFFLINE_ENABLED:'true',JWT_SECRET:'test-only-offline-key'}},console,
  require(name){
   if(name==='express')return express;
   if(name==='jsonwebtoken')return jwt;
   if(name==='node:crypto')return crypto;
   if(name==='../config/db')return {pool};
   if(name==='../config/tenantContext')return tenancy;
   if(name==='../services/ordenService')return orderService;
   if(name==='../services/quickOrderService')return {createQuickOrder:async data=>{
    creations++;const c=await pool.connect();await c.query('BEGIN');
    const row=(await c.query('INSERT INTO ordenes_servicio(modelo) VALUES($1) RETURNING id',[data.model])).rows[0];if(failAfterWrite)throw Error('Injected local transaction failure');await c.query('COMMIT');c.release();
    return orderService.getOrdenById(row.id);
   }};
   if(name==='../services/androidSyncProtocol')return require('../services/androidSyncProtocol');
   if(name==='../middleware/rateLimit')return {rateLimit:()=> (req,res,next)=>next()};
   if(name==='../middleware/auth')return authModule.exports;
   throw Error('Unexpected test dependency '+name);
  }
 });
 const app=express();app.use(express.json());app.use('/api/android',module.exports);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/api/android';
 const request=async(path,body,actor=1,token=jwt.sign({id:actor,sessionVersion:1},'test-only-offline-key',{expiresIn:'8h'}))=>{const response=await fetch(url+path,{method:body!==undefined?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body!==undefined?JSON.stringify(body):undefined});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};};
 try{
  const op={operationId:'11111111-1111-4111-8111-111111111111',kind:'create',data:{model:'Prueba'}};
  const a=await request('/operations',op);assert.equal(a.status,200,JSON.stringify(diagnostics));
  const replay=await request('/operations',op);assert.equal(replay.body.orderId,a.body.orderId);assert.equal(creations,1);
  assert.equal((await request('/operations',{...op,data:{model:'distinto'}})).status,409);
  assert.equal(a.cache,'no-store');
  assert.equal((await request('/capabilities')).body.refresh,true);
  assert.equal((await request('/operations',[])).status,400);
  const expiredAccess=jwt.sign({id:1,sessionVersion:1},'test-only-offline-key',{expiresIn:-1});
  assert.equal((await request('/orders',undefined,1,expiredAccess)).status,401);
  const id=a.body.orderId;
  const changed=await request('/operations',{operationId:'44444444-4444-4444-8444-444444444444',kind:'update',orderId:id,baseVersion:a.body.version,data:{model:'Edición sincronizada'}});
  assert.equal(changed.status,200);assert.equal(changed.body.order.model,'Edición sincronizada');
  failAfterWrite=true;
  const rollback={operationId:'55555555-5555-4555-8555-555555555555',kind:'create',data:{model:'Rollback'}};
  assert.equal((await request('/operations',rollback)).status,500);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM ordenes_servicio')).rows[0].count,1,'Domain write rolled back with missing receipt');
  failAfterWrite=false;assert.equal((await request('/operations',rollback)).status,200);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM ordenes_servicio')).rows[0].count,2);
  await db.query('UPDATE ordenes_servicio SET modelo=$1 WHERE id=$2',['Cambio desde web',id]);
  const stale={operationId:'22222222-2222-4222-8222-222222222222',kind:'update',orderId:id,baseVersion:a.body.version,data:{model:'Cambio offline'}};
  assert.equal((await request('/operations',stale)).status,409);
  assert.equal((await request('/operations',{...stale,operationId:'33333333-3333-4333-8333-333333333333'},2)).status,409);
  assert.equal((await db.query('SELECT modelo FROM ordenes_servicio WHERE id=$1',[id])).rows[0].modelo,'Cambio desde web');
  const snapshot=await request('/orders');
  const target=snapshot.body.orders.find(item=>item.order.id!==id);
  const status=await request('/operations',{operationId:crypto.randomUUID(),kind:'status',orderId:target.order.id,baseVersion:target.version,data:{estado:'En reparación'}});
  assert.equal(status.status,200);assert.equal(status.body.order.status,'En reparación');
  await db.query("INSERT INTO caja_movimientos VALUES(3000000001,'orden',$1)",[target.order.id]);
  const deletion={operationId:crypto.randomUUID(),kind:'delete',orderId:target.order.id,baseVersion:status.body.version};
  assert.equal((await request('/operations',deletion)).status,422,'Financial references prohibit automatic deletion');
  await db.query('DELETE FROM caja_movimientos WHERE referencia_id=$1',[target.order.id]);
  await db.query("UPDATE users_test SET rol='Técnico' WHERE id=1");
  assert.equal((await request('/operations',deletion)).status,403);
  await db.query("UPDATE users_test SET rol='Administrador' WHERE id=1");
  const deleted=await request('/operations',deletion);assert.equal(deleted.status,200);assert.equal(deleted.body.deleted,true);
  assert.equal((await request('/operations',deletion)).status,200,'Deletion replay succeeds after the row is gone');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM ordenes_servicio')).rows[0].count,1);
  const money=await request('/operations',{operationId:crypto.randomUUID(),kind:'create',data:{model:'No pago offline',anticipo:1}});
  assert.equal(money.status,422);
  const expiredRefresh=jwt.sign({type:'android-refresh',id:1,business:1,family:crypto.randomUUID()},'test-only-offline-key',{expiresIn:-1,issuer:'allfix-android-refresh'});
  assert.equal((await request('/refresh',{refreshToken:expiredRefresh})).status,401);
  const dbExpired=await request('/session',{});
  await db.query("UPDATE android_refresh_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[crypto.createHash('sha256').update(dbExpired.body.refreshToken).digest('hex')]);
  assert.equal((await request('/refresh',{refreshToken:dbExpired.body.refreshToken})).status,401);
  const issued=await request('/session',{});assert.equal(issued.status,200,JSON.stringify(diagnostics));
  const rotated=await request('/refresh',{refreshToken:issued.body.refreshToken});assert.equal(rotated.status,200);
  assert.ok(rotated.body.refreshToken!==issued.body.refreshToken,'Refresh token must rotate');
  assert.equal((await request('/refresh',{refreshToken:issued.body.refreshToken})).status,401,'Reuse revokes the family');
  assert.equal((await request('/refresh',{refreshToken:rotated.body.refreshToken})).status,401);
  const ended=await request('/session',{});
  assert.equal((await request('/logout',{refreshToken:ended.body.refreshToken})).status,200);
  assert.equal((await request('/refresh',{refreshToken:ended.body.refreshToken})).status,401);
  if(real){
   const concurrent={operationId:crypto.randomUUID(),kind:'create',data:{model:'Concurrencia real'}};
   const before=creations;
   const copies=await Promise.all(Array.from({length:12},()=>request('/operations',concurrent)));
   assert.ok(copies.every(r=>r.status===200),JSON.stringify(diagnostics));
   assert.equal(new Set(copies.map(r=>r.body.orderId)).size,1);assert.equal(creations,before+1);
   console.log('PASS real PostgreSQL: 12 concurrent retries produce one domain write and receipt');
   const row=copies[0].body;
   const edits=await Promise.all(Array.from({length:8},(_,i)=>request('/operations',{operationId:crypto.randomUUID(),kind:'update',orderId:row.orderId,baseVersion:row.version,data:{model:'Concurrent '+i}})));
   assert.equal(edits.filter(r=>r.status===200).length,1);assert.equal(edits.filter(r=>r.status===409).length,7);
   console.log('PASS real PostgreSQL: one concurrent edit wins; seven stale edits conflict');
   const latest=edits.find(r=>r.status===200).body;
   const web=await admin.connect();
   try{
    await web.query('BEGIN');
    await web.query('UPDATE ordenes_servicio SET modelo=$1 WHERE id=$2',['Web holds row lock',row.orderId]);
    let done=false;
    const competing=request('/operations',{operationId:crypto.randomUUID(),kind:'update',orderId:row.orderId,baseVersion:latest.version,data:{model:'Must not overwrite web'}}).then(r=>{done=true;return r;});
    await new Promise(resolve=>setTimeout(resolve,150));assert.equal(done,false);
    await web.query('COMMIT');assert.equal((await competing).status,409);
   }finally{await web.query('ROLLBACK');web.release();}
   assert.equal((await db.query('SELECT modelo FROM ordenes_servicio WHERE id=$1',[row.orderId])).rows[0].modelo,'Web holds row lock');
   console.log('PASS real PostgreSQL: Android waits for web lock and preserves newer web data');
   const family=await request('/session',{});
   const rotations=await Promise.all([request('/refresh',{refreshToken:family.body.refreshToken}),request('/refresh',{refreshToken:family.body.refreshToken})]);
   assert.deepEqual(rotations.map(r=>r.status).sort(),[200,401]);
   assert.equal((await request('/refresh',{refreshToken:rotations.find(r=>r.status===200).body.refreshToken})).status,401);
   console.log('PASS real PostgreSQL: concurrent refresh reuse revokes the entire family');
   const rls=await runtimeNative.connect();
   try{
    await rls.query('BEGIN');await rls.query("SELECT set_config('app.negocio_id','3000000002',true)");
    assert.equal((await rls.query('SELECT * FROM android_sync_receipts')).rows.length,0);
    assert.equal((await rls.query('SELECT * FROM ordenes_servicio')).rows.length,0);
    await assert.rejects(()=>rls.query("INSERT INTO ordenes_servicio(negocio_id,modelo) VALUES(3000000001,'Forbidden cross business')"),e=>e.code==='42501');
   }finally{await rls.query('ROLLBACK');rls.release();}
   console.log('PASS real PostgreSQL: runtime RLS rejects cross-tenant reads and inserts');
  }
  const second=await request('/session',{});
  await db.query('UPDATE users_test SET session_version=session_version+1 WHERE id=1');
  assert.equal((await request('/refresh',{refreshToken:second.body.refreshToken})).status,401,'Password/session revocation prevents renewal');
 }finally{await new Promise(resolve=>server.close(resolve));await db.close();}
});
