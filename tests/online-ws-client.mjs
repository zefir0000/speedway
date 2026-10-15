import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../web/'+file,import.meta.url),'utf8');
function harness(query){
 let time=1000,nextTimer=0;
 const sockets=[],timers=new Map(),nodes=new Map(),reports=[];
 const element=()=>{const classes=new Set();return {children:[],classList:{add(name){classes.add(name)},remove(name){classes.delete(name)},contains:name=>classes.has(name),toggle(name,enabled){enabled?classes.add(name):classes.delete(name)}},append(...children){this.children.push(...children)},replaceChildren(){},setAttribute(){},click(){}}};
 const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)};
 const racers=()=>Array.from({length:4},(_,gate)=>({gate,x:gate*20,y:0,angle:0,poseLeg:0,poseDrift:0,started:true,finish:null,eliminated:false,auto:false,name:'Rider',speed:0,lap:1}));
 class WebSocket{
  static OPEN=1;
  constructor(){this.readyState=1;sockets.push(this);queueMicrotask(()=>this.onopen())}
  send(raw){const msg=JSON.parse(raw);if(msg.type==='hello')queueMicrotask(()=>this.deliver({type:'welcome',serverNow:time}));if(msg.type==='request')queueMicrotask(()=>this.deliver({type:'reply',id:msg.id,data:msg.route==='queue'?{state:'waiting',players:[],deadline:time+20000}:{state:'race',matchId:'match',gate:0,ack:0,world:world('racing')}}))}
  deliver(msg){this.onmessage?.({data:JSON.stringify(msg)})}
  close(){this.readyState=3;this.onclose?.()}
 }
 function world(phase,clock=time){return {version:1,phase,track:'classic',clock,elapsed:0,racers:racers()}}
 const context={Date:class extends Date{static now(){return time}},performance:{now:()=>time},URLSearchParams,URL:{createObjectURL(blob){reports.push(blob);return 'blob:report'},revokeObjectURL(){}},Blob,location:{search:query,protocol:'http:',host:'localhost'},WebSocket,crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{body:element(),createElement:element,querySelectorAll:()=>[] ,addEventListener(){}},window:{addEventListener(){}},setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),setInterval:()=>++nextTimer,clearInterval(){},$:node,GPUI:{render(){}},playerNames:['Tester'],racers:[],raceMode:'online',state:'menu',humanCount:1,level:'normal',trackChoice:'classic',elapsed:0,particles:[],setTrack(){},showOnlineRace(){},menu(){context.state='menu'},updateControls(){},updateHud(){},updateCenterEvent(){},emitGravel(){},finishRace(){context.state='result'},inputMap:new Map(),norm:x=>x};
 context.OnlineRace={advance:(w,at)=>{w.clock=Math.max(w.clock,at)},input(){}};
 vm.createContext(context);
 for(const file of ['online-smoothing.js','online-ws-ui.js'])vm.runInContext(read(file),context);
 const ui=vm.runInContext('OnlineUI',context);
 return {ui,context,sockets,timers,reports,world,advance:ms=>{time+=ms}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

for(const query of ['?smooth=1','?smooth=0'])test(`WebSocket ${query} reconnects and accepts authoritative result`,async()=>{
 const {ui,context,sockets,timers,world,advance}=harness(query);
 ui.init();ui.launch();
 await flush();
 const first=sockets[0];
 first.deliver({type:'state',data:{matchId:'match',gate:0,ack:0,world:world('racing')}});
 assert.equal(context.state,'racing');
 advance(50);const next=world('racing');next.racers[1].x+=8;
 first.deliver({type:'state',data:{matchId:'match',gate:0,ack:0,world:next}});
 ui.tick(1/60);
 assert.ok(Number.isFinite(context.racers[1].x));
 const rendered=context.racers[1].x;
 advance(180);const late=world('racing');late.racers[1].x+=12;
 first.deliver({type:'state',data:{matchId:'match',gate:0,ack:0,world:late}});
 if(query==='?smooth=1')assert.equal(context.racers[1].x,rendered,'Arrival does not teleport the remote bike');
 ui.tick(1/60);
 first.close();
 const reconnect=[...timers.values()].find(t=>t.ms===500);
 assert.ok(reconnect,'Reconnect scheduled after disconnect');
 reconnect.fn();await flush();
 assert.equal(sockets.length,2);
 const result=world('result');result.racers[0].finish=5;result.racers[0].x=42;
 sockets[1].deliver({type:'state',data:{matchId:'match',gate:0,ack:0,world:result}});
 assert.equal(context.state,'result');
 assert.equal(context.racers[0].x,42);
 assert.equal(context.racers[0].finish,5);
 await flush();
});

test('diagnostic report contains only numeric measurements, not session or rider data',async()=>{
 const {ui,context,sockets,reports,world}=harness('?debug=1');
 ui.init();ui.launch();await flush();
 sockets[0].deliver({type:'state',data:{matchId:'match',gate:0,ack:0,world:world('racing')}});
 ui.frameMetric(16.7);
 const button=context.document.body.children[0].children[1];
 button.onclick();
 const text=await reports[0].text();
 const report=JSON.parse(text);
 assert.equal(report.variant,'smooth');
 assert.ok(report.measurements.frameMs.includes(16.7));
 assert.ok(!/aaaaaaaa|Tester|match|cookie|token|ticket/i.test(text));
 ui.back();
});

test('ping quality uses green, orange and red ranges and resets when stale',async()=>{
 const {ui,sockets,advance,context}=harness('');
 ui.init();
 assert.equal(ui.connectionQuality(),null);
 assert.equal(context.$('online-ping-value').textContent,'PING · — ms');
 ui.launch();await flush();
 const socket=sockets[0];
 for(const [latency,quality] of [[99,'good'],[100,'warn'],[199,'warn'],[200,'bad']]){
  socket.deliver({type:'pong',clientAt:1000-latency,clientAtMono:1000-latency,serverNow:1000});
  assert.equal(ui.connectionQuality(),quality,`${latency} ms`);
  assert.equal(ui.connectionLabel(),`ONLINE · ${latency} ms`);
  assert.equal(context.$('online-ping-value').textContent,`PING · ${latency} ms`);
  assert.ok(context.$('online-ping-value').classList.contains('ping-'+quality));
 }
 advance(1501);
 ui.render();
 assert.equal(ui.connectionQuality(),null);
 assert.equal(ui.connectionLabel(),'ŁĄCZENIE…');
 assert.equal(context.$('online-ping-value').textContent,'PING · — ms');
 assert.ok(!context.$('online-ping-value').classList.contains('ping-bad'));
 ui.back();
});
