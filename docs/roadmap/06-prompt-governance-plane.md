# 06 - Prompt Governance Plane

Status: Active staged-governance track
Execution: Active - observation and communication-governance slices complete.
Created: 2026-07-21

## Objective

Make every effective provider prompt attributable, replayable, bounded, and
evaluated without turning prose into a second configuration or policy system.

Kiln must distinguish durable doctrine, project facts, task procedures,
provider configuration, admitted runtime context, and optional writing
standards. Prompt changes must be observable and removable, and they must not
be promoted from token-count or string-snapshot evidence alone.

## Current Position

The foundation is implemented:

- Core owns a typed effective-prompt manifest with ordered `static`, `dynamic`,
  and `deferred` components.
- Runtime sends `manifest.finalPrompt` as the single provider prompt
  authority.
- Exact prompt and component identities use SHA-256 content hashes.
- Provider-request evidence carries redacted hashes, scopes, and token
  estimates without raw prompt or caller-controlled provenance text.
- The canonical Sequel instruction profile contains durable engineering
  doctrine rather than provider, model, permission, budget, or project facts.
- `action-first-communication` is an explicit neutral skill, not universal
  doctrine or a diagnosis-shaped default.
- A proposed universal executable-tool prompt reduction was reverted because
  it lacked representative model-specific evaluation.
- The final actual provider request now emits one canonical, content-free
  `effective_prompt_observed` event across live and replay surfaces.
- Core owns provider-neutral communication intent/resolution, Runtime owns its
  per-route decision and identified prompt component, and adapters project
  only revision-backed native controls.
- Provider cache usage is observable, but the manifest's static/dynamic scopes
  do not yet become provider-specific cache breakpoints. Current system prompts
  can contain per-turn task, governed-context, and temporal material before the
  conversation prefix, so cache efficiency is not yet live-proven.
- The narrow Capability Fabric descriptor-disclosure dependency is admitted as
  an architecture boundary. This does not start this track's full progressive
  disclosure slice or Capability Fabric Slice 3.

Stable boundaries are documented in
[Context Governance](../architecture/context/context-governance.md),
[Context Usage Projection](../architecture/context/context-usage-projection.md), and
[Agent Context](../architecture/context/agent-context.md). The research and source
basis lives in
[Prompt Component And Response Governance](../research/active/prompt-component-governance.md).
That basis now combines a direct Claude Code production regression, official
OpenAI and Anthropic evaluation guidance, prompt-sensitivity and long-context
studies, skill-retrieval limits, privacy-oriented OpenTelemetry guidance, and
revision-pinned Codex, OpenCode, and Gemini CLI source. It supports the need
for model-and-harness-specific evaluation, component ablation, bounded
disclosure, and content-free observation. It does not externally validate
Kiln's exact manifest, hash, or event design; those remain Kiln-owned contracts
that must pass the gates below.

Provider cache and latency evidence lives in
[Harness Cache And End-To-End Efficiency](../research/active/harness-efficiency.md).
This track owns prompt-cache topology; [Roadmap 06.5](06.5-end-to-end-harness-efficiency.md)
separately owns total-latency attribution because prefill reuse is only one
part of task wall time.

## Goals

- Persist one canonical, content-free effective-prompt observation for the
  provider request that completed each runtime turn.
- Give operators one read-only inspection contract across CLI, TUI, GUI, SDK,
  and replay without exposing prompt text or secrets.
- Evaluate prompt components and removals against representative tasks for
  each admitted model family before promotion.
- Load nested instructions, skill bodies, resources, and nonessential tool
  schemas only when their scope is reached and policy admits them.
- Preserve one provider-recognized stable prefix, project only supported cache
  controls, and prove reuse without crossing tenant, route, model, policy, or
  authority partitions.
- Keep instruction profiles limited to durable organization doctrine; keep
  project facts in adopted project context, task procedures in skills, and
  provider/model/budget decisions in executable config.
- Support optional controlled-language packs through explicit activation,
  source provenance, deterministic validation, and honest compliance states.

## Ownership

This track owns prompt assembly evidence, activation of admitted instruction and
skill content, component evaluation, and privacy-safe operator inspection. Skill
eligibility belongs to the canonical skill capability plane in
`docs/architecture/context/agent-context.md`; provider/model/budget decisions
remain config.

## Scope

