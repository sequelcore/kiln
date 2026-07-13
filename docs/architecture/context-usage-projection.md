# Context Usage Projection

Kiln context usage is a per-turn operator projection of the occupied input
context for the route that actually completed the request. It is not billing,
the historical transcript length, output budget, reasoning-token total, or a
prediction of the next request.

## Ownership And Transport

Core owns the provider-neutral semantic shape and canonical
`context_usage_observed` session event. Runtime is the only normalization
owner: it accepts raw adapter evidence, binds it to the producing
provider/model/request/turn, and appends the completed-turn event. Core never
receives provider-specific cache arithmetic from an operator surface.

`@kilnai/gateway-contracts` intentionally remains a standalone wire package.
It mirrors the serializable DTO and validates it, while Runtime owns the one
explicit Core-to-Gateway mapper. Conformance tests require the mapper output to
parse under the wire schema; neither Gateway nor a surface may reclassify
authority.

GUI and TUI receive the event through the existing session stream. CLI uses the
same projection in its session report and optional structured output. The
projection is persisted with the canonical event so replay and restored-session
views reuse the original observation rather than contacting a provider.

## States And Lifecycle

`state` is one of:

- `unavailable`: no compatible, trustworthy measurement can form a ratio. It
  never includes ratio fields or a fabricated percentage.
- `partial`: useful evidence exists, but it is estimated, streaming,
  stale/inferred/runtime-observed, or otherwise not authoritative. A displayed
  percentage is still bounded and mathematically derived when both values are
  present; the state remains visibly partial.
- `authoritative`: only completion-time provider-reported input usage paired
  with a fresh provider-reported context window for the identical provider and
  model route.

`lifecycle` is `streaming`, `completed`, or `restored`. A restored measurement
is always `freshness: historical`; it preserves the persisted state, source,
ratio, observation time, and route but never appears live. A restored
authoritative observation therefore describes the authority of its original
measurement, not present provider freshness.

The normalizer validates non-negative integer token values, a non-zero window,
matching provider/model identity, bounded percentage, and remaining-token
arithmetic. Missing, stale, inferred, unknown, or mismatched denominator
evidence fails closed. Usage above a reported window is bounded at 100 percent,
has zero remaining tokens, and carries an explicit caveat.

## Provider Evidence

Adapters declare cache semantics with raw usage evidence. OpenAI/Codex reports
cached tokens as a breakdown of input tokens, so Runtime uses `input_tokens`
without adding the cached field. OpenAI documents cached tokens in the input
breakdown and describes input usage as including cached tokens.
[OpenAI Responses usage reference](https://platform.openai.com/docs/api-reference/responses/object).

Anthropic cache-read and cache-write input are separate input categories, so
the Anthropic adapter marks them additive and Runtime adds them to uncached
input only for that declared semantic. The adapter owns this distinction; there
is no provider-name branch or generic cache sum in a surface. See Anthropic's
[prompt-caching usage fields](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#tracking-cache-performance).

Output and reasoning tokens are never added to occupied input context unless a
specific adapter has authoritative evidence to state otherwise. Provider
completion is the only provider-neutral authoritative lifecycle. Model catalog
or capability discovery may supply a denominator for partial evidence, but it
cannot promote it to authoritative context-window evidence.

## Attribution, Retry, And Child Isolation

Each provider request records the route that produced it. Runtime chooses the
last completed request evidence for a turn, so retry and fallback projections
use the successful provider/model rather than the initially selected route.
Provider/model window mismatch produces `unavailable` instead of crossing
routes. Managed-child usage has its own session/turn evidence and is not merged
into a parent turn's context measurement.

Compaction or summarization does not make the transcript a prompt proxy. When
Kiln has an explicit compaction or summary boundary it records the caveat; it
does not estimate context from characters or issue a provider call solely for
this projection.

## Surface Rules

GUI renders a compact circular composer control: a percentage only when a
ratio exists, `P` for partial, an em dash for unavailable, and `H` for restored
historical evidence. Its accessible name and tooltip carry the same textual
evidence, and it remains keyboard focusable and reduced-motion safe.

TUI renders the shared formatted value in its existing turns/tokens sidebar
status. CLI adds it only to an existing human session report and an optional
structured output field. Exact-answer and benchmark output paths do not gain a
new human line. No surface calculates a percentage, chooses cache semantics, or
upgrades freshness locally.
