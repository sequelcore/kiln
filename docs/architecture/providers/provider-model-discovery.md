# Provider Model Discovery

## Purpose

Provider model discovery is the runtime-owned evidence plane that tells
operator surfaces which provider/model routes were observed, which concrete
model IDs are eligible for a specific use, and why a provider or model route is
unavailable.

Discovery is not a fallback mechanism. Kiln must not invent static models or
silently choose a provider when runtime discovery cannot prove availability.
Credential availability comes from provider credential pools, but it is only
one input into eligibility. Execution also needs canonical config evidence,
authentication evidence, entitlement evidence when available, required
capabilities, catalog freshness, route health, policy admission, and a concrete
selected model where the provider requires one.

## Discovery Result

GUI, TUI, and direct CLI execution consume the same structured discovery
result:

- `provider`
- `available`
- `models`
- `status`
- `reason`
- `authState`
- `lastCheckedAt`
- `modelCapabilities`

Common statuses include:

- `available`
- `missing_auth`
- `auth_expired`
- `cli_missing`
- `endpoint_timeout`
- `endpoint_error`
- `empty_model_list`
- `model_version_unsupported`
- `daemon_unreachable`
- `model_selection_not_required`
- `stale`

The discovery result drives operator diagnostics and contributes catalog
observations to provider/model evidence. It is not, by itself, execution
authority. Surfaces may abbreviate the human-facing reason, but they must not
derive selectability from a different source.

`model_version_unsupported` means the harness or provider is installed and
authenticated enough to answer, but the selected or requested model requires a
newer provider binary, app channel, or compatible model surface. Surfaces must
present this as a model readiness/version action, not as a generic endpoint
failure or missing auth state.

## Eligibility Plane

Catalog observation is diagnostic evidence only. A provider, harness, service,
or local daemon may advertise hundreds of model IDs; Kiln preserves those raw
observations at the adapter boundary, normalizes them into provider-neutral
provider-model evidence, and still fails closed unless the canonical
eligibility derivation admits a concrete route for the requested use.

Canonical provider-model evidence keeps these concepts separate:

- provider identity: the provider family or service that owns the account,
  endpoint, or catalog
- harness identity: the local or remote harness that reported a route
- normalized model identity: provider-neutral family/version metadata
- provider route identity: the concrete provider/model/scope that execution
  would use
- credential/authentication evidence
- entitlement evidence when the provider can expose it
- freshness evidence for catalog observations
- route-health evidence for cooldown, quota, and transient failures
- policy admission for the use, such as interactive operation or managed-agent
  invocation
- final eligibility decision with reason codes

`@kilnai/core` owns the pure eligibility derivation. Runtime adapters supply
evidence and projections; CLI, GUI, TUI, SDK, widget, native, and studio
surfaces render the canonical projection. Operator surfaces may filter a
projection to show eligible routes first, but they must not invent local
eligibility rules, promote stale catalogs, or treat provider availability as a
model authorization shortcut.

Unknown, stale, partial, or failed evidence is visible diagnostic evidence and
fails closed. Authentication does not imply entitlement, entitlement does not
imply capability compatibility, capability compatibility does not imply route
health, and route health does not override policy admission.

## Runtime Caching

GUI and TUI use a shared runtime discovery cache with a short TTL and
in-flight request deduplication. Cold startup starts with an immediate
`pending` catalog snapshot and kicks forced discovery into the background after
the operator transport is listening. Startup, dashboard reads, and socket opens
must not block on CLI probes, remote model endpoints, or local daemons.

Local operator startup may also seed the runtime catalog from the project cache
at `.kiln/cache/provider-discovery.json`. That file stores only fresh discovery
snapshots produced by runtime discovery. On startup the cached entries are
projected as `status: stale`, `available: false`, and `authState: unknown`.
This makes prior provider diagnostics visible immediately while preserving the
same fail-closed execution contract.

While discovery is pending, surfaces may render the provider catalog as loading
or include locally known providers as pending selections, but they must not
claim runtime availability. Once discovery completes, subscribers receive the
authoritative catalog and the same snapshot updates GUI, TUI, and direct TUI
state. Normal dashboard reads, socket opens, provider switches, and prompt
admission then reuse fresh discovery results instead of re-probing every
provider on every turn.

Fresh background discovery replaces the stale projection and rewrites the
project cache. Stale startup projections are never written back as cache data
and are never authoritative route evidence.

