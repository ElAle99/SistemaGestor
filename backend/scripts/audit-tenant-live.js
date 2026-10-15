// Explicit live audit: creates two disposable tenants, authenticates against Node,
// and removes fixtures in finally. Uses exactly the server's pool/context APIs.
require('../config/env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { pool: migrationPool } = require('../config/migrationDb');
const { Pool } = require('pg');
const { getPgPoolConfig } = require('../config/pgConfig');
const { createTenantPool } = require('../config/tenantContext');
const { withTenant, withSystemContext } = require('../config/tenantContext');
const origin = process.env.AUDIT_SERVER_URL || 'http://127.0.0.1:5000';
const marker = 'ra-' + crypto.randomBytes(6).toString('hex');
const fixtures = [], results = [];
const system = (sql, params) => migrationPool.query(sql, params);
const record = (name, passed, detail) => results.push({ name, passed, detail });
async function request(token, route, method = 'GET', body, extraHeaders = {}) {
  const response = await fetch(origin + route, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extraHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, cookie:response.headers.get('set-cookie')?.split(';')[0] };
}
async function main() {
  const before = (await system("SELECT md5(string_agg(to_jsonb(c)::text,'|' ORDER BY id)) digest FROM configuracion c")).rows[0].digest;
  const tables = (await system("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='negocio_id' AND NOT a.attisdropped) ORDER BY 1")).rows.map(r => r.relname);
  const uploadPath = path.resolve(__dirname, '../uploads', marker + '.png');
  try {
    for (const label of ['A', 'B']) {
      const negocio = (await system('INSERT INTO negocios(nombre) VALUES($1) RETURNING id', [marker + label])).rows[0].id;
      const fixture = { negocio }; fixtures.push(fixture);
      const password = crypto.randomBytes(24).toString('hex');
      const username = marker + label;
      fixture.user = (await system("INSERT INTO usuarios(negocio_id,username,password,rol,nombre) VALUES($1,$2,$3,'Administrador',$2) RETURNING id", [negocio, username, await bcrypt.hash(password, 10)])).rows[0].id;
      fixture.client = (await system('INSERT INTO clientes(negocio_id,nombre) VALUES($1,$2) RETURNING id', [negocio, marker + label])).rows[0].id;
      fixture.order = (await system('INSERT INTO ordenes_servicio(negocio_id,folio,cliente_id,usuario_creador_id) VALUES($1,$2,$3,$4) RETURNING id', [negocio, marker + label, fixture.client, fixture.user])).rows[0].id;
      fixture.sale = (await system('INSERT INTO ventas(negocio_id,usuario_id,total) VALUES($1,$2,0) RETURNING id', [negocio, fixture.user])).rows[0].id;
      fixture.product = (await system('INSERT INTO inventario(negocio_id,nombre) VALUES($1,$2) RETURNING id', [negocio, marker + label])).rows[0].id;
      fixture.register = (await system('INSERT INTO cajas(negocio_id,usuario_id,monto_inicial) VALUES($1,$2,0) RETURNING id',[negocio,fixture.user])).rows[0].id;
      await system("INSERT INTO caja_movimientos(negocio_id,caja_id,usuario_id,tipo_movimiento,monto,referencia_tipo,referencia_id) VALUES($1,$2,$3,'apertura',0,'caja',$2)",[negocio,fixture.register,fixture.user]);
      await system("INSERT INTO auditoria_ordenes(negocio_id,orden_id,usuario_id,accion) VALUES($1,$2,$3,'audit_fixture')",[negocio,fixture.order,fixture.user]);
      fixture.type = (await system('INSERT INTO tipos_equipo(negocio_id,nombre,clave) VALUES($1,$2::text,$2::text) RETURNING id', [negocio, marker + label])).rows[0].id;
      const login = await request(null, '/api/auth/login', 'POST', { username, password });
      assert.equal(login.status, 200, 'Actual Node login must succeed');
      assert.equal(Number(login.data.user.negocio_id), Number(negocio)); fixture.token = login.data.token;fixture.cookie=login.cookie;
    }
    const [a, b] = fixtures;
    for (const [actor, other] of [[a, b], [b, a]]) {
      record('Folio lookup rejects foreign tenant',(await request(actor.token,'/api/ordenes/folio/'+marker+(other===a?'A':'B'))).status===404);
      record('Folio lookup rejects anonymous',(await request(null,'/api/ordenes/folio/'+marker+(other===a?'A':'B'))).status===401);
      const headers = { 'x-negocio-id': String(other.negocio), negocio_id: String(other.negocio) };
      const config = await request(actor.token, '/api/configuracion/negocio?negocio_id=' + other.negocio, 'GET', null, headers);
      record('HTTP config query/header tenant ignored', config.status === 200 && Number(config.data.negocio_id) === Number(actor.negocio));
      const update = await request(actor.token, '/api/configuracion/negocio', 'PUT', { nombre: marker + '-own', negocio_id: other.negocio }, headers);
      record('HTTP config body cannot update other tenant', update.status === 200 && (await system('SELECT nombre FROM configuracion WHERE negocio_id=$1', [other.negocio])).rows[0].nombre !== marker + '-own');
      // Restore the disposable config for the reciprocal check.
      await system('UPDATE configuracion SET nombre=$1 WHERE negocio_id=$2', [marker + (actor === a ? 'A' : 'B'), actor.negocio]);
      const claims = jwt.verify(actor.token, process.env.JWT_SECRET);
      const forgedTenant = jwt.sign({ id: actor.user, sessionVersion: claims.sessionVersion, negocio_id: other.negocio, rol: 'Administrador' }, process.env.JWT_SECRET, { expiresIn: '1m' });
      const claimRead = await request(forgedTenant, '/api/configuracion/negocio');
      record('HTTP signed JWT tenant claim ignored', Number(claimRead.data.negocio_id) === Number(actor.negocio));
      for (const [route, id] of [['clientes', other.client], ['ordenes', other.order], ['inventario', other.product]]) {
        const read = await request(actor.token, '/api/' + route + '/' + id);
        record('HTTP foreign ' + route + ' read', read.status === 404, read.status);
      }
      const users = await request(actor.token, '/api/users');
      record('HTTP users scoped', users.status === 200 && !users.data.some(user => user.id === other.user));
      const sales = await request(actor.token, '/api/pos/ventas?negocio_id=' + other.negocio);
      record('HTTP sales scoped', sales.status === 200 && sales.data.length === 1 && Number(sales.data[0].negocio_id) === Number(actor.negocio));
      const cash=await request(actor.token,'/api/caja/activa?negocio_id='+other.negocio);
      record('HTTP active register scoped',cash.status===200&&Number(cash.data.caja?.id)===Number(actor.register));
      record('HTTP foreign register detail rejected',(await request(actor.token,'/api/caja/'+other.register)).status===404);
      const clientUpdate=await request(actor.token, '/api/clientes/' + other.client, 'PUT', { nombre: marker + '-intrusion', negocio_id: other.negocio });
      record('HTTP foreign client update rejected',clientUpdate.status===404,clientUpdate.status);
      record('HTTP foreign client update unchanged', (await system('SELECT nombre FROM clientes WHERE id=$1', [other.client])).rows[0].nombre === marker + (other === a ? 'A' : 'B'));
      const deletion = await request(actor.token, '/api/clientes/' + other.client, 'DELETE');
      record('HTTP foreign client delete', deletion.status === 404, deletion.status);
      const relation = await request(actor.token, '/api/calendario', 'POST', { titulo: marker, fecha_inicio: '2030-01-01', fecha_fin: '2030-01-02', orden_id: other.order, negocio_id: other.negocio });
      record('HTTP cross-tenant order relation blocked', relation.status >= 400, relation.status);
      await withTenant(actor.negocio, async () => {
        const db = await pool.connect();
        try {
          const role = (await db.query("SELECT current_user,session_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
          record('Effective application role', role.current_user==='sistema_gestor_app' && role.session_user==='sistema_gestor_app' && !role.rolsuper && !role.rolbypassrls, role);
          for (const table of tables) {
            await db.query('BEGIN');
            try {
              const read = await db.query('SELECT 1 FROM "' + table + '" WHERE negocio_id=$1', [other.negocio]);
              const update = await db.query('UPDATE "' + table + '" SET negocio_id=negocio_id WHERE negocio_id=$1', [other.negocio]);
              const deletion = await db.query('DELETE FROM "' + table + '" WHERE negocio_id=$1', [other.negocio]);
              record('SQL A/B ' + table, !read.rowCount && !update.rowCount && !deletion.rowCount);
            } catch (error) { record('SQL A/B ' + table + ' permission rejection', error.code === '42501', error.code); }
            finally { await db.query('ROLLBACK'); }
          }
          for (const [name, sql, params] of [
            ['order foreign client', 'INSERT INTO ordenes_servicio(folio,cliente_id,usuario_creador_id) VALUES($1,$2,$3)', [marker, other.client, actor.user]],
            ['catalog foreign parent', 'INSERT INTO marcas(nombre,clave,tipo_equipo_id,negocio_id) VALUES($1::text,$1::text,$2,$3)', [marker, other.type, actor.negocio]],
            ['audit foreign references', 'INSERT INTO auditoria_ordenes(orden_id,usuario_id,accion) VALUES($1,$2,$3)', [other.order, other.user, marker]]
            ,['cash foreign order','INSERT INTO caja_movimientos(caja_id,usuario_id,tipo_movimiento,monto,referencia_tipo,referencia_id) VALUES($1,$2,$3,0,\'orden\',$4)',[actor.register,actor.user,'apertura',other.order]]
            ,['cash foreign sale','INSERT INTO caja_movimientos(caja_id,usuario_id,tipo_movimiento,monto,referencia_tipo,referencia_id) VALUES($1,$2,$3,0,\'venta\',$4)',[actor.register,actor.user,'apertura',other.sale]]
            ,['cash foreign register','INSERT INTO caja_movimientos(caja_id,usuario_id,tipo_movimiento,monto,referencia_tipo,referencia_id) VALUES($1,$2,$3,0,\'caja\',$4)',[actor.register,actor.user,'apertura',other.register]]
          ]) {
            await db.query('BEGIN');
            try { await db.query(sql, params); await db.query('SET CONSTRAINTS ALL IMMEDIATE'); record('SQL rejects ' + name, false, 'accepted'); }
            catch (error) { record('SQL rejects ' + name, ['23503', '42501'].includes(error.code), error.code); }
            finally { await db.query('ROLLBACK'); }
          }
          await db.query('BEGIN');
          try {
            await db.query('RESET ROLE');
            const foreign = await db.query('SELECT id FROM clientes WHERE id=$1', [other.client]);
            record('SQL RESET ROLE cannot bypass', !foreign.rowCount, { afterReset: (await db.query('SELECT current_user')).rows[0].current_user, foreignRows: foreign.rowCount });
          } catch (error) { record('SQL RESET ROLE cannot bypass', error.code === '42501', error.code); }
          finally { await db.query('ROLLBACK'); }
          for(const sql of ['SET ROLE postgres','ALTER TABLE clientes DISABLE ROW LEVEL SECURITY','DROP POLICY tenant_scope ON clientes','ALTER TABLE clientes OWNER TO sistema_gestor_app','ALTER ROLE sistema_gestor_app SUPERUSER','GRANT postgres TO sistema_gestor_app']){
            await db.query('BEGIN');
            try {await db.query(sql);record('SQL rejects '+sql,false);}
            catch(error){record('SQL rejects '+sql,error.code==='42501',error.code);}
            finally{await db.query('ROLLBACK');}
          }
        } finally { db.release(); }
      });
    }
    fs.writeFileSync(uploadPath, Buffer.from('RLS audit disposable file'));
    await system('INSERT INTO archivos(negocio_id,url,filename) VALUES($1,$2,$3)',[b.negocio,'/uploads/'+path.basename(uploadPath),path.basename(uploadPath)]);
    await system('INSERT INTO evidencias_orden(negocio_id,orden_id,usuario_id,url_imagen,visible_cliente) VALUES($1,$2,$3,$4,false)', [b.negocio, b.order, b.user, '/uploads/' + path.basename(uploadPath)]);
    const privateFile = await fetch(origin + '/uploads/' + path.basename(uploadPath), { headers: { Authorization: 'Bearer ' + a.token }, signal: AbortSignal.timeout(15000) });
    record('HTTP foreign private evidence blocked', privateFile.status === 403 || privateFile.status === 404 || privateFile.status === 401, privateFile.status);
    const fileUrl='/uploads/'+path.basename(uploadPath);
    for(const route of [fileUrl,'/api/uploads'+fileUrl,'/api/uploads/'+path.basename(uploadPath)]){
      record('Historical file URL rejects A '+route,(await request(a.token,route)).status===404);
      record('Private file rejects anonymous '+route,(await request(null,route)).status===401);
      const own=await request(b.token,route);record('Private file allows owner '+route,own.status===200);
    }
    const fileId=(await system('SELECT id FROM archivos WHERE url=$1',[fileUrl])).rows[0].id;
    record('File download by ID rejects A',(await request(a.token,'/api/archivos/id/'+fileId)).status===404);
    record('File download by ID allows B',(await request(b.token,'/api/archivos/id/'+fileId)).status===200);
    record('Private image cookie allows owner',(await request(null,fileUrl,'GET',null,{Cookie:b.cookie})).status===200);
    record('Private image cookie rejects foreign tenant',(await request(null,fileUrl,'GET',null,{Cookie:a.cookie})).status===404);
    await system('UPDATE usuarios SET session_version=session_version+1 WHERE id=$1',[b.user]);
    record('Revoked file session rejected',(await request(null,fileUrl,'GET',null,{Cookie:b.cookie})).status===401);
    await system('UPDATE usuarios SET session_version=$1 WHERE id=$2',[jwt.verify(b.token,process.env.JWT_SECRET).sessionVersion,b.user]);
    await withTenant(a.negocio,async()=>{
      const db=await pool.connect();try{
        for(const [name,sql,params] of [
          ['foreign equipment image','UPDATE ordenes_servicio SET fotografias=$1 WHERE id=$2',[JSON.stringify([fileUrl]),a.order]],
          ['foreign inventory photo','UPDATE inventario SET foto_url=$1 WHERE id=$2',[fileUrl,a.product]],
          ['foreign inventory alternate photo','UPDATE inventario SET fotografia=$1 WHERE id=$2',[fileUrl,a.product]],
          ['foreign config logo','UPDATE configuracion SET logo_url=$1 WHERE negocio_id=$2',[fileUrl,a.negocio]],
          ['foreign private evidence','INSERT INTO evidencias_orden(orden_id,usuario_id,url_imagen) VALUES($1,$2,$3)',[a.order,a.user,fileUrl]]
        ]){
          await db.query('BEGIN');try{await db.query(sql,params);await db.query('SET CONSTRAINTS ALL IMMEDIATE');record('File FK rejects '+name,false);}
          catch(error){record('File FK rejects '+name,error.code==='23503',error.code);}finally{await db.query('ROLLBACK');}
        }
        record('Scoped auth capability rejects foreign user',(await db.query('SELECT auth_user_by_id($1) identity',[b.user])).rows[0].identity===null);
      }finally{db.release();}
    });
    for(const suffix of ['%2e%2e%2f.env','..%5c.env','bad%2fname.png','%2e%2e%2fserver.js'])record('Path traversal rejected '+suffix,(await request(a.token,'/uploads/'+suffix)).status===404);
    const logoName=marker+'-logo.png',logoPath=path.resolve(__dirname,'../uploads',logoName);
    try{
      fs.writeFileSync(logoPath,Buffer.from('public logo fixture'));
      await system('INSERT INTO archivos(negocio_id,url,filename,publico) VALUES($1,$2,$3,true)',[b.negocio,'/uploads/'+logoName,logoName]);
      await system('INSERT INTO negocio_logos(negocio_id,url) VALUES($1,$2)',[b.negocio,'/uploads/'+logoName]);
      record('Registered commercial logo is public',(await request(null,'/uploads/'+logoName)).status===200);
    }finally{if(fs.existsSync(logoPath))fs.unlinkSync(logoPath);}
    const native=new Pool({...getPgPoolConfig(),max:1}),reused=createTenantPool(native);let pid;
    try{
      for(const actor of [a,b,a,b])await withTenant(actor.negocio,async()=>{
        const rows=(await reused.query('SELECT negocio_id,pg_backend_pid() pid FROM clientes')).rows;
        record('Same socket tenant isolation',rows.length===1&&Number(rows[0].negocio_id)===Number(actor.negocio)&&(!pid||rows[0].pid===pid));pid=rows[0].pid;
      });
      const committed=await native.connect();try{record('SET LOCAL context cleared after commit',(await committed.query('SELECT app_tenant_id() tenant')).rows[0].tenant===null);}finally{committed.release();}
      await withTenant(a.negocio,async()=>{
        const connection=await reused.connect();try{await connection.query('BEGIN');await connection.query('SELECT 1/0');}catch(error){record('Forced rollback error observed',error.code==='22012');await connection.query('ROLLBACK');}finally{connection.release();}
      });
      const raw=await native.connect();try{record('SET LOCAL context cleared after rollback',(await raw.query('SELECT app_tenant_id() tenant')).rows[0].tenant===null);}finally{raw.release();}
      record('Reused socket without context reads zero',(await reused.query('SELECT id FROM clientes')).rowCount===0);
    }finally{await reused.end();}
    record('No tenant protected rows', (await pool.query('SELECT id FROM configuracion')).rowCount === 0);
    record('Public provisioning disabled',(await request(null,'/api/setup/register-user','POST',{negocio_id:a.negocio,rol:'Administrador'})).status===403);
    record('Setup status remains initialized',(await request(null,'/api/setup/status')).data.setupRequired===false);
  } finally {
    // Table names come exclusively from PostgreSQL metadata, not HTTP input.
    if (fixtures.length) await (async () => {
      const db = await migrationPool.connect();
      try {
        await db.query('BEGIN'); await db.query('SET CONSTRAINTS ALL DEFERRED');
        const ids = fixtures.map(f => f.negocio);
        for (const table of ['evidencias_orden','auditoria_ordenes','historial_estados','eventos_calendario','caja_movimientos','cajas','ventas_detalle','ventas','ordenes_servicio','clientes','inventario','marcas','tipos_equipo','usuarios','negocio_logos','archivos','orden_identidades','entidad_identidades','configuracion_sistema','configuracion']) await db.query('DELETE FROM "' + table + '" WHERE negocio_id=ANY($1::bigint[])', [ids]);
        await db.query('DELETE FROM negocios WHERE id=ANY($1::bigint[])', [ids]); await db.query('COMMIT');
      } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
    })();
    if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath); // Single known fixture inside uploads.
    const after = (await system("SELECT md5(string_agg(to_jsonb(c)::text,'|' ORDER BY id)) digest FROM configuracion c")).rows[0].digest;
    assert.equal(after, before, 'Existing configuration changed during audit');
    record('Fixtures removed; existing configuration unchanged', true);
  }
  console.log(JSON.stringify({ results, failures: results.filter(r => !r.passed) }, null, 2));
  if (results.some(r => !r.passed)) process.exitCode = 2;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => Promise.all([pool.end(),migrationPool.end()]));
