# Canonical MCP Integration Research

Date: 2026-07-19

Status: implementation basis

This dossier records the evidence used to complete Kiln's MCP bounded context.
It separates protocol requirements, harness behavior, security findings,
community/operator needs, and Kiln decisions. The implementation and ADR remain
authoritative when this note reports a later change.

## Verified protocol facts

The current stable protocol is MCP `2025-11-25`. Its two standard transports are
stdio and Streamable HTTP. Streamable HTTP replaced the legacy HTTP+SSE
transport; legacy fallback is optional compatibility behavior, not a current
transport requirement. In stdio, the client owns the child process, stdout is
reserved for newline-delimited JSON-RPC, and stderr is the logging channel.
Streamable HTTP uses one endpoint supporting POST and GET, may use SSE within
that transport, and requires origin validation and authentication-aware
deployment controls.

Tools, resources, and prompts are independently negotiated server
capabilities. Their list operations are paginated and may advertise
`listChanged`. Prompt invocation is user-controlled by protocol design.
Resources and prompt results are untrusted content, not instructions with
authority. The schema explicitly states that tool annotations are hints and
must not drive tool-use decisions for untrusted servers.

HTTP authorization is based on OAuth 2.1-era resource-server behavior and
protected-resource metadata. Access tokens belong in the Authorization header,
never a URL. Stdio does not use the HTTP authorization flow; credentials are
provided through the process environment.

Primary sources:

