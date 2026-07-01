# 09 - Native Harness Route Integrity

Status: Deferred correctness program

## Objective

Ensure every native harness starts on the provider and model selected by
canonical Kiln configuration, and reports credential, catalog, projection, and
route failures accurately.

The operator must never receive `Invalid API key` when the credential is valid
and the actual failure is an obsolete ambient model fallback.

## Goals

- Make canonical Kiln routing and projected native defaults agree.
- Classify credential, catalog, projection, and route failures by their actual
  failing layer.
- Prove bare native invocation behavior without relying on explicit per-command
  overrides.
- Remove obsolete aliases, duplicate writers, and temporary overrides.

## Sequel Standards

- No manual native file patch as durable configuration.
- No legacy model alias shim.
- No diagnostic that prints or persists secret material.
- No completion claim without failing regression tests, idempotent sync tests,
  typecheck, and live probe evidence where credentials are intentionally
  available.

## Trigger

On 2026-06-30, bare `opencode run` selected
`deepseek-v4-flash-free` and failed with `Invalid API key`. The canonical Kiln
configuration selected `opencode-go` and advertised current models including
`deepseek-v4-flash`. An explicit invocation of
`opencode-go/deepseek-v4-flash` returned `OK`, proving the credential was valid.

The generated OpenCode configuration had no top-level default model. OpenCode
therefore used an ambient fallback outside Kiln's resolved route. The incident
exposed four distinct concerns that must not remain conflated:

- canonical provider/model resolution;
- native harness default projection;
- provider catalog freshness;
- credential and route error classification.

## Scope

- Canonical default provider/model projection for supported native harnesses.
- One governed owner for each generated native configuration file.
- Drift detection for projected defaults, permissions, MCP, hooks, and agents.
- Provider catalog validation before projection and invocation.
- Credential probes that do not depend on an ambient default route.
- Error classification that distinguishes authentication, authorization,
  unknown model, unavailable route, stale catalog, and projection drift.
- Bare-invocation live proofs for Claude Code, Codex, and OpenCode where the
  harness supports a configurable default.
- Setup, status, doctor, and sync evidence using the same shared contracts.

## Non-Goals

- Patch generated native files manually as durable configuration.
- Preserve obsolete model aliases through compatibility mappings.
- Treat a successful explicit `--model` invocation as proof that native
  defaults are correct.
- Store provider secrets in Kiln projection state or diagnostics.
- Make native harness configuration the canonical source of routing policy.
- Force identical configuration shapes onto harnesses with different native
  capabilities.

## Decisions

### D1. Kiln configuration is canonical

Native defaults are projections of resolved Kiln routing. Native harness files
do not override canonical provider/model selection unless an explicit import
proposal is approved and applied.

### D2. Each native file has one projection owner

Permissions, defaults, MCP, hooks, and agent references may share one native
file. Kiln must compose them through one document owner before writing. Two
independent projectors must not race, overwrite, or maintain separate drift
snapshots for the same file.

### D3. Model identifiers are validated, not translated speculatively

Projection uses a provider-advertised native model identifier. Removed aliases
fail before write with an actionable diagnostic. Kiln does not keep legacy
model-name shims.

### D4. Credential probes use an explicit validated route

A probe must identify its provider and model. Ambient harness defaults cannot
decide which credential a diagnostic tests.

### D5. Errors preserve the failing layer

Authentication errors describe rejected credentials. Unknown or unavailable
models describe route/catalog failures. Missing or drifted native defaults
describe projection failures. Generic provider text must not erase Kiln's
observed layer and evidence.

## Hard Invariants

- Generated native defaults match the resolved canonical Kiln route.
- Projection never writes a model absent from the current provider catalog.
- Projection state records every managed field written to a native file.
- Unmanaged native fields survive sync unchanged.
- Drift blocks only the affected target unless force overwrite is explicitly
  approved.
- Diagnostics never print, hash into user-visible output, or persist secrets.
- Disabled engines are not selected as defaults or fallbacks.
- Explicit probes and bare-invocation proofs agree on provider and model.
- Removing obsolete behavior deletes its projection and tests; no shadow
  fallback remains.

## Delivery Slices

### Slice 0 - Reproduction Matrix

Goal: capture current behavior before changing projections.

- Reproduce bare and explicit invocation for each supported harness.
- Record canonical route, native configured default, selected runtime route,
  catalog status, credential source class, and observed error.
- Add fixtures for valid credential plus stale model, invalid credential plus
  valid model, disabled provider, missing default, and managed-field drift.

Exit gate: every failure is reproducible without exposing a secret.

### Slice 1 - Native Configuration Ownership

Goal: establish one composed writer per native configuration file.

