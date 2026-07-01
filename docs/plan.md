# Provider-Model Discovery Architecture Program Plan

Status: architectural decision required before production changes

Prepared: 2026-07-01
Canonical owner: `docs/architecture/provider-model-discovery.md:1`

## Objective

Correct Kiln's provider-model discovery, normalization, evidence, eligibility,
and operator-presentation contracts end to end. A provider or harness catalog
entry must remain diagnostic evidence until canonical configuration,
credential/authentication evidence, entitlement, required capabilities,
policy admission, freshness, route health, and any explicitly required probe
evidence establish that a distinct provider/model route is selectable for a
particular use.

The result must be provider-neutral, fail closed, preserve raw evidence, keep
harness/provider/model/route identities distinct, and give CLI, GUI, TUI, SDK,
Gateway, managed-agent, direct-provider, subscription-provider, and local
provider paths one authoritative semantic contract.

## Non-goals

- Do not modify Roadmap 03, native projection ownership, or import unmanaged
  native configuration into canonical Kiln policy.
- Do not modify Roadmap 04 or rank efficient routes among already-admissible
  choices.
- Do not add an OpenCode-specific shared-domain filter, static model allowlist,
  first-provider/model fallback, compatibility DTO, duplicate owner, or legacy
  execution path.
- Do not infer authentication, entitlement, health, capabilities, or
  selectability from an advertised/discovered identifier.
- Do not probe a catalog broadly, use real credentials in tests, perform paid
  inference, or make live-provider success claims without Ricardo's explicit
  route-specific authorization.
- Do not silently import, delete, or repair native harness configuration.

## Classification And Architectural Decision Gate

### Classification: B — architecture program

This is not a single missing filter. The public gateway result has only coarse
availability/auth/catalog/model/capability/health fields and no explicit
configured, entitled, policy-admitted, probe-verified, or use-specific
selectable state (`packages/gateway-contracts/src/frames.ts:26-46`,
`packages/gateway-contracts/src/frames.ts:91-165`). Discovery and switching are
owned by a GUI-named runtime monolith spanning native harnesses, OAuth, direct
APIs, OpenRouter, and local providers
(`packages/runtime/src/gateway/gui-provider-models.ts:89-274`,
`packages/runtime/src/gateway/gui-provider-models.ts:435-1997`), while managed
agents flatten every `available` discovery to raw model arrays
(`packages/cli/src/config/managed-agent-provider-models.ts:23-35`). Core also
has separate static capability and eligibility semantics
(`packages/core/src/agents/model-capability-registry.ts:2`,
`packages/core/src/agents/model-capability-registry.ts:292`,
`packages/core/src/agents/model-capability-registry.ts:327`), and GUI/TUI
independently interpret the weak projection.

The correction therefore has several independently valuable migrations: a
provider-neutral evidence contract, adapter normalization, eligibility
derivation, managed-agent adoption, and operator-surface adoption. Each can be
tested and committed independently; together they alter a public cross-package
contract. That is sufficient evidence for B.

### Why this is not Roadmap 03 or Roadmap 04

Roadmap 03 owns federated harness configuration and native projection; this
program consumes native discovery/projection as evidence but does not make it
policy authority. Roadmap 04 owns efficiency decisions after admission; this
program decides whether a route is admissible at all. Putting this work in
either roadmap would blur configuration projection, eligibility, and ranking
owners. The architecture index already assigns provider/model discovery to
the canonical discovery document (`docs/architecture/README.md:98-100`), and
the roadmap index names it as adjacent canonical architecture
(`docs/roadmap/README.md:54`).

### Mandatory decision gate

Before creating any numbered roadmap or changing production code, Piama and
Ricardo must approve or revise this classification, the domain vocabulary,
source precedence, package ownership, migration order, and explicit statement
that Roadmaps 03/04 remain unchanged. Record that decision in this plan or a
canonical ADR. Only after approval may Hal create a numbered roadmap following
`docs/roadmap/README.md`; absent approval, this plan remains the bounded
architecture-program proposal. Do not create a roadmap speculatively.

## Evidence Ledger

### Repository observations

- Kiln's public discovery result is a surface DTO, not an execution-authority
  proof (`packages/gateway-contracts/src/frames.ts:155-165`).
