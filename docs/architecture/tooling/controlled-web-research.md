# Controlled Web Research

## Status

This is the canonical architecture record for governed external web knowledge
acquisition as of 2026-05-08.

## Thesis

Kiln is not a search provider, crawler vendor, or hosted research product.
Kiln is the control plane that governs how autonomous sessions acquire external
knowledge through providers, tools, policy, evidence, budgets, and operator
surfaces.

The product distinction is:

- `web_search`, `web_fetch`, and `web_extract` are low-level read-only web
  primitives.
- `web_research` is a future governed capability built from primitives,
  provider-native web tools, artifacts, citations, and source ledgers.
- Search, extraction, crawl, and browser providers are adapters, not domain
  owners.

This follows the same control-plane contract as other external actions:
authority resolution, rate-limit evaluation, sandbox validation, execution,
result sanitization, and reinjection.

## Competitive Baseline

Current market patterns split into three categories:

- Lab-native web tools. OpenAI, Anthropic, and Gemini expose server-side web
  tools where the model decides when to search and the provider returns sources
  or citations. Kiln may route through these when a provider profile supports
  them, but the result still has to become Kiln evidence.
- Retrieval providers. Tavily, Exa, Firecrawl, Brave, SearXNG, and similar
  services provide search, extract, crawl, or interaction primitives. Kiln
  adapts these behind explicit provider contracts.
- Browser agents and research agents. Systems such as deep research products,
  BrowseComp-style evaluation targets, WebArena, and WebVoyager treat research
  as a multi-step loop: plan, search, open, extract, compare, cite, and stop
  under budget.

The architectural lesson is that research is not a single provider payload.
Research is a governed loop over evidence-producing primitives.

## Current Contract

`KilnYaml.web` controls project web authority for every surface:

- `enabled`
- `netPolicy`
- `allowedDomains`
- `searchProvider`
- `searchFallbackProviders`
- `extractProvider`

Global config may provide only reusable web provider defaults:

- `web.searchProvider`
- `web.searchFallbackProviders`
- `web.extractProvider`

It may not provide authority fields such as `enabled`, `netPolicy`, or
`allowedDomains`. Provider capability is global; network authority is local to
the resolved project. This mirrors the security boundary used by other Kiln
external actions: an adapter can be available without being authorized for a
given repo.

Absent or incomplete configuration remains fail-closed:

- disabled web config does not expose configured web access
- missing network policy is reported as `network_policy_missing`
- denied domains are reported as `domain_denied` or `network_denied`
- missing search or extraction provider is reported as `provider_not_configured`
- provider transport failures remain tool errors with web metadata
- empty extraction responses are reported as `empty_extraction` instead of
  ambiguous successful zero-page results

Search provider adapters currently normalize provider-specific payloads into
the canonical `WebSearchProviderResponse` source shape:

- `http`
- `searxng`
- `brave`
- `tavily`
- `exa`

Search execution is provider-neutral and capability-aware. The caller declares
topic, quality, freshness, date-range, country, language, exact-phrase, domain,
and temporal-evidence requirements. Core rejects incapable providers before a
network call, validates returned URLs against the effective domain boundary,
and advances through `searchFallbackProviders` only for observable retrieval
failure: capability mismatch, transport failure, contract violation, empty
results, or rejected temporal evidence. Provider request ids, duration, usage,
effective parameters, attempts, relevance scores, and domain postconditions are
preserved as evidence without exposing credentials.

Exact-date event research uses a bounded progressive protocol over those
primitives:

1. discover broadly with event identities and the event date;
2. verify snippets against `temporalRequirement`;
3. if evidence is insufficient, broaden only constraints introduced by the
   agent while preserving operator constraints and network authority;
4. extract the strongest candidate pages with the same temporal requirement;
5. synthesize only after independent evidence is accepted.

Publication filters are deliberately separate from event semantics.
`startDate`, `endDate`, `recencyDays`, and `freshnessRequired` constrain or
prove publication recency; they must not be derived automatically from the
event date. Domain allowlists remain hard authority boundaries. When temporal
search evidence is insufficient, Core emits a typed progressive-research
recovery directive rather than misclassifying the provider as unavailable.
Runtime consumes that directive once per turn: if the model tries to stop
before accepted evidence exists, it requests one broader search round and then
returns to the normal evidence guard. The bound prevents open-ended retries.

