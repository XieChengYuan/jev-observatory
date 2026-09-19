import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SERVERS, catalog, PORT } from './config.mjs';
import { runTool, discoverServer } from './runner.mjs';

const id = process.argv[2];
if (!SERVERS[id]) throw new Error('Usage: node src/proxy.mjs <server-id>');
let manifest = catalog(id);
const server = new Server({ name: 'observed-' + id, version: '1.0.0' }, {
  capabilities: { tools: {} },
  instructions: (manifest.instructions || '') + `\nTool calls are logged locally in MCP Observatory at http://127.0.0.1:${PORT}. This gateway exposes tools only. Upstream tools may have side effects; follow their descriptions and normal authorization rules.`,
});
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // A newly installed gateway must work without a separate discovery command.
  manifest = await discoverServer(id);
  return { tools: manifest.tools };
});
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { id: callId, result } = await runTool({ server: id, tool: request.params.name, args: request.params.arguments, source: 'mcp', signal: extra.signal });
  if (!callId) return result;
  return { ...result, _meta: { ...result._meta, "mcp-observatory": { callId } } };
});
await server.connect(new StdioServerTransport());
