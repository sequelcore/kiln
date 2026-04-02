# Phase 4.5 Implementation Plan: Permission & Safety

> Updated: 2026-04-01. Sources: local scouts of `codex`, `claude-code`, `opencode`, `hermes-agent`, and current Kiln implementation.

## Objective

Phase 4.5 is no longer about inventing policy shape. That shape already exists.
The remaining work is to make policy **enforceable**, **auditable**, and
consistent across backends.

Goals:

- Make a canonical permission decision engine the source of truth
- Enforce file/data governance from policy, not only from backend defaults
- Preserve backend translation as adapter logic, not policy logic
- Harden safety on known prompt-injection and dangerous-exec gaps

---

## Current Status (Already Landed)

These capabilities are already in repo and are **not** the remaining 4.5a scope:

- Rich policy types in [session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/session.ts)
  - tool rules, command rules, file governance, data firewall, agent scopes, `safeDefaults`
- YAML support for permission fields in [kiln-yaml-types.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/kiln-yaml-types.ts)
- Config command keys for permission fields in [config.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/commands/config.ts)
- Policy normalization and safe-default expansion in [permission-normalizer.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/permission-normalizer.ts)
- Coarse backend translation in [session-registry.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/session-registry.ts)
- Existing safety pipeline and prompt scanning in:
  - [safety-middleware.ts](/C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/safety-middleware.ts)
  - [prompt-scanner.ts](/C:/Proyectos/Sequel/kiln/packages/core/src/security/prompt-scanner.ts)

Additional progress now landed inside Phase 4.5 implementation:

- `4.5a` canonical decision engine in
  [permission-evaluator.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/permission-evaluator.ts)
  with tests in
  [permission-evaluator.test.ts](/C:/Proyectos/Sequel/kiln/packages/cli/tests/wrapper/permission-evaluator.test.ts)
- `4.5b` translation contract expansion in
  [session-registry.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/session-registry.ts)
  with richer translation metadata for native rules, unsupported rules,
  warnings, and deterministic constraint instructions
- partial backend adapter consumption of translation output in:
  - [claude-code-process.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/claude-code-process.ts)
  - [codex-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/codex-session.ts)
  - [opencode-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/opencode-session.ts)

---

## Design Inputs From Competitor Scouts

- Codex: strongest granular/session-grant model
  - steal: scoped grants, explicit requested-vs-granted semantics
- Claude Code: strongest decision reason and boundary validation discipline
  - steal: structured reasons, strict path validation, denial tracking behavior
- OpenCode: strongest simple rule UX
  - steal: last-match-wins semantics, simple wildcard policy model
- Hermes: strongest approval timeout behavior
  - steal: timeout-to-deny and clear allow-once/session/always mental model

These inform enforcement and UX contracts, not backend-specific copy/paste.

---

## Remaining Gap

Kiln has policy schema + normalizer, but does not yet have a canonical
evaluator that decides `allow | ask | deny` consistently before execution.

Missing enforcement pieces:

- canonical decision object with matched rule and reason
- deterministic evaluation for tool/command/path/agent/destination
- consistent scope handling for agent-specific policy
- policy-driven file/data governance enforcement points

---

## Sub-Phase Plan

### 4.5a — Canonical Permission Decision Engine

**Status:** COMPLETE

**Scope (implemented):**

- Build pure evaluator module in `packages/cli/src/wrapper/` (single source of truth)
- Evaluate normalized policy across:
  - tool actions
  - command patterns
  - file governance (`denyGlobs`, `askGlobs`, `allowGlobs`)
  - data firewall destinations
  - agent scope overlays
- Return structured decision model:
  - `action`: `allow | ask | deny`
  - `surface`: tool/command/file/destination
  - matched rule metadata
  - reason/source fields where available

**Out of scope for 4.5a:**

- backend sync format changes
- remembered approvals persistence
- runtime/UI wiring
- safety classifier hardening

**Primary files:**

- new: `packages/cli/src/wrapper/permission-evaluator.ts` (or equivalent)
- tests: `packages/cli/tests/wrapper/*`
- minimal export plumbing if needed

**Done when:**

- evaluator consumes `normalizePermissionPolicy(...)` output
- deterministic last-match-wins behavior is test-covered
- decisions for tool/command/file/destination/agent scope are test-covered

---

### 4.5b — Backend Translation & Sync Refinement

**Status:** COMPLETE

**Scope:**

- Keep `translatePermission()` as backend adapter boundary
- Consume evaluator/normalized outputs, do not re-implement policy logic
- Extend backend mapping where representable (Claude/OpenCode), fail-open where not (Codex)
- Keep unsupported granular rules explicit via generated instructions where needed

**Implemented so far:**

- richer translation envelope in
  [session-registry.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/session-registry.ts)
