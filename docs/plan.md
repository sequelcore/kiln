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
9. Core `view_image({ path, detail? })` and
   `ocr_image({ path, language? })` tools with image MIME validation, size
   limits, MCP-compatible image content, configurable OCR backend execution,
   shared `media` metadata, and shared projections.
10. Core `verbosity?: "raw" | "structured" | "summary"` support for `bash`,
    `tree`, `grep`, and `glob`, preserving raw defaults while adding structured
    JSON and bounded summaries with stable metadata.

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

### Phase 9: Controlled Web Search And Fetch

Add:

```ts
web_search({ query: string, domains?: string[], recencyDays?: number })
web_fetch({ url: string })
```

Research basis:

- Anthropic, Gemini CLI, and OpenCode all split web discovery from URL
  retrieval.
- OpenAI and Anthropic web search surfaces make source/citation data a first
  class output concern.
- MCP security guidance treats network access as a scope and SSRF boundary, not
  a formatting detail.
- User reports on coding-agent web search highlight stale documentation,
  unreliable lookup, and manual toggle friction.

Design decisions:

- Keep `web_search` and `web_fetch` in `@kilnai/core`; no GUI, CLI, TUI, or MCP
  private implementation.
- Add a new `web` metadata family instead of overloading workspace `search`
  metadata, because external source retrieval has different policy, source,
  HTTP, and truncation evidence.
- `web_fetch` uses an injected `WebFetchClient` with a default native
  `fetch`-based implementation. It validates URL, domain, redirects, content
  type, byte limits, and timeout before returning sanitized text.
- `web_search` uses an injected `WebSearchProvider`. The default provider fails
  closed with a configuration error; core must not scrape search-result pages or
  hide network calls behind shell commands.
- Both tools support `verbosity?: "raw" | "structured" | "summary"` because web
  outputs are high-volume.
- Domain inputs are allowlists for the call. They must be intersected with the
  sandbox/network policy; user-provided domains can narrow policy, never expand
  it.
- Domain parsing must use ASCII-normalized hostnames, reject URL-shaped domain
  values, and include subdomains consistently.
- Fetch follows redirects only when every hop passes the same policy. Redirect
  chains are recorded in metadata.
- Results are sanitized before reinjection: remove scripts/styles, collapse
  whitespace, strip control characters, cap output bytes/chars, and record
  truncation.

Planned contracts:

```ts
web_search({
  query: string,
  domains?: string[],
  recencyDays?: number,
  maxResults?: number,
  verbosity?: "raw" | "structured" | "summary"
})

web_fetch({
  url: string,
  maxBytes?: number,
  timeout?: number,
  verbosity?: "raw" | "structured" | "summary"
})
```

Core metadata:

```ts
WebToolResultMetadata {
  toolName: "web_search" | "web_fetch"
  kind: "web"
  operation: "search" | "fetch"
  provider?: string
  query?: string
  url?: string
  normalizedUrl?: string
  domains?: readonly string[]
  recencyDays?: number
  resultCount?: number
  retrievedAt?: string
  contentType?: string
  status?: number
  bytesRead?: number
  truncated?: boolean
  redirectChain?: readonly string[]
  sources?: readonly WebSourceMetadata[]
  errorCode?: "invalid_input" | "network_denied" | "unsupported_content_type" |
    "too_many_requests" | "unavailable" | "timeout" | "provider_not_configured"
  verbosity?: "raw" | "structured" | "summary"
}
```

Implementation order:

1. Add failing core tests for `TOOL_SCHEMAS`, `DevToolName`, web metadata
   builders, default surface tool order, MCP schema projection, and runtime
   attached-surface projection. Expected count becomes 14 builtin tools.
2. Add `packages/core/src/tools/infrastructure/web-policy.ts` for URL/domain
   normalization, sandbox `NetworkFilter` checks, redirect policy helpers, and
   private/localhost address rejection.
3. Add `packages/core/src/tools/infrastructure/web-result-format.ts` for shared
   raw/structured/summary output formatting and sanitized source snippets.
4. Add `packages/core/src/tools/infrastructure/web-fetch-tool.ts` with injected
   fetch client, timeout, byte cap, content-type allowlist, redirect validation,
   sanitization, and metadata.
5. Add `packages/core/src/tools/infrastructure/web-search-tool.ts` with injected
   provider, domain/recency/max-result validation, fail-closed default provider,
   result normalization, and metadata.
6. Register and export both tools from `TOOL_SCHEMAS`,
   `createDefaultBuiltinTools()`, and `packages/core/src/tools/index.ts`.
7. Update MCP tests, runtime attached-surface tests, CLI tool startup tests if
   needed, and user/architecture docs.

Focused test cases:

- `web_fetch` rejects non-HTTP(S), localhost/private IP, invalid URL, and
  domains outside sandbox policy.
- `web_fetch` rejects redirect hops that leave policy.
- `web_fetch` strips script/style content, strips control characters, records
  `retrievedAt`, `contentType`, `status`, `bytesRead`, `truncated`, and
  redirect chain.
- `web_fetch` formats raw, structured, and summary output without changing
  metadata.
- `web_search` rejects empty query, invalid domains, negative recency, and
  provider-not-configured.
- `web_search` passes query/domain/recency/maxResults to an injected provider
  and returns ranked sources with provider metadata.
- Both schemas expose read-only/idempotent annotations and shared `verbosity`.

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