- Runtime aggregates direct and harness discoveries in one GUI-named module:
  Codex OAuth (`packages/runtime/src/gateway/gui-provider-models.ts:435-799`),
  OpenAI (`packages/runtime/src/gateway/gui-provider-models.ts:828-915`),
  Anthropic (`packages/runtime/src/gateway/gui-provider-models.ts:916-1037`),
  DeepSeek (`packages/runtime/src/gateway/gui-provider-models.ts:1038-1119`),
  OpenRouter (`packages/runtime/src/gateway/gui-provider-models.ts:1120-1260`),
  Ollama (`packages/runtime/src/gateway/gui-provider-models.ts:1261-1325`),
  LM Studio (`packages/runtime/src/gateway/gui-provider-models.ts:1326-1374`),
  OpenCode Go/Zen (`packages/runtime/src/gateway/gui-provider-models.ts:1375-1482`),
  OpenCode CLI (`packages/runtime/src/gateway/gui-provider-models.ts:1504-1589`),
  and Codex CLI (`packages/runtime/src/gateway/gui-provider-models.ts:1597-1997`).
- Runtime switch admission checks discovery membership and route health but
  cannot prove the omitted states (`packages/runtime/src/gateway/gui-provider-models.ts:2019-2097`).
- Managed-agent discovery discards status/evidence and retains model strings
  (`packages/cli/src/config/managed-agent-provider-models.ts:23-35`).
- Native route integrity already distinguishes stale catalog, unknown model,
  authorization failure, timeout, unsupported proof, and projection drift;
  these distinctions must survive the new contract
  (`packages/cli/src/config/native-route-integrity.ts:150-207`).
- Doctor and config status already project partial evidence but are not fed one
  canonical eligibility summary (`packages/cli/src/application/harness-doctor.ts:117-195`,
  `packages/cli/src/application/harness-doctor.ts:261-290`,
  `packages/cli/src/application/config-status.ts:341-388`).
- Catalog/cache ownership is split across
  `packages/runtime/src/gateway/provider-discovery-cache.ts`,
  `packages/runtime/src/gateway/provider-catalog-service.ts`, and
  `packages/cli/src/config/provider-discovery-cache.ts`; stale evidence is
  explicitly marked at `packages/cli/src/config/provider-discovery-cache.ts:289-300`.

### OpenCode primary-source repository evidence

Inspected clone: `C:/Proyectos/Sequel/cloned/opencode`

Commit: `3136b1ba9779c91f74cd8ceabc8574d84880a0c9`

- `opencode models` calls `Provider.Service.list` and prints
  `providerID/modelID`; `--refresh` refreshes Models.dev data, not account
  entitlement (`C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/cli/cmd/models.ts:8-10`,
  `C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/cli/cmd/models.ts:22-30`,
  `C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/cli/cmd/models.ts:49-64`).
- Provider state starts with Models.dev metadata but providers are populated
  through environment credentials, stored keys, configuration, plugins, and
  autoloaders (`C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/provider/provider.ts:1313-1351`,
  `C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/provider/provider.ts:1394-1404`,
  `C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/provider/provider.ts:1488-1549`).
  Enabled/disabled provider rules are separate
  (`C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/provider/provider.ts:1357-1365`,
  `C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/provider/provider.ts:1577-1582`).
- Configuration may introduce provider/model aliases
  (`C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/provider/provider.ts:1406-1429`).
  Capability defaults optimistically set text/tool-call support when evidence
  is absent
  (`C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/provider/provider.ts:1430-1450`),
  so those claims are harness-derived defaults, not
  provider verification.
- Variants and disabled variants remain separate metadata
  (`C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/provider/provider.ts:1478-1482`,
  `C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/provider/provider.ts:1606-1616`).
  Deprecated/alpha/whitelist filtering occurs before empty providers are
  removed
  (`C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/provider/provider.ts:1586-1623`).
- OpenCode's own provider autoloads free models without credentials and removes
  paid models without a key
  (`C:/Proyectos/Sequel/cloned/opencode/packages/opencode/src/provider/provider.ts:179-200`);
  therefore listing does not have one
  universal authentication meaning.
- `opencode-go` is a distinct Models.dev provider and API route
  (`C:/Proyectos/Sequel/cloned/opencode/packages/opencode/test/tool/fixtures/models-api.json:28003-28007`).
- Models.dev data uses memory/disk caching, a five-minute cache, disk/bundled/
  network precedence, periodic refresh, and failure preservation
  (`C:/Proyectos/Sequel/cloned/opencode/packages/core/src/models-dev.ts:138-235`).

