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

**Status:** IN PROGRESS

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

**Still pending in 4.5b:**

- sync-writer refinement in
  [security-sync.ts](/C:/Proyectos/Sequel/kiln/packages/cli/src/sync/security-sync.ts)
- backend-safe persistence of richer native mappings
- sync tests for backend file outputs and merge behavior

**Primary files:**

- `packages/cli/src/wrapper/session-registry.ts`
- `packages/cli/src/sync/security-sync.ts`

---

### 4.5c — Enforcement Integration (Governance + Approval Memory)

**Scope:**

- Enforce file governance in context/prompt and file-touch flows
- Enforce data-firewall decisions at outbound destinations
- Add approval memory levels (`once`, `session`, `project`) and audit trail
- Apply agent-scope restrictions at subagent launch boundaries

**Primary files (expected):**

- `packages/cli/src/wrapper/*`
- `packages/cli/src/application/*` as needed
- `packages/runtime/src/*` for destination enforcement points

---

### 4.5d — Core Safety Hardening

**Scope:**

- Unicode/homoglyph normalization for injection detection
- expanded dangerous code-exec pattern coverage
- propagate denial signals into safety events/metrics
- adversarial regressions for known bypass classes

**Primary files:**

- `packages/core/src/security/*`
- `packages/core/src/safety/*`
- `packages/core/tests/security/*`

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
