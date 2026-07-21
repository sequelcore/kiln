# 07 - Prompt Governance Plane

Status: Active staged-governance track.
Execution: Queued - the request-evidence foundation is complete; do not start
Slice 1 before higher-priority Ready work closes or the queue is explicitly
reprioritized.
Created: 2026-07-21.

## Objective

Make every effective model prompt small, attributable, replayable, and
evaluated without turning instruction prose into a second configuration or
policy system.

Kiln must distinguish durable doctrine, project facts, task procedures,
provider configuration, admitted runtime context, and optional writing
standards. Prompt changes must be observable and removable, and they must not
be promoted from token-count or string-snapshot evidence alone.

## Current Position

The foundation is implemented:

- Core owns a typed effective-prompt manifest with ordered `static`, `dynamic`,
  and `deferred` components.
- Runtime sends `manifest.finalPrompt` as the single provider prompt authority.
- Exact prompt and component identities use SHA-256 content hashes.
- Provider-request evidence carries redacted hashes, scopes, and token
  estimates without raw prompt or caller-controlled provenance text.
- Manifest construction rejects blank or duplicate component ids and invalid
  token estimates.
- The canonical Sequel instruction profile contains durable engineering
  doctrine rather than provider, model, permission, budget, or project facts.
- `action-first-communication` is an explicit neutral skill, not universal
  doctrine or a diagnosis-shaped default.
- A proposed universal executable-tool prompt reduction was reverted because
  it lacked representative model-specific evaluation.

Stable boundaries are documented in
[Context Governance](../architecture/context-governance.md),
[Context Usage Projection](../architecture/context-usage-projection.md), and
[Agent Context](../architecture/agent-context.md). The research and source
basis lives in
[Prompt Component And Response Governance](../research/23-prompt-component-governance.md).

## Goals

- Persist one canonical, content-free effective-prompt observation for the
  provider request that completed each runtime turn.
- Give operators one read-only inspection contract across CLI, TUI, GUI, SDK,
  and replay without exposing prompt text or secrets.
- Evaluate prompt components and removals against representative tasks for each
  admitted model family before promotion.
- Load nested instructions, skill bodies, resources, and nonessential tool
  schemas only when their scope is reached and policy admits them.
- Keep instruction profiles limited to durable organization doctrine.
- Keep project facts in adopted project context, task procedures in skills,
  and provider/model/budget decisions in executable config.
- Support optional controlled-language packs through explicit activation,
  source provenance, deterministic validation, and honest compliance states.

## Scope

- Core effective-prompt evidence and canonical session events.
- Runtime attribution across routing, retry, fallback, and managed children.
- Gateway contracts and read-only operator presentation.
- Prompt component inventories, budgets, snapshots, eval datasets, and
  component-removal ablations.
- Scoped instruction and tool-schema discovery contracts.
- Optional response and controlled-language skill packs.
- Drift diagnostics between canonical config/profile sources and generated
  native harness projections.

## Non-Goals

- Replace provider system prompts or native harness safety contracts.
- Make minimal token count a correctness or intelligence metric.
- Apply a universal brevity, ADHD, personality, or formatting prompt.
- Claim ASD-STE100 compliance from LLM prompting or prose review alone.
- Copy licensed controlled-language material into Kiln without distribution
  authority.
- Store raw effective prompts, secrets, retrieved context, or unredacted
  provenance in events, reports, telemetry, or benchmarks.
- Hardcode model rankings, provider preferences, budgets, or permission state
  in instruction profiles.
- Add compatibility aliases, parallel prompt builders, or surface-local prompt
  policy.

## Delivery Slices

### Slice 0 - Effective-Prompt Foundation

State: Complete.

Delivered:

- Core manifest construction, validation, exact hashes, token estimates, and
  redacted request evidence.
- Runtime assembly for base, governed, temporal, routing, and deferred
  components.
- One prompt authority for normal and fallback provider calls.
- Fail-closed prompt/manifest matching before external invocation.
- Content-derived component revisions and privacy-safe evidence metadata.
- Compact Sequel doctrine and the opt-in `action-first-communication` skill.
- Architecture, guide, and research documentation.

Verification evidence:

- Core: 286 files and 3,524 tests passed.
- Runtime: 200 files and 2,661 tests passed.
- Full workspace typecheck passed.
- Independent findings-first review closed with no remaining actionable
  findings.
- CLI package execution passed 1,441 tests before a Windows/Vitest
  `spawn UNKNOWN` worker-pool failure; the affected test and skill projection
  suites passed in isolated single-worker runs.

### Slice 1 - Canonical Event And Operator Inspection

State: Queued behind higher-priority Ready roadmap work.

Deliver one provider-neutral `effective_prompt_observed` event for the final
completed request of a turn.

Required work:

- Add the event to Core session-event contracts and persist it beside context
  usage without rebuilding the manifest.
- Attribute retry and fallback evidence to the final completed request.
- Add the standalone Gateway wire contract and explicit Core-to-Gateway mapper.
- Transport the same content-free payload to CLI, TUI, GUI, SDK, and replay.
- Present final prompt hash, estimated tokens, component count, and scope
  counts; never display or persist raw component content.
- Define unsupported native-harness/text-only routes explicitly rather than
  synthesizing evidence.

Acceptance criteria:

- One canonical event exists per completed Runtime turn and zero fabricated
  events exist for unsupported paths.
- Event hash equals the exact prompt used by the attributed provider request.
- JSON serialization contains no base prompt, governed context, deferred
  content, secret-bearing identifier, or raw provenance source.
- CLI, TUI, GUI, SDK, and restored replay agree on the same observation.
- Context-usage evidence remains a separate semantic projection.

