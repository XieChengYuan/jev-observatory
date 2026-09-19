# Jev 活动看板

**看看 Agent 交给 Jev 的输入、判断要求和真实返回。**

一个独立运行的本地 MCP 活动看板。代理自动记录，看板自动读取；不用 Agent 汇报，不需要手动发起演示，看板本身不额外调用模型。界面为中文。

![MIT license](https://img.shields.io/badge/license-MIT-eee6ce)
![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-eee6ce)

## 安装与接入

需要 [Node.js 22.13 或更新版本](https://nodejs.org/)（含 npm）。先关闭要更新配置的 MCP 客户端，避免它同时保存设置。

```sh
npm install -g https://github.com/XieChengYuan/jev-observatory/releases/download/v1.1.0/jev-observatory-1.1.0.tgz
jev-observatory setup
```

也可以直接从 GitHub 源码安装（需要 Git）：

```sh
npm install -g github:XieChengYuan/jev-observatory
jev-observatory setup
```

安装向导显示将接入的客户端，备份原配置后自动完成接入，随后启动并打开 [本地看板](http://127.0.0.1:4318/)。**重启对应 MCP 客户端，让它加载新配置**。部分客户端还会要求启用或信任该 MCP，按客户端提示操作。正常让 Agent 使用 Jev 即可。

| 你的情况 | 向导自动完成什么 |
| --- | --- |
| 已有 Jev MCP | 保留服务名称、参数、环境变量及客户端权限设置，把启动入口接到观察代理；复用现有上游 |
| 还没有 Jev MCP | 在本机安装 `@jkudish/jev-mcp@0.5.0`，创建 Jev 服务和代理配置 |
| 已经接入过 | 跳过已接入条目，不重复套代理、不清空历史 |

新安装优先识别终端已有的 TypeSafe / OpenRouter / AI Gateway 密钥。没有密钥时在本地终端隐藏输入，或者稍后到看板的「连接设置」填写。密钥缺失时安装可以完成，但 **Jev 工具还不能正常使用**；补充密钥后重新连接 MCP。密钥不应粘贴到聊天、命令行参数或 GitHub。

指定 OpenRouter：

```sh
jev-observatory setup --provider openrouter
```

新安装的 Jev 放在数据目录，不依赖临时 npx 缓存，不会因清理 npx 缓存断开。安装只添加工具与观测链路，不强制 Agent 每条消息都调用 Jev。

## 支持哪些客户端

| 客户端 | 默认接入位置 |
| --- | --- |
| Codex | `$CODEX_HOME/config.toml` 或 `~/.codex/config.toml` |
| Cursor | `~/.cursor/mcp.json` |
| Claude Code | `~/.claude.json` 中的用户级 `mcpServers` |
| Claude Desktop | macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`；Windows：`%APPDATA%/Claude/claude_desktop_config.json` |

默认检测这些已存在的配置文件，并展示待修改清单。如果没有检测到配置，交互模式会让你选择客户端；也可以显式指定：

```sh
jev-observatory setup --client codex
jev-observatory setup --client cursor
jev-observatory setup --client claude-code
jev-observatory setup --client claude-desktop
```

项目级配置需要显式指定，安装器不会扫描所有项目或修改组织托管配置：

```sh
jev-observatory setup --client cursor --config /absolute/path/to/project/.cursor/mcp.json
jev-observatory setup --client claude-code --config /absolute/path/to/project/.mcp.json
```

Claude Code 项目作用域中的同名配置可能覆盖用户级配置；请接入实际生效的那份配置。其他客户端可使用兼容的 JSON `mcpServers` 文件，通过 `--client cursor --config ...` 接入；不宣称自动识别所有客户端。

自动识别 Jev 服务名或 `@jkudish/jev-mcp` 启动命令。已有 TypeSafe `evaluate mcp` 等其他 stdio 服务可显式指定条目（不会自动安装 TypeSafe 二进制）：

```sh
jev-observatory setup --client codex --server typesafe
```

不支持自动迁移远程 HTTP/SSE 服务、`envFile`、相对 `cwd` 或启动命令里的客户端变量。遇到这些情况保留原配置并说明原因。环境变量字段里的客户端插值仍由原客户端解析；已禁用的服务保留禁用状态。

客户端格式依据：[Codex MCP](https://developers.openai.com/codex/mcp/)、[Cursor MCP](https://cursor.com/docs/mcp)、[本地 MCP 接入](https://modelcontextprotocol.io/docs/develop/connect-local-servers)。上游服务与密钥说明：[Jev MCP](https://github.com/jkudish/jev-mcp)。

## 安装后如何自动运行

```text
Agent / MCP 客户端
       ↓ 调用原来的 Jev 工具名
本地 MCP 观察代理 ─────→ Jev MCP ─────→ 模型服务
       │                    ↓ 返回
       └──真实输入、阶段、返回、用量──→ 本机 SQLite
                                          ↓ 自动读取
                                      Jev 活动看板
```

- 客户端启动 MCP 时，代理检查并自动启动本机看板服务。只启动服务，不反复弹浏览器。
- 第一次 `tools/list` 自动读取上游工具列表，无需手动点击「发现工具」。安装和发现工具不会调用模型。
- 浏览器关掉仍会记录，重新打开即可查看。看板服务停掉也不影响代理写入；运行 `jev-observatory open` 可以再次启动。
- 右上角「停止监听」控制新调用的记录。停止期间 Jev 照常执行，历史保留，已开始的调用收齐结果；恢复后不补录停止期间的调用。
- 只观察经过代理的调用。其他客户端直接连 Jev、直接调用 SDK/API 的流量不会被捕获。
- 如果 Agent 没有调用 Jev，看板不会凭空产生记录。

安装向导不会偷偷改变模型选择，也不自动发起收费模型测试。真实 Jev 调用仍按你的供应商账户收费。

## 查看连接状态

```sh
jev-observatory doctor
jev-observatory doctor --discover
jev-observatory open
```

`stop` 只停止本工具启动且身份匹配的后台看板，不停止 Jev 或外部服务。安装意外中断留下 `setup.lock` 时，确认没有安装进程后可删除该锁文件。

`doctor` 检查配置、代理路径、声明的必需凭据和看板端口；`--discover` 额外通过真实 `tools/list` 验证上游连通，不调用模型。客户端动态注入的变量可能只有从客户端启动时才可用，终端检查不等于客户端已完成加载。

端口冲突时显式选择空闲端口，新接入的代理和看板共用这一设置：

```sh
jev-observatory setup --client cursor --port 4328
jev-observatory open --port 4328
```

已经接入的条目会保持原端口；要迁移它，先 restore，再用新端口 setup。其他服务占用的进程不会被安装器终止。

## 恢复与卸载

```sh
jev-observatory restore
# 或只恢复指定客户端：
jev-observatory restore --client cursor
jev-observatory stop
npm uninstall -g jev-observatory
```

先恢复配置、重启客户端，再卸载程序。对于接入前已有的 MCP，恢复原始启动方式；对于工具新建的 MCP，移除该条目。不会覆盖接入后你对该 MCP 的手动修改，也不会回滚其他客户端设置。

备份位于数据目录的 `integrations/<id>/`。`client.before` 是原配置备份，可能含你原来已有的密钥，请勿分享。历史、密钥、上游包和备份会保留；卸载后需要删除时，在相关进程停止后自行删除数据目录。

升级前先关闭 MCP 客户端、运行 `jev-observatory stop`，再运行新的版本安装命令和 `jev-observatory open`，最后重启 MCP 客户端。保持同一个全局安装位置。不要移动或删除正在被客户端配置引用的安装目录。已有旧版手工代理会被识别并跳过；旧版启动脚本保持原有启动方式。

## 可视化与计数

输入内容 → 工具和判断要求 → 实际返回 → 分类 / 打分 / 是非 / 其他 → 对应结果池。

候选名称、问题维度、概率、评分范围均取自输入声明与真实返回，不内置「重复玩法」等业务类别。未命中的候选仍展示。没有概率或分数范围时保持未知，不猜测高低档位。淡黄色只标记返回选择，不代表好坏。

- 顶部调用数：代理记录的 MCP 调用次数。
- 「本次」：当前一个调用中，命中该池子的返回项数。
- 「同规则累计」：本地记录里相同工具、候选与判断定义的命中项数；不是独立业务条目数。
- 「展示 x / y」：本次返回项的展示位置；不是模型运算进度。
- 同一内容被多次真实调用，每次返回都计入；动画回放不增加计数。
- 时长包含上游进程启动、连接和等待。用量仅显示上游明确返回的数据。

页面按持久游标顺序展示完成调用。动效发生在结果返回后，不揭示模型内部思考或真实内部进度，也不证明你的业务已经执行了某个动作。输入内容纵向滚动；输出、候选和历史各自分页，顶部统计固定。支持减少动态效果。

## 本地数据与安全边界

默认目录：macOS / Linux 为 `$XDG_DATA_HOME/mcp-observatory` 或 `~/.local/share/mcp-observatory`；Windows 为 `%LOCALAPPDATA%/mcp-observatory`。兼容旧安装的 `~/.local/share/jev-observatory`。

| 设置 | 用途 |
| --- | --- |
| `--data` / `MCP_OBSERVATORY_DATA` | 数据、凭据、备份目录 |
| `--port` / `MCP_OBSERVATORY_PORT` | 看板端口，默认 4318 |
| `MCP_OBSERVATORY_CONFIG` | 自定义上游配置；自动安装要求使用数据目录里的 `servers.json` |
| `MCP_OBSERVATORY_NO_AUTOSTART=1` | 代理仅记录，不自动启动看板服务 |

凭据以明文保存在本机独立文件，POSIX 上限制为当前用户权限；Windows 使用用户目录 ACL。输入输出仍可能含私密业务内容；已知密钥与常见敏感字段脱敏不能代替分享前检查。安装器不上传配置、密钥、日志或数据库。看板只绑定 loopback，有 Host / Origin / CSRF 检查；不支持公网部署和多用户访问。

代理目前仅支持 **stdio tools/list、tools/call**，每次工具调用启动一个上游进程，不支持跨调用会话、resources、prompts、sampling、elicitation 或其他交互回调。取消不能撤销上游已执行的外部动作。完整说明见 [SECURITY.md](SECURITY.md)。

## 开发

```sh
npm ci
npm test
node scripts/smoke.mjs
# 不装 Jev，不联网，不调用模型的本地示例：
npm run setup:demo
npm run discover
npm start
```

建议为示例指定独立 `MCP_OBSERVATORY_DATA`，避免混入真实历史。CI 覆盖 Linux、macOS、Windows；本地验证不会冒充其他系统的验证结果。

源码：`bin/` 安装与管理命令，`src/` 代理和本地服务，`public/` 界面，`test/` 隔离测试，`examples/` 通用配置。保留 `npm run config` 供不受安装向导支持的客户端生成手工配置。

MIT License。Jev MCP 是独立上游项目，按其自身许可证发布。
