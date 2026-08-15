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
route configuration with a model where the provider requires one.

## Discovery Result

Runtime consumes the structured discovery result below to derive execution-route
availability and diagnostics. GUI and TUI may render it as evidence, but select
only from the separate execution-route catalog:

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

The discovery result drives operator diagnostics and contributes observations to
provider/model evidence. It is not execution authority. An operator surface
selects a configured execution target by target ID; Runtime derives provider,
model, account, and credential evidence after that intent. Surfaces may
abbreviate the human-facing reason, but they must not derive route selectability
from a different source.

## Available models and route creation

The Available Models projection is a shared, secret-free view of discovery
evidence plus whether a configured execution target currently references a model.
GUI, TUI, and CLI render the same projection for diagnosis and route-creation
starting points. It is intentionally separate from the execution picker.

Selecting an available model produces an incomplete typed route draft. Runtime
will not turn discovery metadata into an executable route: the operator must
provide the data classification and current data-policy evidence, account
selection, economic policy, and other route authority fields. Canonical route
creation uses the revision-fenced global-config mutation owner, validates the
whole execution catalog atomically, and then refreshes projections. A stale
revision, missing material field, or contradictory evidence fails closed.

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
- provider route identity: the concrete provider/model/scope that an admitted
  execution target may use as derived evidence
- credential/authentication evidence
- entitlement evidence when the provider can expose it
- freshness evidence for catalog observations
- route-health evidence for cooldown, quota, and transient failures
- policy admission for the use, such as interactive operation or managed-agent
  invocation
- final eligibility decision with reason codes

`@kilnai/core` owns the pure eligibility derivation. Runtime adapters supply
evidence and projections; CLI, GUI, TUI, SDK, widget, and native
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

While discovery is pending, surfaces may render the execution-route catalog as
loading or unresolved, but they must not claim runtime availability. Configured
routes remain visible so the operator can see the route's reason and repair
action. Once discovery completes, subscribers receive fresh evidence and the
same snapshot updates GUI and TUI route availability. Normal dashboard reads,
socket opens, execution-route selection, and prompt admission then reuse fresh
discovery results instead of re-probing every provider on every turn.

Fresh background discovery replaces the stale projection and rewrites the
project cache. Stale startup projections are never written back as cache data
and are never authoritative route evidence.

Explicit refresh actions and completed provider-auth flows bypass the cache and
force a new discovery pass. This preserves operator correctness after login or
manual refresh while keeping ordinary chat turns from paying repeated CLI,
network, and local daemon discovery costs.

A successful provider-auth completion also carries the freshly projected
`ExecutionRouteCatalog`. GUI and TUI replace their picker catalog from that
completion rather than retaining pre-auth route availability.

The cache is an optimization only. Prompt admission and execution-route
selection consult fresh evidence before changing session routing or admitting
work. If evidence is still pending, that operation waits; if it proves a route's
derived provider/model unavailable, the operation fails closed. Turn records
keep the discovery evidence used for admission.

If the only available startup evidence is `stale`, operator surfaces may show
the configured route as unresolved or unavailable, but execution-route
selection, managed invocation route admission, and prompt execution must wait
for or require fresh runtime discovery. Static provider display metadata and
stale cache entries are diagnostics, not permission.

`kiln run` admits the configured execution target before dispatch begins.
`--target <id>` narrows that configured catalog; provider, model, and
API-key command-line overrides are rejected. Discovery validates the selected
target's provider/model evidence and current configured account candidates, but
cannot choose a credential or widen the route authority.

## Gateway And Operator Projection

Gateway frames project provider-model discovery as diagnostic evidence and
projects the global target catalog separately as the operator selection
contract. Each configured catalog entry has target ID, label, availability, reason codes,
repair actions, account-selection summary, and derived provider/model evidence.
Configured routes remain in the catalog even when Runtime cannot admit them.

GUI and TUI target pickers select only catalog target IDs. Commands carry
`targetId` and, only for an automatic direct target, an eligible
`accountOverrideId`. Provider
and model identifiers on frames are derived evidence, never alternate selection
inputs. Authentication remains a provider-scoped repair action. Its successful
completion returns refreshed route evidence, and no frame or catalog entry
exposes a credential ID or credential material.

## Configuration And Surface Selection

`targetCatalog` is durable global configuration. It defines each target's
stable ID and, for direct targets, provider/model attributes and exact or
automatic account policy. `targetRouting.defaultTargetId` supplies the normal
startup default, while `ui.targetSelection` can persist a surface target and
eligible account alias override. Both are target references, never
provider/model or credential
selection fields.

Runtime projects that configuration plus fresh availability into
`ExecutionRouteCatalog`. GUI and TUI render and select from that runtime
projection; they do not expose the YAML account-to-credential binding or turn
provider/model display evidence into a second selector.

