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
- browser automation
- computer automation
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
- `interactive`: browser and desktop automation evidence for `browser_*` and
  `computer_*`

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
paths and requires a resolved native `rg` runtime; it reports runtime source,
path, and version metadata instead of silently degrading to a TypeScript scanner.
Broad `grep` searches are bounded at the native runtime boundary: Kiln passes
`rg` max-match, max-filesize, and nuisance-directory excludes before execution,
then still shapes returned output as a second guard. Do not rely on
post-processing alone to make repository-wide search safe for model-visible
tool calls.
`glob` supports brace alternates such as `**/*.{ts,tsx,css}` and normalizes that
pattern before either the native `fd` fast path or fallback walker runs, so GUI,
TUI, CLI, MCP, and managed-agent routes do not disagree about file discovery.

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
already controls match shape. `grep.matchMode` separately controls pattern
semantics: `auto`, `regex`, or `literal`.

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

## Interactive Browser And Computer Tools

`browser_session_start`, `browser_navigate`, `browser_observe`,
`browser_click`, `browser_type`, `browser_keypress`, `browser_scroll`,
`browser_session_stop`, `computer_observe`, `computer_click`, `computer_type`,
`computer_keypress`, `computer_open_application`,
`computer_focus_application`, `computer_minimize_application`, and
`computer_close_application` are cross-surface core developer tools. They
project through the canonical builtin surface, emit shared `interactive`
metadata, and fail closed unless a runtime surface injects an interactive-use
provider.

Browser tools target isolated browser sessions for QA, debugging,
documentation flows, and web app automation. Computer tools target a governed
desktop surface for OS-level automation. Both are action capabilities, not GUI
features. GUI renders browser use as a dynamic workbench tab when a browser
session exists; it is not a permanent primary sidebar destination. CLI/TUI may
render artifacts and compact status, and MCP consumers may receive the same
tool contracts, but execution still routes through the shared registry,
authority, approval, audit, and sanitization path.

Interactive metadata records target, operation, provider, session id,
observation evidence, artifact URIs, timeout, sensitivity, and approval hints.
Type actions record text length and sensitivity, never typed text. Observation
tools are read-only/idempotent; click, type, keypress, scroll, navigate,
session-start, session-stop, and application lifecycle operations are
destructive because they can mutate remote state or local UI state.

Browser use is not a replacement for `web_search`. Search/fetch/extract remain
read-only source-acquisition primitives with provider and network-policy
contracts. Browser automation is the correct substrate when the task needs
stateful interaction, authentication, visual inspection, JavaScript execution,
or repro/QA artifacts. Future governed research may compose both families, but
every external subaction must still emit ordinary tool evidence.

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

## Interactive Use Configuration

Project `KilnYaml.interactiveUse` declares browser and computer automation
authority once for every consumer. It does not configure global provider
defaults and it does not grant web search authority.

Stable fields:

- `enabled`
- `allowedDomains`
- `allowedApplications`
- `allowExternalBrowser`
- `allowComputer`
- `browserProvider`
- `computerProvider`
- `browserEnvironment`
- `computerEnvironment`

`browserProvider` currently accepts `none` or `playwright`. `computerProvider`
currently accepts `none`, `windows`, or `windows-uia`. These are runtime
provider selections; core still fails closed unless a surface injects the
matching provider. CLI, TUI, GUI, tools MCP, and benchmark sessions project
configured interactive providers into the shared builtin tool surface.

`browserEnvironment` declares whether browser automation is allowed to affect
the operator's visible desktop. The default and recommended value is
`isolated-headless`: Kiln launches an isolated Playwright browser context in
the background and rejects prompt-supplied attempts to switch the session to a
visible headed browser. `isolated-headed` is an explicit debugging mode for
visible browser windows. This field is policy, not a model hint.

`computerEnvironment` currently accepts only `local-active-desktop`. That name
is intentionally narrow: local Windows computer providers act against the
operator's current interactive desktop. They may use semantic UI Automation or
low-level pointer/keyboard primitives, but they are not a hidden background
desktop. Real background desktop automation requires a separate isolated
environment such as a VM, remote Windows worker, or cloud browser/computer
session, which must be added as a distinct provider/environment rather than
pretending the local desktop can be safely used invisibly.

