const fs=require('node:fs');
const path=require('node:path');
const VERSION='20261107_android_offline_v1';
const TABLES=['android_sync_receipts','android_refresh_sessions'];
const quote=name=>'"'+name.replace(/"/g,'""')+'"';
async function inspect(db,runtimeRole){
 if(typeof runtimeRole!=='string' || !/^[a-z_][a-z0-9_]{0,62}$/i.test(runtimeRole))throw Error('ANDROID_RUNTIME_ROLE inválido o ausente.');
 const role=(await db.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=$1',[runtimeRole])).rows[0];
 if(!role || role.rolsuper || role.rolbypassrls)throw Error('El rol runtime debe existir y no puede omitir RLS.');
 const prerequisites=(await db.query("SELECT to_regprocedure('public.app_tenant_id()') IS NOT NULL AS tenant, to_regprocedure('public.auth_user_by_id(integer)') IS NOT NULL AS auth, to_regclass('public.ordenes_servicio') IS NOT NULL AS orders, to_regprocedure('public.allocate_order_folio(integer)') IS NOT NULL AS folio")).rows[0];
 if(!prerequisites?.tenant || !prerequisites.auth || !prerequisites.orders || !prerequisites.folio)throw Error('Faltan capacidades multiempresa del backend actual; no ejecutar migraciones antiguas automáticamente.');
 for(const signature of ['public.app_tenant_id()','public.auth_user_by_id(integer)','public.allocate_order_folio(integer)']){
  const permission=(await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[runtimeRole,signature])).rows[0];
  if(!permission?.allowed)throw Error('El rol runtime no puede ejecutar las capacidades existentes requeridas.');
 }
 const owner=(await db.query('SELECT current_user AS name')).rows[0].name;
 if(owner===runtimeRole)throw Error('Usa credenciales de migración separadas del runtime.');
 return {version:VERSION,prerequisites:true,runtimeRole};
}
async function migrate(db,runtimeRole){
 await db.query('BEGIN');
 try{
  await db.query("SELECT pg_advisory_xact_lock(hashtext('allfix-android-schema-v1')::bigint)");
  const report=await inspect(db,runtimeRole);
  await db.query(fs.readFileSync(path.join(__dirname,'android-offline.sql'),'utf8'));
  // Identifiers are validated and quoted; no broad grants or changes to existing roles.
  await db.query('GRANT SELECT,INSERT ON public.android_sync_receipts TO '+quote(runtimeRole));
  await db.query('GRANT SELECT,INSERT,UPDATE ON public.android_refresh_sessions TO '+quote(runtimeRole));
  const policies=await db.query("SELECT tablename,policyname,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[])",[TABLES]);
  const exact=expression=>expression?.replace(/[()\s]/g,'')==='negocio_id=app_tenant_id';
  if(policies.rows.length!==2 || policies.rows.some(p=>!exact(p.qual) || !exact(p.with_check)))throw Error('Las políticas nuevas no coinciden con el aislamiento esperado.');
  await db.query('SELECT negocio_id,usuario_id,operation_id,request_hash,result,created_at FROM public.android_sync_receipts LIMIT 0');
  await db.query('SELECT negocio_id,usuario_id,token_hash,family,session_version,expires_at,consumed,revoked FROM public.android_refresh_sessions LIMIT 0');
  await db.query('COMMIT');return report;
 }catch(error){await db.query('ROLLBACK');throw error;}
}
module.exports={VERSION,TABLES,inspect,migrate};