Model-less harness providers remain explicit model-less routes. They do not
receive fake model IDs and do not convert native ambient defaults into
provider/model authority. Native route integrity remains a separate evidence
plane for proving that a harness default matches Kiln's resolved route.

## Model Capabilities

When a provider exposes per-model capability metadata, discovery carries it
under `modelCapabilities[modelId]`. The capability record is advisory for UI
controls and strict for request shaping: operator surfaces may only expose
controls that discovery says the selected route's derived model supports, and
execution must send the selected capability value through the normal turn
request rather than storing it in surface-local state.

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

If a selected route's derived model advertises no deliberation capabilities,
surfaces render no level selector and Runtime follows the intent's explicit
unsupported policy. GUI and TUI preserve the provider default until the operator
selects a level; they never turn the first advertised level into an implicit
override.

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

The `research` task describes whether a route can perform research synthesis;
it does not identify where evidence must come from. Procedural selection is an
orthogonal work-classification decision: repository evidence maps to
`codebase-scouting`, external or provided evidence maps to
`research-workflow`, mixed evidence maps to both, and missing scope maps to
neither.

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

CLI run uses discovery only to validate the selected execution target. It does
not turn task suitability or stale provider/model evidence into an unconfigured
routing graph. Automatic account selection remains the catalog policy after
route admission.

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
- `opencode` resolves one exact OpenCode CLI executable and version, starts its
  loopback model service, and reads the structured, account-visible
  `/api/model` catalog. Model IDs remain provider-prefixed exactly as OpenCode
  reports them, for example `opencode/minimax-m2.5-free`. Deliberation is
  projected only for enabled exact models whose canonical variant IDs match
  recognized reasoning semantics. Capability evidence binds the executable
  version and a safe digest of those semantics; arbitrary variants and catalog
  labels without matching semantics are not authority.

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
- no default-to-first-provider or model behavior
- the surface selects a configured route ID, never a provider or raw model ID
- unavailable configured routes remain visible but are non-selectable
- discovery membership alone never makes a route selectable
- stale, partial, or failed evidence remains diagnostic and fails closed
- model-less providers are explicit and do not receive fake model IDs
- prompt execution revalidates the selected route's derived provider/model
  evidence before admission
- route-selection and prompt-admission failures use the same route-level
  readiness reason

A configured direct execution target must carry a concrete provider model ID whenever
its provider requires one. Incomplete route configuration is rejected as a
route-level `missing-model` condition; no surface falls back to a raw-model
picker or a native ambient default.

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
- provider/model target health answers "is this advertised execution target
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

For an admitted execution target, discovery and target health are candidate
admission gates. An automatic route applies its configured
`economic-least-pressure` policy among eligible accounts before dispatch; the
surface does not choose an account unless the operator explicitly narrows that
same route to an eligible alias. An exact account selection is never widened
into a different account or provider route.

For OpenRouter free capacity, model-specific `:free` routes are volatile
candidates. `openrouter/free` is the stable free router because OpenRouter
selects an available free model at request time. Kiln must not hardcode a
single `:free` model as a durable fallback. If a specific free model is
rate-limited, route health should cool that model down and routing should prefer
another healthy candidate or `openrouter/free` when policy allows it.

## Operator UX

Execution-target pickers show concise unavailable reasons while preserving
structured diagnostics in the runtime result. Examples:

- missing API keys or credentials become "Auth is missing."
- local daemon or connection failures become "Local service is unreachable."
- empty catalogs become "No models found."
- failed model endpoints become "Model endpoint failed."

GUI and TUI refresh the execution-route catalog without restarting the process.
Refresh re-runs runtime discovery, updates route availability, and leaves the
current operator session alive.

Deliberation is shown next to execution-route selection when the selected
route's derived model advertises ordered levels. GUI renders it as a compact
composer control; TUI cycles provider default and explicit levels with
`/deliberation`. Both surfaces send only an explicit selection on the next turn.

## Turn Records

Live prompt admission records the selected execution target and its derived
provider/model validation in the runtime turn record. This preserves the
evidence used to admit or reject a turn and makes post-hoc diagnosis possible
without replaying discovery.

## Invariants

Provider/model discovery can provide a context-window denominator for partial
operator evidence, but discovery authority or freshness never makes a context
measurement authoritative. Only a matching provider-reported context window
does so. See [Context Usage Projection](../context/context-usage-projection.md).

- discovery is runtime-owned
- execution uses the same canonical eligibility truth shown to the operator
- diagnostics are provider-specific and fail closed
- model IDs passed to execution are concrete provider model IDs
- operator selection contains route ID and, where allowed, an account alias;
  it never contains provider, model, or credential authority
- local providers do not imply cloud auth or remote model availability
- unavailable reasons are actionable, not generic placeholders
- live provider probes, credential use, quota consumption, and paid inference
  are never claimed unless explicitly authorized and executed as live evidence

## Related

- [Provider Credential Pools](../safety/provider-credential-pools.md)
