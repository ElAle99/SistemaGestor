const test=require('node:test');
const assert=require('node:assert/strict');
const {assertOperation,version}=require('../services/androidSyncProtocol');
const {inspect,migrate}=require('../db/androidMigration');
const id='11111111-1111-4111-8111-111111111111';
test('Android extension rejects offline payments, unauthorized deletion and invalid bodies',()=>{
 const admin={rol:'Administrador'};
 assert.throws(()=>assertOperation({operationId:id,kind:'create',data:{anticipo:1}},admin),e=>e.statusCode===422);
 assert.throws(()=>assertOperation({operationId:id,kind:'delete'},{rol:'Técnico'}),e=>e.statusCode===403);
 assert.throws(()=>assertOperation({operationId:id,kind:'update',data:[]},admin,{}),e=>e.statusCode===400);
 assert.throws(()=>assertOperation({operationId:id,kind:'update',data:{costo_real:500}},admin,{costo_real:100}),e=>e.statusCode===422);
 assert.doesNotThrow(()=>assertOperation({operationId:id,kind:'update',data:{model:'Nuevo modelo'}},admin,{}));
 assert.equal(version({a:1,b:new Date('2026-01-01')}),version({b:'2026-01-01T00:00:00.000Z',a:1}));
});
test('Android migration rejects unsafe role names before any query',async()=>{
 let queries=0;
 await assert.rejects(()=>inspect({query:async()=>{queries++;}},'x"; GRANT ALL'));
 assert.equal(queries,0);
});
test('Android preflight refuses missing folio capability and missing runtime execute grants',async()=>{
 const db={query:async(sql)=>{
  if(sql.includes('pg_roles'))return {rows:[{rolsuper:false,rolbypassrls:false}]};
  if(sql.includes('to_regprocedure'))return {rows:[{tenant:true,auth:true,orders:true,folio:false}]};
  throw Error('Unexpected query');
 }};
 await assert.rejects(()=>inspect(db,'offline_runtime'),/capacidades/);
 db.query=async sql=>{
  if(sql.includes('pg_roles'))return {rows:[{rolsuper:false,rolbypassrls:false}]};
  if(sql.includes('to_regprocedure'))return {rows:[{tenant:true,auth:true,orders:true,folio:true}]};
  if(sql.includes('has_function_privilege'))return {rows:[{allowed:false}]};
  throw Error('Unexpected query');
 };
 await assert.rejects(()=>inspect(db,'offline_runtime'),/ejecutar/);
});
test('Android migration rolls back on preflight failure without changing business tables',async()=>{
 const statements=[];
 const db={query:async(sql)=>{statements.push(sql);if(sql.includes('pg_roles'))return {rows:[{rolsuper:true,rolbypassrls:false}]};return {rows:[]};}};
 await assert.rejects(()=>migrate(db,'offline_runtime'));
 assert.equal(statements.at(-1),'ROLLBACK');
 assert.ok(!statements.some(sql=>/CREATE TABLE|ALTER TABLE|GRANT SELECT/.test(sql)));
});
