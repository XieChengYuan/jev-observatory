// Isolated local demo workspace for browser QA. No model or network calls.
import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
process.env.MCP_OBSERVATORY_DATA=mkdtempSync(join(tmpdir(),'mcp-ui-'));
process.env.MCP_OBSERVATORY_CONFIG=join(process.env.MCP_OBSERVATORY_DATA,'servers.json');
process.env.MCP_OBSERVATORY_PORT='4319';
writeFileSync(process.env.MCP_OBSERVATORY_CONFIG,JSON.stringify({servers:{demo:{name:'Local demo',command:process.execPath,args:[resolve('src/demo-server.mjs')]}}}));
const {discoverServer}=await import('../src/runner.mjs');
await discoverServer('demo');
await import('../src/server.mjs');