- adapter consumption of translation metadata in:
  - [claude-code-process.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/claude-code-process.ts)
  - [codex-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/codex-session.ts)
  - [opencode-session.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/wrapper/opencode-session.ts)

**Completed in this slice:**

- sync-writer refinement in
  [security-sync.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/sync/security-sync.ts)
- backend-safe persistence of richer native mappings under Kiln-managed
  metadata namespaces, separate from coarse backend-native config
- sync tests for backend file outputs and merge behavior in
  [security-sync.test.ts](/C:/Proyectos/Sequel/kiln/packages/cli/tests/sync/security-sync.test.ts)

**Primary files:**

- `packages/cli/src/wrapper/session-registry.ts`
- `packages/cli/src/sync/security-sync.ts`

---

### 4.5c — Enforcement Integration (Governance + Approval Memory)

**Status:** EFFECTIVELY COMPLETE (closable)

**Scope:**

- Enforce file governance in context/prompt and file-touch flows
- Enforce data-firewall decisions at outbound destinations
- Add approval memory levels (`once`, `session`, `project`) and audit trail
- Apply agent-scope restrictions at subagent launch boundaries

**Planning doc:**

- [plan-phase-4-5c.md](/C:/Proyectos/Sequel/kiln/docs/plan-phase-4-5c.md)

**Current slices in progress / landed:**

- `4.5c.a` approval-memory persistence foundation in CLI wrapper layer
- `4.5c.b` first context-governance enforcement slice:
  `excludeFromContext` now suppresses memory snapshot injection in preamble
- `4.5c.b` second context-governance slice:
  CLI application flow now governs session context before prompt construction
- `4.5c.c` first execution-time agent-scope enforcement slice:
  denied `tool_use` events now fail the active provider attempt before hook
  execution in the CLI application run loop, including agent-scope overlays
- `4.5c.c` second execution-time enforcement slice:
  bash-like tool payloads now evaluate `commandRules` in the CLI application
  run loop when a command string is present
- `4.5c.c` third execution-time enforcement slice:
  scoped `mcpTools` allowlists now gate explicitly marked MCP-origin tool
  events in the CLI application run loop
- `4.5c.c` metadata expansion slice:
  Claude wrapper now preserves MCP-origin tool-use events instead of collapsing
  them into generic tool calls, matching the existing Codex metadata path
- `4.5c.c` OpenCode metadata slice:
  OpenCode wrapper now derives MCP-origin tool-use from `mcp.tools.changed`
  registry updates and marks matching tool events as MCP-backed
- `4.5c.c` canonical selector tightening:
  wrapper-emitted MCP tool events now carry normalized selectors, and run-loop
  enforcement matches scoped `mcpTools` against those canonical selectors
- `4.5c.a` approval-memory consumption slice:
  CLI run-loop tool denies now consult approval memory; matching grants keep
  the normal allowed-tool flow; `once` grants are consumed only after later
  gates pass; session-scoped matching now uses stable logical Kiln session IDs
  (including resume path handoff from `run.ts`)
- `4.5c.a` command-memory consumption slice:
  bash-like command denies now consult command-surface approval memory;
  matching grants preserve the normal allowed-tool flow; `once` grants are
  consumed only after later gates pass; session-scoped matching reuses stable
  logical Kiln session IDs instead of provider-local ids
- `4.5c.b` file-governance execution slice:
  CLI run-loop now enforces file-governance deny decisions for explicit
  path-bearing tool inputs (`input.filePath`, `input.path`) before normal tool
  execution flow is committed
- `4.5c.d.a` first runtime data-firewall slice:
  outbound channel sends now support destination-aware allow/deny/redact
  evaluation before provider calls
- `4.5c.d.b` second runtime data-firewall slice:
  message pipeline now governs assistant response and summary egress on covered
  runtime surfaces

**Primary files (expected):**

- `packages/cli/src/wrapper/*`
- `packages/cli/src/application/*` as needed
- `packages/runtime/src/*` for destination enforcement points

**Closure note:**
- Remaining 4.5c work is non-blocking expansion (for example, broader
  tool-specific path-shape extraction), not a core enforcement gap.

---

### 4.5d — Core Safety Hardening

**Status:** STARTED (`4.5d` scout complete, prompt-scanning slice landed, dangerous-command core slice landed, dangerous-command runtime slice landed, cache-hit tool-result sanitization slice landed, runtime prompt-scanner wiring slice landed, runtime security-alert metrics slice landed, runtime policy-evaluated metrics slice landed)

**Scope:**

- Unicode/homoglyph normalization for injection detection
- tool-result scanning reuse for sink controls
- expanded dangerous command/code-exec pattern coverage
- propagate denial signals into safety events/metrics
- adversarial regressions for known bypass classes

**Scout conclusions (Claude Code patterns to carry into Kiln):**

