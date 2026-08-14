# 07 - Stack Governance Plane

Status: Research track
Execution: Research - define read-only policy and drift evidence before mutation.
Created: 2026-07-22

## Objective

Make project technology baselines executable Kiln configuration with one typed
desired-state policy, deterministic drift evidence, and shared operator/agent
surfaces, instead of duplicating framework and package versions across skills,
instruction profiles, and generated harness markdown.

## Goals

- Define named organization, user, and project stack profiles for surfaces
  such as React applications and static-first Astro sites.
- Resolve required, conditional, forbidden, and exception-bound dependencies
  through one typed contract.
- Compare the resolved profile with package manifests, lockfiles, runtime
  constraints, and project evidence without replacing the package manager.
- Expose the same result through core APIs, CLI/CI, operator surfaces, and
  model-callable tools.
- Let skills consume resolved stack facts without becoming version authority.
- Make migrations explicit, reviewable, reversible, and evidence-gated.

## Ownership

Package manifests and lockfiles own installed state. This track owns desired
constraints, inheritance, exceptions, comparison, and migration evidence. Skills
consume resolved facts but never own versions.

## Scope

- Organization, user, and project stack profiles, inheritance, precedence, and
  reviewed-at metadata.
- Project adoption and explicit exception records.
- Required, conditional, forbidden, and exception-bound dependencies.
- Manifest, workspace, lockfile, runtime, peer, and plugin inspection.
- Structured drift and migration-plan evidence.
- Read-only resolve/check/diff/plan operations.
- CLI/CI, operator, managed-invocation, and tool projection.
- Explicit package-manager-backed apply only after read-only proof.
- Skill-context projection of resolved facts without duplicated version prose.

## Non-Goals

- No package-manager replacement or automatic major upgrade; do not replace
  Bun, npm, pnpm, lockfiles, or framework migration tools.
- No `latest` as standing mutation authority.
- No version authority in skills or generated harness markdown, and no
  requirement that every Sequel project use the same surface/framework.
- No compatibility dependency without a consumer and removal condition.
- No dependency migration mixed with unrelated refactors.

## Contract Direction

The intended authority chain is:

```text
typed Kiln stack profile
  -> resolved project stack evidence
  -> CLI, CI, operator surfaces, and agent tools
  -> task-admitted skills consume resolved facts
```

Package manifests and lockfiles remain the installed-state authority. Kiln
owns desired-state policy, exceptions, comparison, and evidence.

The initial agent-facing contract should support these read-only operations:

- `stack.resolve`: return the adopted profile, effective constraints, source,
  and exception evidence;
- `stack.check`: compare effective constraints with manifests, lockfiles,
  runtime engines, and known compatibility requirements;
- `stack.diff`: return structured drift with severity, affected surface, and
  verification requirements;
- `stack.plan`: propose an ordered migration without modifying files.

`stack.apply` remains unadmitted until read-only evidence is stable and the
operator-authority contract is explicit.

## Ordered Slices

### Slice 0 - Read-Only Fixtures

Status: Research; next admissible work.

Define portable React/Vite, Astro, multi-package workspace, and temporary
compatibility-exception fixtures. Record desired, installed, locked, and drift
states without modifying manifests.

Exit gate: fixtures distinguish desired constraints from installed and locked
versions; conditional and forbidden dependencies have deterministic evidence;
no version is sourced from a skill or generated harness file.

### Slice 1 - Typed Profile Contract

Status: Queued behind Slice 0.

Define identity, inheritance, reviewed-at, surfaces, constraints, runtime floors,
exceptions, and precedence. Invalid profiles and cycles fail closed; project
scope cannot silently weaken organization policy.

Exit gate: schema and serialization tests cover every field.

### Slice 2 - Resolver And Drift

Status: Queued behind Slice 1.

Resolve effective policy and report missing, outdated, forbidden, incompatible,
and justified-exception states distinctly across supported package managers.

Exit gate: the resolver is package-manager-neutral; missing, outdated,
forbidden, incompatible, and justified-exception states are structurally
distinct; no mutation occurs during resolve, check, or diff.

### Slice 3 - CLI And CI

Status: Queued behind Slice 2.

Expose `stack resolve`, `stack check`, `stack diff`, and non-mutating `stack plan`
from shared evidence with stable JSON suitable for CI severity gates.

Exit gate: CLI output is a presentation of shared core evidence; CI can fail
on configured drift severities without parsing prose; workspace and
single-package fixtures pass on supported platforms.

### Slice 4 - Tools And Managed Context

Status: Queued behind Slice 3.

Expose the same read-only evidence to agent tools and Agent Tasks. Record the
profile/evidence used so admitted skills can consume facts without duplicating policy.

Exit gate: tools do not recompute policy independently; tool results identify
profile and evidence provenance; managed invocations record the stack evidence
used for the task; skills no longer need exact framework or package versions
in markdown.

### Slice 5 - Operator Surfaces And Apply

Status: Blocked until read-only reliability is proven.

Render stack health in Setup. Admit apply only with explicit authority, exact
files/packages, package-manager delegation, recovery, and post-change verification.

Exit gate: the operator sees exact files, packages, compatibility risks, and
required verification before approval; apply delegates installation and
lockfile resolution to the configured package manager; partial failure is
recoverable and never reports success without verification.

## Promotion Gates

- One typed contract owns policy, precedence, drift, and exceptions.
- CLI, CI, operator surfaces, managed invocation, and tools share that
  contract.
- Read-only operations are deterministic and package-manager-neutral.
- Skills and generated shims contain no duplicate version authority.
- Mutation is separately authorized, reversible, and verified using the
  project's package manager.
- Major migrations name focused tests, typecheck, build, and rendered
  verification requirements before completion.

## Verification

Schema/resolver tests, portable workspace fixtures (Astro, React/Vite,
compatibility-exception), JSON contract snapshots for CLI and agent tools,
cross-platform manifest/lockfile discovery, Setup/status presentation tests,
`bun run typecheck` and focused package tests for each admitted slice,
`git diff --check`, and documentation-link verification.

## Completion Criteria

This track is complete when a project can adopt a named stack profile and
every supported surface can explain the effective baseline, installed state,
drift, exceptions, and migration requirements from shared structured evidence.
Skills consume those resolved facts without owning versions, and any
dependency mutation remains explicit, package-manager-backed, and verifiably
complete.
