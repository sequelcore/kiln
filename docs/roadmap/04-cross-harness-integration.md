# 04 - Cross-Harness Integration

Status: Ready
Execution: Ready - OpenCode and Codex composite parity are live-proven; Claude quota-gated proof and final all-harness conformance remain.
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
job state, economic commitment, account capacity, and write approval follow the
canonical [managed-agent](../architecture/coordination/managed-agents.md) and
[managed economic commitment](../architecture/coordination/managed-account-leases.md)
contracts. The canonical Model Gateway architecture owns only ingress lifecycle. Provider and
model evidence belongs to Core discovery and Runtime observations. This track
maps harness-native observations onto those shared contracts; it does not create
a second identity, account-selection, execution, or lifecycle owner.

Core owns pure `RouteCapability` values. Runtime is the only composition and
authority boundary: it admits capabilities, commits economic work, materializes
deferred adapter mechanisms, and dispatches. A caller can narrow a candidate
set but cannot broaden it; an encoder is transport-only. Harness and native
adapters project Runtime results and report unavailable or unresolved evidence
explicitly. They do not maintain route matrices, allowlists, or a legacy
Gateway authority. Issue #65 implements this route-authority slice in code and
portable tests; it is not a live harness or provider proof.

## Scope

- Harness-neutral `kiln-control-plane` MCP bridge, migrated off the legacy
  `kiln` identity and live-called from Codex CLI, OpenCode, and Claude Code.
- Additive OpenCode provider projection and live proof of the additive vertical.
- Claude Code entitlement adapter and strict live proof (Ready; reprioritized
  2026-07-24 ahead of the Codex picker now that a real configured Claude
  subscription exists).
- Codex native-plus-Kiln composite picker, gated behind Responses protocol
  parity, native catalog-template inspection, and Claude entitlement proof.
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

Status: Codex and OpenCode live-proven; Claude fresh-session call pending quota recovery.

Migrate the installed Codex bridge from legacy `kiln` to `kiln-control-plane`,
preserve every unrelated native MCP server, verify ownership and exact
uninstall, then live-call it from Codex CLI, OpenCode, and Claude Code while
each harness starts its own stdio child. Rename remaining Codex-named source
files only after every consumer uses the harness-neutral contract; do not
leave a compatibility wrapper behind.

Concurrent stdio children must not become concurrent Runtime owners. First,
make protocol startup and inspection independent from managed Runtime
composition so an existing live owner cannot abort the MCP handshake. Then
mount the harness-neutral control-plane catalog on one authenticated,
project-scoped Operator Gateway Streamable HTTP endpoint and make every stdio
adapter a thin client of that owner. The user-scoped Runtime ledger remains the
single writer for shared account capacity and affinity; commitments remain
project-namespaced. Do not replace it with adapter-local or multi-process
SQLite writers.

Implemented topology: native harnesses and operator surfaces share one signed,
short-lived project session contract. Native harnesses use the MCP adapter;
GUI, TUI, run, and benchmark use the separate typed application endpoint for
managed-economic acquire/fence/release/settlement commands. Model Gateway and
managed-agent dispatch share the global physical capacity ledger while keeping
distinct participant/recovery domains. Project-local legacy ledger files are
historical evidence only and are never reopened by operator surfaces.

