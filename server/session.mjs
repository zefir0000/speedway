import {randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
const name='speedway_sid';
export function sessions(config){
 const sign=id=>createHmac('sha256',config.sessionSecret).update(id).digest('base64url');
 function read(header=''){const value=header.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);if(!value)return null;const [id,signature]=value.split('.');if(!/^[a-f0-9-]{36}$/.test(id||'')||!signature)return null;const a=Buffer.from(signature),b=Buffer.from(sign(id));return a.length===b.length&&timingSafeEqual(a,b)?id:null}
 function get(req,res){let id=read(req.headers.cookie);if(!id){id=randomUUID();res.setHeader('Set-Cookie',`${name}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${config.publicOrigin.startsWith('https:')?'; Secure':''}`)}return id}
 return {read,get};
}
