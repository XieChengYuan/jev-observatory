#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { clients, readClient, tableName, isJev, isObserved, planIntegration, applyIntegration, restoreIntegration, atomicWrite, providerKeys } from '../src/integrations.mjs';
import { ensureDashboard, stopDashboard, health, storageIdentity, openBrowser } from '../src/daemon.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) { console.error('需要 Node.js 22.13 或更新版本。'); process.exit(1); }
const args = process.argv.slice(2), command = args.shift() || 'setup';
const options = {};
if (command === 'proxy') options.server = args.shift();
for (let i = 0; i < args.length; i++) {
  const name = args[i].replace(/^--/, '');
  if (!args[i].startsWith('--')) throw new Error('未知参数；运行 jev-observatory help 查看用法。');
  if (['yes','no-open','no-start','discover'].includes(name)) options[name] = true;
  else if (['client','config','data','port','server','provider'].includes(name) && args[i+1] && !args[i+1].startsWith('--')) options[name] = args[++i];
  else throw new Error('未知或缺失参数：' + name);
}
if (options.data) process.env.MCP_OBSERVATORY_DATA = resolve(options.data);
if (options.port) process.env.MCP_OBSERVATORY_PORT = options.port;
const { DATA, PORT, CONFIG } = await import('../src/config.mjs');
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('端口必须为 1024–65535。');
const daemon = { root, data: DATA, port: PORT, config: CONFIG };
const log = message => console.error(message);