- Model Context Protocol, [Transports, version
  2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
  updated 2025-11-25.
- Model Context Protocol, [Authorization, version
  2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
  updated 2025-11-25.
- Model Context Protocol, [Schema reference, version
  2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/schema),
  updated 2025-11-25.
- Model Context Protocol, [Resources, version
  2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/resources),
  updated 2025-11-25.
- Model Context Protocol, [Prompts, version
  2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts),
  updated 2025-11-25.
- Official TypeScript SDK, [client guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md),
  inspected 2026-07-19. The repository identifies v1 as the production line
  while v2 remains pre-release; Kiln currently depends on SDK `1.26.0`.

## Verified native harness behavior

### Codex

Codex supports stdio and Streamable HTTP in global `~/.codex/config.toml` and
trusted project `.codex/config.toml`. Stdio supports `command`, argument arrays,
environment, forwarded environment-variable names, and `cwd`. HTTP supports
URL, OAuth, bearer-token environment references, static headers, and
environment-backed headers. The cloned source additionally proves startup and
tool timeouts, enabled/disabled tool lists, and default tool approval modes.

Evidence:

- OpenAI, [Codex MCP documentation](https://developers.openai.com/codex/mcp),
  inspected 2026-07-19.
- `<sequel-root>/cloned/codex`, commit
  `db887d03e1f907467e33271572dffb73bceecd6b` dated 2026-06-30, especially
  `codex-rs/config/src/mcp_types.rs` and `codex-rs/core/src/connectors.rs`.

### Claude Code

Claude Code supports stdio and HTTP (`streamable-http` is accepted as an alias
for `http`). Project `.mcp.json` servers require a workspace trust decision.
Its precedence selects the complete highest-priority server definition rather
than field-merging definitions across scopes. Native Windows package launchers
commonly require `cmd /c`. The cloned source handles tool, prompt, and resource
list-change notifications, exposes per-agent MCP requirements, applies managed
server allow/deny policy, and performs explicit process cleanup.

Evidence:

- Anthropic, [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp),
  inspected 2026-07-19.
- `<sequel-root>/cloned/claude-code`, commit
  `3136b1ba9779c91f74cd8ceabc8574d84880a0c9` dated 2026-07-01, especially
  `services/mcp/types.ts`, `services/mcp/config.ts`,
  `services/mcp/client.ts`, and `services/mcp/useManageMCPConnections.ts`.

### OpenCode

OpenCode supports local stdio and remote Streamable HTTP servers. Local commands
are arrays, so argument boundaries remain lossless. Both forms support enabled
state and a discovery timeout; local supports cwd and environment, while remote
supports headers and OAuth. MCP tools are server-prefixed and can be narrowed
per agent through wildcard permissions. The implementation discovers tools,
resources, resource templates, and prompts, reacts to tool-list changes, and
keeps OAuth credentials outside configuration.

Evidence:

- OpenCode, [MCP servers](https://opencode.ai/docs/mcp-servers/), inspected
  2026-07-19.
- `<sequel-root>/cloned/opencode`, package version `1.17.12`, captured
  2026-07-01, especially `packages/opencode/src/mcp/index.ts`,
  `packages/opencode/src/mcp/catalog.ts`, and
  `packages/opencode/src/mcp/auth.ts`.

### Roblox Studio acceptance server

Roblox Studio's official built-in server is stdio. On Windows the documented
definition is `cmd.exe` with arguments `/c` and
`%LOCALAPPDATA%\\Roblox\\mcp.bat`. It can inspect and mutate the open place, so
connection alone cannot imply mutation authority.

Source: Roblox Creator Hub, [Connect to the Roblox Studio MCP
server](https://create.roblox.com/docs/studio/mcp), inspected 2026-07-19.

## Security evidence

Tool descriptions, schemas, annotations, resource bodies, prompt bodies, server
instructions, icons, and capability changes are attacker-controlled input.
Established research identifies tool poisoning, cross-tool shadowing, rug-pull
descriptor changes, implicit trust propagation, confused authority, secret
exfiltration, and insufficient audit as practical risks. Prompt-only controls
are not an authorization boundary.

Sources:

- Microsoft, [Protecting against indirect injection attacks in
  MCP](https://developer.microsoft.com/blog/protecting-against-indirect-injection-attacks-mcp),
  2025-04-28.
- Microsoft, [Securing MCP: A control plane for agent tool
  execution](https://developer.microsoft.com/blog/securing-mcp-a-control-plane-for-agent-tool-execution),
  2026-05.
- GitHub, [Safeguarding VS Code against prompt
  injections](https://github.blog/security/vulnerability-research/safeguarding-vs-code-against-prompt-injections/),
  2025.
- Huang et al., [Model Context Protocol Threat Modeling and Analyzing
  Vulnerabilities to Prompt Injection with Tool
  Poisoning](https://arxiv.org/abs/2603.22489), 2026-03-23, preprint.
- Jamshidi et al., [Securing the Model Context Protocol: Defending LLMs
  Against Tool Poisoning and Adversarial
  Attacks](https://arxiv.org/abs/2512.06556), 2025-12-06, preprint.

## Repository facts verified before implementation

- `KilnYamlMcpServer` exists in the CLI YAML contract, but it lacks timeout,
  retry, secret-reference, admission, trust, effect, and provenance fields.
- Global and project MCP definitions currently field-merge without rejecting a
  transport change or malformed partial override.
- `ProviderCreateConfig.mcpServers` reaches Claude Code and an incorrect
  OpenCode URL projection, but normal CLI/GUI/TUI callers do not populate it;
  Codex is marked as MCP-incompatible in the wrapper registry.
- `@kilnai/core` has an HTTP-only `McpClient`; its production consumer is the
  App Gateway app loader. Stdio is absent from that client boundary.
- App YAML supports `requestTimeoutMs`, while local Kiln YAML does not.
- Existing MCP annotations become informational tags. The runtime's actual
  effect-envelope authorizer is separate and can host the required fail-closed
  policy.
- `kiln mcp-config` independently edits native files, resets malformed input to
  an empty document, splits CLI argument strings on spaces, and retains legacy
  SSE generation. It is outside install-state ownership and competes with the
  canonical native projection path.
- Current operator setup evidence reports pre-existing drift for Codex and
  OpenCode native config. New projection work must preserve and report it.

## Kiln design decisions

1. Kiln owns one canonical MCP server identity per effective project. Global
   and project declarations resolve before any runtime or native adapter runs.
2. A project may add, inherit, replace allowed fields, narrow admission, or
   disable a global server. Transport changes require a complete replacement;
   partial cross-transport overrides fail closed. Provenance is retained per
   effective field.
3. Stdio and Streamable HTTP are the only canonical transports. Legacy SSE and
   WebSocket are explicit incompatibilities, not silent fallbacks.
4. Secrets are referenced by environment or Kiln credential identity. Resolved
   values never enter canonical snapshots, transcripts, diagnostics, or native
   project files.
5. External capability identity is server-qualified. Native harness-specific
   names are projections and never canonical identity.
6. Server and capability admission are explicit. Discovered does not mean
   admitted. An MCP annotation may be displayed as an untrusted hint but cannot
   select an effect or approval policy.
7. Admitted MCP tools are adapted into Kiln's existing `DevTool` execution,
   effect-envelope, authorization, audit, transcript, and progressive catalog
   machinery. Direct-provider execution never depends on native config.
8. Resources and prompts remain separately admitted, namespaced, bounded, and
   user-selected. Server instructions are untrusted metadata and are not
   injected as system authority.
9. Native projection is derived from effective canonical state through the
   existing backup, managed-field, install-state, drift, repair, and uninstall
   services. Malformed native files block projection; they are never replaced
   with empty documents.
10. OAuth automation, sampling, elicitation, server-initiated roots, and
    experimental MCP tasks are deferred until Kiln has explicit operator UX and
    authority contracts for them. Static/bearer header references remain
    supportable for Streamable HTTP without embedding secrets.

## Operator needs treated as requirements

The implementation must make startup failure, missing secrets, Windows command
expansion, timeout, cancellation, reconnect state, tool-name collisions,
catalog size, capability changes, project trust, per-agent allowlists, tenant
isolation, projection drift, repair, and uninstall observable. It must never
silently omit an unsupported server or widen permissions to fit a harness.
