const crypto = require('node:crypto');
function canonical(value) {
  if(value && typeof value.toJSON==='function')return canonical(value.toJSON());
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value ?? null);
}
const version = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fail = (statusCode,message) => Object.assign(new Error(message),{statusCode});
function assertOperation(operation,user,current) {
  if(!uuid(operation.operationId))throw fail(400,'Identificador de operación inválido.');
  if(!['create','update','status','delete'].includes(operation.kind))throw fail(400,'Operación no admitida.');
  if(operation.kind==='delete' && user.rol!=='Administrador')throw fail(403,'Solo administradores pueden eliminar órdenes.');
  if(operation.kind==='create' && !['Administrador','Recepcionista'].includes(user.rol))throw fail(403,'No puedes registrar órdenes.');
  const data=operation.data || {};
  if(typeof data!=='object' || Array.isArray(data))throw fail(400,'Datos de operación inválidos.');
  if(Number(data.anticipo || 0)>0 || data.guardar_catalogo===true)throw fail(422,'Los anticipos y cambios de catálogo requieren conexión.');
  if(operation.kind==='update'){
    const editable=new Set(['deviceType','brand','model','imei','imei2','serial','color','falla_reportada','servicio_solicitado','descripcion_falla','estimatedDate','inspeccion_obs','status','lock_type','lock_pin','lock_pass','lock_pattern']);
    const metadata=new Set(['metodo_pago_anticipo','metodo_pago_abono','advancePaymentMethod','metodo_pago','guardar_catalogo']);
    for(const [field,value] of Object.entries(data)){
      if(editable.has(field) || metadata.has(field) || field.startsWith('_'))continue;
      const empty=v=>v==null || v==='' || v===false || Array.isArray(v)&&v.length===0;
      if(empty(value)&&empty(current?.[field]))continue;
      if((value==null || typeof value!=='object') && String(value)===String(current?.[field]))continue;
      if(canonical(value)!==canonical(current?.[field]))throw fail(422,'Este campo requiere edición en línea: '+field);
    }
    const financial=['anticipo','costo_estimado','costo_real','costo_refaccion','mano_obra','estado_pago'];
    for(const field of financial)if(data[field]!==undefined && String(data[field]??'')!==String(current?.[field]??''))throw fail(422,'Modifica importes y pagos en línea.');
  }
}
module.exports={canonical,version,uuid,fail,assertOperation};