- Typed effective-prompt manifests and final-request attribution.
- Content-free events and cross-surface inspection.
- Model-specific component evaluation and ablation.
- Progressive instruction, skill-resource, and tool-schema disclosure.
- Provider-specific projection of manifest scope into real cache boundaries,
  affinity, retention, and content-free evidence.
- Optional controlled-language packs with explicit authority.
- Drift diagnostics between canonical config/profile sources and generated
  native harness projections.

## Non-Goals

- No raw prompt storage or hidden-reasoning surface.
- No universal brevity/personality formatting prompt.
- No model ranking, budget, permission, or stack version in doctrine.
- No prompt change promoted by token count or snapshots alone.
- No claiming ASD-STE100 compliance from LLM prompting or prose review alone.
- No copying licensed controlled-language material into Kiln without
  distribution authority.
- No compatibility aliases, parallel prompt builders, or surface-local prompt
  policy.
- No ownership of task-level latency, tool-performance optimization, provider
  queueing, or startup benchmarks; Roadmap 06.5 owns those outcomes.

## Ordered Slices

### Slice 0 - Effective Prompt Foundation

Status: Complete.

Core owns one typed manifest; Runtime sends `manifest.finalPrompt`; hashes,
scopes, token estimates, validation, and privacy-safe request evidence are
implemented. Fail-closed prompt/manifest matching guards every external
invocation.

### Slice 1 - Canonical Observation

Status: Complete.

Persist one `effective_prompt_observed` event for the final completed provider
request. Attribute retry and fallback evidence to the final completed
request. Add the standalone Gateway wire contract and explicit Core-to-Gateway
mapper, and project the same content-free payload to CLI, TUI, GUI, SDK, and
replay — present final prompt hash, estimated tokens, component count, and
scope counts, and never display or persist raw component content. Unsupported
routes emit no fabricated evidence.

Acceptance: one canonical event exists per completed Runtime turn with zero
fabricated events for unsupported paths; event hash equals the exact prompt
used by the attributed provider request; serialization contains no base
prompt, governed context, deferred content, or secret-bearing identifier;
context-usage evidence remains a separate semantic projection.

### Slice 1.5 - Communication Governance

Status: Complete.

Core resolves response detail, observable interaction profiles, locale,
required-content preservation, artifact/skill references, precedence, and
unsupported behavior. Runtime resolves after route selection and attributes
explicit locale/preservation instructions to
`runtime-communication-contract`. Parent and managed-child decisions are
independent. Provider attempts, final-request observation, CLI diagnostics,
GUI, TUI, SDK, and replay carry the same content-free evidence.

Codex GPT-5 routes project revision-backed verbosity; supported standalone
Codex profiles report translated personality loss. Owned OpenCode agent files
use route-specific `textVerbosity`. Claude output-style mutation and OpenCode
invocation mutation remain unsupported and fail before transport under `deny`.
Commit and pull-request renderers bind every claim to exact candidate,
verification, and residual-risk evidence.

Acceptance: no provider label becomes canonical vocabulary; no unsupported
control is silently approximated; native projection preserves unmanaged state
and existing drift/rollback ownership; no global communication default or
prompt-fallback profile is promoted without Slice 2 evaluation.

### Slice 2 - Evaluation And Ablation

Status: Research basis complete; implementation pending.

