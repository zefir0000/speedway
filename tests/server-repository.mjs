import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../server/repository.mjs',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replace(/^export /gm,'')
 .replaceAll('import.meta.url',JSON.stringify(new URL('../server/repository.mjs',import.meta.url).href));
const context=vm.createContext({console,Date,JSON,URL});
vm.runInContext(source,context);
const repository=vm.runInContext('repository',context);

test('MariaDB tuple returns score rows and campaign state rather than field metadata',async()=>{
 const saved={version:1,id:'campaign'},calls=[];
 const pool={query:async(sql)=>{
  calls.push(sql);
  if(sql.includes('FROM race_scores'))return [[{name:'Ada',time_ms:62500,level:'easy',players:1}],[]];
  if(sql.includes('FROM gp_campaigns'))return [[{state:JSON.stringify(saved),revision:3}],[]];
  throw Error(sql)
 }};
 const repo=repository(pool),scores=await repo.scores({track:'classic',level:'easy',players:1});
 assert.equal(scores.length,1);
 assert.equal(scores[0].time_ms,62500);
 assert.equal(scores[0].name,'Ada');
 const campaign=await repo.campaign('owner');
 assert.equal(campaign.campaign.id,saved.id);
 assert.equal(campaign.revision,3);
 assert.ok(calls[0].includes('level=?')&&calls[0].includes('players=?'));
});

test('campaign insert and idempotent match save respect mysql2 result headers',async()=>{
 const writes=[];
 let matchExists=false;
 const connection={
  async beginTransaction(){},async commit(){},async rollback(){},release(){},
  async query(sql){
   writes.push(sql);
   if(sql.includes('FOR UPDATE'))return [[],[]];
   if(sql.startsWith('INSERT IGNORE INTO online_matches')){
    const affectedRows=matchExists?0:1;matchExists=true;return [{affectedRows},[]]
   }
   return [{affectedRows:1},[]]
  }
 };
 const repo=repository({getConnection:async()=>connection});
 assert.equal(await repo.saveCampaign('owner',{id:'one',version:1},0),1);
 const result={id:'match',completedAt:1000,members:[],world:{track:'classic',lightOffAt:0,reason:'finished',racers:[{gate:0,name:'Ada',isBot:false,eliminated:false,finish:12,progress:1}]}};
 await repo.saveMatch(result);
 await repo.saveMatch(result);
 assert.equal(writes.filter(sql=>sql.startsWith('INSERT INTO online_match_riders')).length,1);
});

test('migration checks row count, not mysql2 tuple length',async()=>{
 const log=[],migrated=new Set();
 const conn={
  async query(sql,args){
   log.push(sql);
   if(sql.startsWith('SELECT GET_LOCK'))return [[{acquired:1}],[]];
   if(sql.startsWith('SELECT name FROM schema_migrations'))return [[...migrated].filter(n=>n===args[0]).map(name=>({name})),[]];
   if(sql.startsWith('INSERT INTO schema_migrations'))migrated.add(args[0]);
   return [[],[]]
  },release(){}
 };
 const sandbox=vm.createContext({console,Date,JSON,URL,readdir:async()=>['001.sql'],readFile:async()=> 'CREATE TABLE sample (id INT);'});
 vm.runInContext(source,sandbox);
 const migrate=vm.runInContext('migrate',sandbox),pool={getConnection:async()=>conn};
 await migrate(pool);
 await migrate(pool);
 assert.equal(log.filter(sql=>sql.startsWith('CREATE TABLE sample')).length,1);
});