Observed implication: OpenCode's approximately 397 displayed identifiers are
a configured/provider-service catalog after OpenCode's own loading/filtering,
not 397 Kiln-authenticated, entitled, healthy, capability-compatible,
policy-admitted, or selectable routes.

Confidence: high for behavior at the pinned commit; medium for stability
because OpenCode provider loading and Models.dev metadata are upstream
implementation details. Kiln must adapt them as versioned evidence, not adopt
them as policy.

### Official primary-source research

All sources accessed 2026-07-01. Documentation claims are facts about the
documented upstream interface; exact current implementation claims above come
from the pinned clone.

| Accessed | Source | Claim supported | Architectural impact |
|---|---|---|---|
| 2026-07-01 | https://opencode.ai/docs/models/ | Model selection uses provider/model identifiers; configured models and load precedence affect available choices. | Preserve raw provider/model IDs and configuration provenance; do not equate listing with execution authority. |
| 2026-07-01 | https://opencode.ai/docs/providers | Credentials and provider configuration add/shape providers and models. | Authentication/configuration evidence must be explicit and adapter-owned. |
| 2026-07-01 | https://opencode.ai/docs/go/ | OpenCode Go has its own endpoint and model identifiers. | Treat Go as a distinct provider route, not an alias for the underlying model. |
| 2026-07-01 | https://opencode.ai/docs/zen/ | OpenCode Zen exposes a model catalog through its own service. | Preserve Zen provider identity and entitlement uncertainty. |
| 2026-07-01 | https://developers.openai.com/codex/ | Codex has native authentication/model-selection behavior. | Codex harness evidence is not interchangeable with direct OpenAI provider evidence. |
| 2026-07-01 | https://docs.anthropic.com/en/docs/claude-code/getting-started | Claude Code supports native authentication/setup flows. | Keep Claude Code harness identity separate from Anthropic API provider identity. |
| 2026-07-01 | https://docs.anthropic.com/en/docs/claude-code/cli-usage | Claude Code accepts model aliases and full identifiers. | Preserve alias/full-ID provenance and resolve without collapsing routes. |
| 2026-07-01 | https://openrouter.ai/docs/guides/overview/models | OpenRouter exposes a broad catalog with filtering, aliases, and canonical slugs. | Catalog identity, normalized model family, and OpenRouter execution route are separate concepts. |
| 2026-07-01 | https://openrouter.ai/docs/api/api-reference/models/get-models | The models API returns catalog metadata and supports filtering. | Adapter may retain authoritative fields, but listing alone cannot prove user entitlement or route health. |

### Facts, observations, inferences, and Kiln decisions

- **Sourced facts:** the official interfaces and pinned OpenCode behavior listed
  above.
- **Repository observations:** current Kiln DTOs, flattening, caches, route
  integrity, and per-surface interpretations listed above.
- **Inferences requiring adapter tests:** catalog membership generally does not
  prove current account entitlement, health, or every capability; the same
  underlying model may be routable through multiple providers; optimistic
  capability defaults have lower authority than provider-declared or probe
  evidence.
- **Kiln decisions proposed for approval:** execution eligibility is a pure,
  use-specific derivation over typed evidence; missing required evidence fails
  closed; stale/raw evidence stays inspectable but cannot authorize a newly
  configured route; recommendations are separate from admission and require
  stable evidence, never temporary vendor preference.

## Research Questions And Current Answers

1. **What does discovered mean?** For direct APIs, an adapter received a model
   catalog response; for local providers, the endpoint reported installed
   names; for Codex, the app-server reported models; for OpenCode, its provider
   service listed provider/model IDs after its own loading/filtering. Claude
   Code's exact machine-readable discovery contract is **unknown** and must be
   researched before its adapter slice.
2. **Does discovery prove authentication?** No. Some calls require a credential,
   some catalogs are public/local, and OpenCode can autoload free models.
3. **Does discovery prove entitlement?** No; it proves only catalog evidence at
   its source unless the adapter records authoritative account-specific
   entitlement separately.
4. **Does discovery prove current availability?** No. Route health, cooldown,
   outages, quota, and endpoint reachability are separate evidence.
5. **Does discovery prove tools/streaming/reasoning/structured output?** Only
   when the source explicitly authoritatively declares that capability;
   OpenCode optimistic defaults are inferred/harness-reported, not verified.
