import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({name:'observatory-local-demo',version:'1.0.0'});
server.registerTool('echo', {description:'本地连通测试：返回输入文本。不调用模型，不访问网络，不修改数据。',inputSchema:{text:z.string()},annotations:{readOnlyHint:true}},async ({text})=>({content:[{type:'text',text:JSON.stringify({text,source:'local-echo',note:'本地工具结果，不是模型判断'})}]}));
server.registerTool('wait', {description:'本地等待测试：用于观察进行中状态和取消。',inputSchema:{milliseconds:z.number().int().min(1).max(30000)},annotations:{readOnlyHint:true}},async ({milliseconds},extra)=>{
  await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,milliseconds);extra.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('Cancelled'));},{once:true});});
  return {content:[{type:'text',text:JSON.stringify({waited:milliseconds})}]};
});
await server.connect(new StdioServerTransport());
