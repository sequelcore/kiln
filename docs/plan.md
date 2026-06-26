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

6. Cross-family summary producers
   - Populate `OperatorResourceReadResult.summary` through the owning providers
     for tool catalog, session work items, session goals, workspace tree,
     artifact namespace, memory graph, managed-agent invocation, and
     external-engagement artifact aggregate reads.
   - Keep summary counts and facets provider-owned so GUI, TUI, CLI, native,
     SDK, and MCP consumers do not parse local payloads differently.

   Status: completed.

7. Shared summary presentation
   - Add `projectOperatorResourceReadPresentation` to the shared
     `@kilnai/gateway-contracts` resource inspector contract.
   - Project summarized reads into deterministic count, facet, metadata, and
     content rows for terminal and browser presentation.
   - Wire CLI summarized resource reads and GUI preview data URLs to include
     the shared presentation projection instead of surface-local parsing.

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
- Passed:
  `bun run --cwd packages/core test tests/tools/domain/tool-resource-registry.test.ts tests/tools/domain/artifact-resource-store.test.ts tests/tools/default-tool-surface.test.ts`
- Passed:
  `bun run --cwd packages/runtime test tests/managed-agent/resource-provider.test.ts`
- Passed: `bun run --cwd packages/gateway-contracts test tests/resource-inspector.test.ts`
- Passed: `bun run --cwd packages/cli test tests/tools-command.test.ts`
- Passed: `bun run --cwd packages/gui test:run tests/client.test.ts`
- Passed: `bun run --cwd packages/gateway-contracts test`
- Passed: `bun run --cwd packages/cli test -- --reporter dot`
- Passed: `bun run --cwd packages/gui test:run -- --reporter dot`
- Passed: `bun run --cwd packages/core test -- --reporter dot`
- Passed: `bun run --cwd packages/runtime test -- --reporter dot`
- Passed: terminal managed-agent lifecycle regression test for cancelled, stale,
  and recovered summary counts
- Passed: `bun run typecheck`
- Passed: `bun run build`
- Passed: `git diff --check`
- Passed: touched-file authorization/private-token scan

## Remaining Work

- Add summary producers for future aggregate resource families when those
  families are introduced.
