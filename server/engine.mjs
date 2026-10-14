import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context=vm.createContext({Math});
vm.runInContext(readFileSync(new URL('../web/tracks.js',import.meta.url),'utf8'),context);
vm.runInContext(`const factory=makeTrackGeometry,cache=new Map();makeTrackGeometry=track=>{if(!cache.has(track.id))cache.set(track.id,factory(track));return cache.get(track.id)}`,context);
vm.runInContext(readFileSync(new URL('../web/online-race.js',import.meta.url),'utf8'),context);
export const engine=vm.runInContext('OnlineRace',context);
export const tracks=vm.runInContext('TRACKS.map(t=>t.id)',context);
