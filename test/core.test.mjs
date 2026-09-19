import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MCP_OBSERVATORY_DATA = mkdtempSync(join(tmpdir(), 'mcp-observatory-test-'));
writeFileSync(join(process.env.MCP_OBSERVATORY_DATA,'servers.json'),JSON.stringify({servers:{example:{command:process.execPath,secretEnv:['TEST_API_KEY']}}}));
const { redact, saveSecret, saveCatalog, credentials, DATA, validateConfig, expand } = await import('../src/config.mjs');
const { getCall, listCalls } = await import('../src/store.mjs');
saveCatalog('example',{tools:[{name:'echo',inputSchema:{type:'object'}}]});
const { runTool } = await import('../src/runner.mjs');

test('redacts nested fields, serialized JSON and credentials embedded in messages', () => {
  const secret = 'private-test-value';
  const value = redact({ api_key: secret, content: [{ text: JSON.stringify({ password: 'hidden', message: 'Oops ' + secret }) }], state: 'Bearer secret-token' }, [secret]);
  assert.equal(value.api_key, '[已隐藏]');
  assert(!JSON.stringify(value).includes(secret));
  assert(!JSON.stringify(value).includes('secret-token'));
  assert.equal(JSON.parse(value.content[0].text).password, '[已隐藏]');
});
test('credentials are private and model results persist separately from secrets', async () => {
  saveSecret('example','TEST_API_KEY','private-test-value');
  if(process.platform !== 'win32') assert.equal(statSync(join(DATA, 'credentials.json')).mode & 0o777, 0o600);
  assert.equal(credentials().servers.example.TEST_API_KEY, 'private-test-value');
  let closed = 0;
  const result = { content: [{ type: 'text', text: JSON.stringify({ answers: { category: { choice: 'game', confidence: .9 } }, usage: { input_tokens: 23, detail: 'private-test-value' }, api_key: 'private-test-value' }) }] };
  const fake = async () => ({ callTool: async () => result, close: async () => closed++ });
  const calls = await Promise.all(Array.from({ length: 5 }, (_, i) => runTool({ server: 'example', tool: 'echo', source: 'test', args: { state: 'sample ' + i }, connect: fake })));
  assert.equal(closed, 5);
  for (const call of calls) {
    const record = getCall(call.id);
    assert.equal(record.status, 'success');
    assert.equal(record.usage.input_tokens, 23);
    assert.equal(record.stages.length, 4);
    assert(!JSON.stringify(record).includes('private-test-value'));
  }
  assert.equal(listCalls({ q: 'sample', limit: 2, offset: 2 }).rows.length, 2);
  assert.equal(listCalls({ q: "' OR 1=1 --" }).total, 0);
});
test('errors and cancellation remain visible without leaking credentials', async () => {
  const error = await runTool({ server: 'example', tool: 'echo', args: {}, connect: async () => { throw new Error('Failed private-test-value'); } });
  assert.equal(getCall(error.id).status, 'error');
  assert(!JSON.stringify(error).includes('private-test-value'));
  const controller = new AbortController(); controller.abort();
  const cancelled = await runTool({ server: 'example', tool: 'echo', signal: controller.signal, connect: async () => { throw new Error('aborted'); } });
  assert.equal(getCall(cancelled.id).status, 'cancelled');
});
test('tool-level failures are not reported as successful calls', async () => {
  const call = await runTool({ server: 'example', tool: 'echo', connect: async () => ({ callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'invalid criteria' }] }), close: async () => {} }) });
  assert.equal(getCall(call.id).status, 'error');
});
test('missing credentials fail without starting an upstream process', async () => {
  saveSecret('example','TEST_API_KEY','');
  const call = await runTool({ server: 'example', tool: 'echo', connect: async () => { assert.fail('Must not connect'); } });
  assert.equal(getCall(call.id).status, 'error');
  assert.match(call.result.content[0].text, /尚未配置/);
});

test('config validation and portable placeholders', () => {
  assert.throws(()=>validateConfig({servers:{bad:{args:[]}}}),/command/);
  assert.throws(()=>validateConfig({servers:{bad:{command:'node',secretEnv:['invalid-name']}}}),/环境变量/);
  assert.throws(()=>validateConfig(JSON.parse('{"servers":{"__proto__":{"command":"node"}}}')),/服务 ID/);
  assert.equal(expand('${NODE}'),process.execPath);
  assert.equal(expand('${DATA}'),DATA);
  assert.throws(()=>saveSecret('example','UNDECLARED','test'),/未声明/);
});

test('telemetry counts observed traffic and distinguishes missing usage', async()=>{
 const {telemetry,startCall,finishCall}=await import('../src/store.mjs');
 const now=Date.now()+100;
 const baseline=telemetry(now);
 const id=startCall('example','echo','test',{});
 finishCall(id,{usage:{input_tokens:100,output_tokens:20}});
 const after=telemetry(now);
 assert.equal(after.requests,baseline.requests+1);
 assert.equal(after.input,baseline.input+100);
 assert.equal(after.output,baseline.output+20);
 assert.equal(after.outputPerSecond,after.output/60);
 const empty=telemetry(now+120000);
 assert.equal(empty.requests,0);assert.equal(empty.input,null);assert.equal(empty.output,null);
});


test('stopping recording keeps in-flight results and never backfills disabled calls', async()=>{
 const {startCall,finishCall,setListening,listeningEnabled,streamHead,callStream}=await import('../src/store.mjs');
 const {execFileSync}=await import('node:child_process');
 const {pathToFileURL}=await import('node:url');
 const {resolve}=await import('node:path');
 const before=listCalls().total,head=streamHead();
 const existing=startCall('example','echo','test',{});
 setListening(false);
 try{
  assert.equal(listeningEnabled(),false);
  const other=execFileSync(process.execPath,['--no-warnings','--input-type=module','-e',`import {listeningEnabled} from ${JSON.stringify(pathToFileURL(resolve('src/store.mjs')).href)};process.stdout.write(String(listeningEnabled()));`],{encoding:'utf8'});
  assert.equal(other,'false');
  const skipped=startCall('example','echo','test',{text:'not stored'});
  assert.equal(skipped,null);
  finishCall(existing,{output:{content:[]}});
  assert.equal(getCall(existing).status,'success');
  assert.deepEqual(callStream(head).events.map(e=>e.call.id),[existing]);
  setListening(true);
  finishCall(skipped,{output:{content:[]}});
  assert.equal(listCalls().total,before+1);
 }finally{setListening(true);}
});