6. **Can one model appear through multiple routes?** Yes: direct vendor,
   OpenRouter, OpenCode Go/Zen, native harness, and local routes can refer to an
   equivalent family while remaining distinct execution authorities.
7. **Aliases, duplicates, version families, deprecated entries?** All can exist.
   OpenCode config aliases and OpenRouter canonical slugs are evidenced;
   provider-specific alias/version/deprecation maps outside those sources are
   **unknown** until adapter evidence identifies them.
8. **Metadata provenance?** It must be tagged as provider-authoritative,
   harness-reported, inferred, cached, operator-declared, or probe-verified,
   with source/version/observation time and confidence where applicable.
9. **Stale, partial, unavailable, failed catalogs?** Retain last/raw evidence
   and totals for diagnostics with freshness/failure classification. Never
   authorize a new execution from stale/partial/failed evidence; do not relabel
   catalog failure as bad credentials or route failure as model absence.
10. **Interactive selectable models?** Canonically configured routes with
    acceptable credential/auth state, entitlement evidence when required,
    required turn capabilities, policy admission, acceptable freshness, and
    healthy/non-cooling route; explicit probes only when policy requires them.
11. **Managed-agent admissibility?** Only routes admitted for the agent's
    required capabilities, authority, adapter/execution mode, and managed-agent
    policy. Raw interactive discovery is insufficient.
12. **Capability-specific eligibility?** A pure derivation over use-case
    requirements and provenance-ranked claims; absent or insufficiently
    authoritative required capability evidence is ineligible.
13. **Should Kiln recommend/rank?** Not in this program. Admission may expose
    evidence to Roadmap 04; it must not encode temporary vendor opinions.
14. **Recommendation evidence?** Stable, reproducible measurements such as
    operator policy, verified capabilities, health/freshness, cost/latency
    observations, and benchmark evidence. Exact future weighting is **unknown**
    and belongs to Roadmap 04 after admission.
15. **Doctor summary?** Provider counts grouped by usable/configured/ineligible/
    stale/error, configured-route outcomes, bounded reasons/actions, and an
    explicit detail/search mode retaining raw totals and provenance.
16. **GUI/TUI large catalogs?** Default to eligible configured routes; expose
    search/grouping and detail classifications for raw discovered entries.
    Never imply truncation is the full catalog; retain totals and omitted counts.
17. **Canonical policy decisions?** Required evidence, freshness limits,
    capability requirements, interactive/managed admission, configured
    defaults, and recommendation boundaries belong to Kiln configuration/core.
18. **Adapter/native facts?** Raw IDs, aliases, source metadata, auth method,
    account-specific entitlement signals, native selected defaults, harness
    capabilities, cache headers/version, and probe outcomes belong to provider
    adapters or native harness evidence. They never become policy authority.

## Provider-Neutral Domain Contract

Final names are decided at the architecture gate; reuse existing types when
their semantics match. The minimum vocabulary is:

- **Catalog observation:** immutable raw provider/harness evidence, source,
  observed/expiry time, status, raw identifier/metadata, and failure class.
- **Normalized model identity:** provider-neutral family/version identity when
  evidence supports it; never an execution address.
- **Provider route identity:** provider plus provider-native model ID and
  account/endpoint scope needed to execute.
- **Harness route identity:** harness plus its reported provider/model route;
  harness identity remains distinct from provider identity.
- **Configuration evidence:** canonical Kiln route/default declaration and
  whether native configuration matches or drifts.
- **Credential/authentication evidence:** credential source/reference and
  validation state without secret material.
- **Entitlement evidence:** account-specific authorization state, independent
  of authentication.
- **Capability claim:** capability, value, provenance, authority/confidence,
  source version, and observation time.
- **Freshness:** fresh/stale/expired/unknown plus timestamps and source policy.
- **Route health:** healthy/cooling/unavailable/unknown with reason and retry
  horizon; it does not rewrite catalog membership.
- **Policy admission:** use-specific canonical decision and reasons.
- **Eligibility decision:** deterministic result for interactive or managed
  requirements over the evidence above.
- **Probe evidence:** explicitly authorized, bounded route verification; never
  assumed from catalog access.
- **Operator projection:** concise totals, eligible choices, reasons/actions,
  and bounded links/details back to raw evidence.

Invariants:

