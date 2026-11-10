/* Native-only SQLite cache and durable order outbox. Never replay legacy mutations. */
(() => {
 const cap=window.Capacitor;
 if(!cap || !(cap.getPlatform?.()==='android' || cap.nativePromise))return;
 const plugin=()=>cap.registerPlugin?cap.registerPlugin('AllfixOffline'):new Proxy({}, {get:(_,name)=>args=>cap.nativePromise('AllfixOffline',name,args)});
 const Model=window.AllfixOfflineModel;
 const transport=window.fetch.bind(window),api=window.SISTEMA_GESTOR_API_URL,copy=value=>JSON.parse(JSON.stringify(value));
 let session=null,scope='',state=Model.fresh(),queue=[],mutex=Promise.resolve(),syncFlight=null,refreshFlight=null,loaded=false,online=false,protocol=false,error='',generation=0,resolving=false,cancellation=false;
 const expired=s=>{try{return JSON.parse(atob(s.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).exp*1000<=Date.now();}catch{return true;}};
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','X-Allfix-Cache':'1'}});
 function lock(task){const job=mutex.then(task);mutex=job.catch(()=>{});return job;}
 function userScope(s){return s?.user?.negocio_id+':'+s?.user?.id;}
 const localAccess=s=>{if(!s)return false;if(!expired(s))return true;try{const claims=JSON.parse(atob(s.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return Boolean(s.refreshToken && Math.min(Number(s.refreshExpiresAt),claims.exp*1000+30*86400000)>Date.now());}catch{return false;}};
 function current(){return localAccess(session) && scope===userScope(session);}
 function failure(status){return ({401:'Sesión rechazada: inicia sesión de nuevo.',403:'HTTP 403: tu rol no tiene permiso.',404:'HTTP 404: la ruta no existe en el servidor.',409:'HTTP 409: la orden cambió o ya no existe; compara las versiones.',422:'HTTP 422: el servidor requiere revisar los datos o movimientos relacionados.',429:'HTTP 429: demasiadas solicitudes; se reintentará.'})[status] || 'HTTP '+status+': Render no confirmó la operación; los cambios siguen guardados.';}
 function notice(){
  const button=document.getElementById('offline-status');if(!button)return;
  const conflicts=queue.filter(o=>o.state==='conflict').length;
  button.hidden=!session;
  button.textContent=(syncFlight?'Sincronizando · ':online?'Conectado · ':'Sin conexión confirmada · ')+(conflicts?conflicts+' conflictos · revisar':queue.length?queue.length+' cambios pendientes':online && !error?'Actualizado':'Datos guardados')+(error?' · '+error:'');
  button.title=error || 'Ver estado de sincronización';
  button.classList.toggle('has-error',Boolean(error || conflicts));decorate();
 }
 function decorate(){
  document.querySelectorAll('.af-order-card').forEach(card=>{
   const row=state.orders[card.dataset.cardId];if(!row)return;
   let chip=card.querySelector('.offline-chip');
   if(!chip){chip=document.createElement('span');chip.className='offline-chip';card.append(chip);}
   const label=row._pendingDelete?'Eliminación pendiente · reversible':row._sync==='conflict'?'Conflicto · revisar':Number(row.id)<0?'Local · ticket provisional':row._sync==='pending'?'Pendiente de sincronizar':'Sincronizada';
   if(chip.textContent!==label)chip.textContent=label;
  });
 }
 function publish(){
  if(!current() || typeof APP_STATE==='undefined' || String(APP_STATE.currentUser?.id)!==String(session.user.id))return;
  APP_STATE.ordenes=Object.values(state.orders);
  if(state.cache['/api/clientes'])APP_STATE.clientes=state.cache['/api/clientes'];
  try{renderOrdenes();renderDashboard();}catch{}notice();
 }
 async function commit(nextState,nextQueue){
  const active=scope,epoch=generation;
  await plugin().commitState({scope:active,state:nextState,queue:nextQueue});
  if(epoch!==generation || active!==scope)throw Error('La sesión cambió durante el guardado.');
  state=nextState;queue=nextQueue;notice();
 }
 async function open(){
  if(!localAccess(session))return false;
  const next=userScope(session);
  if(loaded && scope===next)return true;
  scope=next;const epoch=generation;
  const result=await plugin().readState({scope});
  if(epoch!==generation || scope!==next)throw new DOMException('La sesión cambió','AbortError');
  state=result.state || Model.fresh();queue=result.queue || [];loaded=true;notice();return true;
 }
 async function saveSession(value){
  await plugin().saveSession({session:value});
  localStorage.removeItem('allfix_session_revoked');session=value;sessionStorage.setItem('allfix_user',JSON.stringify({token:value.token,user:value.user}));
  // Renewing the same identity must not reload stale disk state over a running commit.
  if(scope!==userScope(value))loaded=false;await open();publish();
 }
 async function refreshSession(){
  if(!session?.refreshToken)return false;
  if(refreshFlight)return refreshFlight;
  refreshFlight=(async()=>{
   const old=session,epoch=generation;
   try{
    const response=await transport(api+'/android/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:old.refreshToken})});
    if(epoch!==generation || old!==session)return false;
    if(response.status===401){await forget(false);return false;}
    if(!response.ok)return false;
    const value=await response.json();
    if(userScope(value)!==userScope(old))throw Error('La renovación cambió de negocio.');
    await saveSession(value);return true;
   }catch{return false;}
   finally{refreshFlight=null;}
  })();return refreshFlight;
 }
 async function forget(explicit){
  const old=session;generation++;session=null;loaded=false;scope='';state=Model.fresh();queue=[];
  localStorage.setItem('allfix_session_revoked','true');sessionStorage.removeItem('allfix_user');
  await plugin().saveSession({session:null});
  if(explicit && old?.refreshToken)transport(api+'/android/logout',{method:'POST',headers:{Authorization:'Bearer '+old.token,'Content-Type':'application/json'},body:JSON.stringify({refreshToken:old.refreshToken})}).catch(()=>{});
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
  document.querySelectorAll('dialog[data-offline-dialog]').forEach(dialog=>{dialog.close();dialog.remove();});
  notice();
 }
 async function authenticated(path,options={}){
  if(!session)return reply({error:'Inicia sesión.'},401);
  if(expired(session) && !await refreshSession())return reply({error:session?'No se pudo renovar la sesión; los datos locales permanecen guardados.':'Inicia sesión nuevamente.'},session?503:401);
  const headers=new Headers(options.headers || {});headers.set('Authorization','Bearer '+session.token);
  let response=await transport(api+path,{...options,headers});
  if(response.status===401 && session.refreshToken){
   if(!await refreshSession())return reply({error:session?'Renovación temporalmente no disponible.':'Sesión revocada.'},session?503:401);
   headers.set('Authorization','Bearer '+session.token);response=await transport(api+path,{...options,headers});
  }
  if(response.status===401){await forget(false);if(typeof APP_STATE!=='undefined'){APP_STATE.currentUser=null;stopInventoryPolling();showLoginContainer();}}
  return response;
 }
 async function synchronize(){
  if(syncFlight || resolving || !session || document.hidden)return syncFlight;
  syncFlight=(async()=>{
   let activeOp=null;
   try{
    const capResponse=await authenticated('/android/capabilities',{silent:true});
    online=capResponse.ok;
    const capabilities=capResponse.ok?await capResponse.json():{};
    protocol=capabilities.protocol===1;cancellation=capabilities.cancellation===true;
   if(!current()){error=failure(capResponse.status);notice();return;}
    await open();
    const epoch=generation;
    await Promise.all(['/catalogos','/clientes','/configuracion/negocio'].filter(path=>!state.cache['/api'+path]).map(async path=>{
      const response=await authenticated(path,{silent:true});
      if(response.ok && epoch===generation)await cacheRead('/api'+path,response,epoch);
    }));
    if(!protocol){error=capResponse.ok?'Protocolo offline incompatible.':failure(capResponse.status);notice();return;}
    if(!session.refreshToken){
      const issued=await authenticated('/android/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',silent:true});
      if(issued.ok)await saveSession(await issued.json());
    }
    for(;;){
     const op=Model.nextOperation(queue);if(!op)break;activeOp=op;
     if(op.kind!=='create' && !op.baseVersion && !op.wire){
      await markConflict(op,'Falta la versión original del servidor. Compara antes de reenviar.',null);continue;
     }
     const wire=await lock(async()=>{
      const q=copy(queue),item=q.find(o=>o.operationId===op.operationId);if(!item)return null;
      if(!item.wire){item.wire={operationId:item.operationId,kind:item.kind,orderId:item.orderId,data:item.data,baseVersion:item.baseVersion};await commit(state,q);}
      return item.wire;
     });
     if(!wire)continue;
     const response=await authenticated('/android/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(wire),silent:true});
     if(response.status===401)return;
     if(response.ok){
      const outcome=await response.json();
      if(outcome.operationId!==op.operationId)throw Error('Respuesta de sincronización inválida.');
      if(outcome.cancelled===true){
       const remote=await remoteOrder(op.orderId);
       await lock(async()=>{const next=Model.resolve(state,queue,op.localId,remote,'server',session.user,()=>crypto.randomUUID());await commit(next.state,next.queue);});continue;
      }
      await lock(async()=>{const next=Model.acknowledge(state,queue,op,outcome);await commit(next.state,next.queue);if(typeof APP_STATE!=='undefined' && APP_STATE.selectedOrderForReceipt?.id===op.localId && outcome.order)APP_STATE.selectedOrderForReceipt=outcome.order;});
     }else if([400,403,404,409,422].includes(response.status)){
      await markConflict(op,failure(response.status),response.status);continue;
     }else throw Object.assign(Error(failure(response.status)),{httpStatus:response.status});
    }
    const snapshot=await authenticated('/android/orders',{silent:true});
    if(!snapshot.ok)throw Object.assign(Error(failure(snapshot.status)),{httpStatus:snapshot.status});
    const data=await snapshot.json();
    if(!Array.isArray(data.orders) || data.orders.some(row=>!row.order || typeof row.version!=='string' || String(row.order.negocio_id)!==String(session?.user.negocio_id)))throw Error('Respuesta de órdenes inválida; se conserva la copia local.');
    await lock(()=>commit(Model.merge(state,queue,data.orders),queue));
    error='';publish();
   }catch(cause){
    online=Boolean(cause.httpStatus);error=cause.httpStatus?failure(cause.httpStatus):cause instanceof TypeError || cause.name==='TimeoutError' || cause.name==='AbortError'?'Red, TLS o tiempo de espera: no se recibió confirmación de Render.':cause.message || 'No se pudo sincronizar. Los cambios siguen guardados.';
    if(current() && activeOp)await lock(async()=>{
     const q=copy(queue),item=q.find(o=>o.operationId===activeOp.operationId);if(!item || item.state!=='pending')return;
     item.attempts=(item.attempts || 0)+1;item.error=error;item.nextAt=Date.now()+Math.min(300000,2000*2**Math.min(item.attempts,7));await commit(state,q);
    }).catch(()=>{});
   }finally{syncFlight=null;notice();}
  })();return syncFlight;
 }
 async function markConflict(op,message,httpStatus){
  await lock(async()=>{
   const q=copy(queue),item=q.find(o=>o.operationId===op.operationId);if(!item)return;
   item.state='conflict';item.error=message;item.httpStatus=httpStatus;
   const s=copy(state);if(s.orders[item.localId])s.orders[item.localId]._sync='conflict';await commit(s,q);
  });
 }
 async function cacheRead(path,response,epoch){
  const data=await response.clone().json();
  await lock(async()=>{
   if(epoch!==generation)return;
   const s=JSON.parse(JSON.stringify(state));
   if(path==='/api/ordenes'){
    // Legacy servers supply a cache only, never a version suitable for replay.
    const pending=new Set(queue.map(o=>String(o.localId)));
    for(const order of data)if(String(order.negocio_id)===String(session?.user.negocio_id) && !pending.has(String(order.id)))s.orders[order.id]={...s.orders[order.id],...order,_sync:s.orders[order.id]?._sync || 'synced'};
   }else if(/^\/api\/ordenes\/-?\d+$/.test(path)){
    if(String(data.negocio_id)!==String(session?.user.negocio_id))return;
    if(!queue.some(o=>o.localId===data.id))s.orders[data.id]={...data,_sync:'synced'};
   }else s.cache[path]=data;
   await commit(s,queue);
  });
 }
 const cacheable=path=>path==='/api/ordenes' || /^\/api\/ordenes\/-?\d+$/.test(path) || path==='/api/clientes' || path==='/api/configuracion/negocio' || path.startsWith('/api/catalogos');
 window.fetch=async function(resource,options={}){
  const requestEpoch=generation;
  const url=new URL(typeof resource==='string'?resource:resource.url,location.href),path=url.pathname,method=String(options.method || 'GET').toUpperCase();
  const trusted=url.origin===new URL(api).origin || url.origin===location.origin;
  if(!trusted)return transport(resource,options);
  const send=()=>authenticated(path.replace(/^\/api/, '')+url.search,options);
  if(session && !online && method!=='GET' && /^\/api\/(pos|caja|ventas)(?:\/|$)/.test(path))return reply({error:'Los movimientos financieros requieren conexión confirmada.'},503);
  if(!session || !path.startsWith('/api/') || /^\/api\/(auth|setup|android)(\/|$)/.test(path))return transport(resource,options);
  if(!cacheable(path) && !path.startsWith('/api/ordenes'))return send();
  if(!await open())return reply({error:'Inicia sesión para acceder a tus datos locales.'},401);
  if(requestEpoch!==generation)throw new DOMException('La sesión cambió','AbortError');
  const epoch=generation;
  if(method==='GET' && cacheable(path)){
   const rawId=Number(path.split('/').pop()),id=state.aliases?.[rawId] || rawId,cached=path==='/api/ordenes'?Object.keys(state.orders).length?Object.values(state.orders):null:/^\/api\/ordenes\/-?\d+$/.test(path)?state.orders[id]:state.cache[path];
   if(cached!=null){
    if(Number(id)>0 || !/^\/api\/ordenes\//.test(path)){
      send().then(async response=>{
       if(epoch!==generation)return;
       if(response.status===401){error=failure(401);notice();}
       else if(response.ok){online=true;await cacheRead(path,response,epoch);if(path==='/api/ordenes')publish();notice();}
       else if(response.status>=500){online=false;error='Render no está disponible. Se muestran datos guardados.';notice();}
       else if(!response.ok){error=failure(response.status);notice();}
      }).catch(()=>{online=false;notice();});
    }
    return reply(cached);
   }
   try{
    const response=await send();
    if(response.ok && epoch===generation){online=true;await cacheRead(path,response,epoch);}
    return response;
   }catch{online=false;notice();throw Error('Sin conexión y sin datos guardados para esta pantalla.');}
  }
  let kind=null,id;
  if(method==='POST' && ['/api/ordenes','/api/ordenes/rapida'].includes(path))kind='create';
  const match=path.match(/^\/api\/ordenes\/(-?\d+)(?:\/(status|estado))?$/);
  if(match){id=state.aliases?.[match[1]] || Number(match[1]);kind=method==='DELETE'?'delete':match[2] && ['PUT','PATCH'].includes(method)?'status':method==='PUT'?'update':null;}
  if(kind){
   try{
    const data=options.body?JSON.parse(options.body):{};
    const result=await lock(async()=>{
     const next=Model.apply(state,queue,{kind,orderId:id,data},session.user,crypto.randomUUID());
     await commit(next.state,next.queue);return next.order;
    });
    setTimeout(()=>{publish();synchronize();},0);
    return reply(kind==='delete'?{success:true,pending:true}:result,202);
   }catch(e){
    if(e.onlineRequired && online && !queue.some(o=>kind==='create' || o.localId===id) && (kind==='create' || id>0)){
      // Existing online financial/advanced service, sent exactly once. NEVER enqueue on failure.
      try{
        const response=await send();
        if(response.ok){if(kind==='update')try{await cacheRead(path,response,epoch);}catch{window.AllfixUI?.notify('El servidor confirmó el cambio; no se pudo actualizar la copia local. No repitas el pago.','warning');}setTimeout(()=>publish(),0);}
        return response;
      }catch{throw Error('El servidor no confirmó la operación en línea. Revisa el registro antes de volver a intentar; no se agregó a la cola.');}
    }
    return reply({error:e.message},422);
   }
  }
  if(!online && method!=='GET')return reply({error:'Esta operación requiere conexión. No se registró ningún movimiento financiero.'},503);
  return send();
 };
 async function restore(){
  try{
   let value=localStorage.getItem('allfix_session_revoked')?null:(await plugin().restoreSession()).session;
   if(!value && !localStorage.getItem('allfix_session_revoked')){
    const legacy=JSON.parse(sessionStorage.getItem('allfix_user') || 'null');
    if(legacy?.token && !expired(legacy)){await saveSession(legacy);value=legacy;}
   }
   if(value){session=value;if(expired(value))await refreshSession();if(localAccess(session)){sessionStorage.setItem('allfix_user',JSON.stringify({token:session.token,user:session.user}));await open();}else sessionStorage.removeItem('allfix_user');}
  }catch{session=null;loaded=false;sessionStorage.removeItem('allfix_user');error='No se pudieron abrir los datos protegidos. No se borraron los cambios pendientes.';window.AllfixUI?.notify(error,'warning');}
  if(typeof editOrderDetails==='function'){
   const edit=editOrderDetails;
   editOrderDetails=async function(rawId){
    if(online)return edit(rawId);
    const id=state.aliases?.[rawId] || rawId,order=state.orders[id];
    if(!current() || !order)throw Error('Esta orden no está disponible sin conexión.');
    const dialog=document.createElement('dialog');dialog.className='ax-picker';dialog.dataset.offlineDialog='true';
    const esc=value=>escapeHtml(String(value??''));
    const fields=[['brand','Marca'],['model','Modelo'],['color','Color'],['imei','IMEI'],['serial','Serie'],['falla_reportada','Falla reportada'],['servicio_solicitado','Servicio solicitado'],['estimatedDate','Entrega estimada']];
    dialog.innerHTML='<h2>Editar sin conexión</h2><p>'+esc(order.folio)+' · Los pagos y datos del cliente se modifican en línea.</p><form>'+fields.map(([key,label])=>'<label>'+label+'<input class="form-control" name="'+key+'" type="'+(key==='estimatedDate'?'date':'text')+'" value="'+esc(order[key])+'"></label>').join('')+'<p role="alert"></p><button type="submit" class="ax-cancel">Guardar en este dispositivo</button><button type="button" data-close class="ax-cancel">Cancelar</button></form>';
    dialog.querySelector('[data-close]').onclick=()=>{dialog.close();dialog.remove();};
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const button=dialog.querySelector('[type=submit]');button.disabled=true;
      try{
        const data=Object.fromEntries(new FormData(event.target));
        const response=await window.fetch(api+'/ordenes/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
        const result=await response.json();if(!response.ok)throw Error(result.error || 'No se guardaron los cambios.');
        dialog.close();dialog.remove();publish();
      }catch(error){dialog.querySelector('[role=alert]').textContent=error.message;}
      finally{button.disabled=false;}
    };
    document.body.append(dialog);dialog.showModal();
   };
  }
  const persist=persistSession;
  persistSession=async function(value){persist(value);const normalized=JSON.parse(sessionStorage.getItem('allfix_user'));if(session && userScope(session)===userScope(normalized)){normalized.refreshToken=session.refreshToken;normalized.refreshExpiresAt=session.refreshExpiresAt;}await saveSession(normalized);};
  const clear=clearSessionState;
  clearSessionState=function(){forget(false).catch(()=>{});clear();};
  document.getElementById('btn-logout')?.addEventListener('click',()=>{forget(true).catch(()=>{});},true);
  setTimeout(()=>{publish();synchronize();},0);
 }
 async function remoteOrder(id){
  const response=await authenticated('/android/orders',{silent:true});if(!response.ok)throw Error(failure(response.status));
  const rows=(await response.json()).orders;if(!Array.isArray(rows))throw Error('Respuesta de órdenes inválida.');
  const row=rows.find(row=>String(row.order.id)===String(id)) || null;
  if(row && (String(row.order.negocio_id)!==String(session?.user.negocio_id) || typeof row.version!=='string'))throw Error('La respuesta pertenece a otra sesión.');
  return row;
 }
 async function retry(){
  if(syncFlight)await syncFlight;
  if(!current()){await synchronize();return;}
  await lock(()=>commit(state,queue.map(op=>({...op,nextAt:0}))));await synchronize();
 }
 async function resolveOperation(operationId,mode){
  if(resolving)throw Error('Hay otra resolución en curso.');
  resolving=true;
  try{
   if(syncFlight)await syncFlight;
   const op=queue.find(item=>item.operationId===operationId);if(!op)return;
   if(mode==='cancel' && op.kind==='delete' && !op.wire){
    await lock(async()=>{
     const s=copy(state),q=queue.filter(item=>item.operationId!==operationId);s.drafts ||= [];
     s.drafts.push({date:new Date().toISOString(),order:copy(s.orders[op.localId]),operations:[copy(op)],resolution:'cancel-delete'});
     delete s.orders[op.localId]._pendingDelete;s.orders[op.localId]._sync=q.some(item=>item.localId===op.localId)?'pending':'synced';await commit(s,q);
    });return;
   }
   const affected=queue.filter(item=>String(item.localId)===String(op.localId));
   for(const item of affected.filter(item=>item.wire)){
    if(!cancellation)throw Error('El servidor necesita el parche de cancelación segura antes de resolver una operación enviada. Puedes reintentar el mismo identificador.');
    const response=await authenticated('/android/operations/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item.wire),silent:true});
    if(!response.ok)throw Error(failure(response.status));
    const outcome=await response.json();
    if(outcome.operationId!==item.operationId)throw Error('Confirmación de cancelación inválida.');
    if(!outcome.cancelled){
     await lock(async()=>{const next=Model.acknowledge(state,queue,item,outcome);await commit(next.state,next.queue);});
     throw Error('El servidor ya había aplicado este cambio. Se guardó su confirmación. Revisa la orden antes de resolver otros cambios.');
    }
   }
   const remote=await remoteOrder(op.orderId);
   await lock(async()=>{
    const next=Model.resolve(state,queue,op.localId,remote,mode==='local'?'local':'server',session.user,()=>crypto.randomUUID());
    await commit(next.state,next.queue);
   });
  }finally{resolving=false;publish();}
 }
 async function showQueueV2(){
  if(!current())return;
  const dialog=document.createElement('dialog');dialog.className='ax-picker';dialog.dataset.offlineDialog='true';
  const esc=value=>escapeHtml(String(value??''));
  dialog.innerHTML='<h2>Cambios de este dispositivo</h2><p role="status">'+esc(error || (online?'Conectado a Render.':'Sin conexión confirmada; copia local protegida.'))+'</p><button data-retry>Reintentar sincronización</button>'+queue.map(op=>{
   const local=state.orders[op.localId];
   return '<details><summary>'+esc((local?.folio || 'Orden')+' · '+op.kind+' · '+op.state)+'</summary><p>'+esc(op.error || 'Pendiente de confirmación del servidor.')+'</p><p>'+esc(op.baseVersion?'Versión original guardada.':'Sin versión original: requiere revisión explícita.')+'</p><div data-comparison="'+esc(op.operationId)+'"></div><button data-compare="'+esc(op.operationId)+'">Comparar local y servidor</button>'+(op.kind==='delete'?'<button data-resolve="cancel" data-op="'+esc(op.operationId)+'">Cancelar eliminación pendiente</button>':'')+(op.state==='conflict'?'<button data-resolve="server" data-op="'+esc(op.operationId)+'">Conservar borrador y usar servidor</button><button data-resolve="local" data-op="'+esc(op.operationId)+'">Reaplicar mis cambios sobre el servidor</button>':'')+'</details>';
  }).join('')+'<p>'+state.drafts.length+' borradores conservados</p>'+state.drafts.map(d=>'<details><summary>'+esc(d.order?.folio || 'Borrador')+' · '+esc(d.date)+'</summary><p>'+esc(d.order?.model)+' · '+esc(d.order?.status)+'</p>'+d.operations.map(op=>'<p>'+esc(op.kind+': '+Object.entries(op.data || {}).filter(([key,value])=>!/^lock_|foto|firma|evidencia/i.test(key) && typeof value==='string').map(([key,value])=>key+' = '+value).join('; '))+'</p>').join('')+'</details>').join('')+'<button class="ax-cancel">Cerrar</button>';
  const status=dialog.querySelector('[role=status]');
  dialog.querySelector('.ax-cancel').onclick=()=>{dialog.close();dialog.remove();};
  dialog.querySelector('[data-retry]').onclick=async event=>{
   event.target.disabled=true;status.textContent='Sincronizando…';
   try{await retry();dialog.close();dialog.remove();await showQueueV2();}catch(e){status.textContent=e.message;}finally{event.target.disabled=false;}
  };
  dialog.querySelectorAll('[data-compare]').forEach(button=>button.onclick=async()=>{
   button.disabled=true;
   try{
    const op=queue.find(item=>item.operationId===button.dataset.compare);if(!op)throw Error('El cambio ya se sincronizó; vuelve a abrir la lista.');
    const remote=await remoteOrder(op.orderId),host=button.parentElement.querySelector('[data-comparison]');
    host.innerHTML=remote?'<p>Versión local: '+esc(op.baseVersion || 'desconocida')+'<br>Versión servidor: '+esc(remote.version)+'</p><table><thead><tr><th>Campo</th><th>Local</th><th>Servidor</th></tr></thead><tbody>'+Model.differences(state.orders[op.localId],remote.order).map(diff=>'<tr><td>'+esc(diff.field)+'</td><td>'+esc(diff.local)+'</td><td>'+esc(diff.server)+'</td></tr>').join('')+'</tbody></table>':'<p>Esta orden ya no existe en el servidor. Tu copia local y sus cambios se conservarán como borrador. No se recreará automáticamente.</p>';
   }catch(e){status.textContent=e.message;}finally{button.disabled=false;}
  });
  dialog.querySelectorAll('[data-resolve]').forEach(button=>button.onclick=async()=>{
   button.disabled=true;
   try{await resolveOperation(button.dataset.op,button.dataset.resolve);dialog.close();dialog.remove();await showQueueV2();}catch(e){status.textContent=e.message;button.disabled=false;}
  });
  document.body.append(dialog);dialog.showModal();
 }
 window.AllfixOffline={restore,hydrate:publish,refresh:synchronize,retry,resolve:resolveOperation,ready:()=>current(),isOffline:()=>!online,status:()=>({online,syncing:Boolean(syncFlight),pending:queue.filter(op=>op.state==='pending').length,conflicts:queue.filter(op=>op.state==='conflict').length,error})};
 document.addEventListener('DOMContentLoaded',()=>{
  document.body.classList.add('allfix-offline-enabled');
  const button=document.createElement('button');button.id='offline-status';button.hidden=true;button.onclick=showQueueV2;
  document.querySelector('.view-container').prepend(button);
  new MutationObserver(()=>requestAnimationFrame(decorate)).observe(document.getElementById('af-order-list') || document.querySelector('.view-container'),{childList:true,subtree:true});
  notice();
  setInterval(()=>synchronize(),30000);
 });
 window.addEventListener('offline',()=>{online=false;error='Sin conexión. Los cambios de órdenes se guardan en este dispositivo.';notice();});
 window.addEventListener('online',()=>{queue.forEach(o=>o.nextAt=0);synchronize();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){publish();synchronize();}});
})();
