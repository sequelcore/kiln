# 06 - Prompt Governance Plane

Status: Active staged-governance track
Execution: Queued - higher-priority Ready work closes first.
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

Stable boundaries are documented in
[Context Governance](../architecture/context/context-governance.md),
[Context Usage Projection](../architecture/context/context-usage-projection.md), and
[Agent Context](../architecture/context/agent-context.md). The research and source
basis lives in
[Prompt Component And Response Governance](../research/23-prompt-component-governance.md).

## Goals

- Persist one canonical, content-free effective-prompt observation for the
  provider request that completed each runtime turn.
- Give operators one read-only inspection contract across CLI, TUI, GUI, SDK,
  and replay without exposing prompt text or secrets.
- Evaluate prompt components and removals against representative tasks for
  each admitted model family before promotion.
- Load nested instructions, skill bodies, resources, and nonessential tool
  schemas only when their scope is reached and policy admits them.
- Keep instruction profiles limited to durable organization doctrine; keep
  project facts in adopted project context, task procedures in skills, and
  provider/model/budget decisions in executable config.
- Support optional controlled-language packs through explicit activation,
  source provenance, deterministic validation, and honest compliance states.

## Ownership

This track owns prompt assembly evidence, activation of admitted instruction and
skill content, component evaluation, and privacy-safe operator inspection. Skill
eligibility belongs to Roadmap 05; provider/model/budget decisions remain config.

## Scope

- Typed effective-prompt manifests and final-request attribution.
- Content-free events and cross-surface inspection.
- Model-specific component evaluation and ablation.
- Progressive instruction, skill-resource, and tool-schema disclosure.
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

## Ordered Slices

### Slice 0 - Effective Prompt Foundation

Status: Complete.

Core owns one typed manifest; Runtime sends `manifest.finalPrompt`; hashes,
scopes, token estimates, validation, and privacy-safe request evidence are
implemented. Fail-closed prompt/manifest matching guards every external
invocation.

### Slice 1 - Canonical Observation

Status: Queued; next admissible work after higher priorities.

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

### Slice 2 - Evaluation And Ablation

Status: Research behind Slice 1.

Create a versioned prompt-component inventory with owner, activation rule,
scope, applicability, expected token cost, and eval suite identity. Build
representative task fixtures (repository discovery, tool use, malformed tool
recovery, editing, safety, exact-date research, concise response preferences,
long-form technical explanation). Evaluate current and candidate prompts per
admitted model family and route, and run component-removal ablations, not only
whole-prompt comparisons. Define statistical and operational promotion
thresholds before collecting release evidence.

Acceptance: a prompt change cannot become a default from snapshot, string, or
token-count tests alone; baseline, candidate, and removal-ablation inputs are
replayable by manifest hash and config identity; model-family regressions
remain visible so aggregate improvement cannot hide a material route-specific
regression; the previously reverted executable-tool reduction is reconsidered
only through this gate.

### Slice 3 - Progressive Disclosure

Status: Queued behind Slice 2.

Roadmap 05 decides which skill is admitted; this slice decides when its body
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
- Skill activation consumes Roadmap 05 admission rather than recomputing it.
- No default component change bypasses model-specific evaluation and removal
  ablation.
- Token or cache improvement does not compensate for correctness, safety, or
  tool-trajectory regression.
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
fixtures, controlled-language validator fixtures (pass, fail, partial,
unsupported, human-review-required), workspace typecheck, affected-package
tests, and `git diff --check`.

## Completion Criteria

Operators can inspect exactly which content-free prompt components affected a
turn; changes are removable and evaluated; scoped content loads only after
explicit governed activation; optional controlled-language packs distinguish
drafting guidance from deterministic validation and human certification.
Stable contracts are promoted into architecture and operator guides, and this
track is removed once all remaining obligations are complete or split into
independently owned roadmap tracks with no duplicated scope.
