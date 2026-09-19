// Explicit release check: downloads npm packages but never calls a model.
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { health, stopDashboard } from '../src/daemon.mjs';

const tarball = resolve(process.argv[2]), temp = mkdtempSync(join(tmpdir(),'jev-package-check-'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:package -- /absolute/path/package.tgz');
const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(?:API_KEY|OBSERVATORY)/.test(key)));
env.TYPESAFE_API_KEY = 'isolated-install-check-no-model-calls';
env.npm_execpath = npm;
const run = (args) => new Promise((resolve,reject)=>{
  const child = spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});
  let diagnostics='';
  child.stdout.on('data',d=>diagnostics+=d); child.stderr.on('data',d=>diagnostics+=d);
  child.on('error',reject); child.on('exit',code=>code===0?resolve():reject(new Error(diagnostics.replaceAll(env.TYPESAFE_API_KEY,'[hidden]'))));
});
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
const port=probe.address().port;await new Promise(r=>probe.close(r));
const data=join(temp,'data'), clientFile=join(temp,'cursor.json');
await run([npm,'install','--prefix',join(temp,'package'),'--ignore-scripts','--no-audit','--no-fund',tarball]);
const root=join(temp,'package/node_modules/jev-observatory'),cli=join(root,'bin/cli.mjs');
const sdk=new Client({name:'release-tools-list-check',version:'1.0.0'});
try {
  await run([cli,'setup','--client','cursor','--config',clientFile,'--data',data,'--port',String(port),'--yes','--no-open']);
  const entry=JSON.parse(readFileSync(clientFile)).mcpServers.jev;
  assert.equal(realpathSync(entry.args.find(a=>a.endsWith('cli.mjs'))),realpathSync(cli));
  await sdk.connect(new StdioClientTransport({command:entry.command,args:entry.args,env:{...env,...entry.env},stderr:'pipe'}));
  const tools=await sdk.listTools();
  assert.equal(tools.tools.length,10);assert(tools.tools.some(t=>t.name==='jev_classify'));
  assert((await health(port))?.application==='jev-observatory');
  const status=await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
  assert.equal(status.summary.total,0);
  await run([cli,'doctor','--client','cursor','--config',clientFile,'--data',data,'--port',String(port),'--discover']);
  await sdk.close();
  await run([cli,'restore','--data',data]);
  assert.equal(JSON.parse(readFileSync(clientFile)).mcpServers?.jev,undefined);
  console.log('Packed install → fresh Jev package → client config → 10 real tools → automatic dashboard → restore: passed. Zero model calls.');
} finally {await sdk.close().catch(()=>{});if(await health(port))await stopDashboard({data,port});}