- Map all current writers for Claude, Codex, and OpenCode native files.
- Define provider-neutral desired native configuration documents.
- Compose permissions, default route, MCP, hooks, and supported settings before
  one atomic write.
- Preserve backups, install-state snapshots, and per-field drift evidence.

Exit gate: no supported native file has competing writers or partial snapshots.

### Slice 2 - Canonical Default Projection

Goal: project validated default routes into native harness configuration.

- Resolve the canonical default provider and model from global Kiln config.
- Validate engine enablement and provider catalog membership.
- Translate only the native syntax required by the target harness.
- Preserve unrelated unmanaged fields.
- Remove stale managed defaults when canonical routing no longer targets that
  harness.

Exit gate: fresh sync and repeated idempotent sync produce the expected native
default and stable projection state.

### Slice 3 - Diagnostic Classification

Goal: make setup and runtime failures name the actual failing layer.

- Normalize credential rejection separately from route and catalog errors.
- Detect ambient fallback selection when it differs from canonical routing.
- Report stale projection and stale catalog evidence.
- Include remediation that points to canonical config and governed sync.
- Reuse one diagnostic contract in setup, status, doctor, and invocation.

Exit gate: fixture errors classify deterministically and never mislabel a
route failure as an invalid credential.

### Slice 4 - Credential-Safe Route Probes

Goal: verify each enabled route without relying on native defaults.

- Probe with explicit provider and validated model.
- Record credential source type without secret material.
- Bound timeout, retries, output, and provider spend.
- Distinguish transient availability from persistent credential rejection.

Exit gate: the OpenCode Go incident reports credential-valid and
native-default-invalid before any worker invocation.

### Slice 5 - Bare-Invocation Proof

Goal: prove native standalone behavior matches Kiln after sync.

- Run the smallest non-destructive bare invocation supported by each harness.
- Capture selected provider/model from native evidence.
- Compare it with canonical resolution and explicit probe results.
- Mark unsupported proof capabilities honestly rather than assuming parity.

Exit gate: supported harnesses select the canonical route without explicit
per-command model flags.

### Slice 6 - Cross-Surface Projection

Goal: expose one route-integrity status across operator surfaces.

- Project canonical, native, selected, and probed routes as separate fields.
- Show drift and remediation in CLI, GUI, TUI, and resource surfaces.
- Keep surfaces read-only unless they use config proposal, approval, and apply.

Exit gate: surfaces agree on route identity and failure classification.

## Research Basis

The starting evidence is the 2026-06-30 OpenCode Go incident: an explicit
validated route succeeded while bare OpenCode execution selected an obsolete
ambient fallback and misreported the result as `Invalid API key`. Additional
research must inspect current native harness default-model configuration,
provider catalogs, credential probes, and projection ownership before
implementation.

## Required Tests

- Unit tests for canonical-to-native default translation.
- Integration tests preserving unmanaged fields and projection snapshots.
- Drift, force, disabled-engine, and removed-model tests.
- Credential-versus-model error-classification tests.
- Idempotent sync and uninstall cleanup tests.
- Setup/status/doctor contract tests.
- Live smoke tests for explicit and bare invocation, isolated from normal unit
  suites and skipped unless credentials are intentionally available.

## Verification

- Failing regression test reproduces the invalid-key misclassification.
- Targeted projection, drift, catalog, and diagnostic tests pass.
- Repository typecheck passes.
- Live explicit and bare probes agree for repaired harnesses when credentials
  are intentionally available.

## Promotion Gates

1. Surface map and competing-writer audit are complete.
2. A failing regression test reproduces the OpenCode incident.
3. Projection contracts and ownership are reviewed before implementation.
4. Targeted tests and repository typecheck pass.
5. Sync is idempotent and unmanaged fields are preserved.
6. Live explicit and bare probes agree for the repaired harness.
7. Diagnostics contain no credential material.
8. Reviewer confirms no legacy model alias or parallel writer remains.
9. Residual provider-specific limitations are documented.

## Rollback

Rollback restores the previous managed-field snapshot and canonical routing
policy. It must not restore an obsolete model alias or leave a second native
writer active. Diagnostic evidence remains available after rollback.

## Relationship To Roadmap 08

Roadmap `08-verified-efficiency-control-plane.md` depends on truthful route,
model, cache, and credential evidence. This roadmap owns native route integrity
and error classification. Roadmap `08` may continue through native Codex routes
while this track is deferred, but it must use explicit validated provider/model
identity and must not treat the failing ambient OpenCode default as a valid
benchmark route.

## Completion Criteria

This roadmap is complete when canonical routing, generated native defaults,
provider catalogs, explicit probes, and bare harness execution agree for every
supported capability; when failures identify the correct layer; and when old
aliases, duplicate writers, temporary overrides, and compatibility paths have
been removed.
