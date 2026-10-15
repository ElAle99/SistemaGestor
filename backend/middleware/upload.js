const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|gif|pdf|doc|docx/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido'));
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
});

function registered(middleware) {
  return (req,res,next)=>middleware(req,res,async error=>{
    if(error)return next(error);
    const files=req.file?[req.file]:(req.files||[]);
    try {
      if(!req.user?.negocio_id)throw new Error('Tenant requerido para subir archivos.');
      for(const file of files)await pool.query('INSERT INTO archivos(negocio_id,url,filename,publico) VALUES($1,$2,$3,$4)',[req.user.negocio_id,'/uploads/'+file.filename,file.filename,req.baseUrl==='/api/configuracion'&&req.path==='/logo']);
      next();
    } catch(error) {
      for(const file of files) { const target=path.resolve(uploadDir,file.filename); if(path.dirname(target)===path.resolve(uploadDir)) fs.unlink(target,()=>{}); }
      next(error);
    }
  });
}
module.exports = {single:field=>registered(upload.single(field)),array:(field,max)=>registered(upload.array(field,max))};
