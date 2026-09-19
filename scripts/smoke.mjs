import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
const data=mkdtempSync(join(tmpdir(),'mcp-smoke-'));
process.env.MCP_OBSERVATORY_DATA=data;
process.env.MCP_OBSERVATORY_CONFIG=join(data,'servers.json');
writeFileSync(process.env.MCP_OBSERVATORY_CONFIG,JSON.stringify({servers:{demo:{command:process.execPath,args:[resolve('src/demo-server.mjs')]}}}));
const {discoverServer}=await import('../src/runner.mjs');
await discoverServer('demo');
const client=new Client({name:'smoke-test',version:'1'});
try {
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('src/proxy.mjs'),'demo'],env:{...process.env},stderr:'pipe'}));
 assert.equal((await client.listTools()).tools.length,2);
 const result=await client.callTool({name:'echo',arguments:{text:'hello'}});
 assert.equal(JSON.parse(result.content[0].text).text,'hello');
 console.log('Generic MCP initialize / discovery / proxy / actual tool call passed. No network or model calls.');
} finally {await client.close();}
