# Lifecycle Attribution

Kiln records lifecycle attribution as provider-neutral evidence over canonical
session events. The ledger explains where model-facing usage came from without
changing context admission, provider routing, provider request construction, or
task outcomes.

## Boundary

Provider-reported usage remains the billing source of truth. Lifecycle
attribution is a reconciliation layer over that usage, not a second cost meter.

Core owns:

- lifecycle source and token-class contracts;
- ledger summaries and provider-total reconciliation;
- deterministic replay from canonical evidence;
- failure semantics when claimed attribution exceeds provider totals.

Runtime owns:

- projection from admitted context-audit evidence to lifecycle allocations;
- final-output attribution when a bounded output estimate is available;
- canonical `lifecycle_attribution_recorded` session events;
- route capability evidence for managed-agent adapters.

Provider adapters, harness adapters, GUI, TUI, CLI, SDK, and replay surfaces do
not invent attribution locally. They consume canonical ledger records or
declared adapter capability gaps.

## Source Classes

Lifecycle sources are intentionally semantic, not provider-specific:

- control instructions;
- procedural context;
- memory;
- knowledge;
- coordination;
- transcript;
- repository evidence;
- web evidence;
- verification;
- tool schema;
- tool output;
- final output;
- unknown.

Runtime may allocate provider-input usage only from context blocks that were
admitted by `ContextGovernor` evidence. Deferred or rejected blocks remain
auditable context decisions but are not counted as provider-input attribution.
When estimated runtime allocations exceed provider totals, core collapses the
affected provider token class to `unknown` instead of proportionally rescaling
evidence. Provider-reported over-allocation remains invalid and fails fast.
Unknown attribution is a truthful remainder, not a failure.

## Replay And Neutrality

Lifecycle attribution is replayable from canonical records. Replay must
preserve provider totals, cost summaries, source totals, token classes, and
unknown remainders without requiring provider calls.

Emission is append-only after the provider request path. It must not:

- alter provider-facing messages, tools, model, or route;
- rerun context governance;
- affect turn outcome status;
- hide raw provider usage;
- convert estimates into provider-reported usage.

## Managed Routes

Managed-agent adapter descriptors declare usage capability explicitly:

- supported token classes: input, output, cache read, cache write;
- semantic source granularity: provider-reported, estimated, or unknown;
- evidence basis: provider, runtime, adapter, or unknown.

Direct runtime routes may expose estimated semantic source evidence from runtime
records. CLI and remote harness routes may expose only aggregate or partial
usage until their adapters prove richer evidence. If two routes cannot emit the
same lifecycle detail, the route gap is part of the canonical capability
evidence.

Provider-reported semantic granularity is allowed only when the evidence basis
is provider usage. Adapter or runtime estimates must remain labeled as
estimates.

## Benchmark Contract

Lifecycle attribution fixtures verify:

- provider total reconciliation;
- replay determinism;
- unknown remainders for unobservable usage;
- no fabricated precision when estimates are partial;
- cache read and cache write token-class reconciliation.

Runtime/gateway tests verify request and outcome neutrality. Managed-route
parity tests verify declared direct-versus-harness capability gaps.

These fixtures are internal quality gates. Public savings claims require later
roadmap slices to add comparable baseline and candidate runs with quality
evidence.
