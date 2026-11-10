const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../services/ordenService'),'utf8');
function fixture({exists=true,auditFails=false}={}){
 const statements=[];
 const db={async query(sql,args){
  statements.push({sql,args});
  if(sql.startsWith('SELECT id,folio,estado FROM ordenes_servicio'))return {rows:exists?[{id:7,folio:'TEST-7',estado:'Recibido'}]:[]};
  if(sql.startsWith('INSERT INTO auditoria_ordenes') && auditFails)throw Error('audit unavailable');
  return {rows:[]};
 },release(){}};
 const module={exports:{}};
 vm.runInNewContext(source,{module,console,require:name=>name==='../config/db'?{pool:{...db,connect:async()=>db}}:{}});
 return {service:module.exports,statements};
}
test('order deletion records only identity and status before deleting inside the same transaction',async()=>{
 const f=fixture();assert.equal(await f.service.deleteOrden(7,3),true);
 const audit=f.statements.findIndex(s=>s.sql.startsWith('INSERT INTO auditoria_ordenes'));
 const deletion=f.statements.findIndex(s=>s.sql.startsWith('DELETE FROM ordenes_servicio'));
 assert.ok(audit>0 && deletion>audit);
 assert.deepEqual(JSON.parse(f.statements[audit].args[3]),{folio:'TEST-7',estado:'Recibido'});
 assert.deepEqual(Array.from(f.statements[audit].args.slice(0,3)),[7,3,'eliminar']);
 assert.equal(f.statements[0].sql,'BEGIN');assert.equal(f.statements.at(-1).sql,'COMMIT');
});
test('audit failure rolls back deletion; nonexistent orders produce no deletion audit',async()=>{
 const f=fixture({auditFails:true});await assert.rejects(()=>f.service.deleteOrden(7,3),/audit unavailable/);
 assert.equal(f.statements.at(-1).sql,'ROLLBACK');assert.ok(!f.statements.some(s=>s.sql.startsWith('DELETE')));
 const missing=fixture({exists:false});assert.equal(await missing.service.deleteOrden(7,3),false);
 assert.ok(!missing.statements.some(s=>s.sql.startsWith('INSERT INTO auditoria_ordenes')));
});
