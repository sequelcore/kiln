# 00 - Source Stability

Status: Ready
Priority: Urgent
Execution: Ready - close the existing GUI exposure and approval-replay defect,
then restore trustworthy verification before product expansion.
Created: 2026-08-23

## Objective

Establish one supported source baseline that an operator can use repeatedly
from an exact commit with explicit security boundaries, trustworthy
deterministic gates, recoverable durable state, and honest operator evidence.

This track precedes new Connect, capability, governance, inbound-agent, native,
or release work. A green declared CI run is necessary but insufficient while a
known authority defect or an excluded test-typechecking surface remains open.

## Ownership

This track owns stabilization sequencing, admission, and promotion evidence.
It does not take implementation ownership from the bounded contexts or issues
listed below:

- Roadmap 08.5 owns GUI listener and origin exposure.
- Gateway Contracts and GUI own approval replay identity and presentation.
- Package test configurations own typechecking admission.
- CLI configuration owners own project-state topology and scope.
- Runtime owns crash, recovery, replay, cancellation, and settlement truth.
- Core and Runtime own trusted-execution classification and observation.
- Issue #103 owns the supported source decision. The release runbook and issue
  #104 own later candidate admission and publication.

## Scope

- Existing listener, origin, and approval-replay correctness defects.
- Complete typechecking of the Runtime test surface.
- Private project-state ownership outside repositories without collapsing
  project scope.
- Deterministic recovery gates and separately authorized live evidence.
- Reachable and honest permission-integrity evidence.
- Operational account-usage and live Session lifecycle evidence required by
  supported operator surfaces.
- An exact supported source branch, commit, surface set, and limitation record.

## Non-Goals

- No remote pairing, transport adapter, hosted relay, or mobile application.
- No Capability Fabric, prompt, stack, inbound-agent, Rust, or native-surface
  implementation.
- No release tag, package publication, rebrand implementation, or provisional
  compatibility package.
- No requirement to close unrelated research and deferred product tracks.

## Ordered Slices

### Slice 0 - Existing Security And Correctness Defects

Status: Ready; issue #101 is complete and issue #102 is the next admissible work.

