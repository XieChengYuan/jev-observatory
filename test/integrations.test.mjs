import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { clients, parseConfig, replaceEntry, planIntegration, applyIntegration, restoreIntegration, isObserved, readClient } from '../src/integrations.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ensureDashboard, health, stopDashboard, storageIdentity } from '../src/daemon.mjs';

const root = resolve(import.meta.dirname,'..');
const temporary = () => mkdtempSync(join(tmpdir(),'jev-install-test-'));
function fixture(format = 'json') {
  const data = temporary(), path = join(data, format === 'json' ? 'client.json' : 'config.toml');
  return { data, client: { id: format === 'json' ? 'cursor' : 'codex', label: 'Test', format, path } };
}
const original = { command: process.execPath, args: [resolve(root,'src/demo-server.mjs')], env: { CUSTOM_SECRET_TOKEN: 'isolated-test-secret', MODE: 'work' } };

test('client detection uses platform-specific paths and CODEX_HOME', () => {
  assert.match(clients('/test','darwin',{})[3].path.replaceAll('\\','/'),/Library\/Application Support\/Claude/);
  assert.equal(clients('/test','linux',{}).length,3);
  assert.match(clients('/test','win32',{APPDATA:'/roaming'})[3].path.replaceAll('\\','/'),/roaming\/Claude/);
  assert.equal(clients('/test','linux',{CODEX_HOME:'/custom'})[0].path,resolve('/custom/config.toml'));
});
test('JSONC preserves comments, other settings and MCP services', () => {
  const { client } = fixture();
  const text = '{\n // keep this\n "theme":"light", "mcpServers":{"other":{"command":"echo"},"jev":{"command":"npx"}},\n}';
  const next = replaceEntry(text,client,'jev',original);
  assert.match(next,/keep this/);
  assert.deepEqual(parseConfig(next,'json'),{theme:'light',mcpServers:{other:{command:'echo'},jev:original}});
});
test('TOML patch preserves unrelated fields, comments, nested policy and env', () => {
  const { client } = fixture('toml');
  const text = '# my model\nmodel = "test-model"\n[mcp_servers.jev]\ncommand = "npx"\nenabled_tools = ["jev_classify"]\n[mcp_servers.jev.env]\nTYPESAFE_API_KEY = "test-only"\n[mcp_servers.other]\ncommand = "other"\n[features]\n# preserve\nmulti_agent = true\n';
  const parsed = parseConfig(text,'toml'), entry = {...parsed.mcp_servers.jev,command:'node',args:['proxy']};
  const next = replaceEntry(text,client,'jev',entry);
  parsed.mcp_servers.jev = entry;
  assert.deepEqual(parseConfig(next,'toml'),parsed);
  assert.match(next,/# my model/); assert.match(next,/# preserve/);
  const quoted = '[mcp_servers."a.b"]\ncommand="old"\n';
  assert.equal(parseConfig(replaceEntry(quoted,client,'a.b',{command:'new'}),'toml').mcp_servers['a.b'].command,'new');
});
test('ambiguous inline TOML tables fail rather than changing unrelated settings', () => {
  const { client } = fixture('toml');
  assert.throws(()=>replaceEntry('mcp_servers = { jev = { command = "old" } }\n',client,'jev',{command:'new'}));
});
test('existing stdio migration keeps environment/policy, backs up, restores only its own entry', () => {
  const { data, client } = fixture();
  const entry = {...original,disabled:false,alwaysAllow:['echo']};
  writeFileSync(client.path,JSON.stringify({theme:'paper',mcpServers:{jev:entry,other:{command:'other'}}}));
  const plan = planIntegration({client,name:'jev',original:entry,data,root});
  applyIntegration(plan,data);
  const actual = readClient(client).config;
  assert(isObserved(actual.mcpServers.jev));
  assert.equal(actual.mcpServers.jev.env.CUSTOM_SECRET_TOKEN,'isolated-test-secret');
  assert.deepEqual(actual.mcpServers.jev.alwaysAllow,['echo']);
  assert(plan.upstream.envVars.includes('CUSTOM_SECRET_TOKEN'));
  assert(!JSON.stringify(plan.upstream).includes('isolated-test-secret'));
  const record = join(data,'integrations',plan.id,'record.json');
  if (process.platform !== 'win32') assert.equal(statSync(record).mode & 0o777,0o600);
  actual.theme = 'changed after setup'; writeFileSync(client.path,JSON.stringify(actual));
  restoreIntegration(record);
  assert.deepEqual(readClient(client).config,{theme:'changed after setup',mcpServers:{jev:entry,other:{command:'other'}}});
  applyIntegration(plan,data); // reinstall after restore is safe
});
test('fresh integration restores to no Jev entry and guards later user changes', () => {
  const { data, client } = fixture();
  const plan = planIntegration({client,name:'jev',original,data,root,fresh:true,secretKey:'OPENROUTER_API_KEY'});
  applyIntegration(plan,data);
  assert.deepEqual(plan.upstream.secretEnv,['OPENROUTER_API_KEY']);
  const record = join(data,'integrations',plan.id,'record.json');
  const content = readFileSync(client.path,'utf8');
  const changed = readClient(client).config; changed.mcpServers.jev.args.push('user-change');
  writeFileSync(client.path,JSON.stringify(changed));
  assert.throws(()=>restoreIntegration(record),/被修改/);
  writeFileSync(client.path,content); restoreIntegration(record);
  assert.equal(readClient(client).config.mcpServers?.jev,undefined);
});
test('unsupported transport and unresolved launch variables leave client untouched', () => {
  const { data, client } = fixture();
  for (const entry of [{url:'https://example.test/mcp'}, {command:'node',args:['${workspaceFolder}/mcp.js']}, {command:'node',envFile:'.env'}, {command:'node',cwd:'relative'}]) {
    assert.throws(()=>planIntegration({client,name:'jev',original:entry,data,root}));
  }
  assert(!existsSync(client.path));
});
test('stale migration plans do not overwrite concurrent client changes', () => {
  const { data, client } = fixture();
  writeFileSync(client.path,JSON.stringify({mcpServers:{jev:original}}));
  const plan = planIntegration({client,name:'jev',original,data,root});
  writeFileSync(client.path,JSON.stringify({mcpServers:{jev:{command:'changed'}}}));
  assert.throws(()=>applyIntegration(plan,data),/变化/);
  assert.equal(readClient(client).config.mcpServers.jev.command,'changed');
});
test('installed CLI wraps a real local MCP; discovery and call work without UI controls', async () => {
  const { data, client } = fixture();
  writeFileSync(client.path,JSON.stringify({mcpServers:{jev:original}}));
  const args = [resolve(root,'bin/cli.mjs'),'setup','--client','cursor','--config',client.path,'--data',data,'--yes','--no-start','--no-open'];
  const env = {...process.env,MCP_OBSERVATORY_DATA:data,MCP_OBSERVATORY_CONFIG:join(data,'servers.json'),MCP_OBSERVATORY_NO_AUTOSTART:'1'};
  execFileSync(process.execPath,args,{env,stdio:'pipe'});
  const first = readFileSync(client.path,'utf8');
  execFileSync(process.execPath,args,{env,stdio:'pipe'});
  assert.equal(readFileSync(client.path,'utf8'),first);
  const wrapped = readClient(client).config.mcpServers.jev;
  const sdk = new Client({name:'installer-test',version:'1.0.0'});
  await sdk.connect(new StdioClientTransport({command:wrapped.command,args:wrapped.args,env:{...env,...wrapped.env},stderr:'pipe'}));
  try {
    assert((await sdk.listTools()).tools.some(t=>t.name==='echo'));
    const result = await sdk.callTool({name:'echo',arguments:{text:'genuine isolated MCP call'}});
    assert(!result.isError); assert(result._meta['mcp-observatory'].callId);
  } finally { await sdk.close(); }
  const rows = JSON.parse(execFileSync(process.execPath,['--no-warnings','--input-type=module','-e',`import {listCalls} from ${JSON.stringify(new URL('../src/store.mjs',import.meta.url).href)};console.log(JSON.stringify(listCalls()));`],{env,encoding:'utf8'}));
  assert.equal(rows.total,1); assert.equal(rows.rows[0].status,'success');
  execFileSync(process.execPath,[resolve(root,'bin/cli.mjs'),'restore','--data',data],{env,stdio:'pipe'});
  assert.deepEqual(readClient(client).config.mcpServers.jev,original);
});
test('fresh setup with a locally available provider needs no existing MCP config', () => {
  const { data, client } = fixture();
  const provider = join(data,'providers/jev/node_modules/@jkudish/jev-mcp');
  mkdirSync(provider,{recursive:true}); writeFileSync(join(provider,'package.json'),JSON.stringify({version:'0.5.0'}));
  const env = {...process.env,MCP_OBSERVATORY_CONFIG:join(data,'servers.json'),OPENROUTER_API_KEY:'isolated-install-credential'};
  execFileSync(process.execPath,[resolve(root,'bin/cli.mjs'),'setup','--client','cursor','--config',client.path,'--data',data,'--provider','openrouter','--yes','--no-start'],{env,stdio:'pipe'});
  const entry = readClient(client).config.mcpServers.jev;
  assert(isObserved(entry)); assert(!JSON.stringify(entry).includes('isolated-install-credential'));
  const id = entry.args.at(-1), cfg = JSON.parse(readFileSync(join(data,'servers.json')));
  assert.deepEqual(cfg.servers[id].secretEnv,['OPENROUTER_API_KEY']);
  assert.equal(cfg.servers[id].env.JEV_PROVIDER,'openrouter');
  assert.equal(JSON.parse(readFileSync(join(data,'credentials.json'))).servers[id].OPENROUTER_API_KEY,'isolated-install-credential');
});
test('daemon refuses foreign port without disturbing the listening process', async () => {
  const server = createServer(socket=>socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n'));
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try { await assert.rejects(ensureDashboard({root,data:temporary(),port:server.address().port}),/占用/); }
  finally { server.close(); }
});
test('managed dashboard starts without browser, reuses its process, and stops independently', async () => {
  const data = temporary(), probe = createServer();
  probe.listen(0,'127.0.0.1'); await once(probe,'listening');
  const port = probe.address().port; await new Promise(r=>probe.close(r));
  const config = join(data,'servers.json'); writeFileSync(config,JSON.stringify({servers:{}}));
  const options = {root,data,port,config};
  try {
    assert.equal((await ensureDashboard(options)).started,true);
    assert.equal((await ensureDashboard(options)).started,false);
    assert.equal((await health(port)).storageId,storageIdentity(data));
    const body = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
    assert.equal(body.summary.total,0);
  } finally { await stopDashboard(options); }
  assert.equal(await health(port),null);
});