The Playwright browser provider lives in `@kilnai/runtime` and loads
`playwright` as an optional peer dependency. If a runtime host enables
`interactiveUse.browserProvider: playwright` without installing the optional
peer and a browser binary, the provider must return a setup error that names
both required steps:

```bash
bun add -d playwright
bun x playwright install chromium
```

On Windows when the runtime host itself runs on Bun, the Playwright provider
executes browser automation through a persistent Node sidecar. This keeps Kiln's
main runtime on Bun while using Playwright in the runtime it supports reliably
on Windows. The sidecar is an implementation detail of `@kilnai/runtime`; it
does not change tool schemas, config authority, session ids, or metadata.

Browser observations that include screenshots must store the image in the
session artifact resource plane and expose a `kiln://artifacts/.../content`
URI. Transcript metadata may carry the screenshot URI and resource link, but it
must not persist large `data:image/...` payloads when an artifact store is
available. Providers may use inline data URLs internally as a transport detail;
the shared tool layer materializes them before transcript projection.

Operator surfaces should render screenshot evidence in the transcript beside
the tool call that produced it. GUI should present browser screenshots as a
numbered gallery attached to the tool-call row, with labels that remain stable
when a persisted session is replayed. TUI, CLI, SDK, and widget consumers may
render the same evidence as numbered resource links. The sequence and resource
metadata belong in shared presentation contracts, not in GUI-only state.

GUI may also resolve the latest screenshot artifact URI through the runtime
resource plane for display in the dynamic Browser tab. That tab is a focused
snapshot projection of the governed browser session, not the only inspection
path. The product embedded browser viewport is native-only in `@kilnai/native`
because the real host is an Electron child view, not a web React component.

Browser session state is runtime-owned. Gateway frames may project
`browser_session_updated`, `browser_live_viewport_frame`,
`browser_session_control`, `browser_operator_input`, and
`browser_operator_input_ack`, but those frames do not transfer browser
authority to GUI. GUI sends typed operator intents such as pointer, wheel,
text, or key input; runtime validates session identity, ownership, provider
state, policy, and viewport bounds before dispatching through the active
provider. While ownership is `operator`, agent browser mutations fail closed.
Release returns ownership to the agent only after the provider captures a fresh
artifact-backed observation.

Browser viewport projections use explicit transport labels. `snapshot-polling`
means artifact-backed observation or monitor frames. `cdp-screencast` means a
local Chromium frame stream produced through Playwright/Chrome DevTools
Protocol. `electron-webcontents` means a native Electron `WebContentsView`
embedded browser host with real in-app operator control. Future transports such
as `webrtc` or `hosted-url` must also be represented as transport evidence
rather than hidden behind a generic "live" label. Snapshot polling and CDP
screencast are useful monitor and diagnostic transports; they are not a real
embedded browser. The accepted product embedded browser surface lives in
`@kilnai/native` and projects the same ownership, input, and evidence model.

Operator browser evidence is sanitized. Takeover, release, and input
acknowledgement events may be persisted as session evidence, but raw text input
must not be stored in transcript payloads. Text input evidence records length
and acknowledgement status, while durable replay relies on observation
artifacts, transport labels, ownership transitions, input summaries, and
recording or trace resources.

Agents should call `browser_session_stop` before their final answer for one-off
browser tasks. Runtime providers also enforce an idle-session TTL as a cleanup
backstop so forgotten Playwright sessions do not accumulate, while explicit
session stop remains the preferred lifecycle signal. The Windows+Bun sidecar
exits once no browser sessions remain and is recreated on demand.

`allowedDomains` scopes browser automation. `allowExternalBrowser: true` is an
explicit escape hatch for attaching to an operator-controlled browser instead
of a project-scoped isolated session. `allowComputer: true` plus
`allowedApplications` scopes computer automation to named applications or
windows.

Computer use should target explicit allowed applications instead of depending
on whatever window happens to be active. Providers that can focus windows
should use the request's `application` and optional `windowTitle` to
open/focus/minimize/close an allowed app, then report the observed result.
Graceful close is the default; force-kill behavior must remain a separate
future policy, not an implicit `computer_close_application` fallback.

