import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

test('generic discovery, real tool calls, cancellation and HTTP security', async () => {
  const data=mkdtempSync(join(tmpdir(),'mcp-http-'));
  const demo={command:process.execPath,args:[resolve('src/demo-server.mjs')]};
  writeFileSync(join(data,'servers.json'),JSON.stringify({servers:{demo,locked:{...demo,secretEnv:['TEST_API_KEY']}}}));
  const port=24000+Math.floor(Math.random()*10000);
  const child=spawn(process.execPath,['--no-warnings','src/server.mjs'],{env:{...process.env,MCP_OBSERVATORY_DATA:data,MCP_OBSERVATORY_CONFIG:join(data,'servers.json'),MCP_OBSERVATORY_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),8000);child.stdout.once('data',()=>{clearTimeout(t);resolve();});child.once('exit',()=>{clearTimeout(t);reject(Error('server exited'));});});
    const base='http://127.0.0.1:'+port;
    const boot=await (await fetch(base+'/api/bootstrap')).json();
    assert.equal(boot.listening,true);
    assert.deepEqual(boot.catalogs.demo,[]);
    assert.equal(boot.configured,false);
    const headers={'Content-Type':'application/json','X-Observatory-Token':boot.token};
    const post=(path,body)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await fetch(base+'/api/settings',{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/bootstrap',{headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal(await new Promise((resolve,reject)=>{const req=http.get(base+'/api/bootstrap',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);}),403);
    assert.equal((await post('/api/settings',{server:'locked',name:'OTHER_KEY',value:'secret'})).status,400);
    assert.equal((await post('/api/discover',{server:'locked'})).status,400);
    assert.equal((await post('/api/settings',{server:'locked',name:'TEST_API_KEY',value:'local-test-secret'})).status,200);
    assert.equal(JSON.parse(readFileSync(join(data,'credentials.json'),'utf8')).servers.locked.TEST_API_KEY,'local-test-secret');
    assert(!(await (await fetch(base+'/api/bootstrap')).text()).includes('local-test-secret'));
    assert.equal((await (await post('/api/discover',{server:'demo'})).json()).count,2);
    assert.equal((await post('/api/run',{server:'demo',tool:'unknown',args:{}})).status,400);
    const waitFor=async(id,status)=>{for(let i=0;i<80;i++){const row=await (await fetch(base+'/api/calls/'+id)).json();if(row.status===status)return row;await delay(100);}assert.fail('call did not reach '+status);};
    const {id}=await (await post('/api/run',{server:'demo',tool:'echo',args:{text:'portable MCP'}})).json();
    const row=await waitFor(id,'success');
    assert.match(JSON.stringify(row.output),/portable MCP/);
    const slow=await (await post('/api/run',{server:'demo',tool:'wait',args:{milliseconds:10000}})).json();
    assert.equal((await post('/api/cancel',{id:slow.id})).status,200);
    await waitFor(slow.id,'cancelled');
    assert.equal((await (await fetch(base+'/api/export')).json()).calls.length,2);
    assert.equal((await fetch(base+'/api/listening',{method:'POST',body:'{"enabled":false}'})).status,403);
    assert.equal((await post('/api/listening',{enabled:'false'})).status,400);
    // This long-lived proxy must observe changes written by the separate HTTP process.
    const proxy=new Client({name:'isolated-listening-test',version:'1'});
    await proxy.connect(new StdioClientTransport({command:process.execPath,args:['--no-warnings',resolve('src/proxy.mjs'),'demo'],env:{...process.env,MCP_OBSERVATORY_DATA:data,MCP_OBSERVATORY_CONFIG:join(data,'servers.json')}}));
    try{
      assert.equal((await (await post('/api/listening',{enabled:false})).json()).listening,false);
      assert.equal((await (await fetch(base+'/api/bootstrap')).json()).listening,false);
      const silent=await proxy.callTool({name:'echo',arguments:{text:'unrecorded test'}});
      assert.match(JSON.stringify(silent.content),/unrecorded test/);
      assert.equal(silent._meta?.['mcp-observatory'],undefined);
      assert.equal((await (await fetch(base+'/api/calls')).json()).total,2);
      assert.equal((await (await post('/api/listening',{enabled:true})).json()).listening,true);
      const recorded=await proxy.callTool({name:'echo',arguments:{text:'recorded again'}});
      assert.ok(recorded._meta['mcp-observatory'].callId);
      assert.equal((await (await fetch(base+'/api/calls')).json()).total,3);
    }finally{await proxy.close();}
  } finally { child.kill('SIGTERM'); }
});
