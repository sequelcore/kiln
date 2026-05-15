# Provider Model Discovery

## Purpose

Provider model discovery is the runtime-owned contract that tells operator
surfaces which providers can execute, which concrete model IDs are selectable,
and why a provider is unavailable.

Discovery is not a fallback mechanism. Kiln must not invent static models or
silently choose a provider when runtime discovery cannot prove availability.
Credential availability comes from provider credential pools, but it is only
one input into discovery. Execution also needs provider-specific readiness such
as CLI availability, model endpoint reachability, local daemon health, and a
concrete selected model where the provider requires one.

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
- `daemon_unreachable`
- `model_selection_not_required`

The same discovery result gates execution and drives operator diagnostics.
Surfaces may abbreviate the human-facing reason, but they must not derive
availability from a different source.

## Runtime Caching

GUI and TUI use a shared runtime discovery cache with a short TTL and
in-flight request deduplication. Cold startup starts with an immediate
`pending` catalog snapshot and kicks forced discovery into the background after
the operator transport is listening. Startup, dashboard reads, and socket opens
must not block on CLI probes, remote model endpoints, or local daemons.

While discovery is pending, surfaces may render the provider catalog as loading
or include locally known providers as pending selections, but they must not
claim runtime availability. Once discovery completes, subscribers receive the
authoritative catalog and the same snapshot updates GUI, TUI, and direct TUI
state. Normal dashboard reads, socket opens, provider switches, and prompt
admission then reuse fresh discovery results instead of re-probing every
provider on every turn.

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

`kiln run --provider <direct-provider>` performs the same fail-closed model
admission before creating a provider session. The selected model must be present
in live runtime discovery for that provider; stale static IDs and typos are
rejected before the chat/completions request. Command-line `--api-key` values
participate in discovery for that process only, the same way they participate
in execution.

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
- `defaultReasoningEffort`
- `supportedReasoningEfforts`
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
- `supportsTools` remains a compatibility projection for existing consumers
  that have not yet split UI display from execution eligibility.

Execution admission must use `supportsFunctionTools` and `supportsRuntimeTools`
when present. It must not infer that Kiln tools are unavailable merely because
a provider-native shell or patch tool is disabled.

`supportedReasoningEfforts` uses Kiln's normalized effort enum:
`minimal`, `low`, `medium`, `high`, and `xhigh`. Provider-native names are
normalized at the discovery boundary. For Codex OAuth, the ChatGPT-backed model
endpoint returns `supported_reasoning_levels` as records such as
`{ effort, description }`; discovery must preserve the ordered `effort` values
and ignore descriptive copy. Older string-array shapes remain accepted for
providers that expose them that way.

If a model does not advertise `supportedReasoningEfforts`, GUI and TUI must not
render a reasoning selector for that model, and CLI requests should not invent a
default. If a model does advertise supported efforts, the default is
`defaultReasoningEffort` when present, otherwise the first advertised supported
effort.

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

- `claude` is model-less when the harness is available
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
- model-less providers are explicit and do not use fake model IDs
- prompt execution revalidates the active provider/model before admission
- provider switch errors and prompt execution errors use the same wording for
  the same readiness failure

If a provider has selectable models, execution requires a concrete selected
model ID. If no selected model exists, the canonical error wording is:

```text
Provider '<provider>' requires a selected model.
```

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

Reasoning effort is shown next to provider/model selection when the active
model advertises supported efforts. GUI renders it as a compact composer
control; TUI renders the current effort in the provider sidebar and cycles it
with `/effort`. Both surfaces send the selected effort on the next turn only.

## Turn Records

Live prompt admission records provider validation provider-by-provider in the
runtime turn record. This preserves the evidence used to admit or reject a turn
and makes post-hoc diagnosis possible without replaying discovery.

## Invariants

- discovery is runtime-owned
- execution uses the same provider availability truth shown to the operator
- diagnostics are provider-specific and fail closed
- model IDs passed to execution are concrete provider model IDs
- local providers do not imply cloud auth or remote model availability
- unavailable reasons are actionable, not generic placeholders

## Related

- [Provider Credential Pools](provider-credential-pools.md)