Provider comparisons use the deterministic `web-retrieval-v1` benchmark over
observations projected from governed search metadata, including fallback
attempts and rejected provider URLs. It reports domain compliance, gold-URL recall,
accept/abstain decision accuracy, source diversity, latency, and cost. Live
provider calls remain a separately authorized data-collection step; benchmark
scoring itself is reproducible and offline.

Extraction provider adapters currently normalize provider-specific payloads
into the canonical `WebExtractProviderResponse` page shape:

- `http`
- `tavily`
- `firecrawl`

Provider credentials are referenced by environment variable names in config.
Secrets must not be stored in YAML, docs, events, metadata, or diagnostics.

## Diagnostics

Operator diagnostics must make configuration state visible without executing
network calls.

`kiln status` projects:

- whether web access is enabled
- effective network policy
- allowed domains
- configured search provider type
- configured extraction provider type
- provider origin when it is inherited from global config or declared by the
  project
- configuration issues such as disabled web, missing network policy, or missing
  search provider

Diagnostics are sensors, not authority. They do not grant network access,
validate live provider credentials, or bypass tool execution.

## Current Primitive: `web_extract`

`web_extract` is implemented as the extraction primitive before `web_research`.
It:

- accept one or more HTTP(S) URLs
- reuses the same explicit web network policy model as `web_fetch`
- normalize page content to clean text or markdown
- preserve source URL, final URL, content type, status, bytes, truncation, and
  extraction provider metadata
- supports provider-backed extraction adapters without moving scraping logic into
  core

Current adapters are `http`, `tavily`, and `firecrawl`. Future candidates can
include Exa, Parallel, and a bounded native HTML-to-text fallback only if they
respect the existing web authority, budget, and metadata contract.

## Current Primitive: Browser And Computer Use Contracts

`browser_*` and `computer_*` are implemented as interactive automation
contracts before a full provider-backed runtime ships. They are cross-surface
developer tools, not GUI-only controls and not substitutes for `web_search`.

They exist for cases where source acquisition requires stateful interaction,
authenticated pages, visual inspection, JavaScript execution, repro capture,
or desktop automation. Search, fetch, and extraction remain the preferred
read-only primitives when a task only needs source discovery or page text.
Future `web_research` may compose interactive browser sessions, but every
browser or computer action must still route through normal authority,
approval, audit, artifact, and metadata contracts.

## Future Capability: `web_research`

`web_research` must not be implemented as a hidden network shortcut.

It should be a governed composite capability with:

- query planning
- search fanout through configured providers or provider-native web tools
- source ranking and deduplication
- fetch/extract steps
- optional browser interaction only when provider-backed primitives cannot
  obtain the needed source evidence
- source ledger with citations
- resource-linked artifacts under `kiln://artifacts/research/...`
- token, call, time, domain, and provider budgets
- progress and final evidence events
- clear stop conditions and bounded retries

Every external subaction must route through canonical tool authority and emit
ordinary tool evidence. The final research answer is a synthesis over recorded
sources, not a replacement for source evidence.

## Future Capability: PDF And Binary Source Extraction

PDF handling is intentionally not folded into text `web_fetch`. The next clean
slice is a binary artifact path:

- fetch allowed PDF or other binary source into a bounded artifact
- preserve URL, content type, byte count, hash, and redirect evidence
- extract text from that artifact through a PDF parser, and optionally OCR for
  scanned documents
- emit extraction metadata and warnings distinct from network fetch metadata

This keeps network authority, artifact retention, parser failures, and OCR cost
separate. It also gives agents a reliable fallback when a web extraction
provider confirms a reachable PDF but returns no extractable pages.

## Surface Contract

CLI, GUI, TUI, SDK, widget, MCP, and direct-provider sessions must consume the
same configured web surface.

Surfaces may render diagnostics, sources, citations, and artifacts differently,
but they must not:

- duplicate search-provider execution
- create private web policy evaluators
- hide failed web steps from audit
- inject raw high-volume web content when a resource link is available

## Deferred Packaging: OS Packs

OS packs are a future packaging concern, not a prerequisite for governed web
research.

Potential OS-pack work may include vendored helper binaries or platform-specific
dependencies for extraction, browser automation, certificate handling, or
network diagnostics. That work must stay under the developer-tool packaging
boundary and must not change web authority, policy, metadata, or provider
contracts.
