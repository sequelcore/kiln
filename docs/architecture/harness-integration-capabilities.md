# Harness Integration Capabilities

Kiln is the canonical control plane for local agent harness integration. Claude
Code, Codex, and OpenCode do not share a universal bootstrap configuration
backend today, so Kiln must integrate through each harness capability instead
of pretending one projection mechanism is enough.

This document owns the doctrine for harness integration strategy. Config file
shape, sync, install-state, and drift behavior remain owned by
`config-projection.md`.

## Capability Model

Each harness integration declares explicit support for:

- runtime config injection
- native projection
- native config import
- MCP runtime tools
- hooks

The CLI source of truth is
`packages/cli/src/config/harness-integration-capabilities.ts`. Other CLI config
modules may consume that model, but they must not recreate harness capability
tables locally.

## Runtime Config Injection

Runtime config injection is preferred when Kiln launches the child process and
the harness exposes a documented startup mechanism that can carry resolved
Kiln configuration into that process.

Runtime injection is scoped to Kiln-launched processes. It does not configure a
developer's standalone shell invocation unless the harness itself reads the
same injected source.

Current status:

| Harness | Status | Mechanism |
|---------|--------|-----------|
| Claude Code | Not proven | No canonical external Kiln config backend found |
| Codex | Supported | `CODEX_HOME` plus CLI config overrides for Kiln-launched processes |
| OpenCode | Supported | `OPENCODE_CONFIG_CONTENT` for Kiln-launched processes |

For OpenCode, Kiln injects process-scoped config before `opencode serve`
starts. The wrapper also reconciles permission, MCP, batch-tool, and model
settings through the OpenCode SDK after startup, so startup config and live
runtime config converge on the same Kiln-owned values.

For Codex, live proof on 2026-05-07 verified that `CODEX_HOME` changes the
runtime home used by `codex debug prompt-input`, and `CodexSession` already
passes process-scoped startup overrides for model, approval, sandbox, and
related execution flags. This is not a claim that standalone Codex reads Kiln
global config directly.

Codex runtime output can include non-fatal native diagnostics that are not turn
failures. The wrapper must classify those diagnostics at the adapter boundary
and keep the canonical session stream focused on real failures, completed
work, cost, file changes, and tool evidence. This is a compatibility boundary
for the Codex CLI stream, not durable product doctrine; if Codex exposes
structured diagnostic severities, Kiln should consume that structure instead
of matching message text.

## Native Projection

Native projection remains valid, but it is an artifact strategy, not the
architecture. Kiln uses native projection when:

- the harness requires persistent native files for standalone usage
- the integration surface is a native agent, skill, hook, MCP, or settings file
- runtime injection is unsupported or insufficient for the selected surface

Native projection must remain governed by install-state, drift detection,
append-only backups, and explicit uninstall behavior.

## Native Config Import

Native config import is narrower than native projection. It is allowed only when
Kiln can represent the native setting in canonical global config without
guessing or preserving provider-specific baggage.

Current status:

| Harness | Status | Reason |
|---------|--------|--------|
| Claude Code | Unsupported | Settings shape is broader than Kiln's current canonical import contract |
| Codex | Supported | Provider, model, approval, and sandbox map cleanly |
| OpenCode | Supported | Provider, model, and default permission map cleanly |

## Harness Doctor

Harness doctor is the read-only installation health view for local harnesses.
It reports evidence; it does not repair PATH, install packages, uninstall
aliases, rewrite native files, or select hidden fallback binaries.

The canonical report includes:

- resolved executable path and version for Kiln, Codex, and OpenCode;
- all matching executable entries discovered on PATH;
- competing executable warnings when command resolution may drift;
- auth state, discovery status, and model evidence from shared provider model
  discovery;
- zero automatic repair actions.

Global `kiln` drift is expected during local development. The global command
may point at the last installed release while source runs use the working tree.
Doctor should report that as release/install evidence, not mutate the
developer environment. The global command updates only when a new release is
installed.

## MCP And Hooks

MCP and hooks are complementary integration mechanisms.

- MCP exposes runtime tools after the harness has started. It does not replace
  bootstrap configuration unless a harness explicitly reads startup config
  through MCP, which Claude Code, Codex, and OpenCode do not currently do as a
  shared standard.
- Hooks are native harness extension points and must be projected according to
  the harness capability table.

## Invariants

- Kiln config remains canonical; native files are derived artifacts.
- A harness capability must be proven before code or docs claim support.
- Runtime injection must be process-scoped unless the harness documents a
  standalone config backend.
- Native projection is not a quick fix. It is allowed only as a governed
  projection strategy with ownership, drift detection, and removal semantics.
- GUI, TUI, CLI, MCP, and runtime surfaces consume resolved integration
  capabilities; they do not infer harness behavior independently.
