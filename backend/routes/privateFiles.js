const express=require('express');
const path=require('node:path');
const {pool}=require('../config/db');
const {authMiddleware}=require('../middleware/auth');
const {fileSessionToken}=require('../middleware/fileSession');
const root=path.resolve(__dirname,'../uploads');
const router=express.Router();
async function send(req,res,next,byId=false) {
  try {
    const filename=req.params.filename;
    if(byId && !/^[1-9][0-9]*$/.test(req.params.id||''))return res.status(404).end();
    if (!byId && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(filename||'')) return res.status(404).end();
    const url='/uploads/'+filename;
    // Only a registry-confirmed commercial logo can bypass authentication.
    if (!byId && (await pool.query('SELECT public_logo($1) AS allowed',[url])).rows[0]?.allowed) return deliver(filename,req,res);
    req.assetSessionToken=fileSessionToken(req);
    return authMiddleware(req,res,async()=>{
      try {
        const result=await pool.query('SELECT filename FROM archivos WHERE '+(byId?'id=$1':'url=$1')+' AND negocio_id=$2',[byId?req.params.id:url,req.user.negocio_id]);
        if(!result.rowCount)return res.status(404).end();
        return deliver(result.rows[0].filename,req,res);
      } catch { return res.status(500).json({error:'No se pudo obtener el archivo.'}); }
    });
  } catch { res.status(500).json({error:'No se pudo obtener el archivo.'}); }
}
function deliver(filename,req,res) {
  if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(filename))return res.status(404).end();
  res.set('Cache-Control','private, no-store'); res.set('X-Content-Type-Options','nosniff');
  return res.sendFile(filename,{root,dotfiles:'deny'},error=>{if(error&&!res.headersSent)res.status(error.status===404?404:500).end();});
}
router.get('/id/:id',(req,res,next)=>send(req,res,next,true));
router.get('/:filename',send);
router.use((req,res)=>res.status(404).end());
module.exports=router;
