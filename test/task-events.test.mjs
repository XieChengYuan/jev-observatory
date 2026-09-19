import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.MCP_OBSERVATORY_DATA=mkdtempSync(join(tmpdir(),'jev-task-test-'));
const {recordTaskItem,getTask}=await import('../src/task-events.mjs');
const task={id:'test',name:'Task',pools:[{id:'new',name:'New'},{id:'duplicate',name:'Duplicate'},{id:'review',name:'Review'}]};
const put=(id,pool,input='same content')=>recordTaskItem({task,item:{id,pool,input}});
test('distinct arrivals of duplicate content count separately; retries preserve input identity',()=>{
 put('a','duplicate');put('b','duplicate');put('b','duplicate');
 const result=getTask('test');assert.equal(result.total,2);assert.equal(result.pools[1].count,2);
});
test('routing moves one input between pools without increasing total',()=>{
 put('c',null);assert.equal(getTask('test').waiting,1);
 put('c','review');put('c','new');
 const result=getTask('test');assert.equal(result.total,3);assert.equal(result.waiting,0);assert.deepEqual(result.pools.map(p=>p.count),[1,2,0]);
 assert.equal(result.pools.reduce((n,p)=>n+p.count,0)+result.waiting,result.total);
});
test('tasks are isolated and unknown pools rejected',()=>{
 recordTaskItem({task:{...task,id:'other'},item:{id:'a',pool:'new'}});
 assert.equal(getTask('other').total,1);assert.equal(getTask('test').total,3);
 assert.throws(()=>put('d','missing'),/Unknown/);assert.equal(getTask('test').total,3);
});
test('call linkage selects its own task, not the newest unrelated task',async()=>{
 const {linkTaskCall,getTaskForCall}=await import('../src/task-events.mjs');
 linkTaskCall('call-1',{taskId:'test',inputId:'a'});
 assert.equal(getTaskForCall('call-1').id,'test');assert.equal(getTaskForCall('call-1').currentInputId,'a');
 assert.equal(getTaskForCall('unknown'),null);
 recordTaskItem({task,item:{id:'legacy',pool:'new',calls:[{id:'old-call'}]}});
 assert.equal(getTaskForCall('old-call').currentInputId,'legacy');
});
