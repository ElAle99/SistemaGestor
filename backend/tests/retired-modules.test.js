const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('calendar retains orders and manual events without querying retired quotes',async()=>{
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../services/ordenService.js'),'utf8'),{module,require(name){
  if(name==='../config/db')return{pool:{query:async sql=>{assert.doesNotMatch(sql,/FROM cotizaciones/i);return{rows:sql.includes('FROM ordenes_servicio')?[{id:1,folio:'AFB-1',estado:'Recibido',fecha_creacion:'2026-10-14',fecha_entrega_estimada:'2026-10-15'}]:[{id:2,titulo:'Manual',fecha_inicio:'2026-10-14',fecha_fin:'2026-10-15'}]};}}};
  if(name==='./cajaService'||name==='./garantiaService')return{};
  throw new Error(name);
 }});
 const events=await module.exports.getCalendarEvents();assert.equal(events.length,2);assert.equal(events.some(event=>event.source==='quote'),false);
 for(const name of ['getAllCotizaciones','createCotizacion','updateCotizacion','deleteCotizacion','convertirCotizacionAOrden'])assert.equal(module.exports[name],undefined);
});
