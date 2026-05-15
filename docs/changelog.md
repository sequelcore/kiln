# Changelog

This changelog tracks supported public changes beginning with the Kiln 2.0
baseline. Active and deferred execution tracks live in
[`docs/roadmap/`](roadmap/README.md); stable doctrine lives in
[`docs/architecture/`](architecture/README.md); curated release notes live in
[`docs/releases/`](releases/README.md).

## Unreleased

- Prepared the workspace for the `2.0.0` public baseline.
- Bumped public and private workspace package metadata to `2.0.0`.
- Aligned internal `@kilnai/*` peer and optional dependency ranges to the
  `2.0.0` package line.
- Reset curated release notes so `docs/releases/` starts at the supported
  `2.0.0` baseline.
- Restricted npm publishing to `v2.*` tags and added tag/package version
  validation before publish.
- Added `@kilnai/gateway-contracts` to the publish graph so public packages do
  not depend on an unpublished workspace package.

## v2.0.0

Status: draft until `v2.0.0` is tagged and published.

Kiln 2.0.0 is the first supported public baseline for the current
biocybernetic control-plane architecture.

### Verification

Before publishing the `v2.0.0` tag, run:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```