1. Advertised, discovered, configured, authenticated, entitled,
   capability-compatible, policy-admitted, route-healthy, probe-verified, and
   selectable are distinct, non-monotonic states.
2. A raw entry never grants execution authority. Missing required evidence is
   an explicit fail-closed reason.
3. Normalized model identity never collapses distinct provider or harness
   routes; aliases/duplicates retain provenance and raw IDs.
4. Canonical Kiln configuration/policy outranks native projection. Native state
   is evidence and drift input only.
5. Authentication does not imply entitlement; entitlement does not imply
   capability or health; health does not imply policy admission.
6. Cached/stale evidence remains diagnostic. It cannot silently admit newly
   configured execution.
7. Discovery, credential, entitlement, catalog, projection, capability, and
   route failures retain distinct classifications and actionable remediation.
8. Capability authority is ordered explicitly; an inferred default cannot
   override provider-authoritative or probe-verified contradictory evidence.
9. Interactive and managed-agent decisions share the same derivation but may
   differ by requirements/policy.
10. No secret values enter domain records, logs, fixtures, Gateway frames, or
    operator details.

## Surface Map And Bounded-Context Ownership

| Surface / flow | Current seam | Target owner |
|---|---|---|
| Public Gateway/SDK contract | `packages/gateway-contracts/src/frames.ts:13-165`; `packages/gateway-contracts/src/index.ts:94-95` | Gateway contracts project canonical core semantics; no independent eligibility logic. |
| Core identities/capabilities/policy | `packages/core/src/agents/model-capability-registry.ts:2-327`; `packages/core/src/agents/provider-execution-profiles.ts`; `packages/core/src/engine/domain/model-router.ts` | Core owns provider-neutral evidence and pure use-specific eligibility. |
| Runtime provider/harness adapters | `packages/runtime/src/gateway/gui-provider-models.ts:89-1997` | Runtime adapters own raw facts/normalization input, not policy. Split by concern rather than extend the monolith. |
| Catalog cache/freshness | `packages/runtime/src/gateway/provider-discovery-cache.ts`; `packages/runtime/src/gateway/provider-catalog-service.ts`; `packages/cli/src/config/provider-discovery-cache.ts:289-300` | Runtime cache owns observations/freshness; core defines semantics. Remove duplicate CLI authority during migration. |
| Credential/entitlement | `packages/runtime/src/gateway/gui-provider-models.ts:435-518`, `packages/runtime/src/gateway/gui-provider-models.ts:1375-1482`; credential pool docs | Credential subsystem supplies redacted evidence; adapters classify entitlement separately. |
| Health/cooldown | `packages/core/src/agents/provider-model-route-health.ts`; `packages/runtime/src/agents/provider-route-health/provider-model-route-health-store.ts` | Existing core/runtime health owners remain; eligibility consumes decisions. |
| Native integrity/readiness | `packages/cli/src/config/native-route-integrity.ts:108-207`; Codex probe `packages/runtime/src/gateway/gui-provider-models.ts:1749-1894` | CLI projection reports native evidence; explicitly authorized runtime probe supplies proof. |
| Managed-agent resolution | `packages/cli/src/config/managed-agent-provider-models.ts:23-35`; `packages/cli/src/config/managed-agent-routes.ts:56-77`, `packages/cli/src/config/managed-agent-routes.ts:1103` | Managed agents consume canonical managed eligibility, never raw arrays. |
| Doctor/config status | `packages/cli/src/application/harness-doctor.ts:117-195`, `packages/cli/src/application/harness-doctor.ts:261-290`, `packages/cli/src/application/harness-doctor.ts:354-360`; `packages/cli/src/application/config-status.ts:341-388` | CLI projects one canonical summary with detail evidence. |
| GUI | `packages/gui/src/lib/ws-client.ts:159-203`, `packages/gui/src/lib/ws-client.ts:491-532`; `packages/gui/src/lib/session-store.ts:1437-1459`; `packages/gui/src/components/provider-picker.tsx` | GUI renders contract; no local admission derivation. |
| TUI | `packages/tui/src/ws-client.ts:31-38`, `packages/tui/src/ws-client.ts:100-131`; `packages/tui/src/app.tsx:491-668`, `packages/tui/src/app.tsx:890-947` | TUI renders the same contract and bounded detail/search. |
| React/widget/native/studio | package adapters consume `gateway-contracts`; current app/ws-client files | Inherit the canonical contract; parity tests prove no reinterpretation. |