Explicit refresh actions and completed provider-auth flows bypass the cache and
force a new discovery pass. This preserves operator correctness after login or
manual refresh while keeping ordinary chat turns from paying repeated CLI,
network, and local daemon discovery costs.

The cache is an optimization only. Prompt admission, provider switches, and
direct TUI execution call the provider catalog before mutating session routing
or admitting work. If the catalog is still pending, that operation awaits the
in-flight discovery; if discovery proves the provider/model unavailable, the
operation fails closed. Turn records keep the discovery evidence used for
admission.

If the only available startup evidence is `stale`, operator surfaces may show
the provider as pending/unavailable, but model selection, provider switching,
managed invocation route admission, and prompt execution must wait for or
require fresh runtime discovery. Static provider display metadata and stale
cache entries are diagnostics, not permission.

`kiln run --provider <provider> --model <model>` performs the same
fail-closed model admission before creating a provider session when runtime
discovery can validate that provider. Direct API providers require an explicit
selected model that is present in live runtime discovery. CLI wrapper providers
such as Codex and OpenCode may still run without an explicit model so their
native harness default remains authoritative, but an explicitly selected model
must be advertised by shared CLI discovery or pass a provider-owned live
readiness probe before execution starts. Stale static IDs and typos are
rejected before the chat/completions or wrapper request. Command-line
`--api-key` values participate in discovery for that process only, the same way
they participate in execution.

## Gateway And Operator Projection

Gateway frames project provider-model discovery through a canonical summary and
route entries. Each entry includes raw evidence summary, normalized model
identity, provider route identity, optional harness route identity,
credential/auth evidence, entitlement evidence, freshness, route health, policy
admission, final eligibility, and reason codes.

GUI and TUI provider pickers display diagnostic catalog counts and reason codes
from this projection. A large OpenCode, OpenRouter, direct-provider, Ollama, or
LM Studio catalog remains searchable and explainable, but only entries with
canonical `eligibility.eligible = true` are selectable. When the canonical
projection is absent for a modeled route, modeled selection fails closed
instead of falling back to provider display metadata or stale model arrays.

Model-less harness providers remain explicit model-less routes. They do not
receive fake model IDs and do not convert native ambient defaults into
provider/model authority. Native route integrity remains a separate evidence
plane for proving that a harness default matches Kiln's resolved route.

## Model Capabilities

When a provider exposes per-model capability metadata, discovery carries it
under `modelCapabilities[modelId]`. The capability record is advisory for UI
controls and strict for request shaping: operator surfaces may only expose
controls that discovery says the active model supports, and execution must send
the selected capability value through the normal turn request rather than
storing it in surface-local state.

Current capability fields include:

- `supportsFunctionTools`
- `supportsRuntimeTools`
- `supportsNativeShellTools`
- `supportsNativePatchTools`
- `supportsTools` (operator-surface compatibility projection of
  `supportsRuntimeTools`)
- `supportsParallelToolCalls`
- `contextWindow`
- `supportsVision`
- `deliberation` with provider/model identity, ordered native levels,
  provider default, adaptive support, and revisioned evidence
- `taskSuitability`

Tool-capability fields are intentionally split:

- `supportsFunctionTools` means the model endpoint can accept structured
  function/tool-call schemas.
- `supportsRuntimeTools` means Kiln may execute local runtime tools for that
  model through the canonical authority and execution path.
- `supportsNativeShellTools` and `supportsNativePatchTools` describe
  provider-native shell or patch affordances advertised by the provider. They
  are diagnostics and UI metadata; disabled native provider tools do not, by
  themselves, disable Kiln runtime tools.
- `supportsTools` is the aggregate operator-display signal; execution admission
  uses the specific capability fields above.

Execution admission must use `supportsFunctionTools` and `supportsRuntimeTools`
when present. It must not infer that Kiln tools are unavailable merely because
a provider-native shell or patch tool is disabled.

Deliberation level identifiers are provider-advertised portable strings, not a
closed cross-provider enum. Their ordering and meaning are scoped to the exact
provider/model capability record. Provider-native discovery fields such as
Codex `supported_reasoning_levels` are translated at this boundary while their
order and revision evidence are preserved.

If a model advertises no deliberation capabilities, surfaces render no level
selector and Runtime follows the intent's explicit unsupported policy. GUI and
TUI preserve provider default until the operator selects a level; they never
turn the first advertised level into an implicit override.

