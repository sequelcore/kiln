# 05 - Provider Model Eligibility Plane

Status: Active; Slice 2 closed

Created: 2026-07-01

Canonical owner: `docs/architecture/provider-model-discovery.md`

Authoritative implementation plan: `docs/plan.md`

## Objective

Implement one provider-neutral architecture for provider/model discovery,
normalization, evidence, use-specific eligibility, managed-agent admission, and
operator presentation. Catalog observations remain inspectable evidence; only
canonical, deterministic eligibility decisions may authorize a distinct
provider/model route for a stated use.

## Goals

- Keep advertised, discovered, configured, authenticated, entitled,
  capability-compatible, policy-admitted, route-healthy, probe-verified, and
  selectable states explicit and distinct.
- Preserve harness, provider, normalized-model, and execution-route identities,
  including raw identifiers, aliases, duplicates, metadata, and provenance.
- Derive interactive and managed-agent eligibility from shared core semantics,
  with use-specific requirements and fail-closed missing evidence.
- Make runtime adapters own provider-specific facts while core owns neutral
  evidence and admission semantics.
- Make Gateway, SDK, CLI, GUI, TUI, React, widget, native, and studio consume
  canonical projections without independently deriving eligibility.
- Promote verified durable behavior to the canonical owner, then delete this
  roadmap under the roadmap lifecycle rules.

## Scope

- Provider-neutral evidence, identity, freshness, failure, capability-authority,
  policy-admission, and eligibility contracts in core.
- Runtime catalog normalization, cache/freshness behavior, and provider/harness
  adapter evidence.
- Canonical eligibility adoption by runtime switching, configured defaults,
  native-integrity reporting, and managed-agent route admission.
- Replacement of the weak public discovery projection and adoption by every
  operator surface.
- Deterministic tests, coverage, typecheck, build, architecture review, code
  review, adversarial review, and canonical documentation promotion.

## Non-Goals

- Roadmap 03 remains unchanged. Native projection remains evidence and drift
  input; it does not become canonical policy authority.
- Roadmap 04 remains unchanged. Recommendation, ranking, and efficiency policy
  among already-admitted routes remain outside this program.
- No OpenCode-specific filtering may enter shared domain semantics.
- No raw catalog entry or catalog membership may grant execution authority.
- No compatibility DTO, duplicate semantic owner, legacy execution path, or
  unsupported migration shim may survive the owning slice.
- No live provider inference, credential use, quota consumption, paid probe, or
  catalog-wide probe is authorized. Any future probe requires explicit,
  route-specific operator authorization.
- No static allowlist, hidden provider/model fallback, credential-bearing
  fixture, or recommendation policy is introduced.

## Research Basis

`docs/plan.md` contains the completed repository scouting, primary-source
research, ownership map, risk hypotheses, proposed domain contracts,
acceptance coverage, and verification gates. In particular, pinned OpenCode
repository evidence shows that its approximately 397 displayed identifiers are
provider-service catalog evidence, not proof of Kiln authentication,
entitlement, health, capability compatibility, policy admission, or
selectability. Provider documentation likewise supports preserving native
identifiers and route provenance while separating discovery from execution
authority.

Do not repeat broad research unless implementation exposes missing or
contradictory evidence. Claude Code's exact machine-readable discovery contract
remains unknown and must fail closed until adapter evidence supports it.

## Architecture Decision

Classification B, an architecture program, is approved by Ricardo and received
Piama's final architecture validation on 2026-07-01 with no blocking
contradiction. The approved ownership and migration decisions are:

- `docs/architecture/provider-model-discovery.md` is the single canonical
  architecture owner.
- Core owns provider-neutral evidence and pure, use-specific eligibility.
- Runtime adapters own provider- and harness-specific discovery facts,
  normalization inputs, authentication/entitlement observations, and redacted
  diagnostics.
- Operator surfaces render canonical projections; they do not infer admission.
- Managed agents consume admitted routes, never raw model arrays.
- Normalized model identity is never an execution address and never collapses
  distinct routes.
- Missing required evidence, stale authorization evidence, and insufficiently
  authoritative capability claims fail closed.
- Roadmaps 03 and 04 remain unchanged.

## Decisions And Invariants

1. Authentication does not imply entitlement, health, capability, or policy
   admission; discovery implies none of them.
2. Evidence records carry provenance, authority, freshness, source identity,
   observation time, and redacted failure classification where applicable.
3. Canonical Kiln configuration and policy outrank native projections.
4. Interactive and managed-agent admission use the same derivation but may
   require different capabilities, authority, and policy evidence.
5. Stale, partial, failed, and unavailable observations remain diagnostic but
   cannot authorize newly configured execution.
6. Unknown model, invalid credential, missing authentication, entitlement
   denial, stale catalog, unhealthy route, projection drift, missing
   capability, and policy denial remain distinct.
7. Provider-specific names and optimistic provider defaults do not leak into
   shared core authority.
8. Operator detail may search, group, and bound large catalogs, but totals and
   omission counts remain explicit.

## Delivery Slices