function run(file, argv, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { env, stdio: ['ignore','pipe','pipe'], windowsHide: true });
    // Upstream diagnostics can contain credentials; never echo arbitrary output.
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
    child.on('error', () => reject(new Error('无法启动安装/检测程序，请检查 Node.js 与 npm。')));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('安装/检测未通过，请检查网络、运行环境和服务配置。')));
  });
}
async function installJev() {
  const dir = resolve(DATA, 'providers/jev');
  const manifest = resolve(dir, 'node_modules/@jkudish/jev-mcp/package.json');
  if (!existsSync(manifest) || JSON.parse(readFileSync(manifest)).version !== '0.5.0') {
    log('安装 Jev MCP 0.5.0 到本机数据目录……');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const npmCli = process.env.npm_execpath || [resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(existsSync);
    if (!npmCli) throw new Error('未找到 npm，请通过 npm exec -- jev-observatory setup 运行。');
    await run(process.execPath, [npmCli, 'install', '--prefix', dir, '--no-audit', '--no-fund', '--ignore-scripts', '--save-exact', '@jkudish/jev-mcp@0.5.0']);
  }
  return { command: process.execPath, args: [resolve(dir, 'node_modules/@jkudish/jev-mcp/dist/index.js')] };
}
async function hiddenKey() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) return '';
  log('在此粘贴 API Key（不回显；直接回车可稍后到看板「连接设置」填写）：');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const finish = () => { process.stdin.setRawMode(false); process.stdin.off('data', listener); process.stdin.pause(); log(''); };
    const listener = chunk => {
      for (const c of chunk) {
        if (c === '\u0003') { finish(); reject(new Error('安装已取消。')); return; }
        if (c === '\r' || c === '\n') { finish(); resolve(value.trim()); return; }
        if (c === '\u007f' || c === '\b') value = value.slice(0,-1);
        else if (c >= ' ' && value.length < 8192) value += c;
      }
    };
    process.stdin.on('data', listener);
  });
}
function records() {
  const dir = resolve(DATA, 'integrations');
  return existsSync(dir) ? readdirSync(dir).map(id => resolve(dir,id,'record.json')).filter(existsSync) : [];
}
async function withInstallLock(action) {
  const path = resolve(DATA,'setup.lock');
  let fd;
  try { fd = openSync(path,'wx',0o600); }
  catch { throw new Error('已有安装锁。确认没有其他安装/恢复进程后，删除数据目录中的 setup.lock 再重试。'); }
  try { writeFileSync(fd,String(process.pid)); return await action(); }
  finally { closeSync(fd); unlinkSync(path); }
}
function targets() {
  const available = clients();
  if (options.config && (!options.client || options.client === 'auto')) throw new Error('--config 必须配合 --client 指定格式。');
  if (options.client && options.client !== 'auto') {
    const client = available.find(c => c.id === options.client);
    if (!client) throw new Error('支持的客户端：' + available.map(c => c.id).join(', '));
    if (options.config) client.path = resolve(options.config);
    return [client];
  }
  return available.filter(c => existsSync(c.path));
}
async function setup() {
  if (/(?:^|[/\\])_npx[/\\]/.test(root)) throw new Error('请先持久安装：npm install -g github:XieChengYuan/jev-observatory，再运行 jev-observatory setup。临时 npx 缓存不能作为长期 MCP 启动路径。');
  if (CONFIG !== resolve(DATA,'servers.json')) throw new Error('自动安装不修改自定义 MCP_OBSERVATORY_CONFIG；请取消该环境变量后重试，或使用独立 --data 目录。');
  let selected = targets();
  if (!selected.length) {
    if (!process.stdin.isTTY || options.yes) throw new Error('未检测到客户端配置。请明确指定 --client codex、cursor、claude-code 或 claude-desktop。');
    const available = clients();
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    log(available.map((c,i) => `${i+1}. ${c.label}`).join('\n'));
    const answer = await rl.question('选择要接入的客户端编号：'); rl.close();
    selected = [available[Number(answer)-1]].filter(Boolean);
    if (!selected.length) throw new Error('未选择客户端。');
  }
  // Parse every selected file before installing packages or modifying configuration.
  const tasks = selected.flatMap(client => {
    const { config } = readClient(client), entries = config[tableName(client)] || {};
    if (options.server && !entries[options.server]) throw new Error('未找到指定 MCP 条目。');
    const matches = Object.entries(entries).filter(([name, entry]) => options.server ? name === options.server : isJev(name,entry));
    if (matches.length) return matches.map(([name, original]) => ({ client, name, original }));
    return [{ client, name: 'jev', fresh: true }];
  });
  for (const task of tasks) if (!task.fresh && !isObserved(task.original)) planIntegration({ ...task, root, data: DATA, port: PORT });
  for (const task of tasks) log(`${task.client.label}：${isObserved(task.original) ? '已接入，保持原样' : task.fresh ? '安装 Jev 并接入' : '接入已有 ' + task.name}（${task.client.path}）`);
  if (process.stdin.isTTY && !options.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await rl.question('将备份并更新以上 MCP 配置，继续？[Y/n] '); rl.close();
    if (/^n/i.test(answer)) return;
  }
  const fresh = tasks.some(t => t.fresh);
  let provider, key = '', launch;
  if (fresh) {
    const chosen = options.provider || (process.env.TYPESAFE_API_KEY ? 'typesafe' : process.env.OPENROUTER_API_KEY ? 'openrouter' : process.env.AI_GATEWAY_API_KEY ? 'gateway' : 'typesafe');
    provider = { typesafe: 'TYPESAFE_API_KEY', openrouter: 'OPENROUTER_API_KEY', gateway: 'AI_GATEWAY_API_KEY' }[chosen];
    if (!provider) throw new Error('--provider 支持 typesafe、openrouter、gateway。');
    log('凭据类型：' + provider + '（可用 --provider openrouter 切换）');
    key = process.env[provider] || (!options.yes ? await hiddenKey() : '');
    launch = await installJev();
  }
  let changed = 0;
  for (const task of tasks) {
    if (isObserved(task.original)) continue;
    const plan = planIntegration({ ...task, original: task.original || launch, root, data: DATA, port: PORT, secretKey: provider });
    applyIntegration(plan, DATA); changed++;
    if (task.fresh && key) {
      const path = resolve(DATA,'credentials.json');
      const stored = existsSync(path) ? JSON.parse(readFileSync(path,'utf8')) : {};
      stored.servers ||= {}; stored.servers[plan.id] ||= {}; stored.servers[plan.id][provider] = key;
      atomicWrite(path,JSON.stringify(stored));
    }
    log('已接入：' + task.client.label + ' / ' + task.name);
  }
  log(`完成。更新 ${changed} 个 MCP 配置。请重启对应客户端，然后正常使用 Jev。`);
  if (fresh && !key) log('尚缺 API Key；在看板「连接设置」填写后，重新连接 MCP。未进行付费模型调用。');
  if (!options['no-start']) {
    try { await ensureDashboard(daemon); if (!options['no-open']) openBrowser(`http://127.0.0.1:${PORT}/`); }
    catch(e) { log(e.message); process.exitCode = 1; }
  }
  log('看板地址：http://127.0.0.1:' + PORT + '/');
}
async function doctor() {
  let issues = 0;
  log('Node.js ' + process.versions.node + '\n本地数据：' + DATA);
  const cfg = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : { servers: {} };
  const storedPath = resolve(DATA,'credentials.json');
  const stored = existsSync(storedPath) ? JSON.parse(readFileSync(storedPath,'utf8')) : {};
  let count = 0;
  for (const client of targets()) {
    for (const [name, entry] of Object.entries(readClient(client).config[tableName(client)] || {})) {
      if (!isJev(name,entry) && !isObserved(entry)) continue;
      count++;
      if (!isObserved(entry)) { log(`${client.label} / ${name}：尚未接入`); issues++; continue; }
      if (resolve(entry.env.MCP_OBSERVATORY_DATA) !== resolve(DATA)) { log(`${client.label} / ${name}：接入另一个数据目录（用 --data 检查）`); issues++; continue; }
      const id = entry.args.at(-1), upstream = cfg.servers[id];
      if (!upstream || !existsSync(entry.args.find(a => /(?:cli|proxy)\.mjs$/.test(a)) || '')) { log(`${client.label} / ${name}：代理或上游配置缺失`); issues++; continue; }
      const required = upstream.secretEnv || [];
      const missing = required.filter(k => !stored.servers?.[id]?.[k] && !entry.env?.[k] && !upstream.env?.[k] && !process.env[k]);
      log(`${client.label} / ${name}：${missing.length ? '缺少 ' + missing.join(', ') : '配置就绪'}`);
      if (missing.length) issues++;
      if (options.discover && !missing.length) {
        try {
          const env = { ...process.env, ...Object.fromEntries(Object.entries(entry.env || {}).filter(([,v]) => !v.includes('${'))) };
          await run(process.execPath, [resolve(root,'scripts/discover.mjs'),id], env);
          log('  tools/list 连接通过（不调用模型）');
        } catch { log('  tools/list 未通过；检查密钥、客户端变量和上游命令。'); issues++; }
      }
    }
  }
  if (!count) { log('没有发现 Jev 接入；先运行 setup。'); issues++; }
  const status = await health(PORT);
  log(status?.storageId === storageIdentity(DATA) ? '看板正在运行' : status ? '看板端口被其他服务占用' : '看板未启动；运行 open 或由 MCP 代理自动启动');
  process.exitCode = issues ? 1 : 0;
}
try {
  if (command === 'proxy') {
    if (!options.server) throw new Error('缺少服务 ID。');
    // Do not delay or block MCP execution if the optional UI cannot start.
    if (process.env.MCP_OBSERVATORY_NO_AUTOSTART !== '1') void ensureDashboard(daemon).catch(e => log(e.message));
    process.argv[2] = options.server;
    await import('../src/proxy.mjs');
  } else if (command === 'setup') await withInstallLock(setup);
  else if (command === 'doctor') await doctor();
  else if (command === 'open') { await ensureDashboard(daemon); if (!options['no-open']) openBrowser(`http://127.0.0.1:${PORT}/`); log('http://127.0.0.1:' + PORT); }
  else if (command === 'stop') { log(await stopDashboard(daemon) ? '已停止后台看板。MCP 记录不受影响。' : '看板未运行。'); }
  else if (command === 'restore') {
    await withInstallLock(async () => {
    for (const path of records()) {
      const record = JSON.parse(readFileSync(path));
      if (options.client && options.client !== record.client.id) continue;
      if (options.config && resolve(options.config) !== record.client.path) continue;
      if (options.server && options.server !== record.name) continue;
      log('已恢复：' + restoreIntegration(path));
    }
    });
    log('请重启客户端。历史记录、密钥和备份保留在本机。恢复后可卸载本工具。');
  } else if (command === 'help' || command === '--help') log(`Jev 活动看板\n\nsetup   自动安装/接入 Jev MCP\ndoctor  检查配置；--discover 验证 tools/list，不调用模型\nopen    启动并打开看板\nstop    停止本工具启动的后台看板\nrestore 恢复接入前的 MCP 配置\n\n选项：--client codex|cursor|claude-code|claude-desktop\n      --config 自定义客户端配置路径（项目级配置需显式指定）\n      --server 已有服务名（可显式接入 TypeSafe evaluate 等 stdio 服务）\n      --provider typesafe|openrouter|gateway\n      --data 数据目录 --port 4318 --yes --no-open --no-start\n\n只记录经过代理的 tools/list、tools/call 链路。API Key 在本地输入，不接受命令行明文参数。`);
  else throw new Error('未知命令；运行 jev-observatory help 查看用法。');
} catch (e) {
  // Client parser errors can quote secrets from config lines; keep diagnostics generic.
  const { redact } = await import('../src/config.mjs');
  log(e.name === 'TomlError' || e instanceof SyntaxError ? '本地配置格式错误；请检查配置文件，未输出其内容。' : redact(e.message, providerKeys.map(k => process.env[k]).filter(Boolean)));
  process.exitCode = 1;
}