Boundaries: provider adapters may parse provider-specific metadata; shared core
must not name OpenCode/Codex/OpenRouter. Operator packages may format and
filter a supplied projection but may not infer eligibility. Managed-agent and
interactive consumers request different requirement profiles from the same
core decision service.

## Implementation Slices

All slices are proposals gated by architecture approval. Run one worker at a
time under the repository's `parallel workers: 1` policy. Malcolm writes and
confirms red tests before Reese changes production. Each worker assignment is
one concern and normally no more than two files.

### Slice 1 — Semantics and evidence contracts

Goal: establish one core vocabulary, provenance, freshness/failure classes,
identity invariants, and pure eligibility input/output without adapter or UI
behavior.

Atomic assignments:

1. **Malcolm:** add red contract tests in
   `packages/core/tests/agents/provider-model-evidence.test.ts` and
   `packages/core/tests/agents/model-capability-registry.test.ts`.
2. **Reese:** implement the provider-neutral evidence/identity contract in
   `packages/core/src/agents/provider-model-evidence.ts` and export it from
   `packages/core/src/agents/index.ts`; reuse/refactor the capability registry,
   do not duplicate it.
3. **Malcolm:** add red eligibility tests in
   `packages/core/tests/agents/provider-model-eligibility.test.ts` covering
   required capabilities, freshness, authentication vs entitlement, health,
   policy, interactive vs managed, aliases, and distinct routes.
4. **Reese:** implement the pure derivation in
   `packages/core/src/agents/provider-model-eligibility.ts` and integrate the
   existing registry in `packages/core/src/agents/model-capability-registry.ts`.

Required red-test order: identities/provenance -> state distinctions -> stale
and failure semantics -> capability authority -> interactive eligibility ->
managed eligibility -> distinct routes/aliases. Confirm each fails because the
contract/derivation is absent, not from fixture errors.

Commit: `feat(core): define provider model evidence and eligibility`

### Slice 2 — Catalog normalization and adapter evidence

Goal: replace raw string-array authority with versioned catalog observations
while preserving raw IDs/metadata and adapter-specific provenance.

Atomic assignments after contracts are fixed inline:

1. **Malcolm:** red cache/freshness tests in
   `packages/runtime/tests/gateway/provider-catalog-service.test.ts` and
   `packages/runtime/tests/gateway/provider-model-normalization.test.ts`.
2. **Reese:** implement canonical catalog service/freshness behavior in
   `packages/runtime/src/gateway/provider-catalog-service.ts` and
   `packages/runtime/src/gateway/provider-discovery-cache.ts`.
3. **Malcolm then specialist:** one adapter family per invocation, each with its
   focused test and no more than two files. Extract from
   `packages/runtime/src/gateway/gui-provider-models.ts` into
   `packages/runtime/src/gateway/provider-model-adapters/` for (a) OpenCode
   CLI/Go/Zen, (b) Codex CLI/OAuth, (c) OpenAI/Anthropic/DeepSeek, (d)
   OpenRouter, and (e) Ollama/LM Studio. Exact filenames are chosen during
   extraction, but every invocation pairs one adapter file with one test file.
4. **Reese:** make `packages/runtime/src/gateway/gui-provider-models.ts` an
   orchestration/projection consumer only; update
   `packages/runtime/src/index.ts` exports without a compatibility path.

Tests prove approximately 397 OpenCode entries remain raw inspectable evidence
but do not become eligible, raw aliases/duplicates retain provenance, same
normalized model on two providers remains two routes, stale/failed partial
catalogs remain visible and fail closed, and no fixture contains credentials.

Commit: `refactor(runtime): normalize provider model catalog evidence`

### Slice 3 — Eligibility adoption and managed-agent enforcement

Goal: make runtime switching, canonical defaults, native integrity, and managed
agents consume the same use-specific decision.

Atomic assignments:

1. **Malcolm:** red runtime admission tests in
   `packages/runtime/tests/gateway/provider-model-eligibility.test.ts` and the
   existing relevant `packages/runtime/tests/gateway/gui-gateway.test.ts`
   cases.
2. **Reese:** integrate eligibility in
   `packages/runtime/src/gateway/provider-catalog-service.ts` and
   `packages/runtime/src/gateway/gui-provider-models.ts`; remove raw-membership
   execution authority and hidden fallback.
