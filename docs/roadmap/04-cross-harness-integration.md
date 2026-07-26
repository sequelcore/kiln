# 04 - Cross-Harness Integration

Status: Active integration track
Execution: Blocked - Model Gateway live activation and managed lease correctness must close first.
Created: 2026-07-23

## Objective

Make Codex App/CLI, OpenCode, Claude Code, Kiln GUI/TUI/CLI, and connected
operator surfaces interchangeable entrypoints into the same governed Kiln tools,
agents, status, and replay. An operator should be able to originate intent from a
web or connector-enabled surface, delegate bounded repository work to an
admitted local harness, and carry the same governed work through branch,
worktree, commit, pull request, CI, review, approval, merge, and closeout without
manual context reconstruction or a harness-local source of truth.

The operator should be able to develop Kiln using Kiln from any supported
harness, without hand-written routing doctrine in `AGENTS.md` or `CLAUDE.md` and
without falling back to `codex exec` / `opencode run` shell workarounds for a
governed route.

## Ownership

This track owns harness identity, adapters, native projection, protocol parity,
control-plane MCP discovery, migration/restore, live conformance, and the
cross-harness delivery proof that binds an originating operator surface to local
repository execution and durable pull-request evidence. Runtime job state
belongs to Roadmap 02; gateway service lifecycle, provider identity, and
entitlement evidence belong to Roadmap 03. This track maps harness-native and
connector-native observations onto those shared contracts; it does not create a
second identity, account-selection, lifecycle, approval, or repository owner.

## Scope

- Harness-neutral `kiln-control-plane` MCP bridge, migrated off the legacy
  `kiln` identity and live-called from Codex CLI, OpenCode, and Claude Code.
- Governed web/connector-to-local delivery flow: operator intent may originate
  from a connected web surface, while admitted local harnesses perform
  filesystem, process, test, and Git work in bounded branches and worktrees.
- Durable repository handoff through commits, pull requests, CI checks, review
  evidence, human authorization gates, merge, and residual-risk closeout.
- Additive OpenCode provider projection and live proof of the additive vertical.
- Claude Code entitlement adapter and strict live proof (Ready; reprioritized
  2026-07-24 ahead of the Codex picker now that a real configured Claude
  subscription exists).
- Codex native-plus-Kiln composite picker, gated behind Responses protocol
  parity, native catalog-template inspection, and Claude entitlement proof.
- Unified setup/status projection over shared lifecycle, auth, route
  eligibility, repository-delivery, and proof-age contracts.
- Deferred thin/dynamic federation research after measured need.

## Non-Goals

- No subscription-to-API credential reinterpretation.
- No native config import without provenance and approval.
- No lowest-common-denominator compatibility plane.
- No hidden `codex exec`, `opencode run`, or manual gateway process workaround.
- No adapter-local route, permission, job, replay, approval, branch, or pull
  request owner.
- No requirement for a web surface to access the operator filesystem directly;
  local execution remains local and durable handoff occurs through governed
  evidence and repository objects.
- No treating a connector action, chat transcript, branch, commit, PR, or CI
  check alone as proof that the governed lifecycle completed.
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
  `support.anthropic.com/en/articles/9876003`). This is why Slice 3 models
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

### Slice 2 - Governed Web-To-PR Dogfood

Status: Queued behind Roadmaps 02 and 03 plus Slices 0-1.

Run one real, bounded repository implementation from end to end through the
completed governed path. The initiating operator surface may be ChatGPT web or
another connected surface with repository connectors, but it must materialize a
canonical Kiln goal and bounded work items rather than relying on chat prose as
the workflow record. Kiln must select an admitted local harness for repository
execution, use a managed branch and worktree, and preserve intent, authority,
route selection, status, cancellation, timeout, result, usage, account
selection, evidence, residual risk, and replay.

The local harness must perform the filesystem, process, test, and Git work. The
web or connector-enabled surface may inspect and update repository objects only
within explicit authority. Commits, pull requests, CI checks, review findings,
and approvals are durable evidence and handoff boundaries, but they do not
replace the canonical goal, work item, execution attempt, or closeout state.

The proof must cover this complete lifecycle:

1. originate and clarify operator intent from the initiating surface;
2. materialize a bounded governed plan and work items;
3. select an admitted local harness and route without hidden native-CLI shell
   delegation;
4. create or use an isolated managed worktree and feature branch;
5. implement and verify the bounded change locally;
6. produce intentional commits and a pull request against the declared
   integration target;
7. bind CI results and independent review findings to the same work evidence;
8. require explicit human authorization for remote publication, readiness,
   merge, destructive restore, and cleanup gates;
9. merge the exact reviewed candidate; and
10. record residual risk, delivery evidence, and closeout without manual context
    reconstruction between surfaces.