`deliberationPolicy` may declare default, task, and exact-route intents. Runtime
resolves the winning intent after route selection and records the capability
revision and outcome. Explicit operator input has higher authority; no adapter
accepts an unresolved raw level.

Virtual model-gateway routes that expose native reasoning controls must declare
`deliberation.levels`, optional `defaultLevel`, `supportsAdaptive`, and
`evidenceRevision`. Enabling `reasoning-controls` without that exact-route
evidence is invalid configuration, so an Anthropic-compatible `output_config`
cannot manufacture capability evidence at ingress.

## Task Suitability

Technical model capability is not the same as task suitability. A model may
support tools and still be a poor first choice for visual frontend design,
research synthesis, architecture review, or mechanical edits. Kiln represents
task suitability as explicit evidence, not as prompt folklore.

Canonical task suitability records use:

- `task`: one of `architecture-review`, `backend-coding`, `frontend-design`,
  `mechanical-edit`, `research`, or `test-writing`
- `level`: `preferred`, `capable`, or `limited`
- `source`: `static-profile`, `live-proof`, `operator-override`, or
  `evaluation`
- `reason`: short operator-facing explanation
- `recommendedSkills`: optional advisory skill ids that improve the route for
  that task when those skills are actually configured and admitted
- `evidence`: optional evidence rows with `source`, `status`, and `summary`

Static suitability belongs in `ModelCapabilityRegistry`. It is advisory and
must identify itself as `static-profile`. Operator and project overrides live
in `modelTaskSuitability` config entries and identify themselves as
`operator-override` after admission. An override supersedes static suitability
for the same provider/model/task but does not affect unrelated tasks. Live
harness proof and evaluation results append evidence rows to the same record
shape. A healthy managed route therefore carries one normalized view combining
static profile knowledge, first-party evaluation evidence, route live proof,
and operator overrides when present.

Recommended skills are not permissions. In the default `advisory` skill
selection mode, parent sessions may request a recommended skill only when it
appears in the admitted skill catalog or on the selected agent profile. When
`skills.selection.mode: auto` is configured, Kiln may admit the selected
route/task's recommended skills automatically, but only after the same skill
catalog admission check. Unknown recommended skills are skipped; unknown
explicitly requested skills fail closed.

Parent sessions and managed invocation tool descriptions may use task
suitability to choose among admitted routes. They must still respect route
health, provider availability, authority profile admission, configured agent
profiles, and skill admission. Suitability can choose between eligible routes;
it cannot make an unavailable or unauthorized route admissible.

CLI run uses the same evidence when `routing.routes` declares multiple
provider/model candidates and the operator has not passed an explicit
`--provider`. Kiln infers a coarse task from the selected agent profile first
and from the prompt text second, then ranks configured candidates by resolved
task suitability. Static profiles, live proof, and operator overrides are
merged before ranking. Operator overrides win ties at the same suitability
level because they are local routing policy. The original `routing.routes`
order remains the stable fallback order for unknown tasks, equal scores, and
models without suitability evidence.

## Provider Classes

Wrapper providers and direct providers use provider-specific discovery because
their failure modes differ.

Wrapper providers:

- `claude` discovers its authenticated model catalog through the Agent SDK
  control plane. Moving aliases remain unsuitable for exact managed-route
  admission. Per-model effort capabilities are retained only when the catalog
  reports ordered supported levels and are bound to the resolved Claude Code
  executable version
- `codex` discovers local Codex CLI models from the local Codex model surface
- `opencode` discovers local OpenCode CLI models from the OpenCode command
  surface. These model IDs are provider-prefixed exactly as OpenCode reports
  them, for example `opencode/minimax-m2.5-free` or
  `opencode-go/minimax-m2.5`.

Subscription-auth providers:

- `codex-oauth` discovers models from the OAuth-backed Codex model endpoint
- `opencode-go` and `opencode-zen` discover models from the authenticated
  OpenCode subscription tier. These are direct Kiln provider IDs and their
  selectable model IDs are the tier endpoint IDs without the harness prefix,
  for example `minimax-m2.5-free` for `opencode-zen`.

Direct API providers:

- `openai`, `anthropic`, `deepseek`, and `openrouter` discover models through
  provider model endpoints and filter to usable message/chat models where the
  response supports that distinction
- `ollama` discovers local models through the local daemon and distinguishes a
  daemon connection failure from an empty installed-model list

## Selection Rules