Issue [#76](https://github.com/sequelcore/kiln/issues/76) adds the portable
control-plane procedure without widening this bridge. Core owns one compact
cross-tool instruction component that is projected both through MCP server
initialization and the `kiln-control-plane-workflow` skill. The skill teaches
discovery, inspection, idempotency, and managed-job reconciliation; MCP remains
the native-harness transport, CLI remains operator administration, and Runtime
remains the authority and lifecycle owner.

Exit gate: a harness adapter can be removed without changing canonical route
policy, and background job lifecycle is represented in Kiln events, never in
adapter-local prose.

### Slice 1 - OpenCode Additive Vertical

Status: Complete and live-proven.

The execution-catalog authority is complete in portable code. Global V2
`executionCatalog` and `executionRouting.defaultRouteId` govern CLI, GUI, TUI,
Managed direct routes, and Model Gateway overlays. Automatic routes select the
lowest-economic, least-pressured eligible account after safety, health, quota,
and capacity gates; exact account selection never falls back. Runtime fences
capacity and revalidates credential ID/revision immediately before dispatch.
This closes the multi-credential start blocker without a separate direct-model
catalog. The implementation landed on `dev` in commit `0fe036ee`; the
operator's global config is active on V2 and validates against the landed
schema. The route-first GUI session history integration now persists and
projects canonical route evidence without treating provider history as route
identity. The complete CLI, Runtime, surface, and workspace typecheck gates are
green, completing [issue #71](https://github.com/sequelcore/kiln/issues/71).
The remaining live-proof work in this slice concerns only the additive native
OpenCode projection described below; it does not reopen execution-catalog
authority.

Apply the health-gated additive `provider.kiln` projection to the operator's
OpenCode config. Prove `kiln/*` model discovery, one real turn, native-provider
fallback while the gateway is stopped, restart/autostart, drift repair, update,
and exact uninstall restore that leaves native providers/defaults/allowlists
untouched.

The 2026-08-12 operator proof discovered five `kiln/*` models and completed a
real `kiln/opencode-go-flash` turn through the supervised gateway. Native
`opencode-go/deepseek-v4-flash` completed while the gateway was stopped.
Config-revision restart, current-user autostart, exact uninstall, and reinstall
all passed. Uninstall removed only the owned provider and lifecycle state;
OpenCode's default model and `kiln-control-plane` MCP bridge remained intact.
The shared Runtime economic database now has its own directory so gateway
uninstall cannot delete or lock cross-surface capacity evidence.

#### Deliberation and global configuration disposition

Status: Complete. Native CLI delivery is recorded by
[issue #68](https://github.com/sequelcore/kiln/issues/68); direct Go/Zen has the
terminal unsupported disposition recorded by
[issue #47](https://github.com/sequelcore/kiln/issues/47).

OpenCode Go/Zen deliberation remains at provider default. OpenCode 1.18.16 can
lower declared OpenAI-compatible effort variants, but undeclared variants can
still be omitted silently and the Go/Zen gateways do not provide a revisioned,
deterministic supported-level and protocol contract across eligible upstreams.
Kiln retains `deliberationTransport: none` for these direct providers.

Official Go and Zen documentation rechecked on 2026-08-12 publishes changing
model rosters, endpoints, and protocol packages but no revisioned supported-
level contract across eligible upstreams. OpenCode v2 remains beta and warns
that custom model limits cannot be inferred reliably. There is consequently no
direct-provider capability to implement without guessing. Issue #47 closes as
an explicit unsupported decision; a future official contract requires a new
delivery issue rather than retaining speculative roadmap work.

Native OpenCode uses the exact 1.18.16 CLI's structured, account-visible model
catalog as a separate authority. Canonical variants with verified reasoning
semantics are bound to executable-version plus catalog-digest evidence and
lower through the SDK `variant` field only after Core admission. Explicit
unsupported requests fail closed and task rules configured with
`onUnsupported: omit` send no guessed level. The current account exposes no
eligible native variants, so the live dispatch gate remains pending without
weakening admission.

The operator's global provider-neutral task policy is already configured and
requires no speculative OpenCode `byRoute` rule. Native exact routes activate
only when discovery admits them. Direct Go/Zen routes resolve unsupported task
levels through the configured `omit` behavior and therefore use provider
default without sending a guessed level. No route-wide override is admitted
without reproducible Sequel benchmark evidence.

### Slice 2 - Cross-Harness Dogfood

Status: Queued behind Slices 0-1.

Re-sync and live-prove the harness-neutral bridge from all three harnesses,
then run a real bounded implementation slice through the completed per-job
managed-lease path defined by the canonical
[managed economic commitment authority](../architecture/coordination/managed-account-leases.md)
rather than the legacy static adapter path. Preserve status, cancellation,
timeout, result, usage, account selection, and replay from every participating
surface, and verify that no step falls back to `opencode run`, `codex exec`, or
a manual HTTP gateway process as a hidden workaround.

Exit gate: the operator can work primarily from Codex App without burning
Codex quota for every delegated task, and no workflow step uses a native-CLI
shell workaround for a Kiln-managed route.

### Slice 3 - Claude Entitlement Adapter

Status: Read-only Claude entitlement route live-proven and activated.
The read-only adapter now requires native structured-output provenance, exact
configured and observed model identity, and portable Claude Code
executable/version evidence. Moving model aliases fail admission, discovery and
execution share one resolved executable, `kiln doctor` reports Claude Code, and
the opt-in live proof requires an explicit model. No model is admitted until
the authorized provider call succeeds and its exact observed identity is
recorded in the allowlist.

On 2026-08-01 the operator enabled Claude and authorized three bounded read-only
attempts with Agent SDK `0.3.220`, Claude Code `2.1.220`, and the explicit
catalog value `claude-sonnet-5`. The first two are not promotion evidence: the
live fixture omitted `input.handoff`, so the adapter intentionally did not
attach the SDK `outputFormat` and Claude returned prose. The third used the
corrected fixture and proved native structured output, plan mode, portable
harness evidence, and no fixture write, while revealing that `modelUsage`
contains both the configured model and an auxiliary Haiku model. Kiln now
records the SDK init model as the primary observed identity, retains the full
model-usage set, and admits against the primary. A final authorized probe
proved primary `claude-sonnet-5`, native structured output, plan mode, portable
Claude Code `2.1.220` evidence, an unchanged fixture, zero write evidence, and
no provider-session transcript. Separate authorized probes proved the same
contract for `claude-opus-5` and `claude-haiku-4-5-20251001`; all three exact
IDs are now admitted. Moving aliases and every unproven catalog value remain
closed. Fable remains unconfigured because Kiln cannot yet enforce an
explicit-route-only, runtime-approved exceptional selection boundary.

Keep Claude Code subscription access distinct from Anthropic API billing.
Admit no model into the live-proven set until a strict structured live result
succeeds. Isolate API-key Anthropic usage as a separate, explicitly billed
direct provider only when the operator configures it; do not let it become an
implicit additive provider. Document terms and billing boundaries in status.
Status must also disclose that native-harness provider consumption is not
bounded by Kiln's managed economic ceiling. Before activation, the operator
must acknowledge that enabling `engines.claude` exposes Claude to non-managed
engine selection surfaces. Prove authenticated SDK catalog discovery, one
bounded read-only message, native structured handoff, exact model and executable
identity, diagnostics, privacy-safe durable evidence, and exact config restore.

Deliberation follow-through is code complete. Runtime and CLI now share Agent
SDK `0.3.226`; authenticated `supportedModels()` effort metadata is preserved
with Claude Code executable-version evidence, and admitted levels lower through
`Options.effort`. Native OpenCode uses its own version-bound catalog evidence
rather than inheriting this capability. A bounded Claude `low` live probe on
2026-08-10 was rejected by the active account's weekly quota before completion,
so the new effort path is not yet live-promoted even though its deterministic
discovery, lowering, and cross-surface tests pass.

Exit gate: Claude Code subscription and Anthropic API usage cannot be confused
in route selection or status, and native-harness routes expose an explicit
unsupported-proof diagnostic wherever Kiln cannot verify behavior. The exact
provider model remains admitted only while runtime observations match the
live-proof identity.

### Slice 4 - Codex Composite Picker

Status: Complete and live-proven on Codex 0.147.0.

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

Codex 0.147.0's documented `openai_base_url` and `model_catalog_json` controls
provide the required contract without replacing the built-in `openai`
provider. Kiln captures the bundled native catalog before projection, preserves
native entries, appends capability-conservative virtual entries, and points
the built-in provider at a capability-addressed supervised loopback. The
loopback dispatches admitted virtual ids through canonical Model Gateway
ingress and forwards every native id to Codex's native backend with its caller
authorization and a strict header allowlist. Native provider/session identity
therefore remains `openai`; Kiln never installs a second Codex provider.

The 2026-08-12 operator proof completed strict-config native and virtual turns,
resumed a pre-existing native session, survived an owned gateway restart, and
proved exact uninstall followed by reinstall. Uninstall removed only
`openai_base_url`, `model_catalog_json`, the generated catalog, and their
install-state ownership; a native turn still completed while projection was
absent. Codex's initial WebSocket probe receives 426 and falls back to HTTP.
Virtual requests retain only tools and optional controls admitted by the
selected model's canonical capabilities. The obsolete `model_providers.kiln`
path and schema-invalid native `[kiln.permission_sync]` metadata are removed;
permission evidence remains in Kiln install state.

#### Provider-neutral deliberation policy

Implemented by [ADR-011](../adr/ADR-011-provider-neutral-deliberation-policy.md)
and delivery issue #46. Core owns intent, revisioned capabilities, and explicit
resolution; Runtime admits only resolved decisions; managed economic dispatch
binds the conservative intent envelope before provider execution. CLI, GUI,
TUI, harness ingress v2, examples, and operator config use
`deliberationPolicy`; the former normalized policy has no reader or alias.

#### Research note - codex plugin interactive capabilities

The `codex@openai-codex` Claude Code plugin currently provides three
interactive capabilities that no slice above names as scope: an in-session
rescue/second-opinion subagent (`/codex:rescue`), a stop-time review gate
hook, and session handoff from Claude Code to Codex (`/codex:transfer`).
Slices 0-4 cover routing/execution unification (harness-neutral MCP bridge,
Codex App dogfood without burning quota, native-plus-Kiln composite picker),
not these three. Do not treat the plugin as redundant with this track, or
retire it, until a slice explicitly targets absorbing rescue, review-gate, or
session-transfer behavior into Kiln's governed surface.

### Slice 5 - Unified Status And Repair

Status: Complete by shared-contract reconciliation.

Project gateway lifecycle, auth bootstrap, native projection, MCP bridge,
route eligibility, and proof age through one shared status contract. Add
repair only for state Kiln owns; drift-sensitive or review-only actions stay
blocked until the operator explicitly reviews them.

Exit gate: `kiln status` can explain why a given harness cannot see Kiln tools
or agents, and setup recommendations carry target-specific snapshots instead
of bare action strings.

The V2 config status evidence and `config read` views already own canonical
configuration health, route and managed-agent eligibility, MCP discovery,
native projection state, permission proof freshness, and target-specific setup
snapshots. Model Gateway and Operator Runtime lifecycle remain with their
authenticated supervisors and `doctor` contracts; copying live process
ownership into config status would create a second lifecycle authority. Repair
is limited to Kiln-owned setup actions, while drift review remains explicitly
blocked for operator review. Issues #63 and #70 concern shared operator Session
event/lifecycle projection and remain separate product work, not this
cross-harness setup/status gate.

### Slice 6 - Federation Research

Status: Deferred.

Reopen only when projection benchmarks show that thin or dynamic adapters reduce
meaningful duplication without weakening native
discovery, offline behavior, permissions, or rollback. A qualifying benchmark
compares direct-provider and native-harness execution on representative task
classes (UI/computer-use, code implementation, research, review, mechanical
edits, long-running debugging) and reports verified success, latency, quota
pressure, cost class, retries, and operator intervention. Route defaults must
be justified by reproducible evidence, not by an anecdote or a single
successful run; any public claim discloses provider dependencies, subscription
assumptions, and unsupported-proof gaps.

## Dependencies

- Runtime's canonical managed economic commitment authority owns per-job
  account leases, selection reason, and replay evidence; Slice 2 consumes that
  completed path and must not reimplement leasing or reintroduce ambient
  round-robin.
- [Model Gateway architecture](../architecture/providers/model-gateway.md) owns
  ingress configuration, authentication, supervision, recovery, and exact
  uninstall. Its lifecycle proof is complete; this track owns only harness
  projection and protocol-parity work layered on that service.
- Provider identity and entitlement evidence comes from provider-model discovery
  and Runtime observations. This track maps harness-native evidence without
  redefining those contracts.
- Provider model discovery remains the runtime-owned availability and
  eligibility plane; this track's adapters project that evidence and never
  weaken fail-closed admission.

## Promotion Gates

- Direct-provider and native-entitlement boundaries remain explicit.
- Every projection preserves unmanaged fields and exact restore.
- All adapters consume shared authority and lifecycle contracts.
- OpenCode closes before Codex picker takeover.
- Claude entitlement proof (Slice 3) still requires the same strict live-proof
  bar before its model enters the live-proven set. Codex composite proof no
  longer depends on waiting for that independent entitlement check.
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
