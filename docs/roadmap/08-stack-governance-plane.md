# 08 - Stack Governance Plane

Status: Research track
Execution: Research - define the provider-neutral stack policy and drift contract before admitting mutation operations.
Created: 2026-07-22

## Objective

Make project technology baselines executable Kiln configuration with shared
resolution, drift evidence, and agent-facing tools instead of duplicating
framework and package versions across skills, instruction profiles, and
generated harness markdown.

## Goals

- Define named organization, user, and project stack profiles for surfaces such
  as React applications and static-first Astro sites.
- Resolve required, conditional, forbidden, and exception-bound dependencies
  through one typed contract.
- Compare the resolved profile with package manifests, lockfiles, runtime
  constraints, and project evidence without replacing the package manager.
- Expose the same result through core APIs, CLI/CI, operator surfaces, and
  model-callable tools.
- Let skills consume resolved stack facts without becoming version authority.
- Make migrations explicit, reviewable, reversible, and evidence-gated.

## Scope

- Stack-profile schema, inheritance, precedence, and reviewed-at metadata.
- Project adoption and explicit exception records.
- Manifest, lockfile, runtime, plugin, and peer-compatibility inspection.
- Structured drift and migration-plan evidence.
- Read-only `stack resolve`, `stack check`, and `stack diff` operations.
- Explicitly authorized dependency mutation through a future `stack apply`
  operation.
- CLI, CI, GUI/TUI, managed invocation, and MCP/tool parity.
- Skill-context projection of resolved facts without duplicated version prose.

## Non-Goals

- Do not replace Bun, npm, pnpm, lockfiles, or framework migration tools.
- Do not update major versions automatically or interpret `latest` as standing
  mutation authority.
- Do not make skills or generated `AGENTS.md`/`CLAUDE.md` files canonical
  version stores.
- Do not require every Sequel project to use the same surface or framework.
- Do not add compatibility packages without a demonstrated consumer and an
  explicit removal condition.
- Do not mix dependency upgrades with unrelated source refactors.

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

## Delivery Slices

### Slice 0 - Research Fixture

Status: Planned

Create representative fixtures for a React/Vite application, a static-first
Astro site, a multi-package workspace, and a temporary compatibility exception.
Record the expected resolved profile and drift without writing manifests.

Exit gate:

- fixtures distinguish desired constraints from installed and locked versions;
- conditional and forbidden dependencies have deterministic evidence;
- no version is sourced from a skill or generated harness file.

### Slice 1 - Typed Stack Profile Contract

Status: Not started

Define profile identity, inheritance, reviewed-at metadata, surface selection,
required/conditional/forbidden dependencies, runtime floors, exception
evidence, and precedence across organization, user, and project scopes.

Exit gate:

- invalid profiles and cycles fail closed;
- project overrides cannot silently weaken an organization constraint;
- schema and serialization tests cover every field.

### Slice 2 - Resolver And Drift Evidence

Status: Not started

Resolve the effective profile and compare it with supported package manifests,
workspace packages, lockfiles, runtime engines, and plugin compatibility.

Exit gate:

- the resolver is package-manager-neutral;
- missing, outdated, forbidden, incompatible, and justified-exception states
  are structurally distinct;
- no mutation occurs during resolve, check, or diff.

### Slice 3 - CLI And CI Surface

Status: Not started

Expose `kiln stack resolve`, `kiln stack check`, and `kiln stack diff` with
human-readable and JSON output suitable for CI.

Exit gate:

- CLI output is a presentation of shared core evidence;
- CI can fail on configured drift severities without parsing prose;
- workspace and single-package fixtures pass on supported platforms.

### Slice 4 - Agent Tool And Managed Context

Status: Not started

Expose the shared read-only contract through Kiln tools and allow admitted
skills to receive the resolved surface and stack facts.

Exit gate:

- tools do not recompute policy independently;
- tool results identify profile and evidence provenance;
- managed invocations record the stack evidence used for the task;
- skills no longer need exact framework or package versions in markdown.

### Slice 5 - Operator Surfaces And Explicit Apply

Status: Not started

Render stack health in GUI/TUI Setup and admit an explicitly authorized apply
workflow only after read-only evidence has proven reliable.

Exit gate:

- the operator sees exact files, packages, compatibility risks, and required
  verification before approval;
- apply delegates installation and lockfile resolution to the configured
  package manager;
- partial failure is recoverable and never reports success without verification.

## Promotion Gates

- One typed contract owns stack identity, precedence, drift, and exceptions.
- CLI, CI, operator surfaces, managed invocation, and tools share that contract.
- Read-only operations are deterministic on checked-in fixtures.
- Skills and generated harness markdown contain no duplicate version authority.
- Mutation is separately authorized and uses the project's package manager.
- Major migrations name focused tests, typecheck, build, and rendered
  verification requirements before completion.

## Verification

- Schema and resolver unit tests.
- Workspace, Astro, React/Vite, and compatibility-exception fixtures.
- JSON contract snapshots for CLI and agent tools.
- Cross-platform manifest and lockfile discovery tests.
- Setup/status presentation tests.
- `bun run typecheck` and focused package tests for each admitted slice.
- `git diff --check` and documentation-link verification.

## Completion Criteria

This track is complete when a project can adopt a named stack profile and every
supported Kiln surface can explain the effective baseline, installed state,
drift, exceptions, and migration requirements from shared structured evidence.
Skills consume those resolved facts without owning versions, and any dependency
mutation remains explicit, package-manager-backed, and verifiably complete.
