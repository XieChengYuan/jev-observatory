import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CallQueue} from '../public/call-queue.mjs';
process.env.MCP_OBSERVATORY_DATA=mkdtempSync(join(tmpdir(),'jev-stream-test-'));
const {startCall,finishCall,callStream,streamHead,flowTotals}=await import('../src/store.mjs');
test('rapid completions remain ordered, duplicated polling cannot skip or recount calls',()=>{
 const before=streamHead();const ids=Array.from({length:65},()=>startCall('jev','classify','mcp',{classes:[{id:'repeat'}],items:[{id:'same',text:'identical'}]}));
 ids.reverse().forEach(id=>finishCall(id,{output:{structuredContent:{results:[{id:'same',classification:'repeat'}]}}}));
 const feed=callStream(before);assert.equal(feed.events.length,50);assert.equal(feed.remaining,15);
 const queue=new CallQueue(before);queue.ingest(feed.events);queue.ingest(feed.events);queue.ingest(callStream(queue.cursor).events);
 for(const id of ids){assert.equal(queue.next().id,id);assert.equal(queue.next().id,id);assert.equal(queue.complete('unrelated'),false);assert.equal(queue.complete(id),true);}
 assert.equal(queue.next(),null);assert.equal(queue.ack,streamHead());assert.equal(flowTotals(ids[0]).scope.pools['choice:repeat'],65);
 const resumed=new CallQueue(feed.events[10].seq);resumed.ingest(callStream(resumed.cursor).events);assert.equal(resumed.next().id,ids[11]);
 finishCall(ids[0],{output:{structuredContent:{results:[{id:'same',classification:'changed'}]}}});assert.equal(callStream(before,100).events.length,65);assert.equal(flowTotals(ids[0]).scope.pools['choice:repeat'],65);
});
test('failed calls are automatically retained as their own events',()=>{
 const before=streamHead(),id=startCall('jev','classify','mcp',{});assert.equal(callStream(before).events.length,0);
 finishCall(id,{status:'error',error:'upstream failed'});const events=callStream(before).events;assert.equal(events.length,1);assert.equal(events[0].call.status,'error');assert.equal(flowTotals(id).scope.pools['other:error'],1);
});
