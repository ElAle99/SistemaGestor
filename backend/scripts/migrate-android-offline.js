// Manual CLI only. The HTTP server never imports or runs migrations.
const {inspect,migrate}=require('../db/androidMigration');
async function main(){
 const args=process.argv.slice(2),apply=args.includes('--apply');
 if(args.some(a=>!['--check','--apply'].includes(a)) || args.includes('--check')&&apply)throw Error('Usa --check (solo lectura) o --apply.');
 // Load migration credentials only after the explicit mode was validated.
 const {pool}=require('../config/migrationDb');
 try{
  const db=await pool.connect();
  try{
   const result=apply?await migrate(db,process.env.ANDROID_RUNTIME_ROLE):await inspect(db,process.env.ANDROID_RUNTIME_ROLE);
   console.log(JSON.stringify({...result,applied:apply}));
  }finally{db.release();}
 }finally{await pool.end();}
}
main().catch(()=>{console.error('Preflight/migración Android falló. Revisa requisitos, rol y permisos; no se muestran credenciales.');process.exitCode=1;});
