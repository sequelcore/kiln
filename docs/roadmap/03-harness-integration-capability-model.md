# Harness Integration Capability Model

Status: Active
Opened: 2026-05-07

## Objective

Replace implicit native-projection assumptions with a capability-driven
integration model for Claude Code, Codex, and OpenCode.

Kiln remains the canonical control plane. Each harness adapter must declare the
mechanisms it actually supports: runtime config injection, native projection,
plugin packaging, MCP runtime tools, and hooks.

## Scope

- Add a single CLI-owned capability model for supported harnesses.
- Make sync/import/projection code consume that model instead of recreating
  harness lists.
- Preserve existing governed native projection behavior while making it one
  strategy among explicit capabilities.
- Document runtime injection as supported only where proven.
- Add tests that block unsupported capability claims.

## Non-Goals

- Do not invent a universal external config backend that Claude Code, Codex,
  and OpenCode cannot consume today.
- Do not remove native projection while standalone harness usage still requires
  native files.
- Do not claim Codex runtime config injection until a live proof verifies the
  startup mechanism.
- Do not add compatibility versions or migration shims.

## Acceptance Criteria

- `docs/architecture/harness-integration-capabilities.md` is canonical.
- `packages/cli/src/config/harness-integration-capabilities.ts` is the source
  of truth for harness capability declarations.
- Native projection policy imports supported harnesses from the capability
  model.
- OpenCode runtime config injection is represented as process-scoped
  `OPENCODE_CONFIG_CONTENT`.
- Kiln-launched OpenCode harness sessions inject `OPENCODE_CONFIG_CONTENT`
  before `opencode serve` starts and reconcile the same values through SDK
  config update after startup.
- Codex runtime config injection is represented as process-scoped `CODEX_HOME`
  plus CLI config overrides after live proof on 2026-05-07.
- Claude Code runtime config injection remains false until proven.
- Focused CLI tests and full repo quality gates pass.

## Follow-Up Slices

1. Evaluate Claude Code plugin packaging as a governed integration artifact.
2. Extend `kiln sync` diagnostics so operators can see whether a surface used
   runtime injection, native projection, plugin packaging, MCP, or hooks.