Completed [issue #101](https://github.com/sequelcore/kiln/issues/101). Complete
[issue #102](https://github.com/sequelcore/kiln/issues/102) next. Normal GUI startup
must be loopback-only with exact origin policy, and replaying one approval
resolution must never resolve another pending approval.

Exit gate: focused negative tests demonstrate both boundaries and the affected
Runtime, GUI, CLI, surfaces, typecheck, and startup-profile gates pass.

### Slice 1 - Trustworthy Test Oracle

Status: Queued behind Slice 0.

Complete [issue #85](https://github.com/sequelcore/kiln/issues/85) by making the
Runtime test configuration typecheck cleanly and joining it to the ratcheted
root gate. Reconcile and close
[issue #88](https://github.com/sequelcore/kiln/issues/88) only when its fixed
repository-path cases and the deliberate live-test execution signal are
recorded accurately.

Exit gate: no supported package test surface is omitted because its current
tests do not compile, and live tests remain typechecked even when ordinary CI
correctly excludes credential-bearing execution.

### Slice 2 - Final Project-State Ownership

Status: Queued behind Slice 1.

Complete the bounded cutover in
[issue #100](https://github.com/sequelcore/kiln/issues/100). Keep global
operator config and private project config distinct, move mutable project state
out of the repository, and delete the old readers and writers in the same
change.

Exit gate: two synthetic repositories retain distinct private configuration,
authority cannot be broadened from project scope, no production source uses a
repository `.kiln/` state root, and standalone harness projections still work.

### Slice 3 - Recovery And Live Validation

Status: Queued behind Slice 2. The portable matrix may be specified earlier,
but storage-bound fixtures target only the final project-state owner.

Complete [issue #97](https://github.com/sequelcore/kiln/issues/97): deterministic
crash, restart, replay, cancellation, settlement, stale-evidence, and corrupt-
evidence cases run without credentials; separately authorized live entrypoints
record executed, failed, skipped, and omitted cases.

Exit gate: post-fence uncertainty never silently redispatches or releases
capacity, duplicate ingress cannot duplicate a consequential effect, and
restart preserves attributable terminal or recovery evidence.

### Slice 4 - Trusted Runtime Evidence

Status: Blocked on the independent audit and operator ratification required by
[issue #52](https://github.com/sequelcore/kiln/issues/52). Audit work may begin
before Slice 3; new durable authorization must use the final state owner.

Produce effective-runtime permission observation and make the admitted
integrity states reachable without weakening fail-closed behavior. Durable
full-access authorization remains per harness, explicit, revocable, and
operator-ratified.

Exit gate: `kiln doctor` has no permanently unresolvable permission action on a
clean supported machine, and CLI, TUI, GUI, and doctor project the same
integrity result.

### Slice 5 - Supported Operator Surface Consistency

Status: Queued behind the stability-critical slices.

Close [issue #81](https://github.com/sequelcore/kiln/issues/81), then the
remaining shared projection boundary in
[issue #63](https://github.com/sequelcore/kiln/issues/63), followed by its live
lifecycle extension in
[issue #70](https://github.com/sequelcore/kiln/issues/70), to the degree required
by the explicitly supported source surfaces.

Exit gate: supported surfaces consume canonical sanitized account-usage and
Session lifecycle evidence without deriving authority or freshness locally.

### Slice 6 - Source Support And Release Handoff

Status: Blocked on prior promotion gates.

Use [issue #103](https://github.com/sequelcore/kiln/issues/103) to name the
exact supported source branch and commit, supported surfaces, and limitations.
Hand any installable candidate to
[issue #104](https://github.com/sequelcore/kiln/issues/104), which remains
separately blocked on the public-name, package-coordinate, live-evidence,
clean-install, and registry gates in the release runbook.

Exit gate: a clean synthetic checkout can follow the documented source path on
every admitted platform, and no package or tag is described as available
without registry evidence.

## Dependency Rules

- Slice 0 precedes all other implementation because it removes existing
  exposure and incorrect authority projection.
- Slice 1 precedes broad state or recovery work because tests that do not
  typecheck are not a trustworthy change oracle.
- Issue #97 may define its portable scenario matrix before Slice 2, but its
  storage-bound implementation must consume the final owner from issue #100.
- Issue #52 audit may run early; any durable authorization writes after issue
  #100 and still requires explicit operator ratification.
- Independently useful work does not become the default task unless this file
  records a priority change.

## Promotion Gates

- Normal GUI startup is explicitly loopback-only and has no wildcard CORS.
- Approval replay preserves canonical identity and fails closed when identity
  is missing or malformed.
- Runtime tests compile under the canonical test-typechecking gate.
- Project-private and mutable state have one final owner outside repositories.
- Recovery and replay safety properties have deterministic evidence.
- Live tests have explicit authority, entrypoints, reporting, and omissions.
- Permission-integrity status is reachable from observed Runtime evidence.
- Supported surfaces consume shared account-usage and Session lifecycle truth.
- One exact source branch, commit, platform set, and limitation record are
  named before source support is claimed.

## Verification

Focused issue-owned tests first, then affected package tests, root typecheck,
root tests, build, documentation validation, startup profile, `git diff
--check`, and the authorized live matrix required by each boundary. Synthetic
fixtures must be portable and contain no operator path, credential, account
identity, raw provider payload, or incident body.

## Completion Criteria

An operator can adopt an exact Kiln source commit on every admitted platform,
start only the named supported surfaces, execute and recover bounded work, and
trust the projected approval, permission, account-usage, lifecycle, and
terminal evidence. The repository names remaining limitations explicitly and
does not claim an installable release. Completion unblocks reassessment of
Roadmap 08 and the separately governed release candidate.
