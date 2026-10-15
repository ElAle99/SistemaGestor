const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pool}=require('../config/migrationDb');
async function run(){
 const directory=path.join(__dirname,'../db/backups');
 const name=fs.readdirSync(directory).filter(file=>/^full-before-rls-\d+\.json$/.test(file)).sort()[0];
 if(!name)throw new Error('Falta el respaldo inicial completo.');
 const backup=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
 const counts={};
 for(const [table,original] of Object.entries(backup.tables)){
  if(!/^[a-z_]+$/.test(table))throw new Error('Nombre de tabla no valido.');
  const actual=(await pool.query('SELECT * FROM public."'+table+'"')).rows;
  const serialize=row=>JSON.stringify(Object.fromEntries(Object.keys(original[0]||{}).map(key=>[key,row[key]])));
  const expected=original.map(serialize).sort();const current=actual.map(serialize).sort();
  if(table==='tenant_migraciones'){for(const value of expected)assert.ok(current.includes(value),'Cambio de migracion historica');}
  else if(JSON.stringify(current)!==JSON.stringify(expected))throw new Error('Se alteraron datos historicos: '+table);
  counts[table]=actual.length;
 }
 console.log(JSON.stringify({backup:name,allOriginalValuesPreserved:true,counts},null,2));
}
run().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
