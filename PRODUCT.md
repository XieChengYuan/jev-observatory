# Product scope

Jev活动看板 is a local workbench for inspecting tool calls across configurable stdio MCP servers. Its core concepts are service, tool, call, observable stage and result. No provider or downstream business category is required.

The primary workflow is install the CLI, run setup to wrap an existing Jev service or provision one, supply credentials locally, restart the MCP client, and inspect real calls. The proxy automatically discovers tools and starts the optional local dashboard service. Setup backs up and patches supported client configuration; restore changes only the wrapped entries. The primary surface is passive observation. It automatically displays each completed call in order, keeps observable live stages visible, expands inputs and outputs, and visualizes upstream-reported token usage. There is no manual tool runner in the UI.

Provider-specific classification and deduplication workflows belong in separate applications built on this base. The dashboard must distinguish an observed result from an inferred internal process, and a successful tool response from a successfully achieved business objective.

Current boundary: single-user local deployment, tools-only stdio gateway, new upstream process per call. Remote transports, session persistence, resources and interactive callbacks are future work rather than advertised capabilities.

The complete visual chain is input content → invoked tool and declared decision requirements → actual returned values → result type → dynamically declared result pools. Unknown output shapes retain their actual content in the other lane. No business outcome, editorial decision or assistant-authored status supplies these nodes or counters.
