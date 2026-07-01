# 05 - CLI Test Harness Stability

Status: Deferred test-infrastructure hardening
Created: 2026-06-29

## Objective

Make the CLI package test harness deterministic, bounded, and diagnosable
enough to run as part of the full workspace verification command without
hanging silently.

## Goals

- Identify the exact CLI test or fixture that leaves open handles.
- Make CLI test failures bounded and diagnosable.
- Preserve the canonical workspace test command.
- Avoid skips, sleeps, and machine-local workarounds.

## Trigger

During 2026-06-29 verification, `@kilnai/core`, `@kilnai/runtime`, GUI targeted
tests, and workspace typecheck passed. The full workspace test command could
not close because `bun run --filter @kilnai/cli test` remained alive for more
than seven minutes without useful failure output.

## Scope

- CLI Vitest lifecycle and open-handle cleanup.
- Test isolation for commands, config, wrapper, and application suites.
- Reporter behavior when a test process is interrupted or times out.
- Child-process, server, watcher, and temporary-file teardown in CLI tests.
- Package-level timeout policy and diagnostics for CI/local runs.

## Non-Goals

- No broad skip of slow or hanging tests.
- No environment-specific sleep-based stabilization.
- No dependency on live credentials, installed harnesses, or operator state in
  default tests.
- No change to product behavior unless the test hang exposes a production
  lifecycle bug.

## Constraints

- Do not hide slow or hanging tests by broad skips.
- Do not add environment-specific sleeps or machine-local workarounds.
- Keep CLI tests hermetic: no dependency on locally installed harnesses,
  provider credentials, live model discovery, or operator state unless a test is
  explicitly marked live.
- Preserve the canonical workspace test command documented in project context.

## Sequel Standards

- No broad test skips to hide hangs.
- No environment-specific timing hacks.
- No live harness, credential, or operator-state dependency in default tests.
- No completion claim until package tests and full workspace verification exit
  cleanly.

## Required Evidence

- Identify the exact CLI test file or fixture that leaves handles open.
- Add focused regression coverage for the teardown boundary if production or
  shared test utilities change.
- Prove `bun run --filter @kilnai/cli test` exits cleanly.
- Re-run the full workspace test command after the CLI package exits cleanly.

## Research Basis

The trigger evidence is the 2026-06-29 verification hang in
`bun run --filter @kilnai/cli test`. No external research is required before
activation; this is a local deterministic-test investigation.

## Delivery Slices

1. Reproduce the hang with bounded diagnostics.
2. Isolate the open handle or long-running fixture.
3. Add focused regression coverage for the teardown boundary.
4. Re-run CLI tests, full workspace tests, typecheck, and build.

## Promotion Gates

Promote this roadmap to active when full-workspace verification is needed again
or when CLI test hangs begin blocking release, CI, or confidence in unrelated
changes.

## Verification

- `bun run --filter @kilnai/cli test` exits cleanly.
- Full workspace test command exits cleanly.
- Any changed shared test utility has focused regression coverage.
- Typecheck and build pass after the fix.

## Completion Criteria

This roadmap closes when the CLI test harness is deterministic, bounded, and
diagnosable enough to run inside the canonical workspace verification command.
