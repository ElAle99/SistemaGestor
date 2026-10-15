const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { initTenancy } = require('../db/initTenancy');
const { createTenantPool, withTenant, withSystemContext } = require('../config/tenantContext');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function testPool(db) {
  let tail = Promise.resolve();
  const native = {
    async connect() {
      const previous = tail; let release;
      tail = new Promise(resolve => { release = resolve; }); await previous;
      await db.exec('SET ROLE sistema_gestor_app');
      return { query: (sql, params) => params ? db.query(sql, params) : db.exec(sql).then(results => results.at(-1)), release:()=>db.exec('RESET ROLE').then(release) };
    },
    async query(sql, params) { const c=await native.connect(); try { return await c.query(sql,params); } finally { c.release(); } },
    end: () => db.close()
  };
  const api=createTenantPool(native);api.administrative={query:(sql,params)=>params?db.query(sql,params):db.exec(sql).then(r=>r.at(-1)),connect:async()=>({query:(sql,params)=>params?db.query(sql,params):db.exec(sql).then(r=>r.at(-1)),release(){}})};return api;
}
function load(file, dependencies) {
  const module={exports:{}};
  vm.runInNewContext(read(file),{module,console,__dirname:path.join(__dirname,'../routes'),process:{env:{JWT_SECRET:'test'}}, require:name=>Object.hasOwn(dependencies,name)?dependencies[name]:name==='./fileSession'?require('../middleware/fileSession'):require(name)});
  return module.exports;
}
test('migration preserves Allfix configuration and history; HTTP, RLS, relationships and tickets isolate two tenants',async()=>{
  const db=new PGlite(),pool=testPool(db); let server;
  try {
    const source=read('config/db.js');
    await db.exec(source.match(/const createTables = `([\s\S]*?)`;/)[1]);
    const alterations=source.match(/(?:const \w+ =|await pool.query\()\s*`(\s*ALTER TABLE[\s\S]*?)`/);
    await db.exec(alterations[1]);
    await db.exec('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0');
    await db.exec(read('db/migrations/20260718_garantias.sql'));
    await db.exec(read('db/migrations/20260926_catalogos.sql'));
    await db.exec(`INSERT INTO configuracion(id,nombre,telefono,whatsapp,direccion,terminos_legales,logo_url,logo_ticket_url) VALUES(1,'Allfix legado','555111','555111','Direccion A','Terminos A','/uploads/a.png','/uploads/a-ticket.png');
      INSERT INTO usuarios(id,username,password,rol,nombre,session_version) VALUES(1,'admin_a','test','Administrador','Admin A',1);
      INSERT INTO clientes(id,nombre) VALUES(1,'Cliente A');
      INSERT INTO ordenes_servicio(id,folio,cliente_id,usuario_creador_id) VALUES(1,'AFB-2026-10046',1,1);
      INSERT INTO ventas(id,usuario_id,metodo_pago,total) VALUES(1,1,'Efectivo',50);
      INSERT INTO configuracion_sistema(clave,valor) VALUES('allow_user_creation','false');
      INSERT INTO tipos_equipo(negocio_id,nombre,clave) VALUES(1,'Especial A','especial-a');`);
    const before=(await db.query('SELECT to_jsonb(c) AS config FROM configuracion c WHERE id=1')).rows[0].config;
    await initTenancy(pool.administrative); await initTenancy(pool.administrative);
    const after=(await db.query('SELECT to_jsonb(c) AS config FROM configuracion c WHERE id=1')).rows[0].config;
    assert.equal(Number(after.negocio_id),1); delete after.negocio_id; assert.deepEqual(after,before);
    await db.exec(read('db/migrations/20261014_rls_hardening.sql'));
    await db.exec(read('db/migrations/20261014_file_references.sql'));
    await db.exec(read('db/migrations/20261014_financial_references.sql'));
    await db.exec(`INSERT INTO negocios(id,nombre) VALUES(2,'Negocio B');
      INSERT INTO usuarios(id,negocio_id,username,password,rol,nombre,session_version) VALUES(2,2,'admin_b','test','Administrador','Admin B',1);
      INSERT INTO clientes(id,negocio_id,nombre) VALUES(2,2,'Cliente B');
      INSERT INTO ordenes_servicio(id,negocio_id,folio,cliente_id,usuario_creador_id) VALUES(2,2,'AFB-2026-10047',2,2);
      INSERT INTO ventas(id,negocio_id,usuario_id,metodo_pago,total) VALUES(2,2,2,'Efectivo',70);
      INSERT INTO archivos(url,filename,negocio_id,publico) VALUES('/uploads/b.png','b.png',2,true);
      INSERT INTO negocio_logos(url,negocio_id) VALUES('/uploads/b.png',2);`);
    const initial=(await db.query('SELECT * FROM configuracion WHERE negocio_id=2')).rows[0];
    assert.equal(initial.nombre,'Negocio B');
    for(const key of ['telefono','whatsapp','direccion','terminos_legales','logo_url','logo_ticket_url'])assert.equal(initial[key],'');
    const auth=load('middleware/auth.js',{'../config/db':{pool},'../config/env':{},'../config/tenantContext':require('../config/tenantContext'),jsonwebtoken:{verify:token=>({id:Number(token),sessionVersion:1,negocio_id:999})}});
    const router=load('routes/config.js',{express,'../config/db':{pool},'../middleware/auth':auth,'../middleware/upload':{single:()=> (req,res,next)=>next()},'../services/ticketPrinterService':{},'../services/userService':{}});
    const ordersService=load('services/ordenService.js',{'../config/db':{pool},'./cajaService':{},'./garantiaService':{getGarantiaByOrderId:async()=>null}});
    const ordersRouter=load('routes/ordenes.js',{express,'../middleware/auth':auth,'../services/ordenService':ordersService,'../middleware/rateLimit':{rateLimit:()=> (req,res,next)=>next()},'../services/quickOrderService':{},'../services/catalogService':{scopeForUser:user=>Number(user.negocio_id)},'../config/tenantContext':require('../config/tenantContext')});
    const posRouter=load('routes/pos.js',{express,'../middleware/auth':auth,'../services/ordenService':ordersService});
    const app=express();app.use(express.json());app.use('/api/configuracion',router);app.use('/api/ordenes',ordersRouter);app.use('/api/pos',posRouter);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url=`http://127.0.0.1:${server.address().port}/api/configuracion/negocio`;
    const request=(actor,method='GET',body)=>fetch(url+'?negocio_id='+(actor===1?2:1),{method,headers:{Authorization:'Bearer '+actor,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    for(const actor of [1,2]){
      const own=await(await request(actor)).json();assert.equal(Number(own.negocio_id),actor);
      const other=actor===1?2:1;const untouched=(await db.query('SELECT nombre FROM configuracion WHERE negocio_id=$1',[other])).rows[0].nombre;
      const result=await request(actor,'PUT',{nombre:'Propio '+actor,telefono:'555'+actor,terminos_legales:'Legal '+actor,negocio_id:other});assert.equal(result.status,200);
      assert.equal((await db.query('SELECT nombre FROM configuracion WHERE negocio_id=$1',[other])).rows[0].nombre,untouched);
      assert.equal((await request(actor,'PUT',{nombre:'Intruso',logo_url:actor===1?'/uploads/b.png':'/uploads/a.png'})).status,403);
      const origin=url.split('/api/')[0],headers={Authorization:'Bearer '+actor};
      assert.equal((await fetch(origin+'/api/ordenes/'+other,{headers})).status,404);
      const order=await(await fetch(origin+'/api/ordenes/'+actor,{headers})).json();assert.equal(Number(order.negocio_id),actor);
      const sales=await(await fetch(origin+'/api/pos/ventas?negocio_id='+other,{headers})).json();assert.equal(sales.length,1);assert.equal(Number(sales[0].negocio_id),actor);
    }
    await Promise.all(Array.from({length:20},(_,index)=>{
      const actor=index%2+1;
      return withTenant(actor,async()=>{
        await Promise.resolve();
        const row=(await pool.query('SELECT negocio_id,nombre FROM configuracion')).rows;
        assert.equal(row.length,1);assert.equal(Number(row[0].negocio_id),actor);
      });
    }));
    const {authorizeTicketData}=await import('../../frontend/printing/authorizedData.mjs');
    const {TicketBuilder}=await import('../../frontend/printing/TicketBuilder.mjs');
    const {buildShareTicket}=await import('../../frontend/sharing/ShareTicketBuilder.mjs');
    for(const actor of [1,2])await withTenant(actor,async()=>{
      const config=(await pool.query('SELECT * FROM configuracion')).rows;assert.equal(config.length,1);assert.equal(Number(config[0].negocio_id),actor);
      const orders=(await pool.query('SELECT * FROM ordenes_servicio')).rows,sales=(await pool.query('SELECT * FROM ventas')).rows;
      assert.equal(orders.length,1);assert.equal(sales.length,1);assert.equal(Number(orders[0].negocio_id),actor);
      assert.equal(orders[0].folio,actor===1?'AFB-2026-10046':'AFB-2026-10047');
      assert.equal((await pool.query('UPDATE configuracion SET telefono=$1 WHERE negocio_id=$2 RETURNING id',['INTRUSO',actor===1?2:1])).rows.length,0);
      for(const[type,raw]of[['service',orders[0]],['sale',sales[0]],['equipmentLabel',orders[0]]]){
        assert.equal(new TicketBuilder().build({type,data:authorizeTicketData(type,raw,config[0])}).lines[0].text,'Propio '+actor);
        if(type!=='equipmentLabel')assert.equal(buildShareTicket(type,raw,config[0]).blocks[0].text,'Propio '+actor);
      }
      await assert.rejects(pool.query("INSERT INTO ordenes_servicio(folio,cliente_id,usuario_creador_id) VALUES('FOREIGN-'||$1,$2,$1)",[actor,actor===1?2:1]));
      assert.match((await pool.query('SELECT allocate_order_folio(2026) AS folio')).rows[0].folio,/AFB-2026-1004[89]/);
    });
    assert.equal((await pool.query('SELECT * FROM configuracion')).rows.length,0);
    assert.equal((await withSystemContext(()=>pool.query('SELECT count(*) AS count FROM ventas'))).rows[0].count,0);
    assert.equal((await pool.administrative.query('SELECT count(*) AS count FROM ventas')).rows[0].count,2);
    // Exercise the unchanged financial services against the real migrated schema/role.
    await db.exec("SELECT setval(pg_get_serial_sequence('clientes','id'),2); SELECT setval(pg_get_serial_sequence('ordenes_servicio','id'),2); SELECT setval(pg_get_serial_sequence('ventas','id'),2);");
    const cajaService=load('services/cajaService.js',{'../config/db':{pool}});
    const financialOrders=load('services/ordenService.js',{'../config/db':{pool},'./cajaService':cajaService,'./garantiaService':{getGarantiaByOrderId:async()=>null}});
    const quick=load('services/quickOrderService.js',{'../config/db':{pool},'./cajaService':cajaService});
    for(const actor of [1,2])await withTenant(actor,async()=>{
      const order=await quick.createQuickOrder({clientName:'Cliente nuevo '+actor,deviceType:'Celular',brand:'Marca',model:'Modelo',falla_reportada:'No carga',servicio_solicitado:'Reparar',costo_estimado:50,anticipo:0},actor,actor);
      assert.equal(Number(order.negocio_id),actor);
      await pool.query('INSERT INTO cajas(usuario_id,monto_inicial) VALUES($1,0)',[actor]);
      await assert.rejects(pool.query('INSERT INTO cajas(usuario_id,monto_inicial) VALUES($1,0)',[actor]),/cajas_unica/);
      const product=(await pool.query("INSERT INTO inventario(codigo,nombre,precio,costo,stock) VALUES('SKU-COMUN','Producto propio',50,10,5) RETURNING id")).rows[0].id;
      await assert.rejects(pool.query("INSERT INTO inventario(codigo,nombre,precio,costo,stock) VALUES('SKU-COMUN','Duplicado propio',50,10,5)"),/inventario_codigo/);
      const sale=await financialOrders.createVenta({usuario_id:actor,metodo_pago:'Efectivo',efectivo_recibido:50,monto_recibido:50,items:[{tipo:'producto',producto_id:product,cantidad:1,precio_unitario:50}]});
      assert.equal(Number(sale.negocio_id),actor);assert.equal(sale.total,50);
      assert.equal((await pool.query('SELECT stock FROM inventario WHERE id=$1',[product])).rows[0].stock,4);
    });
    await db.exec('ALTER ROLE sistema_gestor_tenant BYPASSRLS');
    await assert.rejects(initTenancy(pool.administrative),/privilegios inseguros/);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();}
});

test('ambiguous legacy ownership rolls the migration back without changing configuration', async () => {
  const db=new PGlite(), pool=testPool(db);
  try {
    await db.exec("CREATE TABLE configuracion(id INTEGER PRIMARY KEY,nombre TEXT); INSERT INTO configuracion VALUES(1,'Legado'); CREATE TABLE tipos_equipo(negocio_id BIGINT); INSERT INTO tipos_equipo VALUES(1),(2); CREATE TABLE marcas(negocio_id BIGINT); CREATE TABLE fallas_catalogo(negocio_id BIGINT); CREATE TABLE reparaciones_catalogo(negocio_id BIGINT);");
    await assert.rejects(initTenancy(pool.administrative),/varios scopes/);
    assert.deepEqual((await db.query('SELECT * FROM configuracion')).rows,[{id:1,nombre:'Legado'}]);
    assert.equal((await db.query("SELECT to_regclass('public.negocios') AS table_name")).rows[0].table_name,null);
    assert.equal((await db.query("SELECT to_regclass('public.tenant_migraciones') AS table_name")).rows[0].table_name,null);
  } finally { await pool.end(); }
});
