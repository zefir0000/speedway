import {mkdir,readFile,cp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const pkg=JSON.parse(await readFile('package.json','utf8')),folder=`speedway-${pkg.version}`;
const stage=resolve('releases',folder);await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
for(const item of ['package.json','package-lock.json','.env.example','server.mjs','server','web','worker','scripts','tests','deploy','drizzle','db','drizzle.config.ts','SELF_HOSTING.md'])await cp(item,stage+'/'+item,{recursive:true});
// Build metadata belongs to Sites; the standalone release only needs client assets.
await cp('dist/client',stage+'/dist/client',{recursive:true});
const archive=resolve('releases',folder+'.tar.gz');execFileSync('tar',['-czf',archive,'-C',resolve('releases'),folder]);console.log(archive);
