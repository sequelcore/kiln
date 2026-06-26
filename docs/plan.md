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
   - Expose file-backed artifact reads under
     `kiln://external-engagement/artifacts/{fileName}`.
   - Expose source evidence reads under
     `kiln://external-engagement/evidence/{artifactId}`.

   Status: completed.

2. Configured surface integration
   - Register the provider through `loadConfiguredBuiltinToolSurfaceOptions` so
     CLI, GUI, TUI, runtime, and gateway resource-read consumers inherit the
     same resource source.
   - Preserve existing resource providers from web, interactive, memory, and
     artifact configuration.

   Status: completed.

3. Documentation
   - Document external-engagement resource URIs in the operator and external
     engagement docs.
   - Update the Execution Surfaces roadmap to record the resource inspector
     progress.

   Status: completed.

## Verification

- Passed:
  `bun run --cwd packages/cli test tests/config/external-engagement-resource-provider.test.ts tests/config/builtin-tool-surface-config.test.ts`
- Passed: `bun run --cwd packages/cli test`
- Passed: `bun run --cwd packages/cli typecheck`
- Passed: `bun run typecheck`
- Passed: `bun run build`
- Passed: `git diff --check`
- Passed: touched-file private source and secret leakage scan

## Remaining Work

- Add richer shared external-engagement resource summaries when the broader
  resource inspector summary model lands.
- Add rich GUI/TUI/native presentation only after the shared runtime channel is
  the owning surface.