3. **Malcolm:** red managed-agent tests in
   `packages/cli/src/config/managed-agent-provider-models.test.ts` and
   `packages/cli/tests/config/managed-agent-routes.test.ts`.
4. **Reese:** replace raw managed arrays with admitted-route decisions in
   `packages/cli/src/config/managed-agent-provider-models.ts` and
   `packages/cli/src/config/managed-agent-routes.ts`.
5. **Malcolm:** extend regressions in
   `packages/cli/tests/config/native-route-integrity.test.ts` and
   `packages/cli/tests/application/config-status.test.ts`.
6. **Reese:** consume canonical evidence without changing projection authority
   in `packages/cli/src/config/native-route-integrity.ts` and
   `packages/cli/src/application/config-status.ts`.

Tests distinguish unknown model, invalid credentials, unauthenticated,
unauthorized entitlement, stale discovery, cooling/unhealthy route, projection
drift, missing capability, and policy denial. Valid canonical defaults remain
selectable; managed and interactive decisions may differ.

Commit: `feat(routing): enforce provider model eligibility`

### Slice 4 — Gateway and operator projections

Goal: publish one canonical summary/detail contract and render eligible choices
by default without losing raw catalog diagnostics.

Atomic assignments:

1. **Malcolm:** red public-contract tests in
   `packages/gateway-contracts/tests/provider-model-discovery.test.ts` and
   `packages/gateway-contracts/tests/config-status.test.ts`.
2. **Reese:** replace the weak discovery DTO in
   `packages/gateway-contracts/src/frames.ts` and exports in
   `packages/gateway-contracts/src/index.ts`; no parallel legacy DTO.
3. **Malcolm then Reese:** doctor summary/detail behavior in
   `packages/cli/tests/application/harness-doctor.test.ts` and
   `packages/cli/src/application/harness-doctor.ts`.
4. **Malcolm then frontend specialist:** GUI schema/store consumption in
   `packages/gui/tests/ws-client.test.ts`,
   `packages/gui/src/lib/ws-client.ts`, then picker behavior in
   `packages/gui/tests/provider-picker.test.tsx`,
   `packages/gui/src/components/provider-picker.tsx`.
5. **Malcolm then frontend specialist:** TUI schema consumption in
   `packages/tui/src/ws-client.ts`, `packages/tui/tests/app-provider-picker.test.ts`,
   then bounded search/group/detail rendering in
   `packages/tui/src/app.tsx` with the same test file in a separate invocation.
6. Add contract-parity tests for React, widget, native, studio, and SDK only
   where compilation does not already prove transparent consumption; do not add
   surface-local eligibility logic.

Default output answers usable providers, eligible configured routes,
unavailability reasons, freshness, and next action. Detail output provides raw
totals/classifications/provenance with bounded search/grouping; omission counts
remain explicit and secrets remain absent.

Commit: `feat(operator): present eligible provider model routes`

### Slice 5 — Canonical documentation and closure

Goal: promote only verified semantics and residual risks after implementation
and review.

Atomic documentation assignments:

1. Update `docs/architecture/provider-model-discovery.md` and
   `docs/architecture/README.md` with vocabulary, source precedence,
   invariants, freshness/failure behavior, and package ownership.
2. Update `docs/architecture/managed-agents.md` and
   `docs/architecture/operator-surfaces.md` only for materially changed
   consumption contracts.
3. Update `docs/architecture/credential-governance.md` and
   `docs/architecture/provider-credential-pools.md` only if implementation
   changes their evidence contract; never duplicate credential ownership.
4. Append verified implementation history to `docs/changelog.md`.
5. If the architecture decision created a numbered roadmap, promote durable
   content, verify references, and close/delete it only under
   `docs/roadmap/README.md` rules in a separate closure commit. Roadmaps 03 and
   04 remain untouched.

Commit: `docs(architecture): define provider model eligibility`

## Required Acceptance Coverage

Across the slices, deterministic tests must prove every acceptance statement
in the objective brief: hundreds of discovered entries are not implicitly
eligible; raw evidence remains inspectable; unauthenticated listing cannot
execute; authentication does not prove entitlement/health; all four identities
remain distinct; aliases/duplicates retain provenance; routes are not
collapsed; capability sources/authority are explicit; missing capability and
stale evidence fail closed; canonical defaults work; unknown model diagnostics
are actionable; invalid credential/model/drift differ; managed agents receive
only admitted routes; interactive/managed requirements may differ; doctor is
concise with safe detail; GUI/TUI/CLI/Gateway share semantics; native-integrity
regressions remain covered; no test reads credentials or performs inference.

