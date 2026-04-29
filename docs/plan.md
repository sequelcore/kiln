# Shared Developer Tools Active Plan

## Current State

The completed 2026-04-29 foundation is now documented in
`docs/roadmap/07-shared-developer-tools.md` and
`docs/architecture/tool-execution.md`.

Closed slices:

1. `bash` metadata hardening.
2. `bash` timeout propagation.
3. Core-owned builtin tool metadata contract.
4. Runtime evidence extraction from shared metadata.
5. Shared projection cleanup across MCP, runtime-attached sessions, and CLI.
6. Kiln-owned MCP request timeout propagation and server-side progress
   notifications.
7. Core `patch({ patch, dryRun? })` tool with structured parsing, path
   validation, dry-run planning, per-file metadata, and shared projections.
8. Core `stat({ path, hash? })` and
   `tree({ path?, depth?, includeFiles? })` tools with sandbox validation,
   bounded deterministic output, shared `inspection` metadata, and shared
   projections.

## Active Objective

Implement the remaining shared developer tools from the canonical core surface
outward. Every phase must preserve the single core registry and shared runtime
execution path for CLI, GUI, TUI, and MCP consumers.

## References

- Architecture contract: `docs/architecture/tool-execution.md`
- User guide: `docs/guides/tool-use.md`
- Roadmap: `docs/roadmap/07-shared-developer-tools.md`
- Research basis: `docs/research/11-agent-tooling-surface.md`

## Remaining Phases

### Phase 7: Image Viewer And OCR

Add:

```ts
view_image({ path: string, detail?: "default" | "original" })
ocr_image({ path: string, language?: string })
```

Core requirements:

- path-safe image access
- MIME and size validation
- model-consumable output or resource-link projection
- original-resolution option
- OCR confidence/source metadata when available

### Phase 8: Output Verbosity Modes

Add shared option where useful:

```ts
outputMode?: "raw" | "structured" | "summary"
```

Core requirements:

- stable metadata in every mode
- raw output for low-token path lists and command output
- structured output for rich machine-readable projections
- summary output for large results

### Phase 9: Controlled Web Search And Fetch

Add:

```ts
web_search({ query: string, domains?: string[], recencyDays?: number })
web_fetch({ url: string })
```

Core requirements:

- explicit network policy
- domain restrictions
- recency filtering
- source and retrieval metadata
- truncation metadata
- result sanitization before reinjection

## Verification For Every Phase

- Focused unit tests for the new core tool.
- Default surface tests proving the tool is projected from the canonical
  registry.
- MCP tests proving schema and call behavior.
- Runtime projection tests proving CLI, GUI, and TUI attached sessions receive
  the same developer-tool surface.
- `bun run typecheck`
- `bun run test`
- `bun run build`

## Non-Negotiables

- No GUI/TUI-private developer tool implementation.
- No duplicated builtin schema registry.
- No hidden shell fallback that bypasses path/network validation.
- No metadata contract outside core.
- No tool marked complete without docs and tests.
