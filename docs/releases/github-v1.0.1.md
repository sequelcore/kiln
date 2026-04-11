# Kiln 1.0.1

Kiln `1.0.1` is a packaging hotfix for the `1.0.0` control-plane reset.

## Highlights

- Fixed the npm publish workflow so it publishes the full required package
  graph.
- Added the missing `@kilnai/tools*` and `@kilnai/tui` publish steps.
- Added missing build steps for packages that must ship built artifacts.
- Resolved `workspace:*` references across all public packages before publish.
- Bumped workspace packages to `1.0.1`.

## Compatibility note

This release does not change the `1.0.0` architectural baseline. It fixes the
release pipeline so downstream consumers can actually install the published
packages.

## Verification

- `bun run typecheck`
- `bun run test`
- `bun run build`
