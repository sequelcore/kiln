# Developer Tools

## Status

This is the canonical architecture record for Kiln's shared builtin developer
tools as of 2026-04-30.

Stable developer-tool doctrine lives here, in `tool-execution.md`, and in
`docs/guides/tool-use.md`.

## Purpose

Kiln has one builtin developer-tool surface. Tools are defined once in
`@kilnai/core`, projected through MCP and runtime-attached sessions, and
consumed by CLI, GUI, TUI, SDK, and direct-provider sessions without private
registries.

The developer-tool surface owns concrete local and external developer actions:

- command execution
- file reads and writes
- search
- patch application
- file metadata
- directory trees
- image viewing
- OCR
- controlled web search
- controlled web fetch
- output verbosity for high-volume results

Higher-level intelligence on top of this surface, such as catalog search,
deferred discovery, `read_many`, monitors, task state, elicitation, and
resources, is documented in `shared-tooling-intelligence.md` and
`context-resource-plane.md`.

## Core Ownership

The core package owns tool schemas, execution behavior, metadata contracts, and
projection adapters. Consumers may attach their own operator tools, but they do
not own alternate developer-tool implementations.

Canonical construction paths:

- CLI MCP startup uses `createDefaultBuiltinToolSurface()`.
- Runtime-attached CLI, GUI, and TUI sessions use
  `createAttachedRuntimeBuiltinToolSurface()`.
- Runtime per-call execution uses `buildAttachedRuntimePerCallToolConfig()`.
- MCP exposes the same builtin registry through `DevToolsMcpServer`.
- GUI and TUI may add operator-surface tools, but developer tools still come
  from the core surface.

No consumer may copy builtin schemas, create a private executor, or define
separate metadata contracts for builtin developer tools.

## Metadata Contract

Builtin developer tools use the shared metadata contract in
`packages/core/src/tools/domain/tool-result-metadata.ts`.

Stable metadata families include:

- `command`: shell execution evidence for `bash`
- `file`: file operation evidence for `read`, `write`, `edit`, and `patch`
- `search`: search evidence for `grep` and `glob`
- `inspection`: read-only path and tree evidence for `stat` and `tree`
- `media`: image and OCR evidence for `view_image` and `ocr_image`
- `web`: external source evidence for `web_search`, `web_fetch`, and
  `web_extract`

Metadata is audit and projection evidence. It is not a replacement for the
visible output contract or structured tool output schemas.

## Tool Result Presentation

Developer-tool results are emitted as canonical tool evidence and then rendered
through the shared operator-event presentation projection in
`@kilnai/gateway-contracts`.

Normal operator transcript and activity surfaces must render the typed
`toolPresentation` view model, not stringify the raw `ToolResult` envelope.
The raw envelope remains audit evidence for inspector/raw views only.

Stable presentation behavior:

- `read` renders markdown or text previews from the actual file content.
- `tree` renders compact tree previews, not the JSON wrapper around the tree
  output.
- `read_many` renders bounded summaries plus `kiln://artifacts/...` resource
  links for the full packet.
- `patch`, `edit`, and `write` render file-change summaries and diff previews
  when diff evidence is available.
- `stat` renders file metadata as structured fields and may expose compact text
  only when the tool has no richer projection.
- `bash` and `git` render command evidence, exit status, duration, and bounded
  stdout/stderr previews.

The projection is consumer-independent. GUI, TUI, CLI, SDK, and MCP-adjacent
operator surfaces may choose different visual components, but they must not
duplicate private JSON-unwrapping rules.

Tools that can describe a richer semantic display may emit a validated
`metadata.presentationIntent`. That intent is still tool-result evidence, not UI
authority. The shared gateway contract accepts only the closed
`PresentationIntent` union and projects accepted values into
`toolPresentation.presentationIntent`; invalid values are ignored and the normal
typed presentation remains visible. This keeps agent/tool-authored tables,
diagnostics, timelines, resource bundles, and risk reports inspectable across
GUI, TUI, CLI, SDK/widget, and future surfaces without allowing arbitrary UI or
surface-specific schemas.

## Command Execution

`bash` preserves its public text output contract while exposing structured
command metadata. Timeout validation belongs to `BashTool`; the execution bridge
derives its outer retry guard from schema metadata only when the input is
explicitly marked as a millisecond timeout.

Kiln-owned MCP clients propagate request timeouts and opt into progress-based
reset handling. Long-running process ownership beyond a single command belongs
to the monitor tools documented in `shared-tooling-intelligence.md`.

## File And Search Tools

The core surface owns file read/write/edit and search behavior. Runtime
file-change evidence reads shared core `file` metadata first, so write and edit
operations become structured evidence even when provider tool names are aliases.

`grep` and `glob` remain core search tools. `grep` accepts file or directory
paths while preserving the native `rg` fast path when available.

## Patch Tool

`patch({ patch, dryRun? })` is a core developer tool.

It parses structured patch documents in `@kilnai/core`, validates every target
path before applying changes, supports dry-run validation, emits per-file
metadata, and projects through MCP, runtime-attached sessions, and CLI startup
from the canonical builtin surface.

Patch execution is a file mutation and must remain governed by the same
authority, sandbox, and audit path as other write tools.

## File Metadata And Tree Tools

`stat({ path, hash? })` and `tree({ path?, depth?, includeFiles? })` are
read-only core developer tools.

`stat` reports path metadata and optional SHA-256 hashes. `tree` reports compact
deterministic directory shape with bounded depth, bounded entry count, sandbox
validation, and nuisance-directory filtering.

