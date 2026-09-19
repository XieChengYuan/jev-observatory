import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFlow} from '../public/flow-model.mjs';
const row=(input,out,status='success')=>({tool:'evaluate',status,input,output:{structuredContent:out}});
test('choice retains every declared and returned pool, including zero hits',()=>{
 const f=buildFlow(row({classes:[{id:'duplicate'},{id:'distinct'},{id:'uncertain'}],items:[{id:'one',text:'first'},{id:'two',text:'second'}]}, {results:[{id:'one',classification:'distinct',probabilities:{distinct:1,duplicate:0,uncertain:0}},{id:'two',classification:'distinct'}]}));
 assert.equal(f.pools.filter(p=>p.type==='choice').length,3);assert.equal(f.items.length,2);assert.deepEqual(f.items.map(i=>i.title),['first','second']);assert(f.items.every(i=>i.pool==='choice:distinct'));
});
test('mixed typed answers route score and probability without invented thresholds',()=>{
 const f=buildFlow(row({questions:{s:{type:'score'},n:{type:'noul'},c:{type:'choice',criteria:{a:null,b:null}}}},{answers:{s:{type:'score',score:0},n:{type:'noul',noul:.48},c:{type:'choice',choice:'a',probabilities:{a:.9,b:.1}}}}));
 assert.deepEqual(f.items.map(i=>i.type),['score','judgment','choice']);assert.equal(f.items[1].value,'成立概率 48%');assert(f.pools.some(p=>p.id==='choice:b'));assert.equal(f.types.length,4);
});
test('running has no inferred result and failures enter other lane',()=>{
 const pending=buildFlow(row({classes:[{id:'yes'},{id:'no'}]},null,'running'));assert.equal(pending.items.length,0);assert(pending.pools.some(p=>p.id==='choice:no'));
 const error=buildFlow({...row({},null,'error'),error:'network'});assert.equal(error.items[0].type,'other');assert.equal(error.items[0].pool,'other:error');
});
test('probability judgments split into yes and no without a hard verdict',()=>{
 const f=buildFlow(row({},{answers:{safe:{type:'noul',noul:.72}}}));
 assert.equal(f.items.length,1);assert.deepEqual(f.items[0].allocations.map(a=>a.pool),['judgment:true','judgment:false']);
 assert.equal(f.items[0].allocations[0].probability,.72);assert(Math.abs(f.items[0].allocations[1].probability-.28)<1e-10);
 assert.deepEqual(f.types.map(t=>t.name),['分类','打分','是非','其他']);
});
test('score uses a supplied scale and does not invent buckets',()=>{
 const f=buildFlow(row({},{answers:{quality:{type:'score',score:1.4,legend:{0:'low',1:'medium',2:'high'}}}}));
 assert.deepEqual(f.items[0].scale,{value:1.4,min:0,max:2});
 assert.equal(f.pools.filter(p=>p.type==='score').length,1);
 assert.match(f.items[0].value,/1.4.*0–2/);
});
test('candidate labels and descriptions come from each invocation, never business translations',()=>{
 const f=buildFlow(row({classes:[{id:'duplicate',name:'退款',description:'申请退回货款'},{id:'shipping',label:'物流'}]},{results:[{classification:'duplicate'}]}));
 assert.equal(f.pools.find(p=>p.id==='choice:duplicate').name,'退款');
 assert.equal(f.pools.find(p=>p.id==='choice:duplicate').description,'申请退回货款');
 assert.equal(f.pools.find(p=>p.id==='choice:shipping').name,'物流');
 assert.equal(buildFlow(row({classes:[{id:'duplicate'}]},{})).pools.find(p=>p.id==='choice:duplicate').name,'duplicate');
 const next=buildFlow(row({classes:[{id:'music',name:'音乐'}]},{}));
 assert(!next.pools.some(p=>p.id==='choice:duplicate'));
});
test('multiple questions with identical candidates remain separate',()=>{
 const input={questions:{color:{type:'choice',label:'颜色',criteria:{a:{label:'红色'},b:{label:'蓝色'}}},size:{type:'choice',label:'尺寸',criteria:{a:{label:'大'},b:{label:'小'}}}}};
 const f=buildFlow(row(input,{answers:{color:{choice:'a'},size:{choice:'a'}}}));
 assert.equal(f.pools.filter(p=>p.type==='choice').length,4);assert.notEqual(f.items[0].pool,f.items[1].pool);
 assert.deepEqual(f.items.map(i=>i.value),['红色','大']);
});
test('score dimension and explicit range available before and after return',()=>{
 const input={questions:{quality:{type:'score',name:'清晰度',min:0,max:10}}};
 const pending=buildFlow(row(input,null,'running'));assert.equal(pending.pools.find(p=>p.type==='score').name,'清晰度');
 const f=buildFlow(row(input,{answers:{quality:{score:8}}}));assert.equal(f.pools.filter(p=>p.type==='score').length,1);assert.deepEqual(f.items[0].scale,{value:8,min:0,max:10});
 const noScale=buildFlow(row({}, {score:8}));assert.equal(noScale.items[0].scale,undefined);
});
test('independent yes/no questions retain their own branches',()=>{
 const input={questions:{safe:{type:'noul',name:'安全性'},ready:{type:'noul',name:'就绪状态'}}};
 const f=buildFlow(row(input,{answers:{safe:{noul:.8},ready:{noul:.2}}}));
 assert.equal(f.pools.filter(p=>p.type==='judgment').length,4);assert.notEqual(f.items[0].allocations[0].pool,f.items[1].allocations[0].pool);
 assert.equal(buildFlow(row({},{})).pools.some(p=>p.id==='judgment:true'),false);
});

test('totals are scoped by meaning rather than candidate position or task input',async()=>{
 const {flowScope,addFlowCounts,emptyFlowCounts}=await import('../public/flow-model.mjs');
 const a={...row({purpose:'sort',classes:[{id:'a',description:'one'},{id:'b',description:'two'}],items:[{text:'first'}]},{results:[{classification:'a'}]}),id:'1',server:'jev'};
 const b={...a,id:'2',input:{...a.input,classes:[...a.input.classes].reverse(),items:[{text:'second'}]}};
 assert.equal(flowScope(a),flowScope(b));
 assert.notEqual(flowScope(a),flowScope({...b,input:{...b.input,classes:[{id:'a',description:'different meaning'}]}}));
 const totals=emptyFlowCounts();addFlowCounts(totals,a);addFlowCounts(totals,{...b,status:'running'});addFlowCounts(totals,{...b,status:'error'});
 assert.equal(totals.items,2);assert.equal(totals.pools['choice:a'],1);assert.equal(totals.pools['other:error'],1);
 addFlowCounts(totals,b);assert.equal(totals.items,3);assert.equal(totals.pools['choice:a'],2);
});
test('probabilities contribute one judgment, never two classifications',async()=>{
 const {addFlowCounts,emptyFlowCounts}=await import('../public/flow-model.mjs');const totals=emptyFlowCounts();
 addFlowCounts(totals,row({},{answers:{safe:{noul:.72}}}));
 assert.equal(totals.items,1);assert.equal(totals.types.judgment,1);assert.deepEqual(totals.pools,{});
});
