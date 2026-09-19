import {flowScope,addFlowCounts,emptyFlowCounts} from '../public/flow-model.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DATA, redact } from './config.mjs';

const db = new DatabaseSync(resolve(DATA, 'calls.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS calls (
 id TEXT PRIMARY KEY, server TEXT NOT NULL, tool TEXT NOT NULL, source TEXT NOT NULL,
 started TEXT NOT NULL, ended TEXT, status TEXT NOT NULL, duration REAL,
 input TEXT NOT NULL, output TEXT, error TEXT, stages TEXT NOT NULL, usage TEXT, pid INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observer_settings (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));
INSERT OR IGNORE INTO observer_settings(id,enabled) VALUES(1,1);`);
function decode(row) {
  if (!row) return null;
  for (const key of ['input','output','stages','usage']) if (row[key]) row[key] = JSON.parse(row[key]);
  return row;
}
export function listeningEnabled() { return db.prepare('SELECT enabled FROM observer_settings WHERE id=1').get().enabled === 1; }
export function setListening(enabled) {
  if(typeof enabled !== 'boolean') throw new Error('监听状态必须为布尔值');
  db.prepare('UPDATE observer_settings SET enabled=? WHERE id=1').run(Number(enabled));
  return listeningEnabled();
}
export function startCall(server, tool, source, input, secrets = []) {
  const id = randomUUID(), now = new Date().toISOString();
  const recorded = db.prepare('INSERT INTO calls (id,server,tool,source,started,status,input,stages,pid) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT enabled FROM observer_settings WHERE id=1)=1 RETURNING id')
    .get(id, server, tool, source, now, 'running', JSON.stringify(redact(input, secrets)), JSON.stringify([{ label: '已接收调用', at: now }]), process.pid);
  return recorded?.id ?? null;
}
export function stage(id, label) {
  const row = getCall(id);
  if (!row) return;
  row.stages.push({ label, at: new Date().toISOString() });
  db.prepare('UPDATE calls SET stages=? WHERE id=?').run(JSON.stringify(row.stages), id);
}
export function finishCall(id, { output = null, error = null, status = 'success', usage = null }, secrets = []) {
  const row = getCall(id);
  if (!row || row.status !== 'running') return;
  const now = new Date().toISOString();
  row.stages.push({ label: status === 'success' ? '已返回结果' : status === 'cancelled' ? '调用已取消' : '调用失败', at: now });
  db.prepare('UPDATE calls SET ended=?,status=?,duration=?,output=?,error=?,stages=?,usage=? WHERE id=?')
    .run(now, status, Date.now() - Date.parse(row.started), JSON.stringify(redact(output, secrets)), error ? redact(error, secrets) : null, JSON.stringify(row.stages), JSON.stringify(redact(usage, secrets)), id);
}
export function getCall(id) { return decode(db.prepare('SELECT * FROM calls WHERE id=?').get(id)); }
export function listCalls({ server = '', status = '', q = '', limit = 150, offset = 0 } = {}) {
  const conditions = [], args = [];
  if (server) { conditions.push('server=?'); args.push(server); }
  if (status) { conditions.push('status=?'); args.push(status); }
  if (q) { conditions.push('(tool LIKE ? OR input LIKE ?)'); args.push('%' + q + '%', '%' + q + '%'); }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const total = db.prepare('SELECT count(*) AS n FROM calls' + where).get(...args).n;
  const rows = db.prepare('SELECT * FROM calls' + where + ' ORDER BY started DESC LIMIT ? OFFSET ?').all(...args, Math.min(Math.max(Number(limit)||150,1),500), Math.max(Number(offset)||0,0)).map(decode);
  return { rows, total };
}
export function summary() {
  const rows = db.prepare('SELECT status,count(*) AS count,avg(duration) AS duration FROM calls GROUP BY status').all();
  const result = { total: 0, success: 0, error: 0, running: 0, cancelled: 0 };
  for (const row of rows) { result.total += row.count; result[row.status] = row.count; }
  result.averageMs = db.prepare("SELECT avg(duration) AS value FROM calls WHERE status='success'").get().value;
  return result;
}
export function recoverCalls() {
  for (const row of db.prepare("SELECT id,pid FROM calls WHERE status='running'").all()) {
    try { process.kill(row.pid, 0); }
    catch (e) { if (e.code === 'ESRCH') finishCall(row.id, { status: 'error', error: '调用进程已退出，未收到完整结果。' }); }
  }
}

export function telemetry(now=Date.now()) {
 const since=new Date(now-60000).toISOString();
 const starts=db.prepare('SELECT started FROM calls WHERE started>=?').all(since);
 const recent=db.prepare("SELECT ended,usage FROM calls WHERE ended>=? AND status!='running'").all(since);
 const bins=Array(30).fill(0);for(const r of starts){const i=Math.floor((Date.parse(r.started)-(now-60000))/2000);if(i>=0&&i<30)bins[i]++;}
 let input=0,output=0,inputReported=0,outputReported=0;
 for(const r of recent){const u=r.usage?JSON.parse(r.usage):null;if(Number.isFinite(u?.input_tokens)){input+=u.input_tokens;inputReported++;}if(Number.isFinite(u?.output_tokens)){output+=u.output_tokens;outputReported++;}}
 const latency=db.prepare("SELECT id,tool,status,duration FROM calls WHERE status!='running' ORDER BY ended DESC LIMIT 30").all().reverse();
 return {windowSeconds:60,requests:starts.length,bins,latency,input:inputReported?input:null,output:outputReported?output:null,outputPerSecond:outputReported?output/60:null,inputReported,outputReported,completed:recent.length};
}

let flowCountCache;
export function flowTotals(id){
 const selected=getCall(id);if(!selected)return null;
 const revision=db.prepare("SELECT count(*) AS n FROM calls WHERE status!='running'").get().n;
 if(!flowCountCache||flowCountCache.revision!==revision){
  const global=emptyFlowCounts(),groups=new Map();
  for(const raw of db.prepare("SELECT id,server,tool,status,input,output FROM calls WHERE status!='running'").iterate()){
   const row=decode(raw),scope=flowScope(row);if(!groups.has(scope))groups.set(scope,emptyFlowCounts());
   addFlowCounts(global,row);addFlowCounts(groups.get(scope),row);
  }
  flowCountCache={revision,global,groups};
 }
 return {global:flowCountCache.global,scope:flowCountCache.groups.get(flowScope(selected))||emptyFlowCounts()};
}

// A completion is captured in the same SQLite transaction as the proxy result.
// Stages are read live; every terminal call is retained for cursor-based playback.
db.exec(`CREATE TABLE IF NOT EXISTS completed_calls(seq INTEGER PRIMARY KEY AUTOINCREMENT,call_id TEXT NOT NULL UNIQUE);
CREATE TRIGGER IF NOT EXISTS capture_completed_call AFTER UPDATE OF status ON calls
WHEN NEW.status != 'running' AND OLD.status = 'running'
BEGIN INSERT OR IGNORE INTO completed_calls(call_id) VALUES(NEW.id); END;
INSERT OR IGNORE INTO completed_calls(call_id) SELECT id FROM calls WHERE status != 'running' ORDER BY ended,id;`);
export function streamHead(){return db.prepare('SELECT coalesce(max(seq),0) AS seq FROM completed_calls').get().seq;}
export function callStream(after=0,limit=50){
 const cursor=Math.max(0,Number(after)||0),size=Math.min(100,Math.max(1,Number(limit)||50));
 const events=db.prepare('SELECT seq,call_id FROM completed_calls WHERE seq>? ORDER BY seq LIMIT ?').all(cursor,size).map(e=>({seq:e.seq,call:getCall(e.call_id)}));
 const remaining=db.prepare('SELECT count(*) AS n FROM completed_calls WHERE seq>?').get(events.at(-1)?.seq||cursor).n;
 return {events,remaining,head:streamHead()};
}
