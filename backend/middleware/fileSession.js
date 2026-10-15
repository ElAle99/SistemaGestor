const name = 'sg_file_session';
function fileSessionToken(req) {
  const cookie = req.headers?.cookie || '';
  const match = cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith(name+'='));
  if (!match) return null;
  try { return decodeURIComponent(match.slice(name.length+1)); } catch { return null; }
}
function setFileSession(req,res,token,expires) {
  res.cookie?.(name,token,{httpOnly:true,sameSite:'strict',secure:req.secure || process.env.NODE_ENV==='production',path:'/',maxAge:Math.max(0,Math.min(8*3600000,expires*1000-Date.now()))});
}
module.exports={fileSessionToken,setFileSession};
