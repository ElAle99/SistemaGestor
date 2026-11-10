/* Pure durable queue model, shared by native runtime and isolated tests. */
((root)=>{
 const copy=value=>JSON.parse(JSON.stringify(value));
 const fresh=()=>({orders:{},versions:{},aliases:{},cache:{},nextId:-1,drafts:[]});
 const financial=['anticipo','costo_estimado','costo_real','costo_refaccion','mano_obra','estado_pago'];
 function apply(state,queue,request,user,uuid){
  const s=copy(state),q=copy(queue),data=copy(request.data || {}),kind=request.kind;
  let id=Number(request.orderId),order=s.orders[id];
  if(kind==='create'){
   if(!['Administrador','Recepcionista'].includes(user.rol))throw Error('Tu rol no permite crear órdenes.');
   if(Number(data.anticipo || 0)>0)throw Object.assign(Error('Los anticipos requieren conexión; guarda primero la orden sin anticipo.'),{onlineRequired:true});
   id=s.nextId--;order={...data,id,negocio_id:user.negocio_id,folio:'PROVISIONAL · '+Math.abs(id),status:'Recibido',dateIn:new Date().toISOString().slice(0,10),historial:[],anticipo:0};
   data.guardar_catalogo=false;
  }else if(!order)throw Error('Esta orden no está sincronizada en este dispositivo.');
  if(kind!=='create' && order._pendingDelete)throw Error('La eliminación ya está pendiente. Restáurala antes de editar.');
  if(String(order.negocio_id)!==String(user.negocio_id))throw Error('La orden pertenece a otro negocio.');
  if(kind==='update'){
   for(const field of financial)if(data[field]!==undefined){
    const left=data[field],right=order[field],empty=v=>v==null || v==='';
    const same=field==='estado_pago'?String(left??'')===String(right??''):empty(left)&&empty(right) || !empty(left)&&!empty(right)&&Number.isFinite(Number(left))&&Number(left)===Number(right);
    if(!same)throw Object.assign(Error('Los importes y pagos deben modificarse en línea.'),{onlineRequired:true});
    // Unchanged money fields never enter the outbox or the offline update endpoint.
    delete data[field];
   }
   const allowed=new Set(['deviceType','brand','model','imei','imei2','serial','color','falla_reportada','servicio_solicitado','descripcion_falla','estimatedDate','inspeccion_obs','status','lock_type','lock_pin','lock_pass','lock_pattern']);
   for(const [field,value] of Object.entries(data)){
    if(allowed.has(field))continue;
    const empty=v=>v==null || v==='' || v===false || Array.isArray(v)&&v.length===0;
    const same=empty(value)&&empty(order[field]) || typeof value!=='object'&&String(value)===String(order[field]) || JSON.stringify(value)===JSON.stringify(order[field]);
    if(!same && !['metodo_pago_anticipo','metodo_pago_abono','advancePaymentMethod','metodo_pago'].includes(field))throw Object.assign(Error('Este campo requiere conexión: '+field),{onlineRequired:true});
    delete data[field];
   }
   order={...order,...data,id:order.id,folio:order.folio,negocio_id:order.negocio_id};
  }
  if(kind==='status'){order.status=data.estado;order.historial=[...(order.historial || []),{estado:data.estado,fecha:new Date().toISOString(),comentario:data.comentario || 'Cambio local pendiente'}];}
  if(kind==='delete'){
   if(user.rol!=='Administrador')throw Error('Solo un administrador puede solicitar la eliminación.');
   order._pendingDelete=true;
  }
  order._sync='pending';s.orders[id]=order;
  const base=queue.find(o=>String(o.localId)===String(id));
  const op={operationId:uuid,kind,orderId:id,localId:id,data,baseVersion:s.versions[id] || null,baseOrder:copy(base?.baseOrder || state.orders[id] || null),state:'pending',attempts:0,nextAt:0};
  q.push(op);return {state:s,queue:q,order};
 }
 function acknowledge(state,queue,op,result){
  if(result.operationId!==op.operationId || !Number.isSafeInteger(Number(result.orderId)) || Number(result.orderId)<=0 ||
    (op.kind!=='create' && Number(result.orderId)!==Number(op.orderId)) ||
    (op.kind==='delete' ? result.deleted!==true : result.deleted || !result.order || Number(result.order.id)!==Number(result.orderId) || String(result.order.negocio_id)!==String(state.orders[op.localId]?.negocio_id) || typeof result.version!=='string'))throw Error('Confirmación inválida: el cambio permanece pendiente.');
  const s=copy(state),q=copy(queue).filter(item=>item.operationId!==op.operationId);
  const oldId=op.localId,newId=result.orderId;
  if(oldId!==newId){s.aliases ||= {};s.aliases[oldId]=newId;}
  if(result.deleted){delete s.orders[oldId];delete s.versions[oldId];}
  else{
   delete s.orders[oldId];delete s.versions[oldId];s.orders[newId]={...result.order,_sync:'synced'};s.versions[newId]=result.version;
   for(const next of q)if(next.localId===oldId){
    next.localId=newId;next.orderId=newId;
    if(!next.wire){next.baseVersion=result.version;next.baseOrder=copy(result.order);}
    const row=s.orders[newId];
    if(next.kind==='update')Object.assign(row,next.data);
    if(next.kind==='status')row.status=next.data.estado;
    if(next.kind==='delete')row._pendingDelete=true;
    row._sync=next.state;
   }
  }
  return {state:s,queue:q};
 }
 function merge(state,queue,rows){
  const s=copy(state),pending=new Set(queue.map(op=>String(op.localId))),remote=new Set(rows.map(row=>String(row.order.id)));
  for(const id of Object.keys(s.orders))if(Number(id)>0 && !pending.has(id) && !remote.has(id)){delete s.orders[id];delete s.versions[id];}
  for(const row of rows)if(!pending.has(String(row.order.id))){s.orders[row.order.id]={...row.order,_sync:'synced'};s.versions[row.order.id]=row.version;}
  return s;
 }
 // Preserve order within each lane, while a conflict on one order never blocks another.
 function nextOperation(queue,now=Date.now()){
  const seen=new Set();
  return queue.find(op=>{const id=String(op.localId);if(seen.has(id))return false;seen.add(id);return op.state==='pending' && !(op.nextAt>now);});
 }
 function differences(local,remote){
  const fields=['clientName','deviceType','brand','model','imei','imei2','serial','color','falla_reportada','servicio_solicitado','descripcion_falla','estimatedDate','inspeccion_obs','status','anticipo','costo_estimado','costo_real','estado_pago'];
  return fields.filter(key=>JSON.stringify(local?.[key]??null)!==JSON.stringify(remote?.[key]??null)).map(key=>({field:key,local:local?.[key]??null,server:remote?.[key]??null}));
 }
 function resolve(state,queue,id,remote,mode,user,newId){
  if(!['server','local'].includes(mode))throw Error('Resolución inválida.');
  const operations=queue.filter(op=>String(op.localId)===String(id));
  if(!operations.length)throw Error('La cola cambió; revisa de nuevo.');
  if(mode==='local' && !remote && operations[0].kind!=='create')throw Error('La orden no existe en el servidor. Conserva el borrador; no se recreará automáticamente.');
  let s=copy(state),q=copy(queue.filter(op=>String(op.localId)!==String(id)));
  s.drafts ||= [];s.drafts.push({date:new Date().toISOString(),order:copy(s.orders[id] || null),operations:copy(operations),server:copy(remote || null),resolution:mode});
  delete s.orders[id];delete s.versions[id];
  if(remote){s.orders[id]={...copy(remote.order),_sync:'synced'};s.versions[id]=remote.version;}
  if(mode==='local')for(const op of operations){const next=apply(s,q,{kind:op.kind,orderId:id,data:op.data},user,newId());s=next.state;q=next.queue;if(op.kind==='create')id=next.order.id;}
  return {state:s,queue:q};
 }
 root.AllfixOfflineModel={fresh,apply,acknowledge,merge,nextOperation,differences,resolve};
})(typeof window==='object'?window:globalThis);
