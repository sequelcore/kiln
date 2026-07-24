# 04 - Cross-Harness Integration

Status: Active integration track
Execution: Blocked - Model Gateway live activation and managed lease correctness must close first.
Created: 2026-07-23

## Objective

Make Codex App/CLI, OpenCode, Claude Code, Kiln GUI/TUI/CLI interchangeable
operator entrypoints into the same governed Kiln tools, agents, status, and
replay. An operator should be able to develop Kiln using Kiln from any
supported harness, without hand-written routing doctrine in `AGENTS.md` or
`CLAUDE.md` and without falling back to `codex exec` / `opencode run` shell
workarounds for a governed route.

## Ownership

This track owns harness identity, adapters, native projection, protocol parity,
control-plane MCP discovery, migration/restore, and live conformance. Runtime
job state belongs to Roadmap 02; gateway service lifecycle, provider identity,
and entitlement evidence belong to Roadmap 03. This track maps harness-native
observations onto that shared contract; it does not create a second identity,
account-selection, or lifecycle owner.

## Scope

- Harness-neutral `kiln-control-plane` MCP bridge, migrated off the legacy
  `kiln` identity and live-called from Codex CLI, OpenCode, and Claude Code.
- Additive OpenCode provider projection and live proof of the additive vertical.
- Codex native-plus-Kiln composite picker, gated behind Responses protocol
  parity and native catalog-template inspection.
- Conditional Claude Code entitlement adapter and strict live proof.
- Unified setup/status projection over shared lifecycle, auth, and route
  eligibility contracts.
- Deferred thin/dynamic federation research after measured need.

## Non-Goals

- No subscription-to-API credential reinterpretation.
- No native config import without provenance and approval.
- No lowest-common-denominator compatibility plane.
- No hidden `codex exec`, `opencode run`, or manual gateway process workaround.
- No adapter-local route, permission, job, or replay owner.
- No compatibility shims for obsolete harness configs or Codex-named source
  files once every consumer uses the harness-neutral contract.
- No promoting a harness or provider choice from anecdote instead of measured,
  reproducible task-class evidence.

## Research Basis

Provider/harness boundaries in this track are backed by primary provider
documentation, not assumption:

- OpenAI documents Codex usage under ChatGPT plans separately from Codex API
  pricing/limits (`help.openai.com/en/articles/11369540`,
  `developers.openai.com/codex/pricing`).
- Anthropic documents Claude Code Pro/Max subscription access as distinct from
  separately billed Console/API usage (`support.anthropic.com/en/articles/11145838`,
  `support.anthropic.com/en/articles/9876003`). This is why Slice 4 models
  Claude as a native-harness entitlement adapter, never as a direct Anthropic
  provider.
- OpenCode documents Go/Zen provider routes with distinct subscription/credit
  economics and provider ids (`opencode.ai/docs/go`, `opencode.ai/docs/zen`,
  `opencode.ai/docs/providers`).
- Local research checkouts (`cloned/codex`, `cloned/claude-code`,
  `cloned/opencode`, `cloned/codex-plugin-cc`) are supporting implementation
  evidence for adapter behavior, not architecture to copy; stable findings are
  promoted into `docs/architecture/harness-integration-capabilities.md`.

## Ordered Slices

### Slice 0 - Harness-Neutral MCP Migration

Status: Code foundation complete; live migration blocked.

Migrate the installed Codex bridge from legacy `kiln` to `kiln-control-plane`,
preserve every unrelated native MCP server, verify ownership and exact
uninstall, then live-call it from Codex CLI, OpenCode, and Claude Code while
each harness starts its own stdio child. Rename remaining Codex-named source
files only after every consumer uses the harness-neutral contract; do not
leave a compatibility wrapper behind.

Exit gate: a harness adapter can be removed without changing canonical route
policy, and background job lifecycle is represented in Kiln events, never in
adapter-local prose.

### Slice 1 - OpenCode Additive Vertical

Status: Code complete; live proof blocked.

Apply the health-gated additive `provider.kiln` projection to the operator's
OpenCode config. Prove `kiln/*` model discovery, one real turn, native-provider
fallback while the gateway is stopped, restart/autostart, drift repair, update,
and exact uninstall restore that leaves native providers/defaults/allowlists
untouched.

### Slice 2 - Cross-Harness Dogfood

Status: Queued behind Roadmaps 02 and 03 plus Slices 0-1.

