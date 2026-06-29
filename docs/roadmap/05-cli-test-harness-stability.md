Status: Deferred test-infrastructure hardening

## Objective

Make the CLI package test harness deterministic, bounded, and diagnosable
enough to run as part of the full workspace verification command without
hanging silently.

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

## Constraints

- Do not hide slow or hanging tests by broad skips.
- Do not add environment-specific sleeps or machine-local workarounds.
- Keep CLI tests hermetic: no dependency on locally installed harnesses,
  provider credentials, live model discovery, or operator state unless a test is
  explicitly marked live.
- Preserve the canonical workspace test command documented in project context.

## Required Evidence

- Identify the exact CLI test file or fixture that leaves handles open.
- Add focused regression coverage for the teardown boundary if production or
  shared test utilities change.
- Prove `bun run --filter @kilnai/cli test` exits cleanly.
- Re-run the full workspace test command after the CLI package exits cleanly.

## Promotion Gate

Promote this roadmap to active when full-workspace verification is needed again
or when CLI test hangs begin blocking release, CI, or confidence in unrelated
changes.
