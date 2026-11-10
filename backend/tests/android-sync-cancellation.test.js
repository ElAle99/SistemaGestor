const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const express=require('express');
const protocol=require('../services/androidSyncProtocol');
test('HTTP cancellation fences late retries, preserves existing receipts and rejects changed content',async()=>{
 const receipts=new Map(),sqls=[];
 const db={async query(sql,args=[]){
  sqls.push(sql);
  if(sql.startsWith('SELECT request_hash,result'))return {rows:receipts.has(args[1])?[receipts.get(args[1])]:[]};
  if(sql.startsWith('INSERT INTO android_sync_receipts'))receipts.set(args[1],{request_hash:args[2],result:JSON.parse(args[3])});
  return {rows:[]};
 },release(){}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../routes/android'),'utf8'),{module,process:{env:{ANDROID_OFFLINE_ENABLED:'true'}},require:name=>{
  if(name==='express')return express;
  if(name==='node:crypto')return require(name);
  if(name==='jsonwebtoken')return require(name);
  if(name==='../config/db')return {pool:{...db,connect:async()=>db}};
  if(name==='../config/tenantContext')return {withAtomicClient:async(_,fn)=>fn(),withTenant:async(_,fn)=>fn()};
  if(name==='../middleware/auth')return {authMiddleware:(req,res,next)=>{req.user={id:1,negocio_id:'1',rol:'Administrador'};next();}};
  if(name==='../middleware/rateLimit')return {rateLimit:()=>((req,res,next)=>next())};
  if(name==='../services/androidSyncProtocol')return protocol;
  return {};
 }});
 const app=express();app.use(express.json());app.use(module.exports);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const request=async(path,body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{
  const op={operationId:require('node:crypto').randomUUID(),kind:'delete',orderId:7,baseVersion:'v1',data:{}};
  const cancelled=await request('/operations/cancel',op);assert.equal(cancelled.status,200);assert.equal(cancelled.body.cancelled,true);
  assert.deepEqual((await request('/operations',op)).body,cancelled.body);
  assert.equal((await request('/operations/cancel',{...op,baseVersion:'v2'})).status,409);
  const committed={...op,operationId:require('node:crypto').randomUUID()};
  receipts.set(committed.operationId,{request_hash:protocol.version(committed),result:{operationId:committed.operationId,orderId:7,deleted:true}});
  assert.equal((await request('/operations/cancel',committed)).body.deleted,true);
  assert.ok(sqls.some(sql=>sql==='SELECT pg_advisory_xact_lock($1::bigint)'));
  assert.ok(!sqls.some(sql=>/DELETE FROM ordenes_servicio|UPDATE ordenes_servicio/.test(sql)));
 }finally{await new Promise(resolve=>server.close(resolve));}
});
