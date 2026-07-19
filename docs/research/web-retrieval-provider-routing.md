# Web Retrieval Provider Routing

Status: accepted

Evidence reviewed through: 2026-07-19

## Decision

Kiln does not designate one search vendor as universally authoritative. Search
is a provider-neutral intent routed through explicit provider capabilities and
validated against Kiln-owned postconditions. A configured primary provider may
be followed by ordered fallbacks when the prior attempt is incapable, fails in
transport, violates the requested domain boundary, returns no usable evidence,
or fails semantic temporal-evidence checks.

This keeps provider selection a retrieval-policy decision instead of allowing
vendor payloads to become truth. Domain authority, exact-date event consensus,
telemetry, and accept/abstain behavior remain in Core.

## Evidence

- *Equal Accuracy, Unequal Evidence* freezes one agent policy while changing
  only Brave, Tavily, and Firecrawl. Final accuracy is close, while snippet
  support, rank concentration, contradiction exposure, fetch behavior, tokens,
  and latency differ materially. The relevant abstraction is therefore the
  provider's evidence decision surface, not a single accuracy leaderboard:
  <https://arxiv.org/abs/2607.10198>.
- Tavily exposes topic, search depth, relative and absolute date filters,
  domains, country for general-topic search, exact quoted matching, usage,
  request id, response time, and result scores. These are adapter capabilities;
  they do not replace Core postconditions:
  <https://docs.tavily.com/documentation/api-reference/endpoint/search>.
- Brave separates general Web Search from News Search and documents custom
  freshness ranges, country/language targeting, exact query operators, and
  extra snippets. Kiln routes news intent to the news endpoint rather than
  pretending a vendor-neutral topic is a generic query flag:
  <https://api-dashboard.search.brave.com/documentation/services/web-search>
  and <https://api-dashboard.search.brave.com/app/documentation/news-search/get-started>.
- Exa exposes domain filters, publication date bounds, search-depth modes,
  research/news/financial categories, user location, request ids, and cost
  evidence. Kiln translates only supported neutral intent and preserves the
  returned evidence:
  <https://exa.ai/docs/reference/search>.
- Firecrawl's search surface can combine discovery and extraction, illustrating
  why search and full-page acquisition have different cost and evidence
  profiles. Kiln retains progressive search-then-extract primitives rather than
  forcing every query through full-page retrieval:
  <https://docs.firecrawl.dev/api-reference/endpoint/search>.

## Consequences

- `WebSearchIntent` is the stable Core contract. Vendor parameters remain in
  CLI adapters.
- `WebSearchProviderCapabilities` is checked before network execution. A
  capability claim is necessary but never sufficient for acceptance.
- Country and language targeting are routing preferences by default because
  agents may add them to improve relevance even when the user did not make
  them correctness requirements. Unsupported preferences are omitted from the
  provider request and recorded on the provider attempt. Callers that require
  exact targeting set `targetingRequired: true`; Kiln then rejects incapable
  providers before network execution.
- Returned URLs are normalized and checked against effective domains. An
  all-rejected result is `provider_contract_violation`, not successful empty
  search.
- Exact-date event claims require independent semantic consensus. A provider
  can be fresh and still produce rejected evidence.
- Exact-date discovery defaults to general search. Event dates are verified by
  semantic evidence and are not copied into publication filters. When the
  first discovery pass is insufficient, a typed recovery directive requests
  one materially broader pass followed by extraction, while preserving
  operator constraints and the temporal requirement. Runtime enforces at most
  one such recovery round before returning to fail-closed finalization.
- Attempt outcome, request id, duration, usage, effective parameters, provider
  rank, relevance score, and domain postcondition are preserved across events
  and operator presentation. Credentials and raw authorization headers are not.
- Provider changes are evaluated with the deterministic `web-retrieval-v1`
  scorer projected from governed result/attempt metadata: domain compliance,
  gold-URL recall, accept/abstain accuracy, source
  diversity, latency, and cost. Live collection is separately authorized.

## Rejected Alternatives

- Replacing Tavily globally with a hard-coded provider ranking. Available
  evidence does not support a universal winner, and rankings become stale.
- Trusting `include_domains` or equivalent provider inputs without validating
  returned URLs. Provider parameters are requests, not authority enforcement.
- Retrying through the generic tool retry layer. That loses provider-attempt
  identity and cannot distinguish transport, capability, contract, and evidence
  failures under one search intent.
- Preserving one-provider behavior through hidden compatibility shims. A single
  configured provider is simply a one-element governed route; fallback is an
  explicit ordered configuration.