- no static model fallback lists
- no default-to-first-provider behavior
- no hidden default-to-first-model behavior
- unavailable providers are non-selectable for execution
- catalog membership alone never makes a model selectable
- stale, partial, or failed catalogs remain diagnostic and fail closed
- model-less providers are explicit and do not use fake model IDs
- prompt execution revalidates the active provider/model before admission
- provider switch errors and prompt execution errors use the same wording for
  the same readiness failure

If a provider has selectable models, execution requires a concrete selected
model ID. If no selected model exists, the canonical error wording is:

```text
Provider '<provider>' requires a selected model.
```

Native harness defaults follow the same fail-closed rule. A native harness may
have an ambient default, but Kiln does not treat that ambient selection as
canonical unless route integrity evidence shows it matches the resolved Kiln
provider/model. A valid explicit route probe outranks a bare native error when
classifying credentials. If the explicit probe succeeds but bare execution uses
a stale or unknown native model, the failure layer is route/default mismatch,
not invalid credential.

## Provider And Model Route Health

Discovery proves that a provider can advertise and admit a model. It does not
prove that the provider/model route is healthy for immediate execution. A route
may be discoverable and still be temporarily unusable because the upstream model
is rate-limited, quota-exhausted, overloaded, or connection-failing.

Kiln tracks route health at the provider/model boundary, separate from
credential health:

- credential health answers "which secret/account can be used?"
- provider/model route health answers "is this advertised execution route
  cooling down?"
- native route integrity answers "does the harness default actually select the
  canonical provider/model?"

These layers must remain separate in diagnostics. `authentication-failure` and
`authorization-failure` are credential/account results for a catalog-valid
explicit route. `unknown-model`, `unavailable-route`, and `stale-catalog` are
provider/model or catalog results. `projection-drift` and
`ambient-fallback-mismatch` are native configuration results. A diagnostic may
carry more than one evidence field, but it must name the layer that failed
first and must not relabel a route or projection problem as an invalid API key.

Execution surfaces must consult both before admitting work. Retryable route
outcomes such as `rate-limited`, `quota-exceeded`, and `connection-failed`
place the provider/model route in cooldown. A selected route in cooldown is not
healthy just because discovery still lists the model.

When `routing.routes` declares ordered execution candidates, discovery and
route health are admission gates for each direct provider/model candidate.
Unhealthy direct routes are skipped before the runtime loop starts; healthy
fallback candidates remain eligible. Explicit one-off provider/model requests
are not silently widened into unrelated providers.

For OpenRouter free capacity, model-specific `:free` routes are volatile
candidates. `openrouter/free` is the stable free router because OpenRouter
selects an available free model at request time. Kiln must not hardcode a
single `:free` model as a durable fallback. If a specific free model is
rate-limited, route health should cool that model down and routing should prefer
another healthy candidate or `openrouter/free` when policy allows it.

## Operator UX

Provider pickers show concise unavailable reasons while preserving structured
diagnostics in the runtime result. Examples:

- missing API keys or credentials become "Auth is missing."
- local daemon or connection failures become "Local service is unreachable."
- empty catalogs become "No models found."
- failed model endpoints become "Model endpoint failed."

GUI and TUI expose provider refresh without restarting the process. Refresh
re-runs runtime discovery, updates the selectable model catalog, and leaves the
current operator session alive.

Deliberation is shown next to provider/model selection when the active model
advertises ordered levels. GUI renders it as a compact composer control; TUI
cycles provider default and explicit levels with `/deliberation`. Both surfaces
send only an explicit selection on the next turn.

## Turn Records

Live prompt admission records provider validation provider-by-provider in the
runtime turn record. This preserves the evidence used to admit or reject a turn
and makes post-hoc diagnosis possible without replaying discovery.

## Invariants

Provider/model discovery can provide a context-window denominator for partial
operator evidence, but discovery authority or freshness never makes a context
measurement authoritative. Only a matching provider-reported context window
does so. See [Context Usage Projection](../context/context-usage-projection.md).

- discovery is runtime-owned
- execution uses the same canonical eligibility truth shown to the operator
- diagnostics are provider-specific and fail closed
- model IDs passed to execution are concrete provider model IDs
- local providers do not imply cloud auth or remote model availability
- unavailable reasons are actionable, not generic placeholders
- live provider probes, credential use, quota consumption, and paid inference
  are never claimed unless explicitly authorized and executed as live evidence

## Related

- [Provider Credential Pools](../safety/provider-credential-pools.md)
