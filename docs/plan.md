Status: In Progress
Updated: 2026-07-04

## Objective

Start Slice 3 by moving runtime tool-surface assembly to one authority-aligned
progressive projection policy while preserving the canonical full registry
behind `tool_catalog_search`.

## Research Basis

- Anthropic advanced tool use and Tool Search document the pattern: keep a
  search/catalog tool visible and defer full tool definitions until selection.
- ToolLLM, API-Bank, Gorilla, and Toolformer separate tool discovery or
  retrieval from tool execution instead of eagerly injecting every API schema.
- MCP tool listing/discovery treats tool metadata and schemas as inspectable
  server capabilities, which supports provider-neutral catalog projection.
- Cloned harnesses under `C:\Proyectos\Sequel\cloned` show the same pattern:
  Claude Code, Codex, and OpenCode all keep discovery metadata lightweight and
  load full tool/skill definitions progressively.

## Decisions

- Reuse the existing `DefaultBuiltinToolProjectionOptions` and
  `tool_catalog_search`; do not add a second catalog mechanism.
- Centralize explicit `read-only` and `execute` runtime profiles in
  `withProgressiveRuntimeToolProjection`; callers must select one.
- Keep read/research tools admitted for read-only sessions and add edit, shell,
  config mutation, and work-governance mutation tools only for execute sessions.
- Defer heavier/specialized runtime tools from the first provider-facing tool
  projection while keeping the canonical registry executable and searchable.

## Slices

1. Add a focused test proving the progressive runtime projection keeps catalog
   discovery and common control-plane tools visible while deferring a heavy
   browser tool from provider-facing definitions.
2. Replace benchmark-local tool projection with the shared read-only runtime
   profile.
3. Apply the same helper to CLI run, TUI, and GUI runtime tool surfaces.
4. Run focused CLI tests and repository typecheck.
5. Record roadmap evidence and residual risk before any commit.

## Verification

- `bun run --filter @kilnai/core test -- tests/tools/default-tool-surface.test.ts tests/tools/mcp/dev-tools-server.test.ts`
- `bun run --filter @kilnai/cli test -- tests/config/builtin-tool-surface-config.test.ts`
- `bun run --filter @kilnai/cli test -- tests/application/benchmark-session-executor.test.ts`
- `bun run --filter @kilnai/cli test -- tests/commands/run-builtin-tools.test.ts`
- `bun run --filter @kilnai/cli test -- tests/commands/tui-startup-provider-catalog-guard.test.ts`
- `bun run --filter @kilnai/cli test -- tests/commands/gui-dashboard-availability.test.ts`
- `bun run typecheck`
- `git diff --check`
- reviewer and adversarial review

The full serialized CLI suite was rerun with verbose per-test reporting and
completed successfully: 1,330 assertions across 131 test files, with exit code
0 and no unhandled worker errors. The earlier host `ncrypto::CSPRNG` assertion
did not reproduce. A subsequent workspace run exposed reproducible Core worker
saturation through two exact 5-second timeouts. The affected tests passed in
isolation; no timeout, retry, or worker-limit workaround was retained without a
reproducible product-owned cause.

## Residual-Risk Gate

This slice does not yet implement dynamic `tool_reference` or next-round schema
loading for hidden tools. Do not narrow either authority profile further until
that admission path exists and non-inferiority is proven.