| Slice | Status | Deliverable | Commit |
| --- | --- | --- | --- |
| 1. Semantics and evidence contracts | Closed | Provider-neutral identities, evidence vocabulary, provenance/authority/freshness, failure semantics, and pure interactive/managed eligibility. | `feat(core): define provider model evidence and eligibility` |
| 2. Catalog normalization and adapter evidence | Closed | Versioned catalog observations and split runtime adapters preserving raw IDs, aliases, duplicates, route identity, and classified stale/partial/failed evidence. | `refactor(runtime): normalize provider model catalog evidence` |
| 3. Eligibility adoption and managed-agent enforcement | Not started | Canonical admission for switching/defaults/native integrity and managed agents receiving admitted routes only. | `feat(routing): enforce provider model eligibility` |
| 4. Gateway and operator projections | Not started | One public summary/detail contract and shared eligible-by-default behavior across Gateway, SDK, CLI, GUI, TUI, React, widget, native, and studio. | `feat(operator): present eligible provider model routes` |
| 5. Canonical documentation and closure | Not started | Verified architecture, ownership, operator/managed-agent behavior, changelog, residual risk, and roadmap closeout preparation. | `docs(architecture): define provider model eligibility` |

Update this table immediately when a slice starts or closes. Execute slices in
order, one worker at a time. Each behavioral assignment begins with Malcolm's
intentional failing test, followed by one atomic Reese or specialist
implementation assignment.

## Promotion Gates

Each atomic assignment must show the intended red test, focused green tests,
the affected package suite, `bun run typecheck`, `git diff --check`, diff
inspection, and related-file-only staging. Each completed slice additionally
requires at least 80% coverage of changed production lines, Ida boundary
validation, and Lois findings-first review with every finding resolved before
the slice commit.

Slice 4 UI work additionally requires a running application and browser
inspection at desktop and mobile-relevant dimensions, with no overlapping,
truncated, or misleading text. Surface tests must prove that no visible catalog
implies every discovered model is usable.

Before roadmap closeout, Ida performs final DDD/Clean Architecture validation,
Lois performs final code review, and Herkabe adversarially tests raw-catalog
admission, stale evidence, authentication/entitlement conflation, capability
spoofing, route collapse, hidden fallback, managed-agent bypass, large-catalog
resource pressure, secret leakage, and cross-surface divergence. Resolve all
findings and rerun affected gates.

## Verification

Run the following in order before closure:

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

Deterministic acceptance coverage must prove every condition in
`docs/plan.md`, including that hundreds of discovered models do not become
eligible; raw evidence remains inspectable; unauthenticated listings cannot
authorize execution; authentication does not prove entitlement or health;
identities and aliases preserve provenance; stale or missing evidence fails
closed; valid canonical defaults work; failures remain classified; managed
agents receive only admitted routes; all public/operator surfaces share the
same semantics; and no test reads credentials or performs inference.

## Residual Risks

- Without an explicitly authorized live probe, deterministic verification
  proves Kiln's classification and admission behavior only. It does not prove
  current provider entitlement, quota, availability, native harness behavior,
  or end-to-end live execution.
- Upstream provider and harness schemas, aliases, and catalogs may drift;
  adapters must version evidence and retain unknown raw data while failing
  authority closed.
- Fail-closed requirements may hide a genuinely usable route; precise reasons
  and remediation must expose the missing evidence without silently weakening
  admission.
- Large catalogs can pressure frames and surfaces; bounded detail must preserve
  totals, omission counts, grouping, and targeted lookup.
- Claude Code discovery remains unsupported/unknown until authoritative local
  or official evidence defines its adapter contract.
- The canonical owner's legacy live-probe and recommendation language near
  `docs/architecture/provider-model-discovery.md:102` and
  `docs/architecture/provider-model-discovery.md:185` must be reframed during
  Slice 5 so admission, probes, and Roadmap 04 recommendation ownership cannot
  be confused.

## Completion Criteria

- All five slices are closed in dependency order and committed independently
  with the approved commit subjects.
- Discovered, normalized, eligible, probe-verified, and selectable states are
  explicit, provider-neutral, and use-specific.
- OpenCode's large catalog remains inspectable without producing misleading or
  implicitly executable choices.
- Runtime, managed agents, Gateway, SDK, CLI, GUI, TUI, React, widget, native,
  and studio consume canonical decisions with no duplicate derivation.
- No compatibility DTO, dead path, hidden fallback, duplicate owner, or secret
  material remains.
- Tests, changed-line coverage, package suites, typecheck, build, diff check,
  UI inspection, Ida, Lois, and Herkabe gates all pass with no open findings.
- Durable decisions and the explicit no-live-probe residual risk are promoted
  to canonical architecture and the changelog, with no stale links.
- After canonical promotion and implementation commits, this roadmap is
  deleted and `docs/roadmap/README.md` updated in the separate commit
  `docs(roadmap): close provider model eligibility plane`.
- `docs/plan.md` remains unless repository doctrine later assigns plans an
  explicit cleanup lifecycle, and the final worktree is clean.
