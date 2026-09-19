import { spawn } from 'node:child_process';
import { openSync, closeSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const storageIdentity = data => createHash('sha256').update(resolve(data)).digest('hex').slice(0,24);
export async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(750) });
    if (!response.ok) return { foreign: true };
    const result = await response.json();
    return result.application === 'jev-observatory' ? result : { foreign: true };
  } catch (e) {
    if (e.cause?.code === 'ECONNREFUSED') return null;
    return { foreign: true };
  }
}
export async function ensureDashboard({ root, data, port, config, node = process.execPath }) {
  const existing = await health(port), identity = storageIdentity(data);
  if (existing?.storageId === identity) return { started: false };
  if (existing) throw new Error(`端口 ${port} 已被其他服务或其他数据目录占用。请使用 --port 指定空闲端口。`);
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const fd = openSync(resolve(data, 'dashboard.log'), 'a', 0o600);
  const child = spawn(node, ['--no-warnings', resolve(root, 'src/server.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, MCP_OBSERVATORY_DATA: data, MCP_OBSERVATORY_CONFIG: config, MCP_OBSERVATORY_PORT: String(port), MCP_OBSERVATORY_INSTANCE: randomUUID() } });
  closeSync(fd);
  let error;
  child.on('error', e => { error = e; }); child.unref();
  for (let n = 0; n < 35; n++) {
    await new Promise(resolve => setTimeout(resolve, 150));
    if (error) throw new Error('看板进程启动失败。');
    if ((await health(port))?.storageId === identity) return { started: true };
  }
  throw new Error('看板未能启动，请查看本地 dashboard.log；MCP 仍可独立记录。');
}
export async function stopDashboard({ data, port }) {
  const state = await health(port), path = resolve(data, `dashboard-${port}.json`);
  if (!state) return false;
  if (state.storageId !== storageIdentity(data) || !existsSync(path)) throw new Error('该服务不由此安装器管理，未停止。');
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  if (saved.instance !== state.instance || !Number.isSafeInteger(saved.pid) || saved.pid <= 1) throw new Error('后台进程身份不匹配，未停止。');
  process.kill(saved.pid,'SIGTERM');
  for (let n=0;n<35;n++) {
    await new Promise(resolve=>setTimeout(resolve,100));
    if (!(await health(port))) { if (existsSync(path)) unlinkSync(path); return true; }
  }
  throw new Error('看板仍在退出，请稍后检查；未强制终止进程。');
}
export function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); child.unref();
}
