import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.umask(0o077);
const legacy = resolve(homedir(), '.local/share/jev-observatory');
const standard = process.platform === 'win32' ? resolve(process.env.LOCALAPPDATA || homedir(), 'mcp-observatory') : resolve(process.env.XDG_DATA_HOME || resolve(homedir(), '.local/share'), 'mcp-observatory');
export const DATA = process.env.MCP_OBSERVATORY_DATA || process.env.JEV_OBSERVATORY_DATA || (existsSync(resolve(legacy, 'servers.json')) ? legacy : standard);
mkdirSync(DATA, { recursive: true, mode: 0o700 });
chmodSync(DATA, 0o700);
export const PORT = Number(process.env.MCP_OBSERVATORY_PORT || process.env.JEV_OBSERVATORY_PORT || 4318);
export const CONFIG = process.env.MCP_OBSERVATORY_CONFIG || resolve(DATA, 'servers.json');
export function expand(value) { return value.replaceAll('${ROOT}', ROOT).replaceAll('${DATA}', DATA).replaceAll('${NODE}', process.execPath).replaceAll('${HOME}', homedir()); }
export function validateConfig(config) {
  if (!config?.servers || typeof config.servers !== 'object' || Array.isArray(config.servers)) throw new Error('配置必须包含 servers 对象');
  for (const [id, item] of Object.entries(config.servers)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ['__proto__','constructor','prototype'].includes(id)) throw new Error('服务 ID 只能使用字母、数字、下划线和连字符');
    if (!item || typeof item.command !== 'string' || !item.command.trim()) throw new Error(id + ': 缺少 command');
    if (item.args && (!Array.isArray(item.args) || item.args.some(v => typeof v !== 'string'))) throw new Error(id + ': args 必须是字符串数组');
    for (const key of ['secretEnv','envVars']) if (item[key] && (!Array.isArray(item[key]) || item[key].some(v => typeof v !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)))) throw new Error(id + ': 环境变量名无效');
    if (item.env && (typeof item.env !== 'object' || Array.isArray(item.env) || Object.values(item.env).some(v => typeof v !== 'string'))) throw new Error(id + ': env 必须是字符串映射');
  }
  return config;
}
function readServers() {
  if (!existsSync(CONFIG)) return {};
  const config = validateConfig(JSON.parse(readFileSync(CONFIG, 'utf8')));
  return Object.fromEntries(Object.entries(config.servers).map(([id,s]) => {
    const launch = s.literalLaunch ? value => value : expand;
    return [id,{...s,name:s.name || id,command:launch(s.command),args:(s.args || []).map(launch),cwd:s.cwd ? launch(s.cwd) : s.inheritCwd ? process.cwd() : ROOT,secretEnv:s.secretEnv || [],envVars:s.envVars || []}];
  }));
}
export const SERVERS = readServers();
export function reloadServers() {
  const next = readServers();
  for (const id of Object.keys(SERVERS)) if (!Object.hasOwn(next,id)) delete SERVERS[id];
  Object.assign(SERVERS,next);
}
export function credentials() {
  try { return JSON.parse(readFileSync(resolve(DATA, 'credentials.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('本地凭据配置损坏，请重新配置。'); }
  return {};
}
export function saveSecret(server, name, value) {
  if (!SERVERS[server]?.secretEnv.includes(name)) throw new Error('服务未声明此凭据字段');
  const data = credentials(); data.servers ||= {}; data.servers[server] ||= {}; data.servers[server][name] = value;
  const path = resolve(DATA, 'credentials.json');
  writeFileSync(path + '.tmp', JSON.stringify(data), { mode: 0o600 }); chmodSync(path + '.tmp', 0o600); renameSync(path + '.tmp', path);
}
export function serverEnvironment(id) {
  const s = SERVERS[id]; if (!s) throw new Error('未知 MCP 服务');
  const stored = credentials();
  const env = {};
  for (const name of ['PATH','HOME','USERPROFILE','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR','LANG','SHELL',...s.envVars]) if (process.env[name]) env[name] = process.env[name];
  Object.assign(env,s.env || {});
  for (const name of s.secretEnv) {
    const value = stored.servers?.[id]?.[name] || (name === 'TYPESAFE_API_KEY' ? stored.apiKey : '') || process.env[name];
    if (value) env[name] = value;
  }
  return { env, missing: s.secretEnv.filter(name => !env[name]), secrets: [...Object.values(stored.servers?.[id] || {}),stored.apiKey,...Object.entries(env).filter(([k]) => /KEY|TOKEN|SECRET|PASSWORD|AUTH/i.test(k)).map(([,v]) => v)].filter(Boolean) };
}
export function catalog(id) {
  if (!SERVERS[id]) throw new Error('未知 MCP 服务');
  try { return JSON.parse(readFileSync(resolve(DATA, 'catalog', id + '.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; return { tools:[], instructions:'' }; }
}
export function saveCatalog(id, manifest) {
  if (!SERVERS[id]) throw new Error('未知 MCP 服务');
  mkdirSync(resolve(DATA,'catalog'),{recursive:true});
  const path=resolve(DATA,'catalog',id+'.json');
  writeFileSync(path+'.tmp',JSON.stringify(manifest,null,2)); renameSync(path+'.tmp',path);
}

export function redact(value, secrets = []) {
  if (Array.isArray(value)) return value.map(v => redact(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /^(api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token)$/i.test(k) ? '[已隐藏]' : redact(v, secrets)]));
  if (typeof value !== 'string') return value;
  if (/^\s*[\[{]/.test(value)) {
    try { return JSON.stringify(redact(JSON.parse(value), secrets)); } catch {}
  }
  let text = value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]').replace(/\b(?:sk-or-v1-|sk-|ts_)[A-Za-z0-9_-]{16,}/g, '[已隐藏]');
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[已隐藏]');
  return text;
}
