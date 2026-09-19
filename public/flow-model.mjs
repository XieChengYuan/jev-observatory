export const FLOW_TYPES=[{id:'choice',name:'分类'},{id:'score',name:'打分'},{id:'judgment',name:'是非'},{id:'other',name:'其他'}];
const display=(value,fallback)=>typeof value==='string'&&value.trim()?value:String(fallback??'');
function decode(v){if(typeof v==='string'){try{return JSON.parse(v);}catch{}}return v;}
export function parseOutput(row){if(row.output?.structuredContent)return row.output.structuredContent;const parts=(row.output?.content||[]).filter(c=>c.type==='text').map(c=>decode(c.text));return parts.length===1?parts[0]:parts;}
export function candidates(input={},questionId){
 const q=input.questions?.[questionId];
 if(q?.type==='choice')return Object.entries(q.criteria||{}).map(([id,v])=>({id,name:display(v?.label||v?.name||v?.title,id),description:display(v?.description,typeof v==='string'?v:'')}));
 return (Array.isArray(input.classes)?input.classes:[]).map(c=>typeof c==='string'?{id:c,name:c,description:''}:{id:String(c.id??c.value??''),name:display(c.label||c.name||c.title,c.id??c.value),description:display(c.description,'')}).filter(c=>c.id);
}
export function candidateName(input,key,questionId){return candidates(input,questionId).find(c=>c.id===String(key))?.name??String(key);}
export function describeValue(value){
 value=decode(value);
 if(value==null)return '未提供';
 if(typeof value==='boolean')return value?'是':'否';
 if(typeof value!=='object')return String(value);
 if(Array.isArray(value))return value.map(describeValue).join('；');
 return Object.entries(value).map(([key,v])=>key+'：'+describeValue(v)).join('；');
}
export function inputValue(row,id){
 const input=row.input||{},item=input.items?.find(i=>String(i.id)===String(id));
 return decode(item?.text??item??input.state??input.text??input.query??input.items??input);
}
export function inputSummary(row,id){return describeValue(inputValue(row,id));}
export function processingSummary(row){
 const questions=Object.entries(row.input?.questions||{}).map(([id,q])=>`${q.name||q.label||id}：${q.instructions?describeValue(q.instructions):q.type||'判断'}`);
 return [row.tool,row.input?.purpose,...questions].filter(Boolean).join(' · ');
}
function itemTitle(row,id){return inputSummary(row,id);}

