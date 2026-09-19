import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFlow} from '../public/flow-model.mjs';
test('workflow and editorial fields cannot override a recorded MCP answer',()=>{
 const row={status:'success',tool:'classify',input:{classes:[{id:'repeat'},{id:'different'}],items:[{id:'one',text:'same item'}]},output:{structuredContent:{results:[{id:'one',classification:'repeat'}]}}};
 const baseline=buildFlow(row);
 assert.deepEqual(buildFlow({...row,task:{pools:[{id:'different',count:10}],currentInputId:'one',items:[{id:'one',pool:'different'}]}}),baseline);
 assert.equal(baseline.items[0].pool,'choice:repeat');
});
test('generic input, processing request and untyped return stay visible without business schemas',async()=>{
 const {inputSummary,processingSummary}=await import('../public/flow-model.mjs');
 const row={status:'success',tool:'evaluate',input:{state:{sensor:'temperature',value:42},questions:{priority:{type:'score',instructions:'根据温度评分'}}},output:{content:[{type:'text',text:'传感器数据已核对'}]}};
 assert.equal(inputSummary(row),'sensor：temperature；value：42');
 assert.match(processingSummary(row),/evaluate.*priority：根据温度评分/);
 const flow=buildFlow(row);assert.equal(flow.items[0].value,'传感器数据已核对');assert.equal(flow.items[0].pool,'other:result');
 const batch={input:{items:[{id:'a',text:'{"product":"杯子","quantity":2}'},{id:'b',text:'另一条'}]}};
 assert.equal(inputSummary(batch,'a'),'product：杯子；quantity：2');
});
test('probability bars retain real zeros, isolate question options and do not invent missing probabilities',()=>{
 const row={status:'success',input:{questions:{invoice:{type:'choice',criteria:{review:{label:'发票复核'},pass:{label:'正常'}}},message:{type:'choice',criteria:{review:{label:'消息复核'},pass:{label:'放行'}}}}},output:{structuredContent:{answers:{invoice:{choice:'pass',probabilities:{review:0,pass:1}},message:{choice:'review'}}}}};
 const flow=buildFlow(row),invoice=flow.items[0],message=flow.items[1];
 assert.equal(invoice.pool,'choice:["invoice","pass"]');
 assert.deepEqual(invoice.probabilities,{'choice:["invoice","review"]':0,'choice:["invoice","pass"]':1});
 assert.equal(message.pool,'choice:["message","review"]');
 assert.deepEqual(message.probabilities,{});
 assert.equal(flow.pools.filter(p=>p.type==='choice').length,4);
});
test('out of range or nonnumeric probability values never create bars',()=>{
 const flow=buildFlow({status:'success',input:{classes:['a','b','c']},output:{structuredContent:{classification:'a',probabilities:{a:0.7,b:'0.2',c:-0.1,unexpected:1.4}}}});
 assert.deepEqual(flow.items[0].probabilities,{'choice:a':0.7});
});
test('visual input preserves nested fields and paragraphs for the selected result',async()=>{
 const {inputValue}=await import('../public/flow-model.mjs');
 const data={incoming:{title:'新资料',description:'第一段\n\n第二段'},existing:{title:'已存资料',sources:['https://example.com/a']}};
 const row={input:{items:[{id:'first',text:'另一条'},{id:'selected',text:JSON.stringify(data)}]}};
 assert.deepEqual(inputValue(row,'selected'),data);
 assert.equal(inputValue(row,'first'),'另一条');
 assert.deepEqual(inputValue({input:{state:{sensors:[1,2],ready:false}}}),{sensors:[1,2],ready:false});
});
