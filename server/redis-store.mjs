import {createClient} from 'redis';
import {randomUUID} from 'node:crypto';
const JOIN=`
local assigned=redis.call('GET',KEYS[3]);if assigned then return assigned end
local record=cjson.decode(ARGV[2]);local old=redis.call('HGET',KEYS[2],ARGV[1]);
if old then local prior=cjson.decode(old);record.joinedAt=prior.joinedAt end
if not old and redis.call('ZCARD',KEYS[1])>=500 then return redis.error_reply('QUEUE_FULL') end
redis.call('HSET',KEYS[2],ARGV[1],cjson.encode(record));redis.call('ZADD',KEYS[1],record.joinedAt,ARGV[1]);
return 'waiting'`;
const LEASE=`if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) end return 0`;
const RELEASE=`if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;
export function connectRedis(config){const client=createClient({url:config.redisUrl,disableOfflineQueue:true,socket:{connectTimeout:3000,reconnectStrategy:retries=>Math.min(250*(retries+1),2000)}});client.on('error',()=>{});return client}
export class RedisStore{
 constructor(client,prefix){this.client=client;this.prefix=prefix;this.instance=randomUUID();this.consumer=randomUUID();this.chain=Promise.resolve()}
 key(s){return this.prefix+s}
 serialized(work){const job=this.chain.then(work);this.chain=job.catch(()=>{});return job}
 async initialize(){if(!await this.client.set(this.key('owner'),this.instance,{NX:true,PX:10000}))throw Error('Another Speedway process owns this Redis namespace. Use one PM2 instance.');this.leaseUntil=Date.now()+9000;try{await this.client.xGroupCreate(this.key('results'), 'mariadb','0',{MKSTREAM:true})}catch(e){if(!e.message.includes('BUSYGROUP'))throw e}}
 async renew(){const ok=await this.client.eval(LEASE,{keys:[this.key('owner')],arguments:[this.instance,'10000']});if(!ok)throw Error('Server lease lost');this.leaseUntil=Date.now()+9000}
 async close(){if(!this.client.isReady){this.client.destroy();return}try{await this.client.eval(RELEASE,{keys:[this.key('owner')],arguments:[this.instance]})}finally{await this.client.close()}}
 async bindTicket(hash,owner){const k=this.key('session:'+hash);await this.client.set(k,owner,{NX:true,EX:86400});if(await this.client.get(k)!==owner)throw Object.assign(Error('Nieprawidłowy bilet do gry.'),{status:403});await this.client.expire(k,86400)}
 async assignment(hash){const value=await this.client.get(this.key('assigned:'+hash));return value?JSON.parse(value):null}
 async join(member,now){return this.serialized(async()=>{const record={...member,joinedAt:now,seen:now};const value=await this.client.eval(JOIN,{keys:[this.key('waiting'),this.key('waiting-meta'),this.key('assigned:'+member.hash)],arguments:[member.hash,JSON.stringify(record)]});return value==='waiting'?null:JSON.parse(value)})}
 async cancel(hash){return this.serialized(async()=>{await this.client.multi().zRem(this.key('waiting'),hash).hDel(this.key('waiting-meta'),hash).exec()})}
 async heartbeat(hashes,now){return this.serialized(async()=>{if(!hashes.length)return;const records=await this.client.hmGet(this.key('waiting-meta'),hashes),tx=this.client.multi();records.forEach((raw,i)=>{if(raw){const r=JSON.parse(raw);r.seen=now;tx.hSet(this.key('waiting-meta'),hashes[i],JSON.stringify(r))}});await tx.exec()})}
 async status(){const cohort=await this.client.zRangeWithScores(this.key('waiting'),0,3);const records=cohort.length?await this.client.hmGet(this.key('waiting-meta'),cohort.map(p=>p.value)):[];return {state:'waiting',players:records.filter(Boolean).map(raw=>({name:JSON.parse(raw).name})),deadline:(cohort[0]?.score??Date.now())+20000}}
 async take(now,build){return this.serialized(async()=>{
  const hashes=await this.client.zRange(this.key('waiting'),0,-1),records=hashes.length?await this.client.hmGet(this.key('waiting-meta'),hashes):[],valid=[],tx=this.client.multi();
  hashes.forEach((hash,i)=>{const r=records[i]?JSON.parse(records[i]):null;if(!r||now-r.seen>12000)tx.zRem(this.key('waiting'),hash).hDel(this.key('waiting-meta'),hash);else valid.push(r)});await tx.exec();
  if(!valid.length||valid.length<4&&now-valid[0].joinedAt<20000)return null;
  const room=build(valid.slice(0,4)),commit=this.client.multi().set(this.key('room:'+room.id),JSON.stringify(room),{EX:900});
  for(const m of room.members)commit.zRem(this.key('waiting'),m.hash).hDel(this.key('waiting-meta'),m.hash).set(this.key('assigned:'+m.hash),JSON.stringify({matchId:room.id,gate:m.gate}),{EX:900});
  await commit.exec();return room;
 })}
 async room(id){const value=await this.client.get(this.key('room:'+id));return value?JSON.parse(value):null}
 async restore(){const rooms=[];for await(const keys of this.client.scanIterator({MATCH:this.key('room:*'),COUNT:100})){for(const key of Array.isArray(keys)?keys:[keys]){const value=await this.client.get(key);if(value)rooms.push(JSON.parse(value))}}return rooms}
 async checkpoint(rooms){if(!rooms.length)return;const tx=this.client.multi();for(const r of rooms)tx.set(this.key('room:'+r.id),JSON.stringify(r),{EX:900});await tx.exec()}
 async enqueue(result){await this.client.xAdd(this.key('results'),'*',{payload:JSON.stringify(result)})}
 async pendingResults(){const reclaimed=await this.client.xAutoClaim(this.key('results'),'mariadb',this.consumer,1000,'0-0',{COUNT:10});if(reclaimed.messages.length)return reclaimed.messages;let groups=await this.client.xReadGroup('mariadb',this.consumer,{key:this.key('results'),id:'0'},{COUNT:10});if(groups?.[0]?.messages.length)return groups[0].messages;groups=await this.client.xReadGroup('mariadb',this.consumer,{key:this.key('results'),id:'>'},{COUNT:10});return groups?.[0]?.messages??[]}
 async acknowledge(id){await this.client.multi().xAck(this.key('results'),'mariadb',id).xDel(this.key('results'),id).exec()}
}
