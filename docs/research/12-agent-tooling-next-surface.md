# Agent Tooling Next Surface Research

## Purpose

This note starts the second shared-tooling program after the first developer
tool foundation closed on 2026-04-29. It informed the now-complete
`docs/architecture/shared-tooling-intelligence.md` program. Later interactive
browser and computer-use doctrine was absorbed into
`docs/architecture/developer-tools.md` and `docs/guides/tool-use.md`.

The research focus is not another copy of file/edit/search tools. The next
gaps are semantic code intelligence, bulk context ingestion, long-running
monitors, tool catalog scaling, MCP resources, task state, and operator
elicitation.

## Sources Reviewed

- Claude Code tools reference:
  https://code.claude.com/docs/en/tools-reference
- Claude API tool search:
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
- Claude Agent SDK todo tracking:
  https://platform.claude.com/docs/en/agent-sdk/todo-tracking
- Gemini CLI tools overview:
  https://google-gemini.github.io/gemini-cli/docs/tools/
- Gemini CLI multi-file read:
  https://google-gemini.github.io/gemini-cli/docs/tools/multi-file.html
- Gemini CLI memory tool:
  https://google-gemini.github.io/gemini-cli/docs/tools/memory.html
- OpenCode tools reference:
  https://open-code.ai/en/docs/tools
- OpenCode CLI reference:
  https://opencode.ai/docs/cli/
- OpenAI Codex upgrades:
  https://openai.com/index/introducing-upgrades-to-codex/
- OpenAI Codex agent loop:
  https://openai.com/index/unrolling-the-codex-agent-loop/
- MCP tools specification:
  https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP resources specification:
  https://modelcontextprotocol.io/specification/draft/server/resources
- MCP elicitation specification:
  https://modelcontextprotocol.org/specification/draft/client/elicitation
- MCP sampling specification:
  https://modelcontextprotocol.io/specification/2025-11-25/client/sampling
- User reports on tool context and search friction:
  https://www.reddit.com/r/ClaudeCode/comments/1suk0ek/claude_code_removed_glob_and_grep_on_native/
  and
  https://www.reddit.com/r/ClaudeAI/comments/1skd722/i_had_to_take_away_claudes_bash_tool_it_kept/
- User reports on MCP resources and session-history friction:
  https://www.reddit.com/r/GeminiCLI/comments/1m7mkdk/mcp_resource_type_for_gemini_cli/
  and
  https://www.reddit.com/r/GoogleGeminiAI/comments/1sw8l86/built_an_app_to_search_gemini_cli_session_history/

## Findings

### Tool Catalogs Need Lazy Discovery

Claude's tool search feature exists because large tool libraries consume
context and degrade tool selection. The documented thresholds are practical:
tool definitions above tens of thousands of tokens and catalogs above dozens of
tools need search and deferred loading. Kiln currently has a manageable builtin
surface, but MCP servers, skills, package tools, and future app integrations can
push the catalog into this failure mode.

The long-term answer is not hiding tools in prompts. Kiln needs a canonical
tool catalog index with searchable descriptions, argument metadata, authority
classification, and deferred projection.

### MCP Structured Output Should Become A First-Class Contract

The MCP tools specification supports `outputSchema`, structured content,
resource links, embedded resources, and annotations. Kiln already has stable
core metadata, but the next maturity step is exposing structured output schemas
for builtin tools instead of relying on text plus metadata conventions.

This matters for consumers beyond the GUI and TUI: MCP clients, SDK callers,
and future tool-search indexes need machine-readable output contracts.

### Semantic Code Intelligence Is Now Expected

Claude Code exposes an LSP tool with definitions, references, hover, symbols,
implementations, diagnostics, and call hierarchy. OpenCode documents an
experimental `lsp` tool with a similar operation set. Users can approximate
some of this with `grep`, but grep cannot replace type-aware navigation,
diagnostics, or symbol-level dependency analysis.

Kiln should add semantic code intelligence as a shared core capability with an
adapter boundary for language servers. It must not become a GUI or IDE-only
feature.

### Bulk Context Read Is A Distinct Tool

Gemini CLI exposes `read_many_files` because agents often need a bounded
multi-file context packet, not one `read` call per file. It supports include
and exclude patterns, default excludes, gitignore respect, and explicit
multimodal file inclusion.

Kiln has `read`, `glob`, `grep`, `tree`, and image tools. It still lacks a
single bounded context-packet tool that can collect many text files, include
selected image/PDF assets by policy, summarize skipped binaries, and return
structured provenance.

### Long-Running Work Needs Monitors, Not Larger Timeouts

Claude Code's Monitor tool lets the agent watch logs, CI, dev servers, or
polling scripts in the background and react to new output. Codex emphasizes
terminal logs, test results, and sandbox/network controls for longer work.

Kiln fixed timeout propagation for one-shot commands. The long-term solution
for dev servers, watch tests, and CI polling is a monitor/task process model
with start/status/read/stop semantics, streaming events, bounded output, and
explicit lifecycle metadata.

### Task State Is A Tool Surface, Not Just UI

Claude, OpenCode, and Codex all expose some form of task or todo state for
multi-step work. Claude's Agent SDK documents predictable todo lifecycle
states. OpenCode has `todowrite` and `todoread`. Codex advertises progress
tracking for complex work.

Kiln already has external planning helpers in the agent environment, but the
product needs a shared task-state contract that CLI, GUI, TUI, MCP, and SDK
consumers can observe consistently.

### Operator Questions Need A Canonical Elicitation Boundary

OpenCode has a `question` tool for asking users structured questions during a
task. MCP elicitation provides form and URL modes, including clear security
rules: secrets should use URL mode rather than passing credentials through the
client. MCP sampling similarly keeps client control over model access and asks
for human review.

Kiln should implement operator elicitation as a runtime/operator capability,
not as ad hoc GUI modals or CLI prompts. It must support all consumers through
one contract and respect sensitive-data boundaries.

### MCP Resources Are The Right Context Plane

MCP resources are application-driven context items with URIs, MIME types,
resource templates, pagination, optional subscriptions, and list-changed
notifications. They are a better fit than tools for stable context such as
workspace files, generated summaries, plans, task records, and session
artifacts.

Kiln should expose selected context artifacts as resources without making
resources a second execution path. Resources provide context; tools perform
actions.

## Design Principles For Kiln

- Keep builtin tool definitions and metadata in `@kilnai/core`.
- Add output schemas before adding more high-volume tools.
- Treat semantic code intelligence as a shared capability, not an IDE feature.
- Use monitors for ongoing processes instead of inflating `bash` timeouts.
- Treat task state and elicitation as cross-surface runtime contracts.
- Use MCP resources for selectable context and subscriptions, not action.
- Continue fail-closed defaults for network, shell, write, and sensitive user
  input boundaries.
- Every new surface must project to CLI, GUI, TUI, MCP, and SDK consumers from
  the same contract.
