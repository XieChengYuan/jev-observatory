# Jev Activity Dashboard

**See what your agent sends to Jev, what it asks Jev to judge, and what comes back.**

An independent, local MCP activity dashboard. The proxy records calls automatically, and the dashboard reads those records. No agent-written reports or manually triggered demos are needed. The dashboard itself makes no additional model calls. The application interface is currently in Chinese.

![MIT license](https://img.shields.io/badge/license-MIT-eee6ce)
![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-eee6ce)

## Installation and setup

Requires [Node.js 22.13 or newer](https://nodejs.org/), including npm. Close the MCP clients whose configuration you are about to update so they do not save settings at the same time.

```sh
npm install -g https://github.com/XieChengYuan/jev-observatory/releases/download/v1.1.0/jev-observatory-1.1.0.tgz
jev-observatory setup
```

Alternatively, install directly from GitHub source (requires Git):

```sh
npm install -g github:XieChengYuan/jev-observatory
jev-observatory setup
```

The setup wizard lists the clients it will connect, backs up their configuration, applies the integration, and starts and opens the [local dashboard](http://127.0.0.1:4318/). **Restart the affected MCP clients to load the new configuration.** Some clients may also ask you to enable or trust the MCP server. Follow their prompts, then let your agent use Jev normally.

| Your setup | What the wizard does |
| --- | --- |
| Jev MCP is already configured | Preserves the service name, arguments, environment variables, and client permission settings; routes its launch through the observation proxy and reuses the existing upstream server |
| Jev MCP is not configured | Installs `@jkudish/jev-mcp@0.5.0` locally and creates the Jev service and proxy configuration |
| The service is already connected through the proxy | Skips that entry without adding another proxy layer or clearing history |

For a new Jev installation, setup first checks for TypeSafe, OpenRouter, or AI Gateway credentials in the terminal environment. If no key is available, enter it in the local terminal with input hidden, or add it later in the dashboard's connection settings. Setup can finish without a key, but **Jev tools cannot be used until credentials are configured**. Reconnect the MCP client after adding the key. Do not paste credentials into chat, command-line arguments, or GitHub.

To select OpenRouter explicitly:

```sh
jev-observatory setup --provider openrouter
```

New Jev installations are stored in the data directory, outside the temporary npx cache. Clearing that cache will not break the integration. Setup adds tools and the observation layer; it does not force your agent to call Jev on every message.

## Supported clients

| Client | Default configuration location |
| --- | --- |
| Codex | `$CODEX_HOME/config.toml` or `~/.codex/config.toml` |
| Cursor | `~/.cursor/mcp.json` |
| Claude Code | User-level `mcpServers` in `~/.claude.json` |
| Claude Desktop | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%/Claude/claude_desktop_config.json` |

By default, setup detects these existing configuration files and lists the proposed changes. If none are found, interactive setup asks you to choose a client. You can also specify one explicitly:

```sh
jev-observatory setup --client codex
jev-observatory setup --client cursor
jev-observatory setup --client claude-code
jev-observatory setup --client claude-desktop
```

Project-level configuration must be selected explicitly. The installer does not scan every project or modify organization-managed configuration:

```sh
jev-observatory setup --client cursor --config /absolute/path/to/project/.cursor/mcp.json
jev-observatory setup --client claude-code --config /absolute/path/to/project/.mcp.json
```

A Claude Code project-level entry with the same name may take precedence over the user-level entry. Connect the configuration that is actually in use. Other clients with a compatible JSON `mcpServers` file can use `--client cursor --config ...`; automatic detection does not cover every MCP client.

Setup recognizes the Jev service name or a launch command containing `@jkudish/jev-mcp`. To connect another existing stdio service, such as TypeSafe's `evaluate mcp`, select its entry explicitly. This does not install the TypeSafe binary:

```sh
jev-observatory setup --client codex --server typesafe
```

Automatic migration does not support remote HTTP/SSE servers, `envFile`, relative `cwd` values, or client variables in launch commands. These configurations are left unchanged with an explanation. Variable interpolation in environment fields remains the original client's responsibility. Disabled services remain disabled.

Configuration references: [Codex MCP](https://developers.openai.com/codex/mcp/), [Cursor MCP](https://cursor.com/docs/mcp), and [connecting local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers). Upstream installation and credential details: [Jev MCP](https://github.com/jkudish/jev-mcp).

## How automatic observation works

```text
Agent / MCP client
       | Calls the original Jev tool names
       v
Local observation proxy ------> Jev MCP ------> Model provider
       |                           | Response
       +--- Inputs, stages, results, usage ---> Local SQLite
                                                    |
                                             Automatic reads
                                                    v
                                           Jev Activity Dashboard
```

- When the client starts the MCP proxy, the proxy checks for the local dashboard service and starts it if needed. It does not repeatedly open browser windows.
- The first `tools/list` request discovers the upstream tools automatically. There is no need to click a discovery button. Installation and tool discovery do not call a model.
- Recording continues when the browser is closed. Stopping the dashboard service also does not stop proxy writes. Run `jev-observatory open` to start the dashboard again.
- The recording toggle in the top-right corner controls whether new calls are recorded. While recording is off, Jev still runs, history is retained, and already-recorded calls finish their lifecycle. Calls made while recording was off are not backfilled when it resumes.
- Only calls routed through the proxy are observed. Direct Jev connections from other clients and direct SDK/API calls are not captured.
- If the agent does not call Jev, the dashboard does not invent activity.

Setup does not silently change your model selection or run paid model tests. Actual Jev calls remain billable through your provider account.

## Check your connection

```sh
jev-observatory doctor
jev-observatory doctor --discover
jev-observatory open
```

`stop` stops only a background dashboard started by this tool whose process identity matches. It does not stop Jev or unrelated services. If an interrupted installation leaves a `setup.lock` file, remove it from the data directory only after confirming that no setup process is running.

`doctor` checks configuration, proxy paths, declared required credentials, and the dashboard port. Adding `--discover` verifies the upstream connection with a real `tools/list` request, without calling a model. Variables injected dynamically by the MCP client may only be available when launched by that client; a terminal check does not prove the client has loaded the configuration.

If the default port is occupied, choose an available one. Newly connected proxies and the dashboard will share that setting:

```sh
jev-observatory setup --client cursor --port 4328
jev-observatory open --port 4328
```

Already-connected entries retain their original port. To move one, run `restore`, then run `setup` with the new port. The installer does not terminate unrelated processes occupying a port.

## Restore and uninstall

```sh
jev-observatory restore
# Or restore only a specific client:
jev-observatory restore --client cursor
jev-observatory stop
npm uninstall -g jev-observatory
```

Restore the configuration and restart the client before uninstalling. Existing MCP entries return to their original launch configuration; entries created by this tool are removed. Restore will not overwrite manual changes made to the connected MCP entry afterward or roll back unrelated client settings.

Backups live in `integrations/<id>/` inside the data directory. `client.before` contains the original client configuration and may include credentials that were already present; do not share it. History, credentials, upstream packages, and backups are retained after uninstalling. To remove them, stop the relevant processes and delete the data directory yourself.

Before upgrading, close the MCP client and run `jev-observatory stop`. Install the new version, run `jev-observatory open`, and restart the MCP client. Keep the same global installation location. Do not move or delete an installation directory that is still referenced by a client configuration. Existing manually configured legacy proxies are recognized and skipped; their original startup mechanism remains in place.

## Visualization and counters

Input content → tool and judgment requirements → actual response → classification / score / yes-no / other → corresponding result pools.

Candidate names, question dimensions, probabilities, and score ranges come from the declared inputs and actual responses. Business categories such as "duplicate use case" are not built in. Candidates with no matches remain visible. Missing probabilities and score ranges stay unknown; the dashboard does not invent high/low bands. Pale yellow highlights the returned choice, not whether an outcome is good or bad.

- **Total calls:** MCP calls recorded by the proxy.
- **Current call:** The number of returned items assigned to a pool within the selected call.
- **Same-rule total:** Recorded items assigned to that pool across calls with matching tool, candidate, and judgment definitions. This is not a count of unique business records.
- **Displaying x / y:** The presentation position within the current call's returned items, not model computation progress.
- Repeated real calls on the same content each contribute to the counts. Replaying an animation does not.
- Duration includes upstream process startup, connection, and waiting. Usage appears only when explicitly reported by the upstream server.

A persistent cursor presents completed calls in order. Animations run after results arrive; they do not expose model reasoning, represent internal execution progress, or prove that your application performed a downstream action. Input content scrolls vertically. Outputs, candidates, and history paginate separately while the top-level metrics remain fixed. Reduced motion is supported.

## Local data and security boundaries

Default data directory: `$XDG_DATA_HOME/mcp-observatory` or `~/.local/share/mcp-observatory` on macOS / Linux; `%LOCALAPPDATA%/mcp-observatory` on Windows. Existing installations using `~/.local/share/jev-observatory` remain supported.

| Setting | Purpose |
| --- | --- |
| `--data` / `MCP_OBSERVATORY_DATA` | Directory for data, credentials, and backups |
| `--port` / `MCP_OBSERVATORY_PORT` | Dashboard port; defaults to 4318 |
| `MCP_OBSERVATORY_CONFIG` | Custom upstream configuration; automatic setup requires `servers.json` inside the data directory |
| `MCP_OBSERVATORY_NO_AUTOSTART=1` | Record through the proxy without automatically starting the dashboard service |

Credentials are stored in a separate plaintext local file, restricted to the current user on POSIX. Windows uses the user directory's ACLs. Inputs and outputs may still contain private business content; redacting known credentials and common secret fields does not replace reviewing records before sharing them. The installer does not upload configuration, credentials, logs, or databases. The dashboard binds only to loopback and checks Host, Origin, and CSRF tokens. Public hosting and multi-user access are not supported.

The proxy currently supports only **stdio `tools/list` and `tools/call`**, starting a new upstream process for each tool call. It does not support sessions across calls, resources, prompts, sampling, elicitation, or other interactive callbacks. Cancellation cannot undo external actions already performed upstream. See [SECURITY.md](SECURITY.md) for details.

## Development

```sh
npm ci
npm test
node scripts/smoke.mjs
# Local demo: no Jev installation, network access, or model calls:
npm run setup:demo
npm run discover
npm start
```

Use a separate `MCP_OBSERVATORY_DATA` directory for demos to keep them out of real activity history. CI covers Linux, macOS, and Windows; local verification alone is not a substitute for checks on the other platforms.

Source layout: `bin/` for installation and management commands, `src/` for the proxy and local server, `public/` for the interface, `test/` for isolated tests, and `examples/` for generic configuration. `npm run config` remains available to generate manual configuration for clients outside the setup wizard's supported formats.

MIT License. Jev MCP is a separate upstream project distributed under its own license.
