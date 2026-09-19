import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseToml, stringify as toml } from 'smol-toml';
import { parse as parseJson, modify, applyEdits } from 'jsonc-parser';

export const providerKeys = ['TYPESAFE_API_KEY', 'OPENROUTER_API_KEY', 'AI_GATEWAY_API_KEY'];
export function clients(home = homedir(), platform = process.platform, env = process.env) {
  return [
    { id: 'codex', label: 'Codex', format: 'toml', path: resolve(env.CODEX_HOME || resolve(home, '.codex'), 'config.toml') },
    { id: 'cursor', label: 'Cursor', format: 'json', path: resolve(home, '.cursor/mcp.json') },
    { id: 'claude-code', label: 'Claude Code', format: 'json', path: resolve(home, '.claude.json') },
    ...(platform === 'linux' ? [] : [{ id: 'claude-desktop', label: 'Claude Desktop', format: 'json', path: platform === 'win32' ? resolve(env.APPDATA || resolve(home, 'AppData/Roaming'), 'Claude/claude_desktop_config.json') : resolve(home, 'Library/Application Support/Claude/claude_desktop_config.json') }]),
  ];
}
export function parseConfig(text, format) {
  if (format === 'toml') return parseToml(text);
  const errors = [];
  const value = parseJson(text || '{}', errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('客户端配置格式无效；未修改文件。');
  return value;
}
export const tableName = client => client.format === 'toml' ? 'mcp_servers' : 'mcpServers';
export function readClient(client) {
  const text = existsSync(client.path) ? readFileSync(client.path, 'utf8') : (client.format === 'toml' ? '' : '{}\n');
  return { text, config: parseConfig(text, client.format) };
}
export function isObserved(entry) {
  return !!entry?.env?.MCP_OBSERVATORY_DATA && (entry.args || []).some(a => /(?:^|[/\\])(?:proxy\.mjs|cli\.mjs)$/.test(a));
}
export function isJev(name, entry) {
  return /(?:@jkudish[/\\]jev-mcp|jev-mcp[/\\])/.test([entry?.command, ...(entry?.args || [])].join(' ')) || /^jev$/i.test(name) || (isObserved(entry) && /jev/i.test(name));
}

// Only replace the selected MCP entry. Parse the complete result before writing,
// so unusual TOML layouts cannot silently alter unrelated client settings.
export function replaceEntry(text, client, name, entry) {
  const key = tableName(client), before = parseConfig(text, client.format);
  const expected = structuredClone(before);
  expected[key] ||= {};
  if (entry === undefined) delete expected[key][name]; else expected[key][name] = entry;
  let output;
  if (client.format === 'json') {
    output = applyEdits(text, modify(text, [key, name], entry, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  } else {
    let skip = false;
    output = text.split(/(?<=\n)/).filter(line => {
      if (/^\s*\[/.test(line)) {
        try {
          const header = parseToml(line);
          skip = !!header[key] && Object.hasOwn(header[key], name);
        } catch { /* Semantic verification below rejects ambiguous layouts. */ }
      }
      return !skip;
    }).join('');
    if (entry !== undefined) output += '\n' + toml({ [key]: { [name]: entry } });
  }
  const actual = parseConfig(output, client.format);
  // Empty parent tables may disappear on removal.
  for (const value of [actual, expected]) if (value[key] && !Object.keys(value[key]).length) delete value[key];
  if (!isDeepStrictEqual(actual, expected)) throw new Error('此配置布局无法安全局部修改；保留原文件。请使用独立的 MCP 配置文件。');
  return output;
}
export function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + '.' + randomUUID() + '.tmp';
  try { writeFileSync(tmp, text, { mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, path); }
  finally { if (existsSync(tmp)) unlinkSync(tmp); }
}
function checkEntry(entry) {
  if (entry.url || entry.type === 'http' || entry.type === 'sse' || !entry.command) throw new Error('自动接入仅支持 stdio MCP；远程 HTTP/SSE 配置保持原样。');
  if (typeof entry.command !== 'string' || (entry.args && (!Array.isArray(entry.args) || entry.args.some(a => typeof a !== 'string')))) throw new Error('MCP 启动命令格式不受支持。');
  if (entry.env && Object.values(entry.env).some(v => typeof v !== 'string')) throw new Error('MCP 环境变量必须为字符串。');
  if (entry.cwd && !/^(?:\/|[A-Za-z]:[\\/])/.test(entry.cwd)) throw new Error('请先把 MCP cwd 配置为绝对路径，再接入。');
  if (entry.envFile) throw new Error('envFile 暂不支持自动迁移；请使用客户端 env 配置。');
  if ([entry.command, ...(entry.args || [])].some(v => v.includes('${'))) throw new Error('启动命令含客户端变量，无法原样转发；请先改为绝对路径或普通命令。env 中的变量仍由客户端解析。');
}
export function planIntegration({ client, name, original, data, root, port = 4318, node = process.execPath, fresh = false, secretKey }) {
  checkEntry(original);
  const id = client.id + '-' + createHash('sha256').update(client.path + '\0' + name).digest('hex').slice(0,12);
  const upstream = { name: `${client.label} · ${name}`, command: original.command, args: original.args || [], inheritCwd: true,
    envVars: [...new Set([...Object.keys(original.env || {}), ...(original.env_vars || []), ...providerKeys, 'JEV_PROVIDER', 'JEV_MCP_MODEL', 'TYPESAFE_BASE_URL', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'JEV_CLOUDFLARE_API_TOKEN'])],
    secretEnv: fresh && secretKey ? [secretKey] : [], literalLaunch: true };
  if (original.cwd) upstream.cwd = original.cwd;
  if (fresh && secretKey) upstream.env = { JEV_PROVIDER: { TYPESAFE_API_KEY: 'typesafe', OPENROUTER_API_KEY: 'openrouter', AI_GATEWAY_API_KEY: 'vercel' }[secretKey] };
  const wrapped = { ...original, command: node, args: ['--no-warnings', resolve(root, 'bin/cli.mjs'), 'proxy', id], env: { ...original.env, MCP_OBSERVATORY_DATA: data, MCP_OBSERVATORY_CONFIG: resolve(data, 'servers.json'), MCP_OBSERVATORY_PORT: String(port) } };
  return { id, client, name, original: fresh ? undefined : original, wrapped, upstream };
}
export function applyIntegration(plan, data) {
  const { client, name, wrapped, upstream, id } = plan;
  const { text, config } = readClient(client);
  if (!isDeepStrictEqual(config[tableName(client)]?.[name], plan.original)) throw new Error('客户端配置已变化，请重新运行安装。');
  const output = replaceEntry(text, client, name, wrapped);
  const path = resolve(data, 'servers.json');
  const oldServers = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const servers = oldServers ? JSON.parse(oldServers) : { servers: {} };
  if (servers.servers[id] && !isDeepStrictEqual(servers.servers[id],upstream)) throw new Error('该接入 ID 已存在且配置不同，请使用新的 --data 目录或检查原配置。');
  servers.servers[id] = upstream;
  const backupDir = resolve(data, 'integrations', id);
  if (existsSync(resolve(backupDir, 'record.json'))) throw new Error('已有接入备份，请先运行 restore。');
  atomicWrite(resolve(backupDir, 'client.before'), text);
  atomicWrite(resolve(backupDir, 'record.json'), JSON.stringify({ ...plan, upstream: undefined }, null, 2));
  try {
    atomicWrite(path, JSON.stringify(servers, null, 2));
    // Check again immediately before replacing a client file.
    if (readClient(client).text !== text) throw new Error('客户端正在更新配置，请关闭客户端后重试。');
    atomicWrite(client.path, output);
  } catch (e) {
    if (oldServers !== null) atomicWrite(path, oldServers); else if (existsSync(path)) unlinkSync(path);
    unlinkSync(resolve(backupDir, 'record.json'));
    throw e;
  }
}
export function restoreIntegration(recordPath) {
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  const { text, config } = readClient(record.client), key = tableName(record.client);
  if (!isDeepStrictEqual(config[key]?.[record.name], record.wrapped)) throw new Error('此 MCP 配置在接入后被修改；未覆盖。可参考 client.before 手动恢复。');
  atomicWrite(record.client.path, replaceEntry(text, record.client, record.name, record.original));
  // Keep logs, provider configuration and credentials: active clients may still use them.
  renameSync(recordPath, recordPath + '.restored-' + Date.now());
  // Keep the ID reserved so old processes can finish; setup can safely reuse after restart.
  return record.client.label + ' / ' + record.name;
}
