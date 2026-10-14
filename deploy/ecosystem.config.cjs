const path=require('node:path');
module.exports={apps:[{name:'speedway',script:'server.mjs',cwd:path.resolve(__dirname,'..'),interpreter:process.env.SPEEDWAY_NODE||'node',node_args:'--env-file-if-exists=.env',instances:1,exec_mode:'fork',autorestart:true,kill_timeout:10000,listen_timeout:10000,max_memory_restart:'512M',time:true,env:{NODE_ENV:'production'}}]};
