# Kiln 1.0.3

Kiln `1.0.3` is the first fully consistent release after the `1.0.0`
control-plane reset.

## Highlights

- Aligned git tag, npm package versions, and publish workflow behavior.
- Carried forward the publish graph and workspace-resolution fixes from
  `1.0.1` and `1.0.2`.
- Ensured the required `@kilnai/tools*` and `@kilnai/tui` packages are part of
  the publish line.

## Compatibility note

This release does not change the `1.0.0` architectural baseline. It corrects
release consistency so downstream consumers can depend on a coherent published
version.

## Verification

- `bun run typecheck`
- `bun run test`
- `bun run build`