`kiln status` projects interactive-use diagnostics without launching browsers,
observing the desktop, or validating live provider availability. Diagnostics
are observability evidence only; they do not grant action authority.

The `windows` computer provider lives in `@kilnai/runtime` and loads
`@nut-tree/nut-js` as an optional peer dependency for low-level pointer,
keyboard, screen, and window automation. If a runtime host enables
`interactiveUse.computerProvider: windows`, the provider must still enforce
`interactiveUse.allowComputer: true` and `interactiveUse.allowedApplications`
before native automation runs. Runtime hosts must also provide a trusted active
application resolver; model-supplied `application` fields are display intent,
not authority evidence. Missing setup must produce this operator-facing command:

```bash
bun add -d @nut-tree/nut-js
```

The `windows-uia` computer provider is the semantic Microsoft UI Automation
provider. It invokes Kiln's owned `kiln-windows-uia.exe` sidecar over JSON
stdin/stdout; the sidecar is the only runtime component that touches native
`IUIAutomation`. The TypeScript runtime derives the active window from Windows
UIA focus ancestry before checking `allowedApplications` when no explicit
target app is provided. `interactiveUse.applicationAliases` maps localized or
human app names to canonical `allowedApplications` entries before native
automation runs, so adding apps such as Blender, Notepad, or video editors is a
configuration concern unless an app-specific adapter is explicitly introduced.
When `application` or `windowTitle` is provided, the runtime validates that
requested target against `allowedApplications` before the sidecar opens,
focuses, minimizes, or closes the window. The provider exposes the accessibility
tree through `computer_observe` when `includeAccessibility` is set, and executes
semantic targets through UIA patterns such as `InvokePattern` and
`ValuePattern`. Accessibility-tree refs such as `#plusButton`, `.RichEditD2DPT`,
and copied lines such as `documento "Editor de texto" .RichEditD2DPT` are
normalized to structured UIA selectors before the sidecar receives them.
`computer_type` uses `ValuePattern` when available; if the semantically selected
target lacks `ValuePattern`, the sidecar focuses that UIA element and sends
Unicode text through native Windows input. A click must invoke a supported UIA
pattern or fail; the sidecar must not report success after only focusing an
element. It does not
treat coordinates as authority evidence or as a physical pointer transport;
coordinate-only mouse/keyboard work remains owned by the `windows` provider.
Focusing the Kiln operator window is self-authority for returning control to
the user when `allowComputer` is enabled; closing or otherwise automating Kiln
still requires explicit application policy. Graceful close captures the target
window identity, asks UIA `WindowPattern.Close()` first, falls back to bounded
Win32 close messages, verifies the requested window closed, and reports the
requested target rather than whatever window becomes active after close. Close
metadata includes `closeMethod` (`uia-window-pattern`, `win32-sc-close`,
`win32-wm-close`, or `win32-post-message`) so fallback use is visible in tool
evidence instead of hidden behind a generic success result.
Missing setup must produce this operator-facing command:

```bash
packages\runtime\native\windows-uia\build.cmd
```

The runtime also honors `KILN_WINDOWS_UIA_HELPER` when the built sidecar lives
outside the package's default `native/windows-uia/bin` location. Typed text is
sent through stdin JSON, not process arguments, so it is not exposed through
process-list inspection.

## Consumer Contract

All current consumers must use the shared surface:

- CLI `kiln tools --mcp` constructs `DevToolsMcpServer` from the default core
  surface.
- Runtime-attached CLI, GUI, and TUI sessions use the attached core surface.
- GUI and TUI operator tools layer on top of the same configured surface.
- Web policy and search-provider configuration are resolved once from
  `KilnYaml.web`.
- Browser and computer use providers are injected into the same configured
  core surface by runtime adapters; consumers do not own private automation
  registries.
- MCP and SDK consumers receive projections of core-owned tools and metadata.

The guide-level operator workflow and tool examples live in
`docs/guides/tool-use.md`. Authority and execution boundaries live in
`tool-execution.md`.

## Verification Baseline

The completed developer-tool program was verified with focused tool tests,
runtime projection tests, CLI startup tests, MCP tests, `bun run typecheck`,
root tests, and root build before it was promoted from roadmap state into this
canonical architecture record.
