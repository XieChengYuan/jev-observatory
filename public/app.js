import {CallQueue} from './call-queue.mjs';
import {buildFlow,candidateName,inputValue,processingSummary} from './flow-model.mjs';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=v=>JSON.stringify(v,null,2), fmt=v=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const duration=v=>v==null?'—':v<1000?Math.round(v)+' ms':(v/1000).toFixed(2)+' s';
const time=v=>new Date(v).toLocaleTimeString('zh-CN',{hour12:false});
const statuses={running:'运行中',success:'成功',error:'失败',cancelled:'取消'};
let listening=true,listeningPending=false;
let displayMode='text',callQueue=null,streamRemaining=0;
let listPageSize=4;
let bootstrap,names={},selected=null,page=0,follow=true,busy=false,currentView='calls',lastDetail='',events;
function toast(m){$('toast').textContent=m;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4500);}
async function api(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json','X-Observatory-Token':bootstrap?.token||'',...options.headers}});const d=await r.json();if(!r.ok)throw Error(d.error||'请求失败');return d;}
function view(name){currentView=name;for(const id of ['calls','settings'])$('view-'+id).hidden=id!==name;document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===name));$('page-label').textContent=name==='calls'?'实时监控':'连接设置';if(name==='calls'){follow=true;page=0;refresh();}}
document.addEventListener('click',e=>{const n=e.target.closest('[data-view]');if(n)view(n.dataset.view);});
function status(data){
 listening=data.listening;
 const toggle=$('listening-toggle');
 toggle.disabled=listeningPending;
 toggle.textContent=listening?'停止监听':'开启监听';
 toggle.setAttribute('aria-checked',String(listening));
 toggle.title='控制所有已接入 MCP 的新调用记录；不影响工具执行。停止前已接收的调用仍会收齐结果。';
 if(!$('visual-input-pane')){
  $('pipeline-mode').textContent=listening?'实时监听':'监听已停止';
  $('pipeline-caption').textContent=listening?'等待新的 MCP 调用，流程会自动开始。':'已停止接收新调用记录。';
  $('pipeline-board').innerHTML=`<p class="pipeline-idle">${listening?'正在监听 MCP。收到调用后，输入与判断会自动出现在这里。':'监听已停止，点击右上角「开启监听」恢复接收。'}</p>`;
 }
 if(!selected)$('detail').innerHTML=`<div class="empty-detail"><div class="trace-mark">↳</div><h2>${listening?'正在监听 MCP 调用':'监听已停止'}</h2><p>${listening?'Agent 调用工具时，输入与输出会自动显示在这里。':'历史记录保留；停止期间的新调用不记录，也不会补录。'}</p></div>`;

 const servicesChanged=JSON.stringify(Object.keys(bootstrap.versions||{}))!==JSON.stringify(Object.keys(data.versions));
 bootstrap.versions=data.versions;names=Object.fromEntries(Object.entries(data.versions).map(([id,s])=>[id,s.name]));
 if(servicesChanged){const previous=$('settings-server').value;$('settings-server').innerHTML=Object.entries(data.versions).map(([id,s])=>`<option value="${esc(id)}">${esc(s.name)}</option>`).join('');if(data.versions[previous])$('settings-server').value=previous;settingsFields();}
 for(const [id,val] of Object.entries({total:data.summary.total,running:data.summary.running,success:data.summary.success,error:data.summary.error+data.summary.cancelled}))$('stat-'+id).textContent=val;
 $('nav-count').textContent=data.summary.total;$('stat-duration').textContent=duration(data.summary.averageMs);
 $('data-path').textContent=data.storage;$('config-path').textContent=data.configPath;
 $('server-status').innerHTML=Object.values(data.versions).map(s=>`<div class="server-status-row"><span>${esc(s.name)}</span><span class="badge ${s.configured?'success':'error'}">${s.configured?'已配置':'缺少凭据'}</span></div>`).join('');
 $('service-links').innerHTML=Object.entries(data.versions).map(([id,s])=>`<div class="service-link"><i class="server-dot"></i><span>${esc(s.name)}<small>${s.configured?'已接入 · 提供 '+s.tools+' 项功能':'未配置 · 不影响其他服务'}</small></span></div>`).join('');
 const t=data.telemetry;if(t){$('stat-rpm').textContent=fmt(t.requests);$('stat-input').textContent=fmt(t.input);$('stat-output').textContent=fmt(t.output);$('stat-tps').textContent=fmt(t.outputPerSecond);;}
}
function output(row){if(row.output?.structuredContent)return row.output.structuredContent;const a=(row.output?.content||[]).filter(c=>c.type==='text').map(c=>{try{return JSON.parse(c.text);}catch{return c.text;}});return a.length===1?a[0]:a;}
const labels={auto:'自动通过',review:'需要复核',classification:'分类结果',confidence:'置信度',margin:'概率差距',top_probability:'所选概率',decision:'处理建议',url:'来源链接',sourceUrl:'来源链接',sources:'来源',project:'项目',projectUrl:'项目链接',title:'标题',description:'说明',text:'内容',state:'当前状态',purpose:'任务目的',query:'查询',model:'模型',provider:'服务商',answers:'判断结果',choice:'选择',score:'评分',noul:'成立概率',results:'结果',items:'处理内容',classes:'分类标准',context:'背景',criteria:'判断标准',instructions:'判断要求',usage:'用量',input_tokens:'输入 tokens',output_tokens:'输出 tokens',passage_a:'内容 A',passage_b:'内容 B',a:'内容 A',b:'内容 B',incoming:'新内容',existing:'已有内容',error:'错误'};
const label=v=>labels[v]||String(v);
function decoded(v){if(typeof v==='string'&&/^\s*[\[{]/.test(v)){try{return JSON.parse(v);}catch{}}return v;}
function readable(v,depth=0){
 v=decoded(v);
 if(v===null||v===undefined)return '<span class="muted">未提供</span>';
 if(typeof v!=='object')return `<span class="readable-text">${esc(typeof v==='boolean'?(v?'是':'否'):v)}</span>`;
 if(Array.isArray(v)){if(!v.length)return '<span class="muted">无内容</span>';return `<ol class="readable-list">${v.map(x=>`<li>${readable(x,depth+1)}</li>`).join('')}</ol>`;}
 const content=`<dl class="readable-fields">${Object.entries(v).map(([k,x])=>`<div><dt>${esc(label(k))}</dt><dd>${readable(x,depth+1)}</dd></div>`).join('')}</dl>`;
 return depth>3?`<details><summary>展开 ${Object.keys(v).length} 项内容</summary>${content}</details>`:content;
}
function foldList(items,render){return items.map(render).join('');}
function inputView(input){
 if(!input||typeof input!=='object')return readable(input);
 const {purpose,items,classes,...rest}=input;
 let html=purpose?`<p class="task-purpose">${esc(purpose)}</p>`:'';
 if(Array.isArray(items))html+=`<div class="section-label">处理内容 · ${items.length} 项</div>`+foldList(items,(item,i)=>`<article class="input-item"><h4>内容 ${i+1}${item.id?` <small>${esc(item.id)}</small>`:''}</h4>${readable(item.text??item)}</article>`);
 if(Array.isArray(classes))html+=`<details class="criteria-list"><summary>判断标准 · ${classes.length} 类</summary>${classes.map(c=>`<div><strong>${esc(candidateName(input,c.id??c))}</strong><p>${esc(c.description)}</p></div>`).join('')}</details>`;
 const options={},content={};for(const [k,v] of Object.entries(rest)){if(['auto_accept','minimum_margin','review_at','top_k'].includes(k))options[k]=v;else content[k]=v;}
 if(Object.keys(content).length)html+=readable(content);
 if(Object.keys(options).length)html+=`<details class="criteria-list"><summary>判断阈值与选项</summary>${readable(options)}</details>`;
 return html||readable(input);
}
function resultName(result,input,index){
 const item=input?.items?.find(i=>i.id===result.id);
 if(item){const t=decoded(item.text);if(t?.a&&t?.b)return `${t.a.title||'内容 A'} ↔ ${t.b.title||'内容 B'}`;if(t?.incoming&&t?.existing)return `${t.incoming.title||'新内容'} ↔ ${t.existing.title||'已有内容'}`;if(t?.title)return t.title;if(typeof t==='string')return t;}
 return result.id||`结果 ${index+1}`;
}
function outputView(o,input){
 if(!o||!Array.isArray(o.results)||!o.results.every(r=>r&&r.classification!=null))return readable(o);
 const counts={};for(const r of o.results){const k=r.classification??'未提供分类';counts[k]=(counts[k]||0)+1;}
 return `<div class="result-overview"><strong>已返回 ${o.results.length} 项判断</strong><div class="result-counts">${Object.entries(counts).map(([k,v])=>`<span>${esc(candidateName(input,k))} <b>${v}</b></span>`).join('')}</div></div>`+foldList(o.results,(r,i)=>{
 const probs=r.probabilities&&typeof r.probabilities==='object'?Object.entries(r.probabilities).filter(([,p])=>Number.isFinite(p)&&p>=0&&p<=1).sort((a,b)=>b[1]-a[1]):[];
 return `<article class="judgment-item"><h4>${esc(resultName(r,input,i))}</h4><div class="verdict"><strong>${esc(candidateName(input,r.classification??'未提供分类',r.id))}</strong>${r.decision?`<span class="badge">${esc(label(r.decision))}</span>`:''}</div>${probs.map(([k,p])=>`<div class="probability"><span>${esc(candidateName(input,k))}</span><meter min="0" max="1" value="${p}" aria-label="${esc(candidateName(input,k))}概率">${fmt(p*100)}%</meter><b>${fmt(p*100)}%</b></div>`).join('')}${Number.isFinite(r.confidence)?`<p class="confidence-note">模型置信度 ${fmt(r.confidence*100)}%</p>`:''}</article>`;
 })+'<p class="footnote">概率与置信度来自模型返回，不代表结论已经核实。</p>';
}

function contentPane(name,value,html){
 if(name==='输入')return `<section class="content-pane input-scroll-pane"><h3>输入</h3><div class="content-window" tabindex="0" role="region" aria-label="输入内容，可上下滚动"><div class="formatted-content structured-input">${html}</div></div></section>`;
 return `<section class="content-pane" data-page="0"><h3>${name}</h3><div class="content-window"><div class="content-pages"><div class="formatted-content ${name==='输入'?'structured-input':''}">${html}</div></div></div><nav class="pagination" aria-label="${name}翻页"><button data-content-step="-1">上一页</button><span class="content-page-label">第 1 页</span><button data-content-step="1">下一页</button></nav></section>`;
}
function renderDetail(row){
 const o=output(row),u=row.usage;
 $('detail').innerHTML=`<div class="detail-head"><h2>${esc(row.tool)}</h2><span class="badge ${row.status}">${statuses[row.status]}</span></div><div class="detail-meta">${esc(names[row.server]||row.server)} · ${time(row.started)} · ${esc(row.source)}</div><div class="call-stats"><div><span>总耗时</span><strong>${duration(row.duration)}</strong></div><div><span>输入 tokens</span><strong>${fmt(u?.input_tokens)}</strong></div><div><span>输出 tokens</span><strong>${fmt(u?.output_tokens)}</strong></div></div><ol class="timeline">${row.stages.map(s=>`<li><span>${esc(s.label)}</span><time>${time(s.at)}</time></li>`).join('')}</ol><div class="io-panels">${contentPane('输入',row.input,inputView(row.input))}${contentPane('输出',row.output,row.output?outputView(o,row.input):`<p>${esc(row.error||'等待上游返回…')}</p>`)}</div>`;
 requestAnimationFrame(measureContentPages);
}
function measureContentPages(){
 document.querySelectorAll('.content-pane:not(.input-scroll-pane)').forEach(pane=>{
 const win=pane.querySelector('.content-window'),content=pane.querySelector('.content-pages'),width=win.clientWidth;if(!width||!win.clientHeight)return;
 content.style.columnWidth=width+'px';
 const total=Math.max(1,Math.ceil(content.scrollWidth/width));
 const page=Math.min(Number(pane.dataset.page)||0,total-1);pane.dataset.page=page;pane.dataset.total=total;
 content.style.transform=`translateX(${-page*width}px)`;
 const label=pane.querySelector('.content-page-label'),text=`第 ${page+1} / ${total} 页`;if(label.textContent!==text)label.textContent=text;
 pane.querySelector('[data-content-step="-1"]').disabled=page===0;pane.querySelector('[data-content-step="1"]').disabled=page===total-1;
 });
}
document.addEventListener('click',e=>{
 const step=e.target.closest('[data-content-step]');
 if(step){const pane=step.closest('.content-pane');pane.dataset.page=Math.max(0,Math.min(Number(pane.dataset.total)-1,Number(pane.dataset.page)+Number(step.dataset.contentStep)));measureContentPages();}
});
document.addEventListener('toggle',()=>requestAnimationFrame(measureContentPages),true);
window.addEventListener('resize',()=>requestAnimationFrame(measureContentPages));
setInterval(measureContentPages,1000);
async function refresh(){if(busy)return;busy=true;try{
 const [data,state]=await Promise.all([api(`/api/calls?limit=${listPageSize}&offset=${page*listPageSize}`),api('/api/status')]);if(bootstrap.uiVersion&&state.uiVersion!==bootstrap.uiVersion){location.reload();return;}status(state);
 const stream=await api('/api/call-stream?after='+callQueue.cursor);callQueue.ingest(stream.events);streamRemaining=stream.remaining;
 let liveRow=null;
 if(follow&&page===0){liveRow=callQueue.next();if(liveRow)selected=liveRow.id;else{const running=data.rows.find(r=>r.status==='running');if(running)selected=running.id;else if(!selected&&data.rows.length)selected=data.rows[0].id;}}
 $('follow-status').innerHTML=!listening?'监听已停止':follow?'● MCP 自动更新'+(callQueue.waiting+streamRemaining?' · '+(callQueue.waiting+streamRemaining)+' 次待展示':''):'查看历史 <button id="resume-follow">回到实时</button>';
 if($('resume-follow'))$('resume-follow').onclick=()=>{follow=true;page=0;refresh();};
 $('result-count').textContent=data.total;$('page-info').textContent=`第 ${page+1} 页 · 共 ${data.total} 条`;$('prev-page').disabled=page===0;$('next-page').disabled=(page+1)*listPageSize>=data.total;
 $('call-list').innerHTML=data.rows.map(row=>`<button class="call-row ${row.id===selected?'selected':''}" data-id="${esc(row.id)}"><div class="row-top"><i class="server-dot"></i><strong>${esc(row.tool)}</strong><span class="duration">${row.status==='running'?'等待返回':duration(row.duration)}</span></div><p class="row-preview">${esc(row.input?.purpose||JSON.stringify(row.input))}</p><div class="row-meta"><span class="badge ${row.status}">${statuses[row.status]}</span><span>${esc(names[row.server]||row.server)}</span><time>${time(row.started)}</time></div></button>`).join('')||`<div class="empty-list"><h2>${listening?'正在监听 MCP 调用':'监听已停止'}</h2><p>${listening?'Agent 调用已接入的 MCP 后，记录会自动出现。':'停止期间不记录新调用。'}</p></div>`;
 document.querySelectorAll('.call-row').forEach(b=>b.onclick=()=>{selected=b.dataset.id;follow=false;lastDetail='';refresh();});
 if(selected){const row=liveRow||data.rows.find(r=>r.id===selected)||await api('/api/calls/'+selected);const totals=await api('/api/flow-totals/'+encodeURIComponent(row.id));const key=JSON.stringify(row);if(key!==lastDetail){renderDetail(row);lastDetail=key;}updatePipeline({...row,flowTotals:totals},false,follow&&!!callQueue.active);}

 $('connection').textContent=listening?'自动监控已连接':'已连接 · 监听已停止';$('connection').classList.remove('offline');
 }catch(e){$('connection').textContent='连接中断，自动重试';$('connection').classList.add('offline');}finally{busy=false;}}
function settingsFields(){const s=bootstrap.versions[$('settings-server').value];$('secret-name').innerHTML=(s?.secretEnv||[]).map(n=>`<option>${esc(n)}</option>`).join('');$('key-form').hidden=!s?.secretEnv?.length;$('key-status').textContent=!s?'尚未接入服务':s.configured?'凭据已配置。正常观察调用无需操作这里。':'待配置：'+s.missing.join(', ');$('api-key').value='';$('discover-server').disabled=!s;}
$('settings-server').onchange=settingsFields;
$('discover-server').onclick=async()=>{try{$('discover-server').disabled=true;const r=await api('/api/discover',{method:'POST',body:JSON.stringify({server:$('settings-server').value})});$('discover-message').textContent=`已发现 ${r.count} 个工具`;await refresh();}catch(e){$('discover-message').textContent=e.message;}finally{$('discover-server').disabled=false;}};
$('key-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/api/settings',{method:'POST',body:JSON.stringify({server:$('settings-server').value,name:$('secret-name').value,value:$('api-key').value})});$('api-key').value='';await refresh();settingsFields();$('key-message').textContent='已保存，下一次 MCP 调用自动使用。';}catch(e){$('key-message').textContent=e.message;}finally{b.disabled=false;}};
$('prev-page').onclick=()=>{page--;follow=false;refresh();};$('next-page').onclick=()=>{page++;follow=false;refresh();};$('export').onclick=()=>{location.href='/api/export';};
$('listening-toggle').onclick=async()=>{
 if(listeningPending)return;
 listeningPending=true;$('listening-toggle').disabled=true;
 try{
  const state=await api('/api/listening',{method:'POST',body:JSON.stringify({enabled:!listening})});
  status(state);
  toast(state.listening?'已开启监听，从新的 MCP 调用开始记录。':'已停止监听。新调用不再记录，已接收的调用会收齐结果。');
 }catch(e){toast(e.message);}
 finally{listeningPending=false;$('listening-toggle').disabled=false;refresh();}
};
async function init(){try{bootstrap=await api('/api/bootstrap');let cursor=bootstrap.streamHead;try{const saved=localStorage.getItem('jev-mcp-display-cursor');if(saved!==null&&Number.isSafeInteger(Number(saved))&&Number(saved)>=0&&Number(saved)<=cursor)cursor=Number(saved);}catch{}callQueue=new CallQueue(cursor);try{localStorage.setItem('jev-mcp-display-cursor',String(cursor));}catch{}status(bootstrap);$('settings-server').innerHTML=Object.entries(bootstrap.versions).map(([id,s])=>`<option value="${esc(id)}">${esc(s.name)}</option>`).join('');settingsFields();if(location.hash.startsWith('#call=')){selected=decodeURIComponent(location.hash.slice(6));follow=false;}await refresh();events=new EventSource('/api/events');events.onmessage=()=>refresh();events.onerror=()=>{$('connection').textContent='连接中断，自动重试';};setInterval(refresh,2000);}catch(e){toast(e.message);setTimeout(init,2000);}}
init();

