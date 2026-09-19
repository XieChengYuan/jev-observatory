# Interface design

A restrained MCP activity workbench inspired by the user’s Jev reference: warm paper background, fine charcoal outlines, square panels, neutral probability bars and a pale yellow marker for the actual selected answer. Use monospace for timing, counts and tool identifiers; readable system Chinese typography for content. No red/green/blue business categories or decorative charts.

The fixed header contains call and usage metrics. The visual view connects an input panel to a Jev decision panel: tool, observable stage, four return-type tabs (分类 / 打分 / 是非 / 其他), declared candidates with actual probabilities or explicit score scales, actual return and destination pool. All candidate names come from MCP parameters and responses. An absent probability stays absent. Selection highlighting represents the recorded choice, not a judgment of good or bad. The bottom stage row contains only externally observed events, never internal reasoning.

The interface is a passive observer. Calls and returned items have separate counters. Pool totals group matching decision definitions; task/editorial reports never override them. A durable completion cursor feeds automatic presentation without dropping fast calls. Manual inspection and replay are optional. Reduced-motion mode displays the actual final result immediately.

No whole-page scrolling. Input content scrolls vertically within its panel without pagination; output, candidate options and call history paginate within their own content areas while metrics stay fixed. The visual and text views share the same real records. Remember the selected view. Motion stays on the connector, below text. Responsive layouts reduce spacing and rows per page rather than introduce scrolling.

Service names, tool descriptions, schemas and credential fields come from discovery or configuration. Credentials use password inputs and never echo saved values. Render untrusted content as escaped, readable text. The separate catalog application does not define this dashboard’s pools or counters.

The top-right listening switch controls proxy recording, persisted across sessions and shared by all connected providers. Disabled recording never blocks upstream execution. Previously accepted calls finish their recorded lifecycle; calls started while disabled are not recorded or backfilled.
