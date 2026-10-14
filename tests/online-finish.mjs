import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {openDatabase} from '../server/sqlite-d1.mjs';
const root=new URL('../',import.meta.url),read=file=>fs.readFileSync(new URL(file,root),'utf8');
let now=1000000;class Clock extends Date{static now(){return now}}
const DB=openDatabase(':memory:',new URL('drizzle',root).pathname);
const server={Date:Clock,crypto:{randomUUID:crypto.randomUUID,getRandomValues(a){a[0]=10;return a}},Uint32Array,Request,Response,URL,console};vm.createContext(server);
for(const file of ['web/tracks.js','web/online-race.js','worker/api.js','worker/online.js'])vm.runInContext(read(file).replace('export async function','async function'),server);
const online=vm.runInContext('handleOnline',server);
function element(){const classes=new Set(),children=new Map();return {children:[],dataset:{},style:{setProperty(){}},classList:{add(...xs){xs.forEach(x=>classes.add(x))},remove(...xs){xs.forEach(x=>classes.delete(x))},contains:x=>classes.has(x),toggle(x,value){if(value===undefined)value=!classes.has(x);value?classes.add(x):classes.delete(x);return value}},setAttribute(){},addEventListener(){},append(...xs){this.children.push(...xs)},replaceChildren(...xs){this.children=xs},querySelector:s=>children.get(s)||(children.set(s,element()),children.get(s)),getBoundingClientRect:()=>({width:844,height:390}),getContext:()=>new Proxy({},{get:()=>()=>{}})}}
const timers=new Map(),storage=new Map(),nodes={},controls=Array.from({length:4},element);let timerId=0,requests=0;
const setTimer=(f,ms)=>{const id=++timerId;timers.set(id,{f,at:now+ms});return id};
const context={Date:Clock,crypto:crypto.webcrypto,console,AbortController,document:{body:element(),getElementById:id=>nodes[id]||(nodes[id]=element()),querySelectorAll:s=>s==='[data-rider]'?controls:[],createElement:element,createElementNS:element,addEventListener(){}},window:{devicePixelRatio:2,addEventListener(){}},navigator:{},localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},ResizeObserver:class{observe(){}},requestAnimationFrame(){},setTimeout:setTimer,clearTimeout:id=>timers.delete(id),fetch(url,options={}){if(!url.startsWith('/api/online'))return Promise.resolve({ok:true,json:async()=>({scores:[]})});requests++;return new Promise((resolve,reject)=>{const cancel=()=>reject(Object.assign(Error('Aborted'),{name:'AbortError'}));options.signal?.addEventListener('abort',cancel,{once:true});setTimer(async()=>{if(options.signal?.aborted)return;const response=await online(new Request('https://speedway.test'+url,{...options,headers:{...options.headers,origin:'https://speedway.test'}}),{DB});setTimer(()=>{if(options.signal?.aborted)return;options.signal?.removeEventListener('abort',cancel);resolve(response)},40)},40)})}};
vm.createContext(context);for(const file of ['tracks.js','gp-engine.js','gp-ui.js','online-race.js','online-ui.js','game.js'])vm.runInContext(read('web/'+file),context);
vm.runInContext("playerNames[0]='Finish test';GPUI.setMode('online');OnlineUI.launch()",context);
const steer=vm.runInContext(`()=>{if(!['racing','finishing'].includes(state)||!racers.length)return;const r=racers[0];if(!r.started){pressRider(0,'launch');releaseInput('launch');return}if(r.finish!==null||r.eliminated)return;const radius=188,phase=trackPhase(r.x,r.y,radius),aim=trackPoint(phase/TAU*trackLength(radius)+40,radius),error=norm(Math.atan2(aim.y-r.y,aim.x-r.x)-r.angle),turn=error<-.025;if(turn&&!r.held)pressRider(0,'steering');else if(!turn&&r.held)releaseInput('steering')}`,context);
let sawFinishing=false,lastHumanStayedActive=false,session;
const settle=()=>new Promise(resolve=>setImmediate(resolve));
for(let frame=0;frame<60*160;frame++){
 now+=1000/60;
 for(const [id,task] of [...timers])if(task.at<=now){timers.delete(id);task.f()}
 await settle();vm.runInContext('OnlineUI.tick(1/60)',context);steer();
 const state=vm.runInContext('state',context),r=vm.runInContext('racers[0]',context);
 if(state==='finishing'){sawFinishing=true;if(r?.finish===null&&!r.eliminated&&!controls[0].disabled)lastHumanStayedActive=true}
 if(!session&&storage.get('speedway-online-ticket-v1')){const saved=JSON.parse(storage.get('speedway-online-ticket-v1'));if(saved.matchId)session=saved}
 if(state==='result')break;
}
assert.equal(vm.runInContext('state',context),'result','The complete race must reach its results screen');
assert.equal(vm.runInContext('racers[0].eliminated',context),false,'No false start after the light goes out');
assert.ok(vm.runInContext('racers[0].finish!==null',context),'The human must complete four actual laps');
assert.ok(vm.runInContext('racers.every(r=>r.finish!==null)',context),'All three bots must also finish');
assert.ok(sawFinishing&&lastHumanStayedActive,'A trailing human must remain controllable after the first rider finishes');
const room=JSON.parse((await DB.prepare('SELECT data FROM online_rooms WHERE id = ?').bind(session.matchId).first()).data);
assert.equal(room.world.phase,'result');assert.equal(room.world.reason,'finished');assert.ok(room.world.racers.every(r=>r.finish!==null));assert.equal(nodes['save-status'].textContent,'Wynik biegu online potwierdzony przez serwer.');
console.log('Complete real HTTP API + browser simulation race: 80 ms network, solo queue with three bots, light/start, four human laps, trailing-human controls, all finishers and server-confirmed results passed',{humanSeconds:vm.runInContext('racers[0].finish',context).toFixed(2),requests});DB.close();