Execution owner: [issue #95](https://github.com/sequelcore/kiln/issues/95) for
the cross-harness communication-default evaluation. The broader prompt-component
inventory and progressive-disclosure prerequisites remain owned by this slice.

Create a versioned prompt-component inventory with owner, activation rule,
scope, applicability, expected token cost, and eval suite identity. Build
representative task fixtures (repository discovery, tool use, malformed tool
recovery, editing, safety, exact-date research, concise response preferences,
long-form technical explanation). Evaluate current and candidate prompts per
admitted model, provider route, snapshot, and harness revision. Run repeated
trials and component-removal ablations, not only whole-prompt comparisons.
Prioritize task outcome, required-content preservation, correctness, and safety
before style, length, tokens, or cache behavior. Define statistical and
operational promotion thresholds before collecting release evidence.

Acceptance: a prompt change cannot become a default from snapshot, string, or
token-count tests alone; baseline, candidate, and removal-ablation inputs are
replayable by manifest hash and config identity; model-family regressions
remain visible so aggregate improvement cannot hide a material route-specific
regression; source limitations and a predeclared no-promotion outcome are
recorded; the previously reverted executable-tool reduction is reconsidered
only through this gate.

For communication candidates, the evaluation must separate operator profile,
native detail control, and each response skill; preserve requested long-form and
exact-format behavior; score required-content recall and correctness before
style or length; and retain a no-promotion result when no candidate clears the
predeclared gate.

Disconnected native continuity is evaluated in this slice, not assumed from a
successful file copy. Use clean temporary harness homes with no Runtime,
Gateway, MCP server, or readable `~/.kiln` source. Deterministic fixtures must
prove independent instruction loading, skill-package discovery, provenance and
digest reporting, drift refusal, idempotent resync, and exact uninstall. Paired
behavior cohorts are: no projected baseline, minimal global baseline, baseline
plus an explicitly selected skill, and attached Runtime.

Run the behavior cohorts per harness, model, and revision over scope-creep,
unnecessary-framework, speculative-compatibility, unrelated-file, ambiguity,
security-boundary, refactor, and verification fixtures. Correctness, safety,
required-content preservation, and scope fidelity are primary; output size,
tokens, cost, and latency are secondary. Aggregate improvement cannot override
a material per-harness regression, and `no-promotion` remains a valid outcome.
Codex is the first live evaluation harness; Claude Code and OpenCode remain
deterministic projection-only until explicit usage capacity is available.

Implementation checkpoint (2026-08-30): Core now owns the versioned eight-task
fixture, schema, deterministic scorer, four-cohort pairing gate, and built-in
skill portability contract. A two-task, one-repeat Codex/Sol pilot validated the
runner and produced a diagnostic-only result; it did not promote a default.
Release evidence still requires all eight tasks, at least three paired repeats,
the attached-Runtime cohort, and later live Claude Code/OpenCode cohorts when
explicit usage capacity exists. See the
[Codex native-continuity prepilot](../evaluations/native-continuity-codex-prepilot-2026.md).

### Slice 2.5 - Provider Cache Topology

Status: Queued behind Slice 2.

Turn effective-prompt component scope into the exact cache topology sent to
each provider. Define one Core-owned desired topology and partition identity;
let adapters project only the breakpoint, affinity, and retention capabilities
their pinned routes actually support. Replace the CLI's literal dynamic-boundary
marker with typed evidence or delete it; prompt text must never impersonate a
provider cache control.

Keep reusable tool schemas and system components before the first volatile
component. Move task, exact per-turn timestamps, admitted dynamic context, and
other volatile material after the stable provider breakpoint when provider
semantics and instruction authority permit it. If a required high-authority
component cannot move, report the resulting cache limitation instead of
weakening its precedence. Derive request-region stability and serialized order
from the effective manifest and the actual adapter payload rather than labeling
the whole system stable.

Add route-owned `none`, short, and long retention resolution only where the
provider supports it. Bind reuse to tenant, route, model, policy, effective
authority, tool-schema, and any other dimension required to prevent invalid
reuse. Retention that changes provider data handling or Zero Data Retention
eligibility requires an explicit operator-visible decision.

Acceptance: repeated warm requests demonstrate provider-reported reuse of the
intended stable prefix; changing task-only dynamic content preserves only the
admitted prefix; changing tenant, route, model, policy, authority, or tool
schema produces no invalid reuse; unsupported controls remain explicit; exact
serialized request evidence agrees with component scope; and cache gains pass
Slice 2 outcome, safety, authority, required-content, and tool-trajectory gates.
Cold, warm, post-short-TTL, and long-session results report absolute cache
read/write/uncached tokens and TTFT, not only a hit ratio.

### Admitted Dependency Boundary - Capability Descriptor Disclosure

Status: Complete as an architecture admission on 2026-08-30; no implementation
slice started.

This boundary admits only the dependency needed by Roadmap 11 Slice 3. The
Capability Catalog remains the owner of identity, eligibility, descriptor and
schema digests, effect posture, and freshness. The Capability Fabric resolver
will own selection. Prompt Governance owns only disclosure timing and assembly
of an already-eligible, already-selected descriptor and tool schema into a
provider request, as defined by
[Capability Descriptor Disclosure](../architecture/context/context-governance.md#capability-descriptor-disclosure).

The admitted rules are:

- the initial provider request exposes only a bounded discovery contract and
  its required safe metadata, not every deferred tool definition;
- a selected definition enters a later request only while its catalog evidence
  remains current;
- required safety and authority information accompanies the definition before
  the model can request the governed effect;
- disclosure evidence is content-free and identifies the catalog digest,
  descriptor digest, decision, and request scope; and
- disclosure never grants invocation authority or bypasses Runtime admission.

The existing `tool_catalog_search` and progressive tool-admission flow may be
reused as infrastructure. They do not become aliases for `capability.search` or
`capability.describe`, and they do not become Capability Catalog or resolver
authority.

This admission does not define or implement the Roadmap 11 search contracts,
ranking, resolver, provider adapters, schema injection, or execution. It also
does not start the broader skill-resource, nested-instruction, cache-topology,
or cross-harness work below. Slice 2.5 and this track's full Slice 3 retain
their existing queue and promotion gates.

### Slice 3 - Progressive Disclosure

Status: Queued behind Slice 2.5.

The skill capability plane decides which skill is admitted; this slice decides when its body
and resources enter the prompt. Keep initial skill projection metadata-only;
load full instructions and resources only after explicit or policy-owned
selection. Resolve nested repository instructions when work reaches the
relevant path, with root boundaries, duplicate suppression, and byte/token
budgets, at explicit scope boundaries with deterministic order and replay
evidence. Apply identical admission semantics to parent and managed-child
routes.

Acceptance: deferred instructions and schemas do not contribute to the
provider prompt or its token estimate before activation; activation is
explicit, replayable, scope-bounded, and fails closed on missing or ambiguous
authority; required safety and authority information is never deferred behind
the action it governs; cross-harness conformance fixtures prove semantic
parity without requiring identical provider prompt text.

Progressive disclosure must measure both sides of its cache interaction. A
smaller initial tool or instruction prefix is not promoted when repeated
activation churn increases uncached input, total task latency, tool-trajectory
failures, or overall cost.

### Slice 4 - Controlled Language Packs

Status: Blocked on validation contracts and distribution authority.

Define a provider-neutral compliance-pack contract with explicit activation,
document scope, standard/version provenance, validator identity, and result
state. Separate guided drafting, deterministic validation, and
human-certified compliance. Support a pack like ASD-STE100 only when the
operator supplies or licenses the authoritative standard and Kiln has
distribution authority for packaged material. Package no licensed standard
without authority; keep `clear-writing` and `action-first-communication`
independent from controlled-language compliance.

Acceptance: Kiln never labels prompt-guided text as validated or certified
compliance; reports identify standard version, validator version, checked
rules, unresolved review requirements, and evidence timestamp; pack removal
leaves no global prompt residue or hidden configuration; legal/distribution
approval and representative document evals exist before any first-party pack
is published.

## Promotion Gates

- One Runtime prompt authority exists for normal, retry, and fallback calls.
- One canonical owner exists for admission, assembly, evidence, presentation,
  and configuration; no surface-local duplicate policy is introduced.
- Evidence contains hashes and counts, never prompt content or secrets.
- Exact request attribution survives routing, retry, fallback, managed-child,
  and restored-session paths.
- Skill activation consumes canonical skill admission rather than recomputing it.
- No default component change bypasses model-specific evaluation and removal
  ablation.
- Token or cache improvement does not compensate for correctness, safety, or
  tool-trajectory regression.
- Cache topology follows the exact provider serialization and manifest scope;
  no literal prompt marker is treated as a provider breakpoint.
- Cache reuse fails closed across tenant, route, model, policy, authority, and
  tool-schema partition changes.
- Retention and affinity controls are route capabilities with explicit privacy
  and unsupported-state evidence, not universal defaults.
- Safety and authority instructions are never deferred behind the action they
  govern.
- Optional writing/compliance packs are explicit, removable, versioned, and
  separately validated.
- Independent privacy, security, architecture, and findings-first reviews have
  no unresolved high or medium findings.

## Verification

Core/Runtime/Gateway event tests, privacy serialization tests, cross-surface
replay parity, representative eval fixtures, per-model prompt snapshots,
task-outcome evals, component-removal ablations, progressive-disclosure
fixtures, provider cache-topology fixtures, invalid-reuse probes, paired cold
and warm live provider trials, controlled-language validator fixtures (pass, fail, partial,
unsupported, human-review-required), workspace typecheck, affected-package
tests, and `git diff --check`.

## Completion Criteria

Operators can inspect exactly which content-free prompt components affected a
turn; changes are removable and evaluated; scoped content loads only after
explicit governed activation; provider cache reuse follows typed component
scope without crossing an authority or policy partition; optional
controlled-language packs distinguish
drafting guidance from deterministic validation and human certification.
Stable contracts are promoted into architecture and operator guides, and this
track is removed once all remaining obligations are complete or split into
independently owned roadmap tracks with no duplicated scope.
