const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function startup(role,ready=true){
 const module={exports:{}};let calls=0;
 const connection={query:async()=>{calls++;return {rows:[calls===1?role:{ready}]};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../config/db.js'),'utf8'),{
  module,console,process:{env:{}},require(name){
   if(name==='pg')return{Pool:class{constructor(){return connection;}}};
   if(name==='./env')return{};
   if(name==='./pgConfig')return{getPgPoolConfig:()=>({})};
   if(name==='./tenantContext')return{createTenantPool:pool=>pool};
   throw new Error('Unexpected runtime dependency: '+name);
  }
 });return{init:module.exports.initDB,calls:()=>calls};
}
const safe={unsafe:false,owns_tables:false,session_user:'sistema_gestor_app',current_user:'sistema_gestor_app'};
test('runtime refuses privileged login/ancestor before checking migration status',async()=>{const h=startup({...safe,unsafe:true});await assert.rejects(h.init(),/inseguros/);assert.equal(h.calls(),1);});
test('runtime refuses ownership of protected tables',async()=>{const h=startup({...safe,owns_tables:true});await assert.rejects(h.init(),/inseguros/);});
test('runtime refuses an effective role different from its login',async()=>{const h=startup({...safe,current_user:'sistema_gestor_tenant'});await assert.rejects(h.init(),/inseguros/);});
test('runtime refuses unapplied administrative migrations',async()=>{const h=startup(safe,false);await assert.rejects(h.init(),/migraciones/);assert.equal(h.calls(),2);});
