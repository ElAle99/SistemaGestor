const express=require('express');
const jwt=require('jsonwebtoken');
const crypto=require('node:crypto');
const {pool}=require('../config/db');
const {withTenant,withAtomicClient}=require('../config/tenantContext');
const {authMiddleware}=require('../middleware/auth');
const {rateLimit}=require('../middleware/rateLimit');
const orders=require('../services/ordenService');
const {createQuickOrder}=require('../services/quickOrderService');
const {version,fail,assertOperation,uuid}=require('../services/androidSyncProtocol');
const router=express.Router();
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const allowedStates=['Recibido','Diagnóstico','Esperando autorización','Esperando refacción','En reparación','Listo para entregar','Terminado','Entregado','Cancelado','Retrasado'];
const enabled=(req,res,next)=>process.env.ANDROID_OFFLINE_ENABLED==='true'?next():res.status(501).json({error:'La extensión offline no está habilitada.'});
router.use(enabled);
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
async function transaction(action){
 const client=await pool.connect();
 try{await client.query('BEGIN');const result=await action(client);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
function errorResponse(res,error){
 return res.status(error.statusCode || (error.code==='42P01'?503:500)).json({error:error.statusCode?error.message:'No se pudo completar la operación Android.'});
}
router.get('/capabilities',authMiddleware,async(req,res)=>{
 try{await pool.query('SELECT 1 FROM android_sync_receipts LIMIT 0');await pool.query('SELECT 1 FROM android_refresh_sessions LIMIT 0');res.json({protocol:1,refresh:true});}catch(e){errorResponse(res,e);}
});
router.get('/orders',authMiddleware,async(req,res)=>{
 try{
  // Details are deliberately synchronized: they include the authorized receipt fields missing from the list.
  const list=await orders.getAllOrdenes(),result=[];
  for(const entry of list){const order=await orders.getOrdenById(entry.id);if(order)result.push({order,version:version(order)});}
  res.json({orders:result});
 }catch(e){errorResponse(res,e);}
});
router.post('/operations',authMiddleware,async(req,res)=>{
 try{
  const op=req.body;
  if(!op || typeof op!=='object' || Array.isArray(op))throw fail(400,'Operación inválida.');
  if(!uuid(op.operationId))throw fail(400,'Operación inválida.');
  const result=await transaction(async db=>withAtomicClient(db,async()=>{
   // One tenant lane serializes retries and offline mutations; web UPDATEs also acquire row locks.
   await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[String(req.user.negocio_id)]);
   const digest=version(op);
   const previous=(await db.query('SELECT request_hash,result FROM android_sync_receipts WHERE negocio_id=app_tenant_id() AND usuario_id=$1 AND operation_id=$2',[req.user.id,op.operationId])).rows[0];
   if(previous){if(previous.request_hash!==digest)throw fail(409,'La operación ya existe con otro contenido.');return previous.result;}
   let current=null;
   if(op.kind!=='create'){
    if(!Number.isSafeInteger(Number(op.orderId)) || Number(op.orderId)<=0)throw fail(400,'Orden inválida.');
    await db.query('SELECT id FROM ordenes_servicio WHERE negocio_id=app_tenant_id() AND id=$1 FOR UPDATE',[op.orderId]);
    current=await orders.getOrdenById(Number(op.orderId));
    if(!current)throw fail(409,'La orden ya no existe. Revisa el conflicto.');
    if(typeof op.baseVersion!=='string' || version(current)!==op.baseVersion)throw fail(409,'La orden cambió en la web. Conservamos ambos cambios para revisión.');
   }
   assertOperation(op,req.user,current);
   let order;
   if(op.kind==='create')order=await createQuickOrder({...op.data,anticipo:0,guardar_catalogo:false},req.user.id,req.user.negocio_id);
   if(op.kind==='update'){
    // Offline edits touch descriptive fields only; no stock, customer or money side effects.
    const fields={deviceType:'tipo_equipo',brand:'marca',model:'modelo',imei:'imei1',imei2:'imei2',serial:'serie',color:'color',falla_reportada:'falla_reportada',servicio_solicitado:'servicio_solicitado',descripcion_falla:'descripcion_falla',estimatedDate:'fecha_entrega_estimada',inspeccion_obs:'otros_insp',lock_type:'lock_type',lock_pin:'lock_pin',lock_pass:'lock_pass',lock_pattern:'lock_pattern'};
    const entries=Object.entries(fields).filter(([field])=>op.data[field]!==undefined);
    for(const [field] of entries)if(op.data[field]!=null && (typeof op.data[field]!=='string' || op.data[field].length>10000))throw fail(400,'Campo de orden inválido.');
    if(entries.length)await db.query('UPDATE ordenes_servicio SET '+entries.map(([,column],i)=>column+'=$'+(i+1)).join(',')+' WHERE negocio_id=app_tenant_id() AND id=$'+(entries.length+1),[...entries.map(([field])=>op.data[field]),op.orderId]);
    if(op.data.status && !allowedStates.includes(op.data.status))throw fail(400,'Estado inválido.');
    if(op.data.status && op.data.status!==current.status)await orders.updateOrdenEstado(Number(op.orderId),op.data.status,'Cambio offline revisado',req.user.id);
    order=await orders.getOrdenById(Number(op.orderId));
   }
   if(op.kind==='status'){
    if(!allowedStates.includes(op.data?.estado))throw fail(400,'Estado inválido.');
    order=await orders.updateOrdenEstado(Number(op.orderId),op.data.estado,op.data.comentario,req.user.id);
   }
   if(op.kind==='delete'){
    const linked=await db.query(`SELECT EXISTS(SELECT 1 FROM caja_movimientos WHERE negocio_id=app_tenant_id() AND referencia_tipo='orden' AND referencia_id=$1)
      OR EXISTS(SELECT 1 FROM ventas_detalle WHERE negocio_id=app_tenant_id() AND orden_id=$1)
      OR EXISTS(SELECT 1 FROM orden_refacciones WHERE negocio_id=app_tenant_id() AND orden_id=$1) AS blocked`,[op.orderId]);
    if(linked.rows[0].blocked || Number(current.anticipo || 0)>0 || current.estado_pago==='Pagado')throw fail(422,'La orden tiene movimientos relacionados. Revísala en línea; no se eliminará automáticamente.');
    await orders.deleteOrden(Number(op.orderId),req.user.id);
   }
   const outcome={operationId:op.operationId,orderId:order?.id || Number(op.orderId),deleted:op.kind==='delete'};
   if(!outcome.deleted){order=await orders.getOrdenById(outcome.orderId);outcome.order=order;outcome.version=version(order);}
   await db.query('INSERT INTO android_sync_receipts(usuario_id,operation_id,request_hash,result) VALUES($1,$2,$3,$4::jsonb)',[req.user.id,op.operationId,digest,JSON.stringify(outcome)]);
   return outcome;
  }));
  res.json(result);
 }catch(e){errorResponse(res,e);}
});
async function mint(db,user,family,expires){
 const refresh=jwt.sign({type:'android-refresh',id:user.id,business:user.negocio_id,family,nonce:crypto.randomUUID()},process.env.JWT_SECRET,{expiresIn:Math.max(1,Math.floor((expires-Date.now())/1000)),issuer:'allfix-android-refresh'});
 await db.query('INSERT INTO android_refresh_sessions(usuario_id,token_hash,family,session_version,expires_at) VALUES($1,$2,$3,$4,$5)',[user.id,hash(refresh),family,user.session_version,new Date(expires).toISOString()]);
 const token=jwt.sign({id:user.id,username:user.username,rol:user.rol,sessionVersion:user.session_version},process.env.JWT_SECRET,{expiresIn:'8h'});
 return {token,refreshToken:refresh,refreshExpiresAt:expires,user:{id:user.id,negocio_id:user.negocio_id,username:user.username,nombre:user.nombre,rol:user.rol,correo:user.correo || '',telefono:user.telefono || ''}};
}
router.post('/session',authMiddleware,rateLimit({windowMs:60000,max:20,keyPrefix:'android-session'}),async(req,res)=>{
 try{
 const result=await transaction(async db=>{
  const user=(await db.query('SELECT auth_user_by_id($1) AS identity',[req.user.id])).rows[0]?.identity;
  if(!user?.activo)throw fail(401,'Sesión revocada.');
  return mint(db,user,crypto.randomUUID(),Date.now()+30*86400000);
 });res.json(result);
 }catch(e){errorResponse(res,e);}
});
router.post('/refresh',rateLimit({windowMs:60000,max:20,keyPrefix:'android-refresh'}),async(req,res)=>{
 try{
  const raw=req.body?.refreshToken;
  if(typeof raw!=='string' || raw.length>4096)throw fail(401,'Sesión inválida.');
  let claims;try{claims=jwt.verify(raw,process.env.JWT_SECRET,{issuer:'allfix-android-refresh'});}catch{throw fail(401,'Sesión expirada.');}
  if(claims.type!=='android-refresh' || !Number.isSafeInteger(Number(claims.business)))throw fail(401,'Sesión inválida.');
  const result=await withTenant(claims.business,()=>transaction(async db=>{
   if(!uuid(claims.family))throw fail(401,'Sesión inválida.');
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',[claims.family]);
   const row=(await db.query('SELECT * FROM android_refresh_sessions WHERE negocio_id=app_tenant_id() AND token_hash=$1 FOR UPDATE',[hash(raw)])).rows[0];
   const user=(await db.query('SELECT auth_user_by_id($1) AS identity',[claims.id])).rows[0]?.identity;
   if(!row || row.usuario_id!==claims.id || row.revoked || !user?.activo || String(user.negocio_id)!==String(claims.business) || row.session_version!==user.session_version || Date.parse(row.expires_at)<=Date.now())return null;
   if(row.consumed){await db.query('UPDATE android_refresh_sessions SET revoked=true WHERE negocio_id=app_tenant_id() AND family=$1',[row.family]);return null;}
   await db.query('UPDATE android_refresh_sessions SET consumed=true WHERE negocio_id=app_tenant_id() AND token_hash=$1',[hash(raw)]);
   return mint(db,user,row.family,Date.parse(row.expires_at));
  }));
  if(!result)throw fail(401,'Sesión revocada o expirada.');res.json(result);
 }catch(e){errorResponse(res,e);}
});
router.post('/logout',rateLimit({windowMs:60000,max:20,keyPrefix:'android-logout'}),async(req,res)=>{
 try{
  let decoded;try{decoded=jwt.verify(req.body?.refreshToken,process.env.JWT_SECRET,{issuer:'allfix-android-refresh'});}catch{throw fail(401,'Sesión inválida.');}
  if(decoded.type!=='android-refresh')throw fail(401,'Sesión inválida.');
  await withTenant(decoded.business,()=>pool.query('UPDATE android_refresh_sessions SET revoked=true WHERE negocio_id=app_tenant_id() AND family=$1 AND usuario_id=$2',[decoded.family,decoded.id]));
  res.json({success:true});
 }catch(e){errorResponse(res,e);}
});
module.exports=router;