## Risk Hypotheses And Mitigations

- **Public-contract migration:** GUI/TUI/SDK consumers may silently reinterpret
  optional fields. Remove the old shape atomically and use schema/parity tests.
- **Duplicate ownership:** core registry, runtime catalog, and CLI cache may
  each remain authoritative. Define one owner per fact/decision and delete the
  superseded path rather than bridge it.
- **False negatives:** fail-closed evidence requirements can hide legitimately
  usable models. Emit precise missing-evidence reasons and operator actions;
  never loosen admission silently.
- **False positives from optimistic metadata:** tag authority/provenance and
  require sufficient authority per capability.
- **Identity collapse:** normalized family deduplication can erase provider or
  account routes. Use separate identity types and route-key tests.
- **Staleness/outage:** preserved cache can appear current. Carry observed/
  expiry times and prevent stale evidence from authorizing new execution.
- **Credential leakage:** raw adapter failures may contain secrets. Retain
  typed/redacted diagnostics only; add serialization snapshot assertions.
- **Scale:** hundreds of entries can make frames/UI/doctor unusable. Provide
  totals, bounded pages/search/grouping, and detail lookup; do not merely truncate.
- **Provider drift:** upstream schemas and aliases change. Version source
  evidence and fail partial/unknown fields closed without deleting raw data.
- **Unresearched Claude Code discovery:** do not claim parity until exact local
  or official evidence is obtained; model it as unsupported/unknown evidence.

Rollback is slice-local before release: revert the slice contract and its
consumers together. After a public contract release, stop and design an
explicit migration; do not add a backward-compatibility shim.

## Live-Probe Policy And Residual Risk

This plan authorizes no live inference, credential use, quota consumption, or
paid probe. All required tests use fixtures, stubbed transports, and redacted
recorded schemas. If Ricardo later authorizes live evidence, disclose the exact
provider/model first, bound calls to explicitly selected routes, and record
only redacted outcomes.

Residual risk without live proof: deterministic evidence proves Kiln's
classification and fail-closed behavior, not current account entitlement,
provider availability, quota, native harness behavior, or end-to-end execution
for any live route. Canonical documentation must retain that limitation; no
live-provider success may be claimed.

## Verification Gates

After every atomic assignment: confirm intended red failure, run focused green
tests, run affected package tests, run typecheck, inspect the diff, and commit
only that slice. Changed production lines require at least 80% coverage under
the package's established coverage command.

After each slice:

1. Focused tests for every changed behavior pass.
2. Every affected package's full test suite passes.
3. `bun run typecheck` passes.
4. Ida confirms provider/core/runtime/operator boundaries and no duplicate
   contract; Lois reviews correctness, security, dead/legacy paths, and tests.
5. `git diff --check` passes and the slice commit contains only its files.

Before closure, run in this order:

```bash
bun run --filter @kilnai/gateway-contracts test
bun run --filter @kilnai/core test
bun run --filter @kilnai/runtime test
bun run --filter @kilnai/cli test
bun run --filter @kilnai/react test
bun run --filter @kilnai/widget test
bun run --filter @kilnai/tui test
bun run --filter @kilnai/native test
bun run --filter @kilnai/studio test
bun run --filter @kilnai/gui test
bun run typecheck
bun run build
git diff --check
```

Then:

- **Ida:** validate DDD/Clean Architecture, provider-neutral core, adapter fact
  ownership, canonical config authority, and shared interactive/managed policy
  derivation.
- **Lois:** review findings-first for security, secret handling, public contract
  completeness, failure classification, cache freshness, dead code, missing
  tests, and 80% coverage evidence.
- **Herkabe:** adversarially attempt raw-catalog execution, stale admission,
  auth/entitlement conflation, capability spoofing, route collapse, hidden
  fallback, managed-agent bypass, huge-catalog denial of service, secret
  disclosure, and GUI/TUI semantic divergence.

Resolve every finding, rerun affected focused/package tests, then repeat the
full typecheck/build/diff gates. Closure additionally requires canonical docs,
slice-only commits, a clean worktree, and explicit publication of the no-live-
probe residual risk.
