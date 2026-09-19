import { SERVERS, ROOT, DATA, CONFIG } from '../src/config.mjs';
import { resolve } from 'node:path';
const ids=process.argv[2] ? [process.argv[2]] : Object.keys(SERVERS);
for(const id of ids) if(!SERVERS[id]) throw new Error('Unknown server id');
console.log(JSON.stringify({mcpServers:Object.fromEntries(ids.map(id=>[id,{command:process.execPath,args:['--no-warnings',resolve(ROOT,'src/proxy.mjs'),id],env:{MCP_OBSERVATORY_DATA:DATA,MCP_OBSERVATORY_CONFIG:CONFIG}}]))},null,2));
console.error('生成配置供 MCP 客户端使用；此命令不会自动修改客户端配置。');
