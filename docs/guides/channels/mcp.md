# Canonical MCP

Kiln owns MCP configuration. Native Codex, Claude Code, and OpenCode files are
projections, not additional sources of truth. Supported transports are `stdio`
and MCP Streamable HTTP; legacy HTTP+SSE is intentionally unsupported.

## Configuration and precedence

Global servers live under `mcp.servers` in `~/.kiln/config.yaml`. Project
servers use the same shape in the bound private project's `config.yaml`. A project may add a server,
override common fields, replace a transport only with a complete definition,
narrow global admission, or disable a global server. Invalid or widening
overrides fail closed and retain source-path and field provenance in status.

```yaml
# ~/.kiln/config.yaml
version: "1"
mcp:
  servers:
    docs:
      transport: streamable-http
      url: https://mcp.example.com/mcp
      headers:
        Authorization: { fromCredential: docs-token }
      startupTimeoutMs: 30000
      requestTimeoutMs: 120000
      maxCapabilities: 64
      reconnect: { maxAttempts: 3, initialDelayMs: 500, maxDelayMs: 5000 }
      admission:
        state: admitted
        tools: { allow: [search] }
      trust: verified
```

```yaml
# private project config.yaml
version: "1"
mcp:
  servers:
    docs:
      requestTimeoutMs: 30000
      admission:
        state: admitted
        tools: { allow: [search] }
    local-fixture:
      transport: stdio
      command: node
      args: [tests/fixtures/mcp-server.mjs, "argument with spaces"]
      cwd: .
      admission: { state: admitted }
      trust: local
    inherited-but-disabled:
      enabled: false
```

Stdio arguments remain an array and are never shell-split. `%NAME%` expansion
is supported for Windows arguments and paths. Environment/header maps use
`{ value }`, `{ fromEnv }`, or `{ fromCredential }`. Sensitive header and
environment names cannot contain literal values.

## Credentials

`fromCredential` values are encrypted with AES-256-GCM in
`~/.kiln/mcp-secrets.json`. Set the operator-owned master key, then import a
value without placing it on the command line:

```powershell
$env:KILN_MCP_SECRET_KEY = '<operator master key>'
$env:DOCS_MCP_TOKEN = '<token>'
kiln mcp-config --credential docs-token --from-env DOCS_MCP_TOKEN
Remove-Item Env:DOCS_MCP_TOKEN
```

Missing master keys, variables, or credential ids are configuration errors.
Diagnostics contain reference ids, never secret values.

## Admission and effects

Server admission is explicit. Tool, resource, and prompt allow/deny lists use
server-local names. Runtime identities are qualified, for example
`mcp:docs:tool:search`; agent scopes and managed routes must use that selector.

MCP annotations and descriptions are untrusted. Unknown tools receive Kiln's
conservative mutation envelope. Operators may declare a complete maximum effect
under `admission.effects.<tool-name>`; Kiln's normal authorization and approval
pipeline then decides each call. Resource and prompt contents remain untrusted
model input and must be admitted narrowly.

## Inspect, test, synchronize, and remove

```text
kiln config read --view mcp
kiln mcp-config --test [--server <id>]
kiln mcp-config [--client codex|claude|opencode|all]
kiln mcp-config --repair [--client <harness>]
kiln mcp-config --uninstall [--client <harness>]
```

The connection test initializes and discovers but never executes a capability.
Status reports source, transport, admission, trust, health/discovery counters,
compatibility, install state, and drift. GUI Configuration Health and TUI setup
consume the same contract.

Projection preserves unmanaged keys, backs up before mutation, records exact
owned fields in the global native-projection install state under
`~/.kiln/runtime/native-projections/`, refuses unmanaged id collisions,
detects drift, and never replaces malformed native files. Repair is explicit;
uninstall removes only recorded fields.

Codex, Claude Code, and OpenCode projection installs one user-scoped
`kiln-control-plane` declaration per harness. Each harness starts
`kiln native-harness control-plane-mcp --harness <harness>` as a short-lived
stdio bridge. The bridge derives the adopted project from its working
directory and authenticates to one global loopback Operator Runtime. Sessions
for the same project share one lazy project Runtime; different projects remain
isolated. This provides Kiln inspection, sanitized account-usage inspection,
and bounded control-plane tools without starting the HTTP Model Gateway. It
does not run a harness's native subagents or tools.

The bridge also publishes a compact server-level instruction component shared
with the `kiln-control-plane-workflow` built-in. The server instruction covers
the critical discovery, governance, idempotency, asynchronous-lifecycle, and
no-fallback invariants; the progressively loaded skill carries the full
procedure. Both are projections of one Core-owned contract rather than separate
prompt doctrine.

