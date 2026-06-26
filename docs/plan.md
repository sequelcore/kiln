# External Engagement Resource Inspector Plan

Date: 2026-06-26
Status: implemented

## Objective

Make generated external-engagement artifacts inspectable through Kiln's shared
resource plane so operators can review source-grounded evidence without adding
broader X access, write authority, GUI-local parsing, or compatibility shims.

## Non-Goals

- Do not add posting, replying, liking, reposting, following, DM access, or
  automated external actions.
- Do not read arbitrary filesystem paths through resource URIs.
- Do not add a separate GUI/TUI/native model for external-engagement artifacts.
- Do not preserve project-local runtime database compatibility.

## Implementation Slices

1. Workspace resource provider
   - Add a CLI-configured `ToolResourceProvider` for
     `.kiln/external-engagement`.
   - Expose `kiln://external-engagement/artifacts`.
   - Summarize generated artifacts by content-derived kind and counts instead
     of relying on filename conventions.
   - Expose file-backed artifact reads under
     `kiln://external-engagement/artifacts/{fileName}`.
   - Expose source evidence reads under
     `kiln://external-engagement/evidence/{artifactId}`.

   Status: completed.

2. Shared summary contract
   - Add a typed `summary` field to shared resource-read results.
   - Project provider summaries through `OperatorResourceReadResult`.
   - Populate external-engagement artifact indexes with generic resource
     summary counts and facets.

   Status: completed.

3. Configured surface integration
   - Register the provider through `loadConfiguredBuiltinToolSurfaceOptions` so
     CLI, GUI, TUI, runtime, and gateway resource-read consumers inherit the
     same resource source.
   - Preserve existing resource providers from web, interactive, memory, and
     artifact configuration.

   Status: completed.

4. Summary presentation
   - Keep summarized CLI resource reads in the shared
     `OperatorResourceReadResult` JSON contract instead of collapsing them to
     raw text.
   - Keep summarized GUI resource openings in the shared resource-read contract
     when converting them to preview data URLs.

   Status: completed.

5. Documentation
   - Document external-engagement resource URIs in the operator and external
     engagement docs.
   - Update the Execution Surfaces roadmap to record the resource inspector
     progress.

   Status: completed.

## Verification

- Passed: `bun run --cwd packages/gateway-contracts test tests/resource-inspector.test.ts`
- Passed:
  `bun run --cwd packages/cli test tests/config/external-engagement-resource-provider.test.ts tests/config/builtin-tool-surface-config.test.ts`
- Passed: `bun run --cwd packages/cli test tests/tools-command.test.ts`
- Passed: `bun run --cwd packages/gui test:run tests/client.test.ts`
- Passed: `bun run --cwd packages/cli test tests/config --reporter verbose`
- Passed: `bun run --cwd packages/cli test`
- Passed: `bun run --cwd packages/gui test:run -- --reporter dot`
- Passed: `bun run --cwd packages/gateway-contracts test -- --reporter dot`
- Passed:
  `bun run --cwd packages/gui test:e2e tests/parity/04-input-ergonomics.spec.ts --project=chromium`
- Passed: `bun run --cwd packages/cli typecheck`
- Passed: `bun run typecheck`
- Passed: `bun run build`
- Passed: `git diff --check`
- Passed: touched-file private source and secret leakage scan

## Remaining Work

- Add typed summary producers for other resource families when they need rich
  operator presentation.
- Add richer GUI/TUI/native inspector layouts after each resource family has a
  shared runtime summary producer.
