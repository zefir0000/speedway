import {loadConfig} from './server/config.mjs';
import {createApp} from './server/app.mjs';
const config=loadConfig(),app=await createApp({config,onFatal:()=>{console.error('Realtime backend unavailable; stopping for restart');process.kill(process.pid,'SIGTERM')}}),address=await app.listen();
console.log(`Speedway WebSocket server listening on ${address.address}:${address.port}`);
let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;try{await app.close();process.exitCode=0}catch{process.exitCode=1}});
