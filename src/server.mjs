import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { ROOT, DATA, PORT, CONFIG, SERVERS, serverEnvironment, saveSecret, catalog, redact, reloadServers } from './config.mjs';
import { listCalls, getCall, summary, recoverCalls, telemetry, flowTotals, callStream, streamHead, listeningEnabled, setListening } from './store.mjs';
import { runTool, discoverServer } from './runner.mjs';
import { storageIdentity } from './daemon.mjs';
import { atomicWrite } from './integrations.mjs';

const uiVersion=createHash('sha256').update(['index.html','app.js','flow-model.mjs','call-queue.mjs','style.css'].map(f=>readFileSync(resolve(ROOT,'public',f),'utf8')).join('')).digest('hex').slice(0,12);
const csrf = randomBytes(32).toString('hex');
const active = new Map();
const clients = new Set();
const allowedHosts = new Set(['127.0.0.1:' + PORT, 'localhost:' + PORT]);
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 512000) throw new Error('请求内容超过 500 KB'); }
  return JSON.parse(data || '{}');
}
function status() {
  const versions = Object.fromEntries(Object.entries(SERVERS).map(([id,s]) => {
    const {missing}=serverEnvironment(id), count=catalog(id).tools.length;
    return [id,{name:s.name,version:s.version || '',configured:missing.length===0,missing,secretEnv:s.secretEnv,tools:count,discovered:count>0}];
  }));
  return { uiVersion, listening:listeningEnabled(), streamHead:streamHead(), configured:Object.values(versions).every(s=>s.configured), storage:DATA, configPath:CONFIG, versions, summary:summary(), telemetry:telemetry() };
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (!allowedHosts.has(req.headers.host)) return json(res, 403, { error: '仅允许本机地址访问' });
  if (req.headers.origin && ![...allowedHosts].some(h => req.headers.origin === 'http://' + h)) return json(res, 403, { error: '来源不允许' });
  if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: '跨站请求不允许' });
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-observatory-token'] !== csrf) return json(res, 403, { error: '请刷新看板后重试' });
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
  try {
    reloadServers();
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { application: 'jev-observatory', storageId: storageIdentity(DATA), instance: process.env.MCP_OBSERVATORY_INSTANCE || null });
    if (req.method === 'GET' && url.pathname === '/api/bootstrap') return json(res, 200, { ...status(), token: csrf, catalogs: Object.fromEntries(Object.keys(SERVERS).map(id => [id, catalog(id).tools])) });
    if(req.method==='GET'&&url.pathname==='/api/call-stream')return json(res,200,callStream(url.searchParams.get('after')));
    if(req.method==='GET'&&url.pathname.startsWith('/api/flow-totals/')){const totals=flowTotals(url.pathname.split('/').at(-1));return json(res,totals?200:404,totals||{error:'记录不存在'});}
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, status());
    if (req.method === 'GET' && url.pathname === '/api/calls') return json(res, 200, listCalls(Object.fromEntries(url.searchParams)));
    if (req.method === 'GET' && url.pathname.startsWith('/api/calls/')) { const row = getCall(url.pathname.split('/').at(-1)); return json(res, row ? 200 : 404, row || { error: '记录不存在' }); }
    if (req.method === 'GET' && url.pathname === '/api/export') {
      const rows = listCalls({ ...Object.fromEntries(url.searchParams), limit: 500 }).rows;
      res.setHeader('Content-Disposition', 'attachment; filename="mcp-calls.json"');
      return json(res, 200, { exportedAt: new Date().toISOString(), scope: '最近最多 500 条符合筛选的调用', calls: rows });
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/listening') {
      const {enabled}=await body(req);
      if(typeof enabled!=='boolean')return json(res,400,{error:'请提供有效的监听开关状态'});
      setListening(enabled);
      for(const client of clients)client.write('data: tick\n\n');
      return json(res,200,status());
    }
    if (req.method === 'POST' && url.pathname === '/api/settings') {
      const data = await body(req);
      if (!SERVERS[data.server]?.secretEnv.includes(data.name) || typeof data.value !== 'string' || !data.value.trim() || data.value.length>8192) return json(res,400,{error:'请选择服务声明的凭据字段并填写有效值。'});
      saveSecret(data.server,data.name,data.value.trim());
      return json(res,200,{saved:true});
    }
    if (req.method === 'POST' && url.pathname === '/api/discover') {
      const {server:id}=await body(req);
      if (!SERVERS[id]) return json(res,400,{error:'未知服务'});
      try { const manifest=await discoverServer(id); return json(res,200,{count:manifest.tools.length}); }
      catch(e) { return json(res,400,{error:redact(e.message,serverEnvironment(id).secrets)}); }
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const data = await body(req);
      if (!SERVERS[data.server] || !catalog(data.server).tools.some(t => t.name === data.tool)) return json(res, 400, { error: '请选择有效工具' });
      if (!data.args || typeof data.args !== 'object' || Array.isArray(data.args)) return json(res, 400, { error: '参数必须是 JSON 对象' });
      if (active.size >= 4) return json(res, 429, { error: '最多同时运行 4 个看板任务，请稍后再试。' });
      const controller = new AbortController();
      let callId, activeKey;
      const pending = runTool({ server: data.server, tool: data.tool, args: data.args, source: 'dashboard', signal: controller.signal, onStart(id) { callId = id; activeKey = id ?? Symbol('unrecorded'); active.set(activeKey, controller); } });
      pending.catch(() => {}).finally(() => active.delete(activeKey));
      return json(res, 202, { id: callId });
    }
    if (req.method === 'POST' && url.pathname === '/api/cancel') {
      const { id } = await body(req), controller = active.get(id);
      if (!controller) return json(res, 409, { error: '调用已结束，或由 MCP 客户端发起；请在原客户端中取消。' });
      controller.abort(); return json(res, 200, { cancelled: true });
    }
    const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js','text/javascript'], '/flow-model.mjs':['flow-model.mjs','text/javascript'], '/call-queue.mjs':['call-queue.mjs','text/javascript'], '/style.css': ['style.css','text/css'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
    if (req.method === 'GET' && files[url.pathname]) {
      const [file,type] = files[url.pathname];
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(readFileSync(resolve(ROOT, 'public', file)));
    }
    return json(res, 404, { error: '页面不存在' });
  } catch (e) { return json(res, 400, { error: e instanceof SyntaxError ? 'JSON 格式无效' : e.message }); }
});
recoverCalls();
const ticker = setInterval(() => { recoverCalls(); for (const client of clients) client.write('data: tick\n\n'); }, 1000);
server.listen(PORT, '127.0.0.1', () => {
  if (process.env.MCP_OBSERVATORY_INSTANCE) atomicWrite(resolve(DATA,`dashboard-${PORT}.json`),JSON.stringify({pid:process.pid,instance:process.env.MCP_OBSERVATORY_INSTANCE}));
  console.log('Jev活动看板 http://127.0.0.1:' + PORT);
});
async function shutdown() {
  clearInterval(ticker); for (const c of active.values()) c.abort(); for (const c of clients) c.end();
  server.close(); setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
