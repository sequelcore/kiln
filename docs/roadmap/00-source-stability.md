# 00 - Source Stability

Status: Blocked
Priority: Urgent
Execution: Slices 0, 1, 3, 4, and 5 are complete, and the Slice 6 clean source
candidate passes every declared credential-free promotion gate on Windows x64.
The only remaining adoption condition is Slice 2 / issue #100's physical
deletion of one exact inactive operator quarantine. The execution harness blocks
that recursive delete before PowerShell starts, so issue #103 cannot record the
final exact supported commit until the operator removes it.
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
- Complete typechecking of the Runtime and GUI test surfaces.
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

Status: Complete; issue #101 is complete and issue #102 reached code/integration-complete state.

[Issue #101](https://github.com/sequelcore/kiln/issues/101) is complete. On
2026-08-23, the exact clean candidate for
[issue #102](https://github.com/sequelcore/kiln/issues/102) passed the full root
suite, build, typecheck, startup profile, documentation check, and diff check.
Normal GUI startup must be loopback-only with exact origin policy, and replaying
one approval resolution must never resolve another pending approval.

Exit gate: focused negative tests demonstrate both boundaries and the affected
Runtime, GUI, CLI, surfaces, typecheck, and startup-profile gates pass.

### Slice 1 - Trustworthy Test Oracle

Status: Complete; Slice 1 / issue #106 implementation evidence was completed on
2026-08-23. Runtime admission and repository-path hermeticity are complete.

[Issue #85](https://github.com/sequelcore/kiln/issues/85) admitted Runtime test
sources to the ratcheted root typechecking gate, and
[issue #88](https://github.com/sequelcore/kiln/issues/88) closed the owned
repository-path defects while assigning live execution policy to issue #97.
The GUI test typecheck project now reports zero errors and is wired into the
root `typecheck:tests` gate without an issue-specific exclusion, baseline, or
escape hatch. The GUI suite reports 546 tests and the surfaces suites report
731 tests. The full root tests, build, typecheck, startup profile, documentation
check, and diff check pass. Representative mutation evidence is recorded in
[issue #106](https://github.com/sequelcore/kiln/issues/106), alongside the
focused repair evidence. This records Slice 1 repository evidence; it does not
claim issue closure, a commit, a supported source, or a release.

Exit gate: no supported package test surface is omitted because its current
tests do not compile, and live tests remain typechecked even when ordinary CI
correctly excludes credential-bearing execution.

### Slice 2 - Final Project-State Ownership

Status: Implementation complete; operator cleanup pending. Slice 2 / issue #100
passed its code, review, and deterministic gates on 2026-08-23, but its
operator-owned lifecycle is not closed until the inactive legacy discard
quarantine is physically deleted.

Complete the bounded cutover in
[issue #100](https://github.com/sequelcore/kiln/issues/100). Keep global
operator config and private project config distinct, move mutable project state
out of the repository, and delete the old readers and writers in the same
change.

Exit gate: two synthetic repositories retain distinct private configuration,
authority cannot be broadened from project scope, no production source uses a
repository `.kiln/` state root, and standalone harness projections still work.

The completed cutover establishes one canonical `ProjectStateBinding`, keeps
global configuration distinct from project attenuation, stores project state
under the operator Kiln home, and deletes the repository-state readers and
writers without a compatibility or migration path. The operator chose to
discard the unused 106,496-byte legacy Memory Lattice database; it was removed
from active ownership through a quiescent operator move, not product migration
code. The discarded database and associated obsolete state remain only in an
inactive operator quarantine until the final physical deletion; no product
reader, writer, fallback, or compatibility path uses them. Effect-time
containment tests cover private-state reads, writes, deletes,
worktrees, App Gateway state, and the retained repository instruction shims,
including Windows junction and symlink swaps. The full supported test surfaces,
root typecheck, build, startup profile, documentation check, generated schema
check, managed-agent harness, and diff check pass. Independent Sol-high review
reported no HIGH or MEDIUM findings. This records implementation evidence; the
remaining operator deletion is the final adoption condition.

### Slice 3 - Recovery And Live Validation

Status: Complete. Portable deterministic evidence and an operator-authorized
Codex live run both passed on an intended clean candidate. Live entrypoints
remain separately authorized from portable deterministic fixtures.

Complete [issue #97](https://github.com/sequelcore/kiln/issues/97): deterministic
crash, restart, replay, cancellation, settlement, stale-evidence, and corrupt-
evidence cases run without credentials; separately authorized live entrypoints
record executed, failed, skipped, and omitted cases.

Exit gate: post-fence uncertainty never silently redispatches or releases
capacity, duplicate ingress cannot duplicate a consequential effect, and
restart preserves attributable terminal or recovery evidence.

The canonical manifest now owns 12 portable recovery cases, 13 exact
deterministic locators, 12 implemented live proofs, and three planned live
omissions. The root test gate runs every deterministic locator without
credentials and rejects missing, duplicate, failed, or skipped evidence.
Credential-free evidence covers committed-revision retention, pre- and
post-fence crash behavior, duplicate ingress, disconnect uncertainty, child
cleanup, cancellation settlement, startup recovery, stale/conflicting/corrupt
checkpoints, and retained capacity under unknown settlement.

Production startup recovers managed invocation checkpoints before exposing the
execution owner, only on cold start, and unwinds staged owners on failure. The
live runner requires explicit master and provider authority plus exact model or
route configuration; discovery never authorizes execution. It records a
sanitized candidate and executor provenance in one atomically replaced private
report, bounds output and process-tree settlement, fails closed on unauthorized
or uncataloged assertions, and never claims release readiness.

The authorized clean-candidate run executed and passed three representative
Codex cases: fixture-isolated write, read-boundary enforcement, and approved
write. Nine implementation variants were omitted because their provider routes
were not authorized, and transport disconnect, credential expiry, and capacity
exhaustion remain three explicit planned omissions. The private report records
the candidate, executor provenance, executed/failed/skipped/omitted counts, and
cleanup truth without persisting credentials or operator paths in the
repository. These omissions prohibit full-matrix and release-readiness claims;
they do not invalidate the required representative live recovery evidence.

### Slice 4 - Trusted Runtime Evidence

Status: Complete for the supported Codex boundary under
[issue #52](https://github.com/sequelcore/kiln/issues/52). Operator policy,
passive lease evidence, the legacy durable-authority cutoff, attended
issuance/enforcement, and genuine runtime attestation are implemented.

The audit rejected route-derived authority as effective-runtime proof and
found that full-access consent currently overstates applied enforcement. The
shared CLI observer that echoed requested authority as `proof: proven` has
been removed. Credential-free tests now prove that unattended or background
direct-provider, CLI-harness, and remote-harness work cannot reach the adapter
without genuine runtime observation; attended foreground work remains
available with projection-only evidence.

Trusted execution now uses a process-local, session-owned lease for one exact
invocation tree. It ends at the earliest of completion, session close,
revocation, composition revision change, or a one-hour cap; it never
auto-renews or implicitly transfers to a child. `authorizedBy` is display
attribution only. Legacy private grant files are retained as inactive history,
and native projection snapshots cannot carry executable authorization.

The first issuance path is implemented only for interactive CLI `run` and
foreground `managed_agent.invoke` work on the Runtime-controlled Codex OAuth
direct-provider route. A dedicated structured prompt binds the process-local
principal, operator session, project, composition revision, route, invocation
tree, profile, tools, effect ceiling, policy digest, enforcement revision, and
expiry. Runtime validates that binding before authority observation or resource
acquisition, then checks every resolved child tool effect before cache lookup or
execution. Consequential effects are checked again after asynchronous admission
readback and before the durable action claim; retries recheck before every
attempt. Observed expiry latches terminal so clock rollback cannot reactivate a
lease. The lease is completed when the foreground invocation settles.

Generic tool approval cannot mint this lease. GUI, TUI, background, nested,
economic-routed, non-Codex direct-provider, and native CLI-harness paths remain
fail-closed until they gain an equivalent operator-owned issuance and
enforcement boundary.

Codex attestation starts an ephemeral, content-free `thread/start` against the
exact admitted app-server version and binds the observed executable digest,
process id, protocol, version, hashed thread identity, and component-scoped
approval/filesystem/network proof into one short-lived receipt. Aggregate or
forged proof is rejected. `kiln config verify-runtime codex` refreshes that
receipt; CLI, GUI, TUI, and doctor consume the same integrity projection. A
clean supported configuration can reach `current-verified`. Native permission
semantics that cannot be represented exactly remain
`unsupported-semantic-translation` rather than being overstated as proven.

The supported proof is exact for Codex app-server `0.149.1`. Claude Code and
OpenCode do not yet supply equivalent genuine runtime attestation. Lease
possession remains authorization evidence only and never counts as runtime
attestation.

Exit gate: `kiln doctor` has no permanently unresolvable permission action on a
clean supported machine, and CLI, TUI, GUI, and doctor project the same
integrity result.

### Slice 5 - Supported Operator Surface Consistency

Status: Complete for the supported CLI, TUI, and GUI source surfaces.

Close [issue #81](https://github.com/sequelcore/kiln/issues/81), then the
remaining shared projection boundary in
[issue #63](https://github.com/sequelcore/kiln/issues/63), followed by its live
lifecycle extension in
[issue #70](https://github.com/sequelcore/kiln/issues/70), to the degree required
by the explicitly supported source surfaces.

Exit gate: supported surfaces consume canonical sanitized account-usage and
Session lifecycle evidence without deriving authority or freshness locally.

MCP account usage now refreshes the Codex provider owner, retains expired
evidence as explicitly stale instead of collapsing it to missing, and reports
distinct provider failure and credential-unavailable actions. Gateway Contracts
owns the canonical event ordering, deduplication, approval identity, tool/file,
route, usage, goal/work-item, terminal, and presentation reduction consumed by
GUI replay/live state and TUI projection. Runtime owns the process-local
`idle`/`running` lifecycle revision and freshness window; stale observations
become `unknown` rather than being derived by a surface.

### Slice 6 - Source Support And Release Handoff

Status: Verified candidate; blocked only on Slice 2's operator quarantine
deletion before the exact supported commit is recorded in issue #103.

Use [issue #103](https://github.com/sequelcore/kiln/issues/103) to name the
exact supported source branch and commit, supported surfaces, and limitations.
Hand any installable candidate to
[issue #104](https://github.com/sequelcore/kiln/issues/104), which remains
separately blocked on the public-name, package-coordinate, live-evidence,
clean-install, and registry gates in the release runbook.

Exit gate: a clean synthetic checkout can follow the documented source path on
every admitted platform, and no package or tag is described as available
without registry evidence.

The candidate source decision admits branch `dev` on Windows 11 x64 with Git
and Bun `1.4.0`. The named local operator surfaces are CLI, TUI, and GUI; normal
GUI startup remains loopback-only. A clean detached checkout passed frozen
dependency installation, root help, full typecheck, the canonical root test
chain, build, documentation validation, startup-profile tests, and a real GUI
startup profile. The root chain reported 385 script tests, 4,152 foundation
tests, 3,339 Runtime tests with five intentional skips, 2,617 CLI tests with one
intentional skip, and 761 surface tests.

Provider credentials are not part of the source setup contract. The supported
runtime-integrity proof is the exact Codex boundary described in Slice 4;
Claude/OpenCode attestation, unattended/background/nested trusted execution,
remote GUI exposure, non-Windows platforms, installable packages, tags,
provisional `@kilnai/*` coordinates, and full live-matrix coverage are excluded.
Issue #104 retains the separate installable-candidate contract.

## Dependency Rules

- Slice 0 precedes all other implementation because it removes existing
  exposure and incorrect authority projection.
- Slice 1 precedes broad state or recovery work because tests that do not
  typecheck are not a trustworthy change oracle.
- Issue #97 may define its portable scenario matrix before Slice 2, but its
  storage-bound implementation must consume the final owner from issue #100.
- Issue #52 keeps active trusted-execution authority process-local. Existing
  private grant bytes may be retained as inactive history but cannot authorize
  execution or status.
- Independently useful work does not become the default task unless this file
  records a priority change.

## Promotion Gates

- Normal GUI startup is explicitly loopback-only and has no wildcard CORS.
- Approval replay preserves canonical identity and fails closed when identity
  is missing or malformed.
- Runtime and GUI tests compile under the canonical test-typechecking gate.
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
