# 07 - Stack Governance Plane

Status: Research track
Execution: Research - define read-only policy and drift evidence before mutation.
Created: 2026-07-22

## Objective

Make project technology baselines executable Kiln configuration with one typed
desired-state policy, deterministic drift evidence, and shared operator/agent surfaces.

## Ownership

Package manifests and lockfiles own installed state. This track owns desired
constraints, inheritance, exceptions, comparison, and migration evidence. Skills
consume resolved facts but never own versions.

## Scope

- Organization, user, and project stack profiles.
- Required, conditional, forbidden, and exception-bound dependencies.
- Manifest, workspace, lockfile, runtime, peer, and plugin inspection.
- Read-only resolve/check/diff/plan operations.
- CLI/CI, operator, managed-invocation, and tool projection.
- Explicit package-manager-backed apply only after read-only proof.

## Non-Goals

- No package-manager replacement or automatic major upgrade.
- No `latest` as standing mutation authority.
- No version authority in skills or generated harness markdown.
- No compatibility dependency without a consumer and removal condition.
- No dependency migration mixed with unrelated refactors.

## Ordered Slices

### Slice 0 - Read-Only Fixtures

Status: Research; next admissible work.

Define portable React/Vite, Astro, multi-package workspace, and temporary
compatibility-exception fixtures. Record desired, installed, locked, and drift
states without modifying manifests.

### Slice 1 - Typed Profile Contract

Status: Queued behind Slice 0.

Define identity, inheritance, reviewed-at, surfaces, constraints, runtime floors,
exceptions, and precedence. Invalid profiles and cycles fail closed; project
scope cannot silently weaken organization policy.

### Slice 2 - Resolver And Drift

Status: Queued behind Slice 1.

Resolve effective policy and report missing, outdated, forbidden, incompatible,
and justified-exception states distinctly across supported package managers.

### Slice 3 - CLI And CI

Status: Queued behind Slice 2.

Expose `stack resolve`, `stack check`, `stack diff`, and non-mutating `stack plan`
from shared evidence with stable JSON suitable for CI severity gates.

### Slice 4 - Tools And Managed Context

Status: Queued behind Slice 3.

Expose the same read-only evidence to agent tools and managed jobs. Record the
profile/evidence used so Roadmap 05 skills can consume facts without duplicating policy.

### Slice 5 - Operator Surfaces And Apply

Status: Blocked until read-only reliability is proven.

Render stack health in Setup. Admit apply only with explicit authority, exact
files/packages, package-manager delegation, recovery, and post-change verification.

## Promotion Gates

- One typed contract owns policy, precedence, drift, and exceptions.
- Read-only operations are deterministic and package-manager-neutral.
- Skills and generated shims contain no duplicate version authority.
- Mutation is separately authorized, reversible, and verified.

## Verification

Schema/resolver tests, portable workspace fixtures, JSON contract tests,
cross-platform discovery, operator presentation tests, workspace typecheck,
focused package tests, link checks, and `git diff --check`.

## Completion Criteria

Every supported surface can explain effective baseline, installed state, drift,
exceptions, and migration requirements from shared evidence; any mutation remains
explicit and package-manager-backed.