Acceptance requires at least one successful feature delivered through the full
flow and a second proof that changes the participating local harness without
changing canonical work ownership or repository policy. No step may fall back
to `opencode run`, `codex exec`, a manual HTTP gateway process, copied prompt
state, or an adapter-local lifecycle as a hidden workaround.

Exit gate: an operator can coordinate from a connected web surface, delegate
bounded repository work to admitted local CLIs, and complete PR, CI, review,
approval, merge, and closeout with one replayable Kiln work identity. Replacing
one supported harness with another does not change the governed workflow,
authority model, or durable repository evidence.

### Slice 3 - Claude Entitlement Adapter

Status: Ready - reprioritized ahead of Slice 4 by explicit operator decision
(2026-07-24). The operator now holds a Claude Pro/Max subscription and is the
real configured consumer the prior "Conditional" gate was waiting on; the
motivating goal is spreading governed work across Claude, Codex, and OpenCode
so no single provider subscription is exhausted by one session (see the
incident recorded in the changelog/session record for 2026-07-24). This
reorders the queue for this track only; it does not change Roadmap 03/02 as
the shared live-activation blocker below this track's header status.

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

### Slice 4 - Codex Composite Picker

Status: Queued behind OpenCode live parity and Slice 3.

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

### Slice 5 - Unified Status And Repair

Status: Queued.

Project gateway lifecycle, auth bootstrap, native projection, MCP bridge,
route eligibility, delivery-flow stage, repository evidence, and proof age
through one shared status contract. Add repair only for state Kiln owns;
drift-sensitive or review-only actions stay blocked until the operator
explicitly reviews them.

Exit gate: `kiln status` can explain why a given harness cannot see Kiln tools
or agents, where a governed web-to-PR delivery is blocked, which repository or
human gate is pending, and why. Setup and repair recommendations carry
target-specific snapshots instead of bare action strings.

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

- Roadmap 02 owns per-job account leases, selection reason, execution lifecycle,
  result, and replay evidence; Slice 2 consumes that completed path and must not
  reimplement leasing or reintroduce ambient round-robin.
- Roadmap 03 owns the Model Gateway process, configuration, and token bootstrap;
  Slices 1, 3, and 5 depend on a live, operator-configured gateway and must not
  duplicate its lifecycle or provider-identity contract.
- Roadmap 03 also owns provider identity/access/entitlement projection; this
  track only maps harness-native observations onto it.
- Work Governance owns canonical intent, goal, work-item, attempt, evidence,
  approval, and closeout semantics. Connectors, harnesses, Git branches, commits,
  pull requests, and CI systems project or contribute evidence to that lifecycle;
  they never replace it.
- Provider model discovery remains the runtime-owned availability and
  eligibility plane; this track's adapters project that evidence and never
  weaken fail-closed admission.

## Promotion Gates

- Direct-provider and native-entitlement boundaries remain explicit.
- Every projection preserves unmanaged fields and exact restore.
- All adapters consume shared authority and lifecycle contracts.
- Web and connector surfaces do not require direct access to the local
  filesystem and cannot silently acquire local execution authority.
- Local harnesses cannot publish, mark ready, merge, delete branches/worktrees,
  or perform destructive restore without the explicit authority required by the
  owning gate.
- Repository objects and CI results are bound to canonical work and evidence;
  chat prose or a successful connector call alone is insufficient closeout.
- The full web/connector-to-local-PR acceptance flow is proven with one exact
  reviewed and merged candidate, then repeated with a different admitted local
  harness without changing canonical policy.
- OpenCode closes before Codex picker takeover.
- Claude entitlement proof (Slice 3) is admitted ahead of the Codex composite
  picker (Slice 4) per the 2026-07-24 reprioritization; it still requires the
  same strict live-proof bar as every other slice before any model enters the
  live-proven set.
- No slice claims live validation from code-complete or integration-complete
  evidence alone; operator-machine proof is recorded separately.
- Uninstall/restore is proven exact for every projection this track owns
  before its slice can close.

## Verification

Protocol fixtures, isolated-home projection tests, live opt-in harness tests,
one bounded web/connector-to-local-PR delivery, a second cross-harness replay of
the same governance contract, workspace typecheck/build, affected suites,
`git diff --check`, CI evidence, independent review, authorization-gate proof,
merge evidence, restore proofs, and adversarial authority review.

## Completion Criteria

Supported web, connector, native harness, GUI, TUI, and CLI surfaces participate
in one governed delivery lifecycle with consistent intent, authority, status,
repository evidence, review, approval, and replay. Supported harnesses discover
and invoke the same governed Kiln capabilities; direct providers are preferred
where official and governed; native harnesses are used only where product
entitlement or terms require them; and unsupported or unproven paths fail
closed.

The track is not complete until an operator can originate a bounded feature from
a connected surface, delegate local repository execution, deliver the exact
reviewed candidate through PR and CI, merge under explicit authority, and close
the work with replayable evidence without manual context reconstruction. The
same proof must remain valid when one admitted local harness is replaced by
another.