### Control-plane projection boundary

`kiln-control-plane` is a governed projection for native-harness context, not a
command-for-command mirror of the Kiln CLI. The CLI serves direct operator
workflows and may expose details such as local paths or account email addresses
that must not enter model context. The control-plane bridge exposes only
bounded operations with trusted caller identity, explicit authority,
constrained inputs, and sanitized structured output. It never exposes secrets,
credential material, raw provider responses, storage paths, configuration,
environment values, or account PII.

CLI and MCP operations may use the same canonical application owner without
having identical commands or fields. A missing CLI operation on the MCP bridge
is therefore not, by itself, a parity defect. Admit a new control-plane tool
only when a native-harness task requires it and the existing owner can project
the operation without creating a second authority or widening the information
available to model context. Otherwise, keep the workflow on an operator
surface. Native harnesses discover safe configured-agent identities and
eligibility through `kiln_capability_inspect`; that projection does not expose
route configuration. Agent Task operations are exactly `kiln_agent_task_submit`,
`kiln_agent_task_status`, `kiln_agent_task_result`, `kiln_agent_task_cancel`,
and `kiln_agent_task_replay`. See
[Agent Tasks and Agent Runs](../../architecture/coordination/agent-tasks.md) for
the current task projection and its field-level boundaries.

The distinct identity does not overwrite an operator's existing `kiln tools
--mcp` server. Projection rejects reserved-id collisions, malformed native
files, and drift; uninstall removes only recorded owned fields. Repository-local
legacy declarations are not read, migrated, or treated as runtime authority.

## Runtime surfaces

Direct-provider, CLI, GUI, and TUI sessions create Kiln-owned clients and do not
depend on native files. MCP is a consultation/configuration/tool surface, not a
required subagent transport. Managed execution admits MCP only when the
selected `authorityProfiles[].tools.allowed` contains the qualified selector. App
Gateway `app.yaml` contains canonical server ids only:

```yaml
mcp:
  servers: [docs]
```

Gateway startup fails for missing references or discovery failure. App and
tenant allowlists apply before external execution. Native harnesses receive only
representable projections; unsupported timeout, credential, resource/prompt, or
tool-policy features produce explicit incompatibility instead of weakening.

## Roblox Studio on Windows

Roblox's built-in Studio server is a normal stdio definition:

```yaml
mcp:
  servers:
    roblox-studio:
      transport: stdio
      command: cmd.exe
      args: [/c, "%LOCALAPPDATA%\\Roblox\\mcp.bat"]
      admission:
        state: admitted
        tools:
          allow: [<reviewed read-only Studio capability names>]
          deny: [subagent]
      trust: local
```

Start with discovery only. After reviewing the current catalog, assign observe
effects only to inspection capabilities. Keep script edits, Luau execution,
asset insertion/upload, generated content, play-mode changes, input simulation,
navigation, and `subagent` outside the allowlist or behind explicit mutation
approval. The core domain contains no Roblox tool-name special cases.

For supervised acceptance, use a disposable place: enable Studio MCP, test the
connection, inspect status, sync Codex, invoke one admitted inspection through
Kiln, verify a mutation requests approval and is audited, disable the server,
verify it disappears, then uninstall Codex projection and compare unrelated
settings. Never mutate a valuable place.

### Local acceptance evidence (2026-07-19)

The official Windows launcher was found at
`%LOCALAPPDATA%\Roblox\mcp.bat`; it delegates to Roblox's `StudioMCP.exe`.
Roblox Studio was not running during verification, so Kiln did not start the
launcher or claim a live place inspection without an operator-selected
disposable place. The deterministic stdio fixture proves the same Kiln-owned
connect/discover/authorize/execute/audit/disable lifecycle in CI. The live
Studio discovery, read-only inspection, mutation-approval observation, and
post-uninstall comparison remain the supervised steps above.

## Troubleshooting

- Missing reference: set the named environment value or unlock/import the
  credential; values remain redacted.
- Startup timeout: verify the exact executable, array arguments, working
  directory, and stderr. JSON-RPC must stay on stdout.
- Incompatible projection: use Kiln-owned direct execution or explicitly revise
  canonical policy; omission is not automatic.
- Drift: inspect the native file and install state before `--repair`.
- Changed catalog: rediscover and re-review. New names are not granted by prior
  qualified allowlists.

See [ADR-009](../../adr/ADR-009-canonical-mcp-ownership-and-execution.md) and the
[tool-poisoning evidence](../../research/foundations/agent-security-and-authority.md).
