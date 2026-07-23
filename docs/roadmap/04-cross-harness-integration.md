# 04 - Cross-Harness Integration

Status: Active integration track
Execution: Blocked - Model Gateway live activation and managed lease correctness must close first.
Created: 2026-07-23

## Objective

Make Codex App/CLI, OpenCode, Claude Code, Kiln GUI/TUI/CLI interchangeable
operator entrypoints into the same governed Kiln tools, agents, status, and replay.

## Ownership

This track owns harness identity, adapters, native projection, protocol parity,
control-plane MCP discovery, migration/restore, and live conformance. Runtime job
state belongs to Roadmap 02; gateway service lifecycle belongs to Roadmap 03.

## Scope

- Harness-neutral `kiln-control-plane` MCP bridge.
- Additive OpenCode provider projection and live proof.
- Codex native-plus-Kiln composite picker after protocol parity.
- Conditional Claude Code entitlement adapter and strict proof.
- Unified setup/status projection over shared contracts.
- Deferred thin/dynamic federation research after measured need.

## Non-Goals

- No subscription-to-API credential reinterpretation.
- No native config import without provenance and approval.
- No lowest-common-denominator compatibility plane.
- No hidden `codex exec`, `opencode run`, or manual gateway process workaround.
- No adapter-local route, permission, job, or replay owner.

## Ordered Slices

### Slice 0 - Harness-Neutral MCP Migration

Status: Code foundation complete; live migration blocked.

Migrate the installed Codex bridge from legacy `kiln` to `kiln-control-plane`,
preserve every unrelated native MCP server, verify ownership and exact uninstall,
then live-call it from Codex CLI, OpenCode, and Claude Code.

### Slice 1 - OpenCode Additive Vertical

Status: Code complete; live proof blocked.

Apply the health-gated additive `provider.kiln` projection. Prove `kiln/*` model
discovery, one real turn, native-provider fallback while the gateway is stopped,
restart/autostart, drift repair, update, and exact uninstall restore.

### Slice 2 - Cross-Harness Dogfood

Status: Queued behind Roadmaps 02 and 03 plus Slices 0-1.

Run a real bounded implementation slice through the completed managed lease path.
Preserve status, cancellation, timeout, result, usage, account selection, and
replay from every participating surface.

### Slice 3 - Codex Composite Picker

Status: Queued behind OpenCode live parity.

Close Responses protocol parity, admitted reasoning levels, hosted web search,
and native catalog-template inspection. Generate and journal an exact
native-plus-Kiln catalog, preserve session/provider semantics, and prove CLI
before App including resume, recovery, and uninstall.

### Slice 4 - Claude Entitlement Adapter

Status: Conditional.

Keep Claude Code subscription access distinct from Anthropic API billing. Admit
no model until a strict structured live result succeeds. Prove project-local
binding, `/v1/models`, one real message, diagnostics, and exact restore.

### Slice 5 - Unified Status And Repair

Status: Queued.

Project gateway lifecycle, auth bootstrap, native projection, MCP bridge, route
eligibility, and proof age through one shared status contract. Add repair only for
state Kiln owns; drift-sensitive actions require operator review.

### Slice 6 - Federation Research

Status: Deferred.

Reopen only when capability matrices and projection benchmarks show that thin or
dynamic adapters reduce meaningful duplication without weakening native
discovery, offline behavior, permissions, or rollback.

## Promotion Gates

- Direct-provider and native-entitlement boundaries remain explicit.
- Every projection preserves unmanaged fields and exact restore.
- All adapters consume shared authority and lifecycle contracts.
- OpenCode closes before Codex picker takeover.
- Claude remains conditional unless a real configured consumer requires it.

## Verification

Protocol fixtures, isolated-home projection tests, live opt-in harness tests,
workspace typecheck/build, affected suites, `git diff --check`, restore proofs,
and adversarial authority review.

## Completion Criteria

Supported harnesses discover and invoke the same governed Kiln capabilities with
consistent status and replay, while unsupported or unproven paths fail closed.
