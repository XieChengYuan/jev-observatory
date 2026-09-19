// Generic workflow telemetry: callers declare pools and supply stable input IDs.
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {DATA} from './config.mjs';
const db=new DatabaseSync(resolve(DATA,'tasks.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,name TEXT NOT NULL,pools TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task_items(task_id TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,pool TEXT,input TEXT,output TEXT,calls TEXT,updated TEXT NOT NULL,PRIMARY KEY(task_id,id));`);
export function recordTaskItem({task,item}){
 if(!task?.id||!item?.id||!Array.isArray(task.pools))throw Error('Task, input ID and pool definitions required');
 if(item.pool&&!task.pools.some(p=>p.id===item.pool))throw Error('Unknown task pool');
 const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');try{
 db.prepare('INSERT INTO tasks VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,pools=excluded.pools,updated=excluded.updated').run(task.id,task.name,JSON.stringify(task.pools),now);
 db.prepare('INSERT INTO task_items VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id,id) DO UPDATE SET title=excluded.title,status=excluded.status,pool=excluded.pool,input=excluded.input,output=excluded.output,calls=excluded.calls,updated=excluded.updated').run(task.id,item.id,item.title||item.id,item.status||'queued',item.pool||null,JSON.stringify(item.input??null),JSON.stringify(item.output??null),JSON.stringify(item.calls||[]),now);
 db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
export function listTasks(){return db.prepare('SELECT * FROM tasks ORDER BY updated DESC').all().map(t=>({...t,pools:JSON.parse(t.pools)}));}
export function getTask(id){const task=listTasks().find(t=>t.id===id);if(!task)return null;
 const items=db.prepare('SELECT * FROM task_items WHERE task_id=? ORDER BY updated DESC,id').all(id).map(i=>({...i,input:JSON.parse(i.input),output:JSON.parse(i.output),calls:JSON.parse(i.calls)}));
 return {...task,total:items.length,waiting:items.filter(i=>!i.pool).length,pools:task.pools.map(p=>({...p,count:items.filter(i=>i.pool===p.id).length})),items};
}

// Explicit association is available as soon as a proxied call starts.
db.exec('CREATE TABLE IF NOT EXISTS task_calls(call_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,input_id TEXT NOT NULL)');
export function linkTaskCall(callId,context){
 if(!context?.taskId||!context?.inputId)return;
 if(!db.prepare('SELECT 1 FROM task_items WHERE task_id=? AND id=?').get(context.taskId,context.inputId))return;
 db.prepare('INSERT OR REPLACE INTO task_calls VALUES(?,?,?)').run(callId,context.taskId,context.inputId);
}
export function getTaskForCall(callId){
 const link=db.prepare('SELECT task_id,input_id FROM task_calls WHERE call_id=?').get(callId)
  ||db.prepare("SELECT task_id,id AS input_id FROM task_items WHERE EXISTS (SELECT 1 FROM json_each(task_items.calls) WHERE json_extract(value,'$.id')=?) LIMIT 1").get(callId);
 if(!link)return null;
 return {...getTask(link.task_id),currentInputId:link.input_id};
}
