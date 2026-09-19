import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { SERVERS, serverEnvironment, catalog, redact, saveCatalog } from './config.mjs';
import { startCall, stage, finishCall } from './store.mjs';

export async function connectUpstream(server, env, signal) {
  const cfg = SERVERS[server];
  if (!cfg) throw new Error('未知 MCP 服务');
  const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args, cwd: cfg.cwd, env, stderr: 'pipe' });
  const client = new Client({ name: 'mcp-observatory', version: '1.0.0' });
  const pending = client.connect(transport, { timeout: 15000, signal });
  transport.stderr?.on('data', () => {});
  try { await pending; } catch (e) { await transport.close().catch(() => {}); throw e; }
  return client;
}
export async function discoverServer(id) {
  const { env, missing } = serverEnvironment(id);
  if (missing.length) throw new Error('尚未配置凭据：' + missing.join(', '));
  const client = await connectUpstream(id, env);
  try {
    const tools = []; let cursor;
    do { const page = await client.listTools(cursor ? {cursor} : {}); tools.push(...page.tools); cursor=page.nextCursor; } while(cursor);
    const manifest = { tools, instructions:client.getInstructions() || '', discoveredAt:new Date().toISOString() };
    saveCatalog(id,manifest); return manifest;
  } finally { await client.close(); }
}
export function findUsage(result) {
  const candidates = [result.structuredContent];
  for (const item of result.content || []) if (item.type === 'text') { try { candidates.push(JSON.parse(item.text)); } catch {} }
  for (const item of candidates) if (item?.usage) return item.usage;
  return null;
}
export async function runTool({ server, tool, args = {}, source = 'mcp', signal, onStart, connect = connectUpstream }) {
  const { env, missing, secrets } = serverEnvironment(server);
  const id = startCall(server, tool, source, args, secrets);
  onStart?.(id);
  let client;
  try {
    if (!catalog(server).tools.some(t => t.name === tool)) throw new Error('此服务没有这个工具');
    if (missing.length) throw new Error('尚未配置凭据：' + missing.join(', ') + '。请在「连接设置」填写。');
    stage(id, '启动 MCP 并建立连接');
    client = await connect(server, env, signal);
    stage(id, '已提交工具，等待上游结果');
    const result = await client.callTool({ name: tool, arguments: args }, CallToolResultSchema, { timeout: 120000, signal });
    finishCall(id, { output: result, status: result.isError ? 'error' : 'success', error: result.isError ? '上游返回工具错误，请查看输出详情。' : null, usage: findUsage(result) }, secrets);
    return { id, result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    finishCall(id, { status: signal?.aborted ? 'cancelled' : 'error', error: message }, secrets);
    return { id, result: { isError: true, content: [{ type: 'text', text: redact(message, secrets) + (id ? '\n本地观察台记录：' + id : '') }] } };
  } finally { await client?.close().catch(() => {}); }
}
