const test=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {TARGET,verifyIdentity,checkedConnection,requireBigint,verifyTLS,cleanFixtures,checkpoint,diagnostic,technicianRoleForConstraint,expectPermission,expectPermissionQuery,expectPermissionRequest,permissionFailure}=require('../scripts/validate-android-staging.cjs');
const branch={id:TARGET.branch,name:TARGET.name,project_id:TARGET.project,default:false,protected:false};
const endpoint={id:TARGET.endpoint,branch_id:TARGET.branch,project_id:TARGET.project,host:TARGET.host,type:'read_write',disabled:false};
test('staging identity is pinned: rejects production, another project, pooler and disabled endpoints',()=>{
 assert.doesNotThrow(()=>verifyIdentity(branch,endpoint));
 for(const change of [{id:'production'},{name:'production'},{project_id:'another-project'},{default:true},{protected:true}])
  assert.throws(()=>verifyIdentity({...branch,...change},endpoint));
 for(const change of [{id:'another-endpoint'},{branch_id:'production'},{host:TARGET.host.replace('.','-pooler.')},{disabled:true},{type:'read_only'}])
  assert.throws(()=>verifyIdentity(branch,{...endpoint,...change}));
});
test('staging connection guard rejects wrong database, host, port and unverified TLS before connecting',()=>{
 const good=`postgresql://fixture:fixture@${TARGET.host}/allfix_db?sslmode=verify-full`;
 assert.equal(checkedConnection(good,'test').hostname,TARGET.host);
 for(const bad of [good.replace('allfix_db','other_db'),good.replace(TARGET.host,'production.neon.tech'),good.replace('.c-8','-pooler.c-8'),good.replace('/allfix_db',':5433/allfix_db'),good.replace('verify-full','disable'),good+'&sslrootcert=fixture',good+'#fragment'])
  assert.throws(()=>checkedConnection(bad,'test'));
});
test('bigint preflight requires v2 and all three bigint columns',()=>{
 const good={version:'20261108_android_offline_bigint_v2',bigintReady:true,tenantTypes:['ordenes_servicio','android_sync_receipts','android_refresh_sessions'].map(table_name=>({table_name,tenant_type:'bigint'}))};
 assert.doesNotThrow(()=>requireBigint(good));
 assert.throws(()=>requireBigint({...good,version:'v1'}));
 assert.throws(()=>requireBigint({...good,bigintReady:false}));
 assert.throws(()=>requireBigint({...good,tenantTypes:good.tenantTypes.slice(1)}));
 assert.throws(()=>requireBigint({...good,tenantTypes:good.tenantTypes.map(t=>({...t,tenant_type:'integer'}))}));
});
test('TLS verification rejects unauthorized streams before SQL and always releases connection',async()=>{
 let queries=0,released=0;
 const client={connection:{stream:{encrypted:true,authorized:false,servername:TARGET.host}},query:async()=>{queries++;return {rows:[{db:TARGET.database}]};},release(){released++;}};
 await assert.rejects(()=>verifyTLS({connect:async()=>client},TARGET.host,'test-tls'));
 assert.equal(queries,0);assert.equal(released,1);
 client.connection.stream.authorized=true;client.connection.stream.servername='wrong-host';
 await assert.rejects(()=>verifyTLS({connect:async()=>client},TARGET.host,'test-tls'));
 assert.equal(queries,0);assert.equal(released,2);
});
test('safe diagnostics never print raw errors, URLs or tokens',()=>{
 const secret='postgresql://fixture:NEVER_PRINT_THIS@private.invalid/db';
 checkpoint('test','Causa segura fija.');
 assert.equal(diagnostic(new Error(secret)),'Causa segura fija.');
 for(const code of ['28P01','42501','ERR_TLS_CERT_ALTNAME_INVALID','UNKNOWN'])
  assert.ok(!diagnostic({code,message:secret,stack:secret}).includes('NEVER_PRINT_THIS'));
});
const marker='offline-test-0123456789abcdef';
const owned=[{id:'3000000001',name:marker+'A'},{id:'3000000002',name:marker+'B'}];
test('reproduces staging CHECK 23514, then uses the existing legacy role without changing its constraint',async()=>{
 const db=new PGlite();
 try{
  const legacy='T\u00c3\u00a9cnico';
  await db.exec(`CREATE TABLE usuarios(id int primary key,negocio_id bigint,rol text NOT NULL CONSTRAINT usuarios_rol_check CHECK(rol IN ('Administrador','${legacy}','Recepcionista'))); INSERT INTO usuarios VALUES(1,3000000001,'Administrador');`);
  const before=(await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='usuarios_rol_check'")).rows[0].definition;
  await assert.rejects(()=>db.query('UPDATE usuarios SET rol=$1 WHERE id=$2 AND negocio_id=$3',['T\u00e9cnico',1,'3000000001']),e=>e.code==='23514');
  const chosen=technicianRoleForConstraint(before);assert.equal(chosen,legacy);
  await expectPermissionQuery('permisos.asignar-tecnico',async()=>{
   const r=await db.query('UPDATE usuarios SET rol=$1 WHERE id=$2 AND negocio_id=$3',[chosen,1,'3000000001']);
   return {rowCount:r.affectedRows};
  });
  assert.equal((await db.query('SELECT rol FROM usuarios')).rows[0].rol,legacy);
  assert.equal((await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='usuarios_rol_check'")).rows[0].definition,before);
  const {assertOperation}=require('../services/androidSyncProtocol');
  for(const kind of ['create','delete'])assert.throws(()=>assertOperation({operationId:'11111111-1111-4111-8111-111111111111',kind},{rol:chosen}),e=>e.statusCode===403);
 }finally{await db.close();}
});
test('role compatibility prefers canonical UTF-8 and rejects unknown technician representations',()=>{
 assert.equal(technicianRoleForConstraint("CHECK(rol IN ('Administrador','T\u00e9cnico','Recepcionista'))"),'T\u00e9cnico');
 assert.equal(technicianRoleForConstraint("CHECK(rol IN ('T\u00c3\u00a9cnico','T\u00e9cnico'))"),'T\u00e9cnico');
 assert.throws(()=>technicianRoleForConstraint("CHECK(rol IN ('Administrador','Recepcionista'))"));
});
test('permission diagnostics expose check name and numeric expected/obtained values only',async()=>{
 expectPermission('permisos.tecnico-no-crea',403);
 assert.throws(()=>expectPermission('permisos.tecnico-no-crea',401),e=>permissionFailure(e)==='FAIL comprobacion: permisos.tecnico-no-crea | esperado: HTTP 403 | obtenido: 401');
 const sensitive='NEVER_PRINT_TOKEN_OR_CUSTOMER';
 await assert.rejects(()=>expectPermissionQuery('permisos.asignar-tecnico',async()=>{throw {code:'23514',message:sensitive,detail:sensitive};}),e=>permissionFailure(e)==='FAIL comprobacion: permisos.asignar-tecnico | esperado: filas 1 | obtenido: SQLSTATE 23514 (restriccion CHECK)');
 await assert.rejects(()=>expectPermissionQuery('permisos.restaurar-admin',async()=>({rowCount:0})),e=>permissionFailure(e).includes('esperado: filas 1 | obtenido: 0'));
 await assert.rejects(()=>expectPermissionRequest('permisos.anonimo',async()=>{throw new Error(sensitive);}),e=>permissionFailure(e).endsWith('sin respuesta HTTP verificable')&&!permissionFailure(e).includes(sensitive));
 assert.throws(()=>expectPermission('permisos.anonimo',sensitive),e=>!permissionFailure(e).includes(sensitive));
 assert.equal(permissionFailure(new Error(sensitive)),null);
});
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE negocios(id bigint primary key,nombre text);
  CREATE TABLE clientes(id int primary key,negocio_id bigint references negocios(id));
  CREATE TABLE android_sync_receipts(negocio_id bigint,operation_id text);
  INSERT INTO negocios VALUES(1,'preexisting fixture'),(3000000001,'${marker}A'),(3000000002,'${marker}B');
  INSERT INTO clientes VALUES(1,1),(2,3000000001),(3,3000000002);
  INSERT INTO android_sync_receipts VALUES(1,'existing'),(3000000001,'test-a'),(3000000002,'test-b');`);
 return {db,connection:{query:async(sql,params)=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length};}}};
}
test('cleanup removes only owned bigint tenants, preserves unrelated fixtures, and can be repeated',async()=>{
 const {db,connection}=await fixture();
 try{
  await cleanFixtures(connection,owned,marker,['android_sync_receipts','clientes']);
  await cleanFixtures(connection,owned,marker,['android_sync_receipts','clientes']);
  assert.deepEqual((await db.query('SELECT nombre FROM negocios')).rows,[{nombre:'preexisting fixture'}]);
  assert.equal((await db.query('SELECT * FROM clientes')).rows.length,1);
  assert.deepEqual((await db.query('SELECT operation_id FROM android_sync_receipts')).rows,[{operation_id:'existing'}]);
 }finally{await db.close();}
});
test('cleanup rejects marker or owner mismatch without deleting rows',async()=>{
 const {db,connection}=await fixture();
 try{
  await assert.rejects(()=>cleanFixtures(connection,owned,'invalid-marker',['clientes']));
  await db.query('UPDATE negocios SET nombre=$1 WHERE id=$2',['different owner',owned[0].id]);
  await assert.rejects(()=>cleanFixtures(connection,owned,marker,['android_sync_receipts','clientes']));
  assert.equal((await db.query('SELECT * FROM negocios')).rows.length,3);
  assert.equal((await db.query('SELECT * FROM android_sync_receipts')).rows.length,3);
 }finally{await db.close();}
});
test('cleanup rolls back partial deletes on a dependency failure and does not broaden its table list',async()=>{
 const {db,connection}=await fixture();
 try{
  await assert.rejects(()=>cleanFixtures(connection,owned,marker,['android_sync_receipts']),e=>e.code==='23503');
  assert.equal((await db.query('SELECT * FROM android_sync_receipts')).rows.length,3);
  await assert.rejects(()=>cleanFixtures(connection,owned,marker,['clientes; DELETE FROM negocios']));
  assert.equal((await db.query('SELECT * FROM negocios')).rows.length,3);
 }finally{await db.close();}
});