export function buildFlow(row){
 const input=row.input||{},questions=input.questions||{},pools=new Map(),items=[];
 const questionName=id=>display(questions[id]?.label||questions[id]?.name||questions[id]?.title,id);
 const scoped=type=>Object.values(questions).filter(q=>type==='judgment'?['noul','boolean'].includes(q.type):q.type===type).length>1;
 const keyFor=(type,key,qid)=>qid&&scoped(type)?JSON.stringify([qid,String(key)]):String(key);
 const addPool=(type,key,name,description='')=>{const id=type+':'+key;if(!pools.has(id))pools.set(id,{id,type,name:display(name,key),description});return id;};
 function choicePool(key,qid){const c=candidates(input,qid).find(c=>c.id===String(key));const name=c?.name??String(key);return addPool('choice',keyFor('choice',key,qid),qid&&scoped('choice')?questionName(qid)+' · '+name:name,c?.description||'');}
 function judgmentPool(key,qid){const name=key==='true'?'是':key==='false'?'否':String(key);return addPool('judgment',keyFor('judgment',key,qid),qid?questionName(qid)+' · '+name:name,display(questions[qid]?.instructions,''));}
 const scorePool=id=>addPool('score',id,questions[id]?questionName(id):id==='score'?'分值':id,display(questions[id]?.instructions,''));
 candidates(input).forEach(c=>choicePool(c.id));
 for(const [id,q] of Object.entries(questions)){
  if(q.type==='choice')candidates(input,id).forEach(c=>choicePool(c.id,id));
  if(q.type==='score')scorePool(id);
  if(['noul','boolean'].includes(q.type))['true','false'].forEach(k=>judgmentPool(k,id));
 }
 const push=(type,pool,value,id)=>{items.push({id:String(id||items.length),title:itemTitle(row,id),type,pool,value});return items.at(-1);};
 function visit(v,id=''){
  if(!v||typeof v!=='object')return;
  if(Array.isArray(v)){v.forEach((x,i)=>visit(x,x?.id??String(i+1)));return;}
  const resultId=String(v.id??id),qid=questions[resultId]?resultId:undefined,q=questions[qid]||{};
  if(Number.isFinite(v.score)){
   const key=resultId||'score',item=push('score',scorePool(key),`分值 ${v.score}`,resultId),legend=v.legend??q.legend;
   const levels=Array.isArray(legend)?legend.filter(Number.isFinite):legend&&typeof legend==='object'?Object.keys(legend).filter(k=>k.trim()!==''&&Number.isFinite(Number(k))).map(Number):[];
   const min=v.min??q.min??q.range?.min??(levels.length>1?Math.min(...levels):undefined),max=v.max??q.max??q.range?.max??(levels.length>1?Math.max(...levels):undefined);
   if(Number.isFinite(min)&&Number.isFinite(max)&&max>min){item.scale={value:v.score,min,max};item.value+=` / 标准 ${min}–${max}`;}return;
  }
  if(Number.isFinite(v.noul)||v.type==='boolean'&&Number.isFinite(v.probability)){
   const p=v.noul??v.probability;if(p<0||p>1)return;
   const yes=judgmentPool('true',qid),no=judgmentPool('false',qid),item=push('judgment',yes,`成立概率 ${Math.round(p*10000)/100}%`,resultId);
   item.allocations=[{pool:yes,probability:p,value:'是 · '+Math.round(p*10000)/100+'%'},{pool:no,probability:1-p,value:'否 · '+Math.round((1-p)*10000)/100+'%（补概率）'}];return;
  }
  if(typeof v.value==='boolean'&&(v.type==='boolean'||q.type==='boolean')){['true','false'].forEach(k=>judgmentPool(k,qid));push('judgment',judgmentPool(String(v.value),qid),v.value?'是':'否',resultId);return;}
  if(v.classification!=null||v.choice!=null){
   Object.keys(v.probabilities||{}).forEach(k=>choicePool(k,qid));const key=v.classification??v.choice,p=v.probabilities?.[key];
   const item=push('choice',choicePool(key,qid),candidateName(input,key,qid)+(Number.isFinite(p)?` · ${Math.round(p*10000)/100}%`:'')+(v.decision==='review'?' · 待复核':''),resultId);item.probabilities=Object.fromEntries(Object.entries(v.probabilities||{}).filter(([,p])=>Number.isFinite(p)&&p>=0&&p<=1).map(([key,p])=>[choicePool(key,qid),p]));return;
  }
  if(v.verdict!=null){Object.keys(v.probabilities||{}).forEach(k=>judgmentPool(k,qid));push('judgment',judgmentPool(String(v.verdict),qid),String(v.verdict),resultId);return;}
  for(const [k,x] of Object.entries(v)){if(['usage','summary','probabilities','thresholds','legend','metadata'].includes(k))continue;visit(x,k);}
 }
 if(row.status==='error'||row.status==='cancelled')push('other',addPool('other',row.status,row.status==='error'?'调用失败':'已取消'),row.error||'调用结束',row.tool);
 else if(row.status!=='running'){visit(parseOutput(row));if(!items.length)push('other',addPool('other','result','一般返回'),describeValue(parseOutput(row)),row.tool);}
 // Empty lanes describe absence, never invent task candidates or thresholds.
 for(const t of FLOW_TYPES)if(![...pools.values()].some(p=>p.type===t.id))addPool(t.id,'empty','本次无'+t.name);
 return {types:FLOW_TYPES,pools:[...pools.values()],items};
}

// Counts belong to a decision definition, never to a node's screen position.
export function flowScope(row){
 const input=row.input||{};
 const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
 const classes=candidates(input).sort((a,b)=>a.id.localeCompare(b.id));
 const questions=input.questions||{};
 return JSON.stringify(stable({server:row.server,tool:row.tool,classes,questions,purpose:input.purpose||'',isolated:classes.length||Object.keys(questions).length?null:row.id}));
}
export function addFlowCounts(target,row){
 if(row.status==='running')return;
 const model=buildFlow(row);target.calls++;target.items+=model.items.length;
 for(const item of model.items){target.types[item.type]=(target.types[item.type]||0)+1;
  // Probability branches are not two classified items, and percentages are not counts.
  if(item.allocations)continue;
  target.pools[item.pool]=(target.pools[item.pool]||0)+1;
 }
}
export const emptyFlowCounts=()=>({calls:0,items:0,types:{},pools:{}});
