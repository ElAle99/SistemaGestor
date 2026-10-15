const express=require('express');
const {pool}=require('../config/db');
const {rateLimit}=require('../middleware/rateLimit');
const router=express.Router();
const limit=rateLimit({windowMs:60000,max:60,keyPrefix:'setup-status'});
router.get('/status',limit,async(req,res)=>{
  try {const initialized=(await pool.query('SELECT setup_initialized() AS initialized')).rows[0].initialized;res.json({setupRequired:!initialized});}
  catch {res.status(503).json({error:'No se pudo verificar el estado de instalacion.'});}
});
router.get('/user-creation-status',limit,(req,res)=>res.json({setupRequired:false,userCreationAllowed:false,canCreateAdmin:false,canRegisterUser:false,roles:[]}));
// The first tenant/admin is provisioned administratively. Existing tenant admins
// create their own users through the authenticated /api/users endpoint.
for(const endpoint of ['/admin','/create-admin','/register-user'])router.post(endpoint,limit,(req,res)=>res.status(403).json({error:'La creacion publica de usuarios no esta habilitada.'}));
module.exports=router;