Both tools emit `inspection` metadata and project through the canonical builtin
surface.

## Image And OCR Tools

`view_image({ path, detail? })` and `ocr_image({ path, language? })` are
read-only core developer tools.

`view_image` validates image content by MIME signature, enforces size limits,
emits MCP-compatible image content, and preserves compact JSON output for
text-only consumers.

`ocr_image` validates the same image boundary and calls a configurable OCR
runner. The default runner uses `tesseract` from PATH when available and returns
a clear tool error otherwise.

Both tools emit `media` metadata and project through MCP, runtime-attached
sessions, and CLI startup from the canonical builtin surface.

## Output Verbosity

High-volume tools support:

```ts
verbosity?: "raw" | "structured" | "summary"
```

The field is named `verbosity`, not `outputMode`, because `grep.outputMode`
already controls match semantics.

`bash`, `tree`, `grep`, and `glob` preserve raw default output while adding
structured JSON and bounded summaries. Metadata records the requested
verbosity.

Resource-linked high-volume outputs are documented in
`context-resource-plane.md`.

## Controlled Web Tools

`web_search`, `web_fetch`, and `web_extract` are read-only/idempotent core
developer tools. They project through the canonical builtin surface and emit
shared `web` metadata.

`web_fetch`:

- validates HTTP(S) URLs
- rejects private and localhost targets
- requires explicit network policy
- enforces sandbox `NetworkFilter` checks
- validates redirect hops
- caps bytes
- checks supported text content types
- sanitizes reinjected text
- records retrieval metadata

`web_search` accepts query, domain, recency, and max-result controls through an
injected `WebSearchProvider`. The default provider fails closed; core does not
scrape public result pages or shell out for search. CLI configuration can adapt
provider-specific search payloads from `http`, `searxng`, `brave`, `tavily`,
and `exa` into the canonical ranked-source metadata shape without making
runtime consumers provider-specific.

`web_extract` accepts one or more HTTP(S) URLs plus format, byte, timeout, and
verbosity controls through an injected `WebExtractProvider`. The default
provider fails closed; core does not own scraping vendors or browser
automation. CLI configuration can adapt provider-specific extraction payloads
from `http`, `tavily`, and `firecrawl` into the canonical page-evidence shape
without making runtime consumers provider-specific.

Web errors use typed metadata so operator surfaces can distinguish missing
configuration from runtime denial:

- `network_policy_missing`
- `network_denied`
- `domain_denied`
- `provider_not_configured`
- `provider_unreachable`
- `timeout`
- `too_many_requests`
- `unsupported_content_type`
- `empty_extraction`

`web_search`, `web_fetch`, and `web_extract` are not the research capability.
Governed research is a higher-level future capability documented in
[`controlled-web-research.md`](controlled-web-research.md).

## Web Configuration

Project `KilnYaml.web` configures controlled web authority once for every
consumer.

Stable fields:

- `enabled`
- `netPolicy`
- `allowedDomains`
- `searchProvider`
- `extractProvider`

Absent configuration remains fail-closed: `web_fetch` requires explicit network
policy, `web_search` requires an injected search provider, and `web_extract`
requires an injected extraction provider.

`web_search.recencyDays` treats `null` the same as an omitted recency filter so
provider adapters do not fail when model surfaces serialize optional fields as
JSON nulls.

`web_extract` treats an empty provider response as an error with
`errorCode: empty_extraction`. A provider returning `pages: []` means Kiln did
not obtain source text; it is not a successful extraction of an empty document.

`searchProvider` supports:

- `type: none`
- `type: http`
- `type: searxng`
- `type: brave`
- `type: tavily`
- `type: exa`

`extractProvider` supports:

- `type: none`
- `type: http`
- `type: tavily`
- `type: firecrawl`

Providers that require credentials reference environment variable names through
`apiKeyEnv`; secrets are not stored in config or emitted in diagnostics.

`~/.kiln/config.yaml` may define only `web.searchProvider` and
`web.extractProvider` as global provider defaults. It cannot define
`web.enabled`, `web.netPolicy`, or `web.allowedDomains`. Effective config may
inherit those providers, but a project must still grant web authority in
`.kiln/kiln.yaml`.

`kiln status` projects web diagnostics without executing network calls. Those
diagnostics are observability evidence only; they do not grant authority or
validate live provider credentials. When a provider is inherited from global
config, status labels it as global.

Configured options are passed into `createDefaultBuiltinToolSurface()` for CLI
MCP startup and into `createAttachedRuntimeBuiltinToolSurface()` for direct
provider sessions, GUI gateway startup, and TUI gateway startup.

## Consumer Contract

All current consumers must use the shared surface:

- CLI `kiln tools --mcp` constructs `DevToolsMcpServer` from the default core
  surface.
- Runtime-attached CLI, GUI, and TUI sessions use the attached core surface.
- GUI and TUI operator tools layer on top of the same configured surface.
- Web policy and search-provider configuration are resolved once from
  `KilnYaml.web`.
- MCP and SDK consumers receive projections of core-owned tools and metadata.

The guide-level operator workflow and tool examples live in
`docs/guides/tool-use.md`. Authority and execution boundaries live in
`tool-execution.md`.

## Verification Baseline

The completed developer-tool program was verified with focused tool tests,
runtime projection tests, CLI startup tests, MCP tests, `bun run typecheck`,
root tests, and root build before it was promoted from roadmap state into this
canonical architecture record.
