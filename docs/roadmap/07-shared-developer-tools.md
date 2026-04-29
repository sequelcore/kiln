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

### Phase 5: Patch Tool

Goal: add a reviewable, structured edit tool that is safer than whole-file
`write` and more expressive than string-only `edit`.

Target contract:

```ts
patch({ patch: string, dryRun?: boolean })
```

Design requirements:

- Accept a single patch document with explicit create, update, delete, and move
  semantics.
- Validate paths before applying any file operation.
- Support dry-run validation and structured per-file results.
- Decide atomicity before implementation. Default should be all-or-nothing for
  multi-file patches unless the contract explicitly states partial success.
- Emit `file` metadata for every changed path and a higher-level patch summary
  for audit.
- Reject ambiguous or unsupported patch syntax instead of shelling out blindly.

Research basis:

- OpenAI documents `apply_patch` as a structured diff workflow with explicit
  success/failure result reporting, path validation, rollback considerations,
  and approval hooks.
- User complaints around patch tools on Windows show that shell-mediated patch
  invocation is brittle; Kiln should implement patch application as a core tool,
  not as a hidden shell convention.

### Phase 6: File Metadata And Directory Tree Tools

Goal: provide cheap orientation tools so agents do not abuse shell, broad grep,
or recursive reads for simple workspace inspection.

Target contracts:

```ts
stat({ path: string, hash?: "none" | "sha256" })
tree({ path?: string, depth?: number, includeFiles?: boolean })
```

Design requirements:

- `stat` returns type, size, modified time, and optional checksum.
- `tree` returns a compact, bounded representation with deterministic ordering.
- Both tools must respect sandbox path validation and ignore nuisance
  directories by default where appropriate.
- Both tools should support raw/structured projection once output verbosity is
  implemented.

Research basis:

- Gemini CLI exposes `list_directory`, `glob`, `search_file_content`, and
  file metadata-style behavior as first-class tools instead of forcing shell
  commands for orientation.
- Claude Code has dedicated `Glob`, `Grep`, and `Read` tools; user complaints
  show regressions when dedicated search/orientation tools disappear or drift
  from model instructions.

### Phase 7: Image Viewer And OCR

Goal: make image-heavy workspaces first-class for every consumer.

Target contracts:

```ts
view_image({ path: string, detail?: "default" | "original" })
ocr_image({ path: string, language?: string })
```

Design requirements:

- `view_image` returns model-consumable image content or a stable resource link
  depending on the consumer projection.
- Preserve original-resolution access for detail-sensitive evidence, UI, and
  diagram work.
- Enforce MIME/type checks, size limits, and sandbox path validation.
- `ocr_image` must return text plus confidence/source metadata when the OCR
  backend supports it.
- Do not couple implementation to GUI/TUI rendering. GUI/TUI may render richer
  previews later, but the core tool contract must work through MCP and runtime.

Research basis:

- MCP tool results support image content, embedded resources, and resource
  links.
- Gemini CLI reads images and PDFs as base64 model-consumable data through its
  file tools.
- Users repeatedly report friction around passing multiple images, image size
  failures, and unreliable image handling in coding agents.

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
