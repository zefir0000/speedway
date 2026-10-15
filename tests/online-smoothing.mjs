import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

let time=0;
const context=vm.createContext({performance:{now:()=>time},Date:{now:()=>1000}});
vm.runInContext(readFileSync(new URL('../web/online-smoothing.js',import.meta.url),'utf8'),context);
const smoothing=vm.runInContext('OnlineSmoothing',context);
const rider=(x,angle=0)=>({x,y:0,angle,poseLeg:0,poseDrift:0,started:true,finish:null,eliminated:false});
const frames=(a,b)=>[{clock:1000,racers:[rider(a,3.1)]},{clock:1050,racers:[rider(b,-3.1)]}];

test('interpolation wraps angles and bounded extrapolation stops on missing packets',()=>{
 const history=frames(0,5);
 const mid=smoothing.pose(history,0,1025);
 assert.equal(mid.x,2.5);
 assert.ok(Math.abs(mid.angle-3.14)<.1);
 assert.equal(mid.starved,false);
 assert.equal(smoothing.pose(history,0,1100).x,10);
 assert.equal(smoothing.pose(history,0,1500).x,17);
 assert.equal(smoothing.pose([{clock:1000,racers:[rider(0)]}],0,1100).x,0);
 history[1].racers[0].finish=20;
 assert.equal(smoothing.pose(history,0,1100).x,5);
});

test('display follows prediction without modifying physical pose and snaps on large discontinuity',()=>{
 const physical=rider(12,-3.1),previous=rider(0,3.1);
 const shown=smoothing.follow(previous,physical,.016);
 assert.ok(shown.x>0&&shown.x<12);
 assert.ok(Math.abs(shown.angle-3.1)<.1);
 assert.equal(physical.x,12);
 assert.equal(smoothing.follow(previous,rider(100),.016).x,100);
});

test('server clock stays monotonic across wall clock adjustments and adaptive buffer contracts slowly',()=>{
 const clock=smoothing.create();
 clock.initialize(5000);
 time+=50;
 assert.equal(clock.now(),5050);
 clock.sync(5100,40);
 assert.ok(clock.now()>=5050);
 for(let i=0;i<5;i++){time+=50;clock.receive(5000+i*50)}
 const baseline=clock.stats().bufferMs;
 time+=170;clock.receive(5300);
 assert.ok(clock.stats().bufferMs>baseline);
 const after=clock.stats().bufferMs;
 clock.target(.016);
 assert.ok(clock.stats().bufferMs<=after);
 clock.starve(true,.016);clock.starve(true,.016);clock.starve(false,.016);
 assert.equal(clock.stats().stalls,1);
 assert.equal(clock.stats().stallMs,32);
});