Re-sync and live-prove the harness-neutral bridge from all three harnesses,
then run a real bounded implementation slice through the completed per-job
managed-lease path (Roadmap 02 Slice 1) rather than the legacy static adapter
path. Preserve status, cancellation, timeout, result, usage, account
selection, and replay from every participating surface, and verify that no
step falls back to `opencode run`, `codex exec`, or a manual HTTP gateway
process as a hidden workaround.

Exit gate: the operator can work primarily from Codex App without burning
Codex quota for every delegated task, and no workflow step uses a native-CLI
shell workaround for a Kiln-managed route.

### Slice 3 - Codex Composite Picker

Status: Queued behind OpenCode live parity.

Close Responses protocol parity, admitted reasoning levels, hosted web search,
and native catalog-template inspection; fail closed if no valid native catalog
template is available. Generate and journal an exact native-plus-Kiln catalog
without changing session provider identity, defaults, search settings, or
unrelated fields. Route native and virtual entries through a supervised
loopback that preserves native semantics; never activate provider-only
projection as a fake picker. Journal ownership of catalog/cache/base-URL state
so uninstall restores the exact prior configuration. Prove CLI before App,
including native turn, virtual turn, pre-existing session resume, gateway
recovery, and exact uninstall.

### Slice 4 - Claude Entitlement Adapter

Status: Conditional.

Keep Claude Code subscription access distinct from Anthropic API billing.
Admit no model into the live-proven set until a strict structured live result
succeeds. Isolate API-key Anthropic usage as a separate, explicitly billed
direct provider only when the operator configures it; do not let it become an
implicit additive provider. Document terms and billing boundaries in status.
Prove project-local gateway binding, `/v1/models` discovery, one real message,
diagnostics, and exact restore.

Exit gate: Claude Code subscription and Anthropic API usage cannot be confused
in route selection or status, and native-harness routes expose an explicit
unsupported-proof diagnostic wherever Kiln cannot verify behavior.

### Slice 5 - Unified Status And Repair

Status: Queued.

Project gateway lifecycle, auth bootstrap, native projection, MCP bridge,
route eligibility, and proof age through one shared status contract. Add
repair only for state Kiln owns; drift-sensitive or review-only actions stay
blocked until the operator explicitly reviews them.

Exit gate: `kiln status` can explain why a given harness cannot see Kiln tools
or agents, and setup recommendations carry target-specific snapshots instead
of bare action strings.

### Slice 6 - Federation Research

Status: Deferred.

Reopen only when capability matrices and projection benchmarks show that thin
or dynamic adapters reduce meaningful duplication without weakening native
discovery, offline behavior, permissions, or rollback. A qualifying benchmark
compares direct-provider and native-harness execution on representative task
classes (UI/computer-use, code implementation, research, review, mechanical
edits, long-running debugging) and reports verified success, latency, quota
pressure, cost class, retries, and operator intervention. Route defaults must
be justified by reproducible evidence, not by an anecdote or a single
successful run; any public claim discloses provider dependencies, subscription
assumptions, and unsupported-proof gaps.

## Dependencies

- Roadmap 02 owns per-job account leases, selection reason, and replay
  evidence; Slice 2 consumes that completed path and must not reimplement
  leasing or reintroduce ambient round-robin.
- Roadmap 03 owns the Model Gateway process, configuration, and token
  bootstrap; Slices 1, 3, and 5 depend on a live, operator-configured gateway
  and must not duplicate its lifecycle or provider-identity contract.
- Roadmap 03 also owns provider identity/access/entitlement projection; this
  track only maps harness-native observations onto it.
- Provider model discovery remains the runtime-owned availability and
  eligibility plane; this track's adapters project that evidence and never
  weaken fail-closed admission.

## Promotion Gates

- Direct-provider and native-entitlement boundaries remain explicit.
- Every projection preserves unmanaged fields and exact restore.
- All adapters consume shared authority and lifecycle contracts.
- OpenCode closes before Codex picker takeover.
- Claude remains conditional unless a real configured consumer requires it.
- No slice claims live validation from code-complete or integration-complete
  evidence alone; operator-machine proof is recorded separately.
- Uninstall/restore is proven exact for every projection this track owns
  before its slice can close.

## Verification

Protocol fixtures, isolated-home projection tests, live opt-in harness tests,
workspace typecheck/build, affected suites, `git diff --check`, restore
proofs, and adversarial authority review.

## Completion Criteria

Supported harnesses discover and invoke the same governed Kiln capabilities
with consistent status and replay, direct providers are preferred where
official and governed, native harnesses are used only where product
entitlement or terms require them, and unsupported or unproven paths fail
closed.