### Slice 2 - Model-Specific Evaluation And Ablation Gate

State: Research after Slice 1 unless explicitly reprioritized.

Define the evidence required to add, remove, shorten, or promote a prompt
component.

Required work:

- Create a versioned prompt-component inventory with owner, activation rule,
  scope, applicability, expected token cost, and eval suite identity.
- Build representative task fixtures for repository discovery, tool use,
  malformed tool recovery, editing, safety, exact-date research, concise
  response preferences, and long-form technical explanation.
- Evaluate current and candidate prompts per admitted model family and route.
- Run component-removal ablations, not only whole-prompt comparisons.
- Record outcome quality, tool trajectory, safety preservation, latency, input
  tokens, cache behavior, and failure categories.
- Define statistical and operational promotion thresholds before collecting
  release evidence.

Acceptance criteria:

- A prompt change cannot become a default from snapshot, string, or token-count
  tests alone.
- Baseline, candidate, and removal-ablation inputs are replayable by manifest
  hash and config identity.
- Model-family regressions remain visible; aggregate improvement cannot hide a
  material route-specific regression.
- Eval datasets contain no benchmark-only production branch or evaluator
  leakage into the model prompt.
- The previously reverted executable-tool reduction is reconsidered only
  through this gate.

### Slice 3 - Progressive Instruction And Tool Disclosure

State: Queued behind Slice 2 evidence contracts.

Reduce initial context by loading scoped material when the task reaches its
owner boundary.

Required work:

- Keep initial skill projection metadata-only; load full skill instructions and
  resources only after explicit or policy-owned selection.
- Resolve nested repository instructions when work reaches the relevant path,
  with root boundaries, duplicate suppression, and byte/token budgets.
- Keep essential tool names and safety semantics available while deferring
  nonessential schemas until discovery selects them.
- Preserve deterministic ordering, provenance hashes, cache boundaries, and
  manifest evidence for every expansion.
- Apply identical admission semantics to parent and managed-child routes.

Acceptance criteria:

- Deferred instructions and schemas do not contribute to the provider prompt
  or its token estimate before activation.
- Activation is explicit, replayable, scope-bounded, and fails closed on
  missing or ambiguous authority.
- Repository-root and context-budget boundaries prevent unbounded discovery.
- Required safety and authority information is never deferred behind the action
  it governs.
- Cross-harness conformance fixtures prove semantic parity without requiring
  identical provider prompt text.

### Slice 4 - Optional Controlled-Language Packs

State: Blocked on distribution authority and Slice 2 validation contracts.

Provide controlled technical-language support without turning a writing style
into universal model doctrine.

Required work:

- Define a provider-neutral compliance-pack contract with explicit activation,
  document scope, standard/version provenance, validator identity, and result
  state.
- Separate guided drafting, deterministic validation, and human-certified
  compliance.
- Support an ASD-STE100 pack only when the operator supplies or licenses the
  authoritative standard and Kiln has distribution authority for packaged
  material.
- Build deterministic checks where rules permit and report non-machine-
  decidable rules as review requirements.
- Keep `clear-writing` and `action-first-communication` independent from
  controlled-language compliance.

Acceptance criteria:

- Kiln never labels prompt-guided text as validated or certified compliance.
- Reports identify standard version, validator version, checked rules,
  unresolved review requirements, and evidence timestamp.
- Pack removal leaves no global prompt residue or hidden configuration.
- Legal/distribution approval and representative document evals exist before
  any first-party ASD-STE100 pack is published.

## Promotion Gates

- One canonical owner exists for admission, assembly, evidence, presentation,
  and configuration; no surface-local duplicate policy is introduced.
- Prompt contents and arbitrary provenance strings remain absent from durable
  evidence.
- Exact request attribution survives routing, retry, fallback, managed-child,
  and restored-session paths.
- Every default prompt change passes representative model-specific evaluation
  and removal ablation.
- Token or cache improvement does not compensate for correctness, safety, or
  tool-trajectory regression.
- Progressive loading cannot defer the authority or safety rule governing an
  action.
- Optional writing/compliance packs are explicit, removable, versioned, and
  separately validated.
- Independent privacy, security, architecture, and findings-first reviews have
  no unresolved high or medium findings.

## Verification

- Core contract tests for validation, hashing, redaction, event creation, and
  serialization.
- Runtime tests for exact prompt assembly, pre-invocation matching, routing
  suffixes, retry, fallback, and managed-child attribution.
- Gateway conformance tests against the standalone wire schema.
- CLI, TUI, GUI, SDK, and replay projection tests using the same event fixture.
- Secret-bearing metadata fixtures proving content-free evidence.
- Per-model prompt snapshots, task outcome evals, and component-removal
  ablations.
- Progressive-disclosure fixtures for scoped instructions, skills, resources,
  and tool schemas.
- Controlled-language validator fixtures with pass, fail, partial, unsupported,
  and human-review-required results.
- Focused checks first, then Core, Runtime, Gateway, CLI, TUI, GUI, and full
  workspace typecheck gates appropriate to the touched slice.

## Completion Criteria

- Operators can inspect and replay which effective prompt governed a completed
  request without accessing its text or secrets.
- Prompt defaults have model-specific outcome and removal-ablation evidence.
- Scoped instructions, skill bodies, resources, and nonessential tool schemas
  load progressively under one governed contract.
- Optional controlled-language packs distinguish drafting guidance from
  deterministic validation and human certification.
- Stable contracts are promoted into architecture and operator guides.
- This active track is removed once all remaining obligations are complete or
  split into independently owned roadmap tracks with no duplicated scope.
