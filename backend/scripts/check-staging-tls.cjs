// PostgreSQL SSLRequest + verified TLS handshake. No authentication or SQL is sent.
// This host was resolved from Neon metadata for allfix-staging-offline only.
'use strict';
const net=require('node:net'),tls=require('node:tls');
const host='ep-blue-lab-bdnti3ov.c-8.us-east-2.aws.neon.tech';
const socket=net.connect({host,port:5432});
const fail=()=>{console.error('FAIL TLS directo staging: conexion o certificado no verificable; no se enviaron credenciales ni SQL.');socket.destroy();process.exitCode=1;};
socket.setTimeout(15000,fail);socket.once('error',fail);
socket.once('connect',()=>{const request=Buffer.alloc(8);request.writeInt32BE(8,0);request.writeInt32BE(80877103,4);socket.write(request);});
socket.once('data',data=>{
 if(data.length!==1||data[0]!==83)return fail();
 const secure=tls.connect({socket,servername:host,rejectUnauthorized:true,minVersion:'TLSv1.2'});
 secure.setTimeout(15000,()=>{secure.destroy();fail();});secure.once('error',()=>{secure.destroy();fail();});
 secure.once('secureConnect',()=>{
  if(!secure.authorized){secure.destroy();return fail();}
  console.log('PASS TLS directo staging: certificado y hostname verificados; '+secure.getProtocol()+'. Sin autenticacion ni SQL.');
  secure.end();
 });
});