- layered defense beats single-pass filtering (input normalization + execution
  checks + sink checks)
- fail-closed approval semantics are safer than optimistic allow on ambiguous
  paths or unresolved dynamic behavior
- sink controls matter as much as source controls (tool-output scanning and
  post-tool hooks reduce exfiltration/injection rebound risk)
- denial propagation must be explicit and observable (counters + metrics), not
  silent

**First landed slice (currently uncommitted):**

- core prompt scanning now performs detection-time normalization only
  (Unicode/homoglyph + invisible-character classes) while preserving original
  input for audit trails
- adversarial tests expanded for homoglyph/invisible-char bypass attempts and
  fenced-code downgrade behavior

**Second landed slice (currently uncommitted):**

- new dangerous-command detector contract added in engine/domain
- deterministic core implementation added in security
- shell-aware `allow | ask | deny` style decisions now cover:
  Unix destructive commands, Windows destructive commands,
  download-and-exec patterns, and explicit ambiguous ask boundaries

**Third landed slice (currently uncommitted):**

- dangerous-command detector is now enforced in runtime before tool execution
  via `ModeBOrchestrator`
- detector wiring is provided from `gateway-server`
- enforcement is fail-closed for `deny` and `ask`
- detector errors are treated conservatively and empty commands are blocked
  before tool execution

**Fourth landed slice (currently uncommitted):**

- cached tool results now go through `ToolResultSanitizer` before reinjection
  in `ModeBOrchestrator` (same safety path as live tool results)
- sanitizer failure during cache-hit handling no longer falls through to tool
  re-execution; cache-hit flow remains safe and controlled

**Fifth landed slice (currently uncommitted):**

- runtime now wires prompt-injection scanning into
  `ToolResultSanitizer` construction through `tool-result-sanitizer-factory`
- sanitizer wiring honors runtime `securityConfig.promptInjection`
- regression coverage exists for enabled, disabled, and custom
  `allowedPatterns` behavior through the runtime tool-result reinjection path

**Sixth landed slice (currently uncommitted):**

- runtime observability now propagates `security_alert` events into Prometheus
  via explicit `security_alerts_total` counter wiring in `PrometheusCollector`
- labels are stable and minimal (`severity`, `category`) with deterministic
  `unknown` fallback labels for malformed/missing/unsupported category values
  to keep save-path fail-closed without crashing
- focused unit coverage added for expected-label increment and fallback-label
  behavior

**Seventh landed slice (currently uncommitted):**

- runtime observability now propagates `policy_evaluated` events into
  Prometheus via explicit `policy_evaluations_total` counter wiring in
  `PrometheusCollector`
- labels are stable and minimal (`rail_type`, `allowed`, `direction`) with
  deterministic `unknown` fallbacks for malformed/missing/unsupported values
  to keep save-path fail-closed without crashing
- focused unit coverage added for expected-label increment and fallback-label
  behavior

**Verification note:**

- targeted core compile passed
- focused test execution for this slice remains blocked in the current
  environment
- targeted runtime compile passed
- focused runtime tests are implemented for the enforcement path
- focused `mode-b-orchestrator-tools` cache-hit sanitization test passed
- targeted runtime compile passed for gateway sanitizer wiring slice
- focused gateway sanitizer test coverage exists for
  enabled/disabled/custom-allowlist reinjection behavior
- focused `prometheus-collector` tests cover security-alert metric increment and
  deterministic fallback-label behavior
- focused `prometheus-collector` tests cover policy-evaluated metric increment
  and deterministic fallback-label behavior

**Primary files:**

- `packages/core/src/security/*`
- `packages/core/src/safety/*`
- `packages/core/tests/security/*`
- `packages/runtime/src/observability/prometheus-collector.ts`
- `packages/runtime/tests/observability/prometheus-collector.test.ts`

---

## Dependency Order

1. `4.5a` first (defines canonical decision contract).
2. `4.5b` second (translation/sync must consume 4.5a outputs).
3. `4.5c` third (enforcement wiring depends on 4.5a contract, and may consume 4.5b adapters).
4. `4.5d` can start partially in parallel with `4.5a` for pattern work, but denial-propagation integration should follow `4.5c`.

---

## Execution Notes

- Do not re-open schema/type work already landed in 4.5a.
- Do not duplicate policy logic in translators, sync, or command handlers.
- Do not make backend capability gaps invisible; document and fail-open safely.
- Keep decision logic pure and testable before wiring runtime behavior.

---

## Worker Sequence

1. Worker A: `4.5a` evaluator + tests (canonical decision engine)
2. Worker B: `4.5b` translation/sync refinement
3. Worker C: `4.5c` governance + approval memory integration
4. Worker D: `4.5d` safety hardening + adversarial tests

If slices are independent, run in parallel; if they consume a contract from an
earlier slice, run sequentially.
