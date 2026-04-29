# Shared Developer Tools Roadmap

## Purpose

This roadmap owns Kiln's builtin developer-tool surface after the 2026-04-29
metadata and projection foundation. The work is core-first: every tool is
defined once in `@kilnai/core`, projected through MCP and runtime-attached
sessions, and consumed by CLI, GUI, and TUI without private registries.

Use this file with:

- `docs/architecture/tool-execution.md`
- `docs/guides/tool-use.md`
- `docs/research/11-agent-tooling-surface.md`

## Completed Foundation

The following slices are closed and verified.

### Slice 1: Bash Metadata Hardening

`bash` now preserves its public text output contract while exposing structured
command metadata for execution evidence, audit, and projection layers.

### Slice 1.5: Bash Timeout Propagation

`BashTool` remains the owner of command timeout validation. The execution bridge
derives its outer retry guard from canonical schema metadata only when a tool
input is explicitly marked as a millisecond timeout. Kiln-owned MCP clients also
propagate MCP request timeouts and opt into progress-based reset handling.

### Slice 2: Core-Owned Metadata Contract

Builtin developer tools now share one typed metadata contract in
`packages/core/src/tools/domain/tool-result-metadata.ts`. The contract covers
`command`, `file`, and `search` metadata while preserving existing public output
text and metadata keys.

### Slice 3: Runtime Evidence From Metadata

Runtime file-change evidence now reads shared core `file` metadata first.
`write` and `edit` operations become structured evidence even when provider
tool names are aliases. `read` metadata is explicitly not change evidence.

### Slice 4: Shared Projection Cleanup

MCP, runtime-attached sessions, and CLI MCP startup project from the canonical
core builtin surface. `grep` accepts file or directory paths without leaving the
native `rg` fast path. The dev-tools MCP server emits standard MCP progress
notifications for long-running tool calls when the caller supplies a progress
token.

### Slice 5: Patch Tool

`patch({ patch, dryRun? })` is now a core developer tool. It parses structured
patch documents in `@kilnai/core`, validates every target path before applying
changes, supports dry-run validation, emits per-file metadata, and projects
through MCP, runtime-attached sessions, and CLI startup from the canonical
builtin surface.

### Slice 6: File Metadata And Directory Tree Tools

`stat({ path, hash? })` and `tree({ path?, depth?, includeFiles? })` are now
core developer tools. `stat` reports read-only path metadata and optional
SHA-256 hashes. `tree` reports compact deterministic directory shape with
bounded depth, bounded entry count, sandbox validation, and nuisance-directory
filtering. Both tools emit shared `inspection` metadata and project through the
canonical builtin surface.

### Slice 7: Image Viewer And OCR Tools

`view_image({ path, detail? })` and `ocr_image({ path, language? })` are now
core developer tools. `view_image` validates image content by MIME signature,
enforces size limits, emits MCP-compatible image content, and preserves compact
JSON output for text-only consumers. `ocr_image` validates the same image
boundary and calls a configurable OCR runner; the default runner uses
`tesseract` from PATH when available and returns a clear tool error otherwise.
Both tools emit shared `media` metadata and project through MCP,
runtime-attached sessions, and CLI startup from the canonical builtin surface.

## Consumer Contract

All current consumers use the shared surface:

- CLI `kiln tools --mcp` constructs `DevToolsMcpServer` from
  `createDefaultBuiltinToolSurface()`.
- Runtime-attached CLI, GUI, and TUI sessions use
  `createAttachedRuntimeBuiltinToolSurface()` and
  `buildAttachedRuntimePerCallToolConfig()`.
- GUI and TUI may attach operator-surface tools, such as `operator_set_theme`,
  but developer tools still come from the core surface.
- No consumer may copy builtin tool schemas, create a private executor, or
  define separate metadata contracts for builtin tools.

## Remaining Tool Phases

### Phase 8: Output Verbosity Modes

Goal: reduce token overhead without losing structured metadata.

Target contract pattern:

```ts
outputMode?: "raw" | "structured" | "summary"
```

Design requirements:

- Keep metadata stable regardless of output mode.
- `raw` should minimize wrapper text for path lists and command output.
- `structured` should preserve current JSON-rich behavior.
- `summary` should provide bounded human-readable rollups for large results.
- Apply to high-volume tools first: `glob`, `grep`, `tree`, `bash`, and future
  web tools.

Research basis:

- MCP encourages structured tool outputs and output schemas, but production
  research highlights token pressure, observability, and error handling as
  infrastructure concerns beyond the base protocol.
- Gemini CLI exposes MCP description toggles and schema inspection, showing
  demand for adjustable verbosity during tool discovery and use.

### Phase 9: Controlled Web Search And Fetch

Goal: add current external lookup tools with source-quality controls.

Target contracts:

```ts
web_search({ query: string, domains?: string[], recencyDays?: number })
web_fetch({ url: string })
```

Design requirements:

- Domain restrictions must be first-class, not prompt-only hints.
- Fetch must return source URL, content type, retrieval time, truncation state,
  and citations or extract metadata where possible.
- Search must expose recency filtering and result ranking metadata.
- Network access policy must be explicit and auditable.
- Results must be sanitized before reinjection.

Research basis:

- Claude Code exposes `WebFetch` and `WebSearch`.
- Gemini CLI exposes both `web_fetch` and web search.
- Production MCP research identifies server contracts, timeouts, errors, and
  observability as necessary reliability layers; web tools must include those
  from the first slice.

## Execution Rules

- Add tests first for each phase.
- Add one tool or one shared capability at a time.
- Update `TOOL_SCHEMAS`, metadata builders, default surface tests, MCP tests,
  runtime projection tests, and CLI startup tests in the same slice.
- Run `bun run typecheck`, `bun run test`, and `bun run build` before marking a
  phase complete.
- Keep user-facing docs updated in `docs/guides/tool-use.md`.
