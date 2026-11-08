const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {inspect,migrate,TABLES}=require('../db/androidMigration');
const schema=fs.readFileSync(path.join(__dirname,'../db/android-offline.sql'),'utf8');
const role='offline_runtime';
async function fixture(legacy=false){
 const db=new PGlite();
 await db.exec(`CREATE ROLE offline_runtime LOGIN NOSUPERUSER NOBYPASSRLS;
  GRANT USAGE ON SCHEMA public TO offline_runtime;
  CREATE FUNCTION app_tenant_id() RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.negocio_id',true),'')::bigint $$;
  CREATE FUNCTION auth_user_by_id(integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
  CREATE FUNCTION allocate_order_folio(integer) RETURNS text LANGUAGE sql AS $$ SELECT 'TEST'::text $$;
  CREATE TABLE ordenes_servicio(id serial PRIMARY KEY,negocio_id bigint);`);
 if(legacy){
  // Reconstruct the exact v1 column types while retaining its real policies/indexes.
  await db.exec(schema.replace(/negocio_id bigint/g,'negocio_id integer'));
  await db.exec(`GRANT SELECT,INSERT ON android_sync_receipts TO offline_runtime;
   GRANT SELECT,INSERT,UPDATE ON android_refresh_sessions TO offline_runtime;
   INSERT INTO android_sync_receipts(negocio_id,usuario_id,operation_id,request_hash,result)
    VALUES(1,1,'11111111-1111-4111-8111-111111111111','fixture-hash','{"orderId":1}');
   INSERT INTO android_refresh_sessions(negocio_id,usuario_id,token_hash,family,session_version,expires_at)
    VALUES(1,1,'fixture-token-hash','22222222-2222-4222-8222-222222222222',1,now()+interval '1 day');`);
 }
 // pg accepts multi-statement SQL without parameters; mirror its simple protocol.
 return {exec:sql=>db.exec(sql),query:(sql,params)=>params?db.query(sql,params):db.exec(sql).then(results=>results.at(-1)),close:()=>db.close()};
}
const snapshot=async db=>({
 receipts:(await db.query('SELECT * FROM android_sync_receipts ORDER BY negocio_id')).rows,
 sessions:(await db.query('SELECT * FROM android_refresh_sessions ORDER BY negocio_id')).rows,
 policies:(await db.query("SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE tablename=ANY($1::text[]) ORDER BY tablename",[TABLES])).rows,
 indexes:(await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename=ANY($1::text[]) ORDER BY indexname",[TABLES])).rows,
 acl:(await db.query("SELECT relname,relacl::text,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname",[TABLES])).rows
});
for(const legacy of [false,true])test(`bigint migration: ${legacy?'populated integer upgrade':'fresh install'}, repeatable with RLS and minimum grants`,async()=>{
 const db=await fixture(legacy);
 try{
  const before=legacy?await snapshot(db):null;
  assert.equal((await inspect(db,role)).bigintReady,false);
  assert.equal((await migrate(db,role)).bigintReady,true);
  const once=await snapshot(db);
  if(before)assert.deepEqual(once,before,'Upgrade must preserve rows, receipt hashes/results, sessions, indexes, policies and ACLs');
  await migrate(db,role);
  assert.deepEqual(await snapshot(db),once,'Second apply must not change stored data or protections');
  const types=(await inspect(db,role)).tenantTypes;
  assert.equal(types.filter(t=>TABLES.includes(t.table_name)&&t.tenant_type==='bigint').length,2);
  await db.exec('SET ROLE offline_runtime');
  await db.query("SELECT set_config('app.negocio_id',$1,false)",['3000000001']);
  await db.query("INSERT INTO android_sync_receipts(usuario_id,operation_id,request_hash,result) VALUES(1,$1,'large-tenant','{}')",['33333333-3333-4333-8333-333333333333']);
  await db.query("INSERT INTO android_refresh_sessions(usuario_id,token_hash,family,session_version,expires_at) VALUES(1,'large-tenant',$1,1,now()+interval '1 day')",['44444444-4444-4444-8444-444444444444']);
  for(const table of TABLES)assert.equal(String((await db.query('SELECT negocio_id FROM '+table)).rows[0].negocio_id),'3000000001');
  await db.query("SELECT set_config('app.negocio_id',$1,false)",['3000000002']);
  for(const table of TABLES){
   assert.equal((await db.query('SELECT * FROM '+table)).rows.length,0);
   await assert.rejects(()=>db.query('DELETE FROM '+table),e=>e.code==='42501');
  }
  await assert.rejects(()=>db.query("INSERT INTO android_sync_receipts(negocio_id,usuario_id,operation_id,request_hash,result) VALUES(3000000001,1,$1,'foreign','{}')",['55555555-5555-4555-8555-555555555555']),e=>e.code==='42501');
  await assert.rejects(()=>db.query("UPDATE android_sync_receipts SET request_hash='forbidden'"),e=>e.code==='42501');
  const permissions=(await db.query("SELECT has_table_privilege(current_user,'android_refresh_sessions','UPDATE') AS session_update,EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(c.relacl) a WHERE c.oid='android_sync_receipts'::regclass AND a.grantee=0) AS public_read")).rows[0];
  assert.equal(permissions.session_update,true);assert.equal(permissions.public_read,false);
 }finally{await db.close();}
});
test('bigint upgrade rolls back both tables on unexpected policy and preserves data',async()=>{
 const db=await fixture(true);
 try{
  await db.exec('CREATE POLICY unexpected ON android_refresh_sessions USING(true)');
  const before=await snapshot(db);
  await assert.rejects(()=>migrate(db,role),/Unexpected offline policies/);
  assert.deepEqual(await snapshot(db),before);
  const types=(await inspect(db,role)).tenantTypes.filter(t=>TABLES.includes(t.table_name));
  assert.ok(types.every(t=>t.tenant_type==='integer'),'First table conversion must also roll back');
 }finally{await db.close();}
});
test('bigint preflight refuses incompatible business and offline types without writing',async()=>{
 const db=await fixture();
 try{
  await db.exec('ALTER TABLE ordenes_servicio ALTER COLUMN negocio_id TYPE integer');
  await assert.rejects(()=>inspect(db,role),/ordenes debe usar bigint/);
  await db.exec('ALTER TABLE ordenes_servicio ALTER COLUMN negocio_id TYPE bigint');
  await db.exec('CREATE TABLE android_sync_receipts(negocio_id text)');
  await assert.rejects(()=>inspect(db,role),/offline incompatible/);
 }finally{await db.close();}
});