let pipelineRow=null,pipelineSignature='',pipelineTimer=null,pipelinePaused=false,pipelineModel=null,pipelineIndex=0,pipelineType='choice',poolPage=0,poolPageSize=4,pipelineQueued=false;
const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
function stopPipeline(){clearTimeout(pipelineTimer);pipelineTimer=null;}
function shortText(v,n=24){const a=Array.from(String(v??''));return a.length>n?a.slice(0,n-1).join('')+'…':a.join('');}
function pipelineTotals(){const t=pipelineRow.flowTotals;$('pipeline-totals').textContent=`已完成 ${fmt(t?.global.calls)} 次 MCP 调用　/　相同判断规则 ${fmt(t?.scope.calls)} 次　/　${callQueue.waiting+streamRemaining} 次等待展示`;}
function pipelineItem(){return pipelineModel.items[Math.min(pipelineIndex,Math.max(0,pipelineModel.items.length-1))];}
function poolRows(){
 if(!pipelineModel||!$('decision-options'))return;
 const item=pipelineItem(),all=pipelineModel.pools.filter(p=>p.type===pipelineType&&!p.id.endsWith(':empty'));
 const totalPages=Math.max(1,Math.ceil(all.length/poolPageSize));poolPage=Math.min(poolPage,totalPages-1);
 $('decision-types').innerHTML=pipelineModel.types.map(t=>`<button data-flow-type="${t.id}" aria-pressed="${pipelineType===t.id}">${t.name}<span>${pipelineModel.items.filter(i=>i.type===t.id).length}</span></button>`).join('');
 $('candidate-origin').textContent=`本次调用候选 · ${all.length} 项 · 名称来自 MCP 参数与返回`;
 $('decision-options').innerHTML=all.length?all.slice(poolPage*poolPageSize,(poolPage+1)*poolPageSize).map(p=>{
 const hit=item?.pool===p.id&&!item?.allocations,prob=item?.probabilities?.[p.id]??item?.allocations?.find(a=>a.pool===p.id)?.probability;
 const scale=item?.pool===p.id?item.scale:null;
 const ratio=Number.isFinite(prob)?prob:scale?Math.max(0,Math.min(1,(scale.value-scale.min)/(scale.max-scale.min))):null;
 const count=pipelineModel.items.filter(i=>i.pool===p.id&&!i.allocations).length,cumulative=pipelineRow.flowTotals?.scope.pools[p.id]||0;
 const value=Number.isFinite(prob)?fmt(prob*100)+'%':scale?fmt(scale.value):hit&&item.type==='score'?item.value:hit?'已返回':'—';
 return `<article class="option-row ${hit?'chosen':''}"><div class="option-name" title="${esc(p.name+(p.description?'：'+p.description:''))}">${esc(p.name)}${hit?'<span class="hit-marker">← 返回选择</span>':''}</div><div class="option-evidence">${ratio!==null?`<meter min="0" max="1" value="${ratio}" aria-label="${esc(p.name)}${Number.isFinite(prob)?'概率':'评分位置'}">${esc(value)}</meter>`:'<span class="no-probability">未提供概率</span>'}<strong>${esc(value)}</strong></div><div class="option-count">${item?.allocations?.some(a=>a.pool===p.id)?'概率分支，不作次数累加':`本次 ${count} · 同规则累计 ${fmt(cumulative)}`}</div></article>`;
 }).join(''):`<div class="type-empty">本次调用没有${esc(pipelineModel.types.find(t=>t.id===pipelineType)?.name)}结果。<small>有对应问题或返回时，这里会自动出现。</small></div>`;
 $('pool-page-info').textContent=`${poolPage+1} / ${totalPages}`;$('pool-prev').disabled=poolPage===0;$('pool-next').disabled=poolPage>=totalPages-1;
 $('pool-pagination').hidden=totalPages===1;
}
function fitPoolRows(){
 const options=$('decision-options');if(!options||!options.clientHeight)return;
 const pager=$('pool-pagination'),rowHeight=parseFloat(getComputedStyle(options).getPropertyValue('--option-height'))||94;
 const available=options.clientHeight+(pager.hidden?0:pager.offsetHeight);
 const count=pipelineModel.pools.filter(p=>p.type===pipelineType&&!p.id.endsWith(':empty')).length;
 const size=Math.max(1,Math.floor((available-(count*rowHeight>available?42:0))/rowHeight));
 if(size!==poolPageSize){poolPageSize=size;poolRows();}
}
function showPipelineItem(finished=false){
 const row=pipelineRow,model=pipelineModel,item=pipelineItem(),running=row.status==='running';
 const input=inputValue(row,running?row.input?.items?.[0]?.id:item?.id);
 $('flow-input-status').textContent=running?'正在处理':finished?'最近输入 · 已完成':`展示 ${Math.min(pipelineIndex+1,model.items.length)} / ${model.items.length}`;
 $('visual-input-content').innerHTML=readable(input);
 $('visual-input-pane').querySelector('.content-window').scrollTop=0;
 $('decision-verdict').textContent=running?'等待 MCP 返回':item?.value||'未提供返回';
 const pools=item?(item.allocations||[{pool:item.pool}]).map(a=>model.pools.find(p=>p.id===a.pool)?.name||a.pool):[];
 $('decision-destination').textContent=running?'结果池将在返回后标明':item?.allocations?'概率分布 → '+pools.join(' / '):'返回结果池 → '+pools.join(' / ');
 $('decision-stage').textContent=row.stages.at(-1)?.label||'已记录';
 $('decision-stages').innerHTML=row.stages.map(s=>`<span title="${esc(s.label)}">${esc(s.label)}<time>${time(s.at)}</time></span>`).join('');
 if(item){pipelineType=item.type;poolPage=0;const pools=model.pools.filter(p=>p.type===item.type&&!p.id.endsWith(':empty'));const index=pools.findIndex(p=>p.id===item.pool);if(index>=0)poolPage=Math.floor(index/poolPageSize);}
 poolRows();requestAnimationFrame(()=>{fitPoolRows();measureContentPages();});
 $('decision-bridge').classList.toggle('flowing',running||(!finished&&!reduceMotion.matches));
 $('pipeline-progress').textContent=running?'输入已由 MCP 提交，等待真实返回。':finished?`本次返回 ${model.items.length} 项判断。结果池表示 MCP 返回归类，不代表外部业务已执行。`:`按记录展示第 ${pipelineIndex+1} / ${model.items.length} 项判断 · 展示节奏不代表模型耗时。`;
}
function completePresentation(){stopPipeline();showPipelineItem(true);$('pipeline-pause').hidden=true;if(pipelineQueued&&callQueue.complete(pipelineRow.id)){try{localStorage.setItem('jev-mcp-display-cursor',String(callQueue.ack));}catch{}}}
function advancePipeline(){if(pipelinePaused)return;pipelineIndex++;if(pipelineIndex>=pipelineModel.items.length){completePresentation();return;}showPipelineItem();schedulePipeline();}
function schedulePipeline(){stopPipeline();pipelineTimer=setTimeout(advancePipeline,Math.max(160,Math.min(1100,4800/Math.max(1,pipelineModel.items.length))));}
function updatePipeline(row,replay=false,queued=false){
 const sig=JSON.stringify([row.id,row.status,row.stages,row.output,queued]);
 if(!replay&&sig===pipelineSignature){pipelineRow=row;pipelineTotals();poolRows();return;}
 stopPipeline();pipelineSignature=sig;pipelineRow=row;pipelineModel=buildFlow(row);pipelineIndex=0;pipelinePaused=false;pipelineQueued=queued;
 const running=row.status==='running';
 $('pipeline-caption').textContent=shortText(row.input?.purpose||processingSummary(row),120);$('pipeline-caption').title=processingSummary(row);
 $('pipeline-mode').textContent=running?'实时接收':replay?'历史记录回放':'MCP 原始返回';
 $('pipeline-replay').hidden=running;$('pipeline-pause').hidden=running||(!queued&&!replay)||reduceMotion.matches;$('pipeline-pause').textContent='暂停展示';
 pipelineTotals();
 $('pipeline-board').innerHTML=`<section class="input-station"><header class="station-head"><span><b>01</b> 输入</span><small id="flow-input-status"></small></header><section id="visual-input-pane" class="content-pane input-scroll-pane"><div class="content-window" tabindex="0" role="region" aria-label="输入内容，可上下滚动"><div id="visual-input-content" class="formatted-content structured-input"></div></div></section><footer class="input-source"><span>调用来源</span><strong>${esc(names[row.server]||row.server)}</strong><small>${time(row.started)} · ${esc(row.id.slice(0,8))}</small></footer></section><div id="decision-bridge" class="decision-bridge" aria-hidden="true"><span></span><i></i></div><section class="decision-station"><header class="station-head"><span><b>02</b> Jev <small>判断与返回</small></span><strong class="decision-duration">${duration(row.duration)}</strong></header><div class="decision-context"><strong>${esc(row.tool)}</strong><span id="decision-stage"></span></div><div id="decision-types" class="decision-types" role="group" aria-label="返回类型"></div><div class="options-heading"><span id="candidate-origin"></span><span>返回概率 / 分值</span></div><div id="decision-options" class="decision-options"></div><nav id="pool-pagination" class="pagination" aria-label="候选结果翻页"><button id="pool-prev">上一页</button><span id="pool-page-info"></span><button id="pool-next">下一页</button></nav><footer class="decision-result"><span>实际返回</span><strong id="decision-verdict"></strong><p id="decision-destination"></p></footer></section><div id="decision-stages" class="decision-stages" aria-label="MCP 可观察阶段"></div>`;
 $('decision-types').onclick=e=>{const b=e.target.closest('[data-flow-type]');if(b){pipelineType=b.dataset.flowType;poolPage=0;poolRows();}};
 $('pool-prev').onclick=()=>{poolPage--;poolRows();};$('pool-next').onclick=()=>{poolPage++;poolRows();};
 $('pipeline-pause').onclick=()=>{pipelinePaused=!pipelinePaused;$('pipeline-pause').textContent=pipelinePaused?'继续展示':'暂停展示';if(pipelinePaused)stopPipeline();else schedulePipeline();};
 if(running){showPipelineItem();return;}
 if(reduceMotion.matches||(!queued&&!replay)){pipelineIndex=Math.max(0,pipelineModel.items.length-1);completePresentation();}else{showPipelineItem();schedulePipeline();}
}
$('pipeline-replay').onclick=()=>{if(pipelineRow)updatePipeline(pipelineRow,true);};
reduceMotion.addEventListener('change',()=>{if(reduceMotion.matches&&pipelineRow&&pipelineRow.status!=='running')completePresentation();});
new ResizeObserver(()=>fitPoolRows()).observe($('pipeline-board'));

function setDisplayMode(mode){
 displayMode=mode;
 $('visual-panel').hidden=mode!=='visual';$('text-panel').hidden=mode!=='text';
 $('mode-visual').setAttribute('aria-pressed',String(mode==='visual'));$('mode-text').setAttribute('aria-pressed',String(mode==='text'));
 try{localStorage.setItem('jev-board-view',mode);}catch{}
}
$('mode-visual').onclick=()=>setDisplayMode('visual');$('mode-text').onclick=()=>setDisplayMode('text');
let savedMode;try{savedMode=localStorage.getItem('jev-board-view');}catch{}
setDisplayMode(savedMode==='visual'?'visual':'text');

function fitCallList(){const panel=document.querySelector('.list-panel');if(!panel||!panel.clientHeight)return;const size=Math.max(1,Math.floor((panel.clientHeight-95)/100));if(size!==listPageSize){listPageSize=size;page=0;refresh();}}
new ResizeObserver(()=>{fitCallList();measureContentPages();}).observe($('text-panel'));
