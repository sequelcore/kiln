# Config Projection

Kiln treats `~/.kiln/config.yaml` as the global source of truth for providers,
models, execution targets, reusable authority profiles, economics, and local
harness configuration. Each project has one operator-private state namespace
under `~/.kiln/projects/<krp_sha256>/`; its canonical project document is
`config.yaml` in that namespace. Project config may only add reviewed,
non-derivable project context and narrow global limits for that workspace. It
cannot redefine those global catalogs. Native harness files are projected
artifacts, not source state.

The project identity is derived from the canonical physical project root and is
represented by an opaque `krp_<sha256>` id. `adoption.json` is an identity-only,
canonical manifest in that private namespace. It binds the private state to the
exact project identity; it contains no copied configuration, credentials, or
operator paths. A missing, malformed, copied, or unsafe manifest is an
unadopted project and fails closed. Relocating a project produces a new identity
and requires explicit re-adoption; Kiln does not migrate or alias the old state.

The private namespace also owns reviewed private project context, agents,
instruction profiles, skills, runtime state, sessions, caches, evidence,
backups, mutations, projections, domains, memory, feedback, benchmarks, and
temporary files. The repository contains source files and project-owned
guidance such as `AGENTS.md` and an optional `CLAUDE.md`; it is not a mutable
Kiln state root and those guidance files are not Kiln-generated authority.

Supported native projection targets are Claude Code, Codex, and OpenCode.

Codex projection preserves native settings only when Kiln can keep them valid
for the target harness. Provider-specific values outside Codex native contract
are removed during sync instead of being carried forward as compatibility
baggage. For example, service_tier is preserved only for supported Codex tiers
(fast and flex); unsupported values such as default are backed up with the
previous file and omitted from the projected config. This keeps standalone
Codex and Kiln-launched Codex on the same valid configuration surface.

Harness integration strategy is capability-driven; see
`harness-integration-capabilities.md` for runtime config injection, plugin,
MCP, hook, and proof rules. Additional harnesses require a new roadmap slice
when adoption justifies the cost.

## Ownership

The config projection boundary is owned by the CLI config layer.

- `packages/cli/src/config/global-config-schema.ts` owns the strict global
  structural schema, inferred admitted type, diagnostics, editor schema, and
  descriptors. `packages/cli/src/config/global-config/` separates semantic and
  cross-resource admission by owner from the single document-store lifecycle;
  `global-config.ts` is the explicit public boundary for those modules.
- `packages/cli/src/application/config-setting-descriptors.ts` owns admitted
  settings operations, scope eligibility, value parsing, and reconciliation
  targets. It resolves ownership, sensitivity, and activation from the
  canonical global or project schema instead of duplicating those facts.
- `packages/cli/src/application/config-settings-application.ts` owns the typed
  read, propose, approve, and apply port used by transported operator surfaces.
  It delegates writes and settlement to the existing mutation authority.
- `packages/cli/src/config/project-config-schema.ts` owns the strict runtime
  schema, inferred admitted type, stable structural diagnostics, editor schema,
  and field descriptors for the private project `config.yaml`. The committed JSON
  artifacts under `packages/cli/schemas` are generated projections and never
  runtime authority.
- `packages/cli/src/config/harness-integration-capabilities.ts` owns harness
  integration capability declarations.
- `packages/cli/src/config/config-merger.ts` merges global and project config.
- `packages/cli/src/config/native-*-projection.ts` owns native file IO for
  permissions, hooks, agents, and skills.
- `packages/cli/src/config/global-communication-projection.ts` owns the narrow
  user-scoped Claude `outputStyle` projection from canonical global
  communication intent. It owns one field, not the whole settings file.
- `packages/cli/src/application/global-instruction-shim-projection.ts` owns
  opt-in global instruction projections for native harness startup:
  `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, and
  `~/.config/opencode/AGENTS.md`.
- `packages/cli/src/application/project-instruction-status.ts` owns the
  read-only status of project-owned `AGENTS.md` and `CLAUDE.md`.
- `packages/cli/src/application/workflow-snapshot-projection.ts` owns the
  private workflow snapshot projection and manifest; it never reads or writes
  repository guidance.
- `packages/cli/src/application/instruction-profile-loader.ts` owns canonical
  global and private-project instruction profile loading from Kiln filesystem
  config.
- `packages/cli/src/config/native-projection-state.ts` owns install-state,
  managed-field hashes, whole-file hashes, and drift detection.
- `packages/cli/src/config/managed-agent-routes.ts` projects enabled engine and
  managed-agent config into runtime `ManagedInvocationToolOptions`.
- `packages/cli/src/commands/sync.ts` orchestrates sync. It does not own
  projection translation rules.
- `packages/cli/src/commands/uninstall.ts` removes recorded managed projection
  state from native files.

No GUI, TUI, runtime, SDK, or MCP surface may rebuild these rules independently.
Those surfaces consume resolved config, route health, gateway contracts, or
runtime tool options.

## Kiln Home Resolution

Kiln home has one precedence rule: an explicit non-empty path wins; otherwise
`XDG_CONFIG_HOME/kiln` wins; otherwise the host user home supplies `.kiln`.
Core owns this pure precedence rule and receives already observed values or a
lazy fallback reader. Runtime owns environment and operating-system discovery.
CLI composition consumes the Runtime boundary instead of defining a competing
resolver. Explicit and XDG paths must not probe the host home directory, and
none of these paths authorizes repository-local `.kiln` state.

Project-instruction status is read-only and classifies each target as `missing`,
`project-owned`, or `unreadable`. Any regular file is project-owned; diagnostics
never grant Kiln write authority over it.

The property-level owner, classification, current activation evidence, and
roadmap transfer for every canonical YAML field are recorded in
[Configuration Property Ownership](configuration-property-ownership.md).

## Target Catalog Projection

`targetCatalog` is the single source for direct and harness execution targets,
accounts, account policies, economics, and capacity intent. Config projection validates
references only; it cannot resolve a credential, acquire capacity, choose an
account, or construct an adapter.

Runtime owns selection and commitment in its shared local capacity authority.
Automatic policies gate safety, health, quota, and live capacity before
economics and pressure. Managed agents and Model Gateway virtual models name
the same canonical `targetId`. Neither consumer copies an account list,
credential, or economics route.

GUI and TUI target refreshes use one
Runtime-owned, request-correlated operation. Runtime refreshes provider
discovery and route availability before returning the catalog; stale success
or failure frames cannot settle or replace a newer surface request.

The committed binding contains one route ID, account ID, credential ID, and
credential revision. Adapter construction accepts only that binding and
rejection is fail-closed on mismatch, saturation, or post-fence credential
drift. Projection remains secret-free and exposes unavailable-route reasons and
repair guidance rather than a guessed fallback.

## Global Config

Global config is the active user-level contract. It includes:

- `engines` for harness availability and billing metadata
- `targetCatalog` and `targetRouting.defaultTargetId` for direct and harness
  execution
- `authorityProfiles` for reusable tool, workspace, network, memory, voice,
  timeout, and write authority
- `permissions`, `permissionCeiling`, `mcp`, and `hooks`
- `managedAgents` defaults and bounded managed-agent intent; Runtime-owned
  economic evidence is projected read-only
- `identity`, atomic `ui.appearance`, and bundled `components`

The current canonical global schema version is `"7"`. Kiln does not support
compatibility shims for obsolete or partial global config files. Invalid global
config is an adoption error: commands that intentionally write a canonical
replacement must back up the invalid file before writing.

Obsolete global config shapes have no reader, migration command, or
compatibility branch. With no external consumers, the canonical document is
replaced in place when the contract changes.

All global-config writers use one mutation owner in the CLI config layer. The
owner validates the current and proposed documents, serializes writers with an
acquisition-specific interprocess lock, detects expected-revision conflicts,
writes a same-directory temporary file, and atomically replaces the canonical
path. Lock recovery and release claim only acquisition-specific paths, so a
writer cannot delete a successor's lock. Direct-only bindings do not trigger
native projection.

## Runtime Turn Convergence

Turn convergence is Runtime-owned execution policy, not a new canonical YAML
configuration family. Every attached Runtime turn resolves one finite policy
from `RuntimeExecutionEnvelope.convergence` or the centralized Runtime default.
`RuntimeSessionOrchestrator` enforces that policy before each provider request
and before each atomically admitted tool batch. Operator surfaces may carry
workflow intent, but they do not own per-turn thresholds or private loop
settlement.

The numeric defaults are centralized in Runtime and remain provisional pending
calibration. This document does not define or imply an unsupported
`convergence`, `toolRounds`, or other turn-policy field in global or project
YAML. A bounded workflow may pass an explicitly resolved Runtime envelope
through its existing execution boundary.

`sessionTurnBudget` remains a separate outer/session-history authorization. The
Runtime checks it before consequential steps; it cannot replace or widen the
turn-local convergence policy. Numeric convergence defaults remain centralized,
provisional, and calibration-owned; `sessionTurnBudget` does not define a
convergence schema. Context projection and cumulative input-token accounting
likewise remain separate: one controls the next provider request's message set,
while the other is turn-wide convergence evidence.

## Tool And Producer Projection

Canonical tool IDs, operator-facing aliases, the initial provider projection,
the derived `authorizedMaterializable` view, and later materialized tool state
are separate Runtime/Core projections. Discovery may reveal only tools already
authorized for the turn, with typed status; it never widens the admitted
authority or allowlist. A materializable definition is not executable until the
turn already authorizes its canonical ID.

Configured verification-producer diagnostics are projected to the model through
the typed tool catalog only as redacted configuration facts (for example,
availability or version status). They do not expose credentials, paths, or raw
probe payloads and do not grant authority. Completion obligations still require
the exact canonical producer and scoped evidence; a shell command is not an
equivalent producer unless Core explicitly lists that equivalence.

Instruction profiles, agents, and skills are canonical filesystem config, not
inline YAML fields. Global definitions live under `~/.kiln/instructions/`,
`~/.kiln/agents/`, and `~/.kiln/skills/`; private project definitions live under
the bound namespace's `instructions/`, `agents/`, and `skills/` directories.
Native harness agent, skill, and instruction files are opt-in projections. The
project-owned `AGENTS.md` remains repository guidance consumed natively by
Codex and OpenCode. A project-owned `CLAUDE.md` may import `@AGENTS.md` and add only genuine
Claude-specific deltas; neither adapter should duplicate global doctrine or
agent rosters in repository files.
Kiln core built-in skills are lowest-precedence product defaults controlled by
`skills.builtin` activation policy. They are projected like other skills during
native sync, but user and project skills with the same id override them.
Canonical `skills.visibility` policy determines whether each resolved skill is
implicitly discoverable, explicit-only, or disabled. Native skill projection
uses a harness-specific renderer because Codex, Claude Code, and OpenCode do not
encode these semantics in the same file or support them at the same versions.
Projection status records the desired state, effective native state, and whether
the translation is exact or unsupported; adapters never claim parity by merely
copying provider-specific metadata to every harness.
Native harness-local skills discovered under Codex, OpenCode, or Claude Code
directories are not imported implicitly. Status surfaces classify them as
`native-harness` origin with `unmanaged-native` projection state so operators
can decide whether to install them into Kiln project/user config, ignore them,
or remove native drift.
Shared `.agents` roots, Codex system skills, and enabled plugin contributions
are also inventory inputs. They remain diagnostic-only and cannot enter Kiln
managed admission merely because a standalone harness discovers them. Plugin
inventory comes from the harness's structured installed/enabled view; raw cache
directories are not activation authority because they may retain disabled or
historical versions.

The shared skill status contract keeps the resolved/admissible registry
separate from source inventory. Inventory records portable logical identity,
complete-package digest, duplicate/collision resolution, exact description
bytes, and completeness diagnostics. Status and doctor surfaces render bounded
summaries from that contract; they do not rescan provider directories or claim
exact token utilization without versioned native evidence.

## Sync Contract

`kiln sync` projects selected canonical Kiln config into supported native
harness files when that projection is explicitly enabled. It never writes or
overwrites repository guidance. A bare sync does not infer permission to write
every project or user-level target; callers select the target and opt into the
native projection family.

Preview and status surfaces classify each target without mutating it. A preview
names every affected path, planned status, ownership evidence, and refusal
reason. Unmanaged repository guidance remains project-owned and is diagnosed by
`agent-context-doctor`; it is not adopted or replaced by sync.

Native sync executes serially by projection surface and target. Successful
writes remain committed if a later target fails; Kiln reports each target error
and does not silently roll native files back. Protected managed drift is a
refusal that preserves operator state. Before overwriting a managed native
projection file, Kiln writes a retained backup under that projection's private
state namespace. New files are not backed up.

If global config marks a known harness engine as `enabled: false`, sync removes
recorded managed projections for that harness and excludes it from new native
permission, hook, agent, and skill projection writes.

Global native instruction projections are opt-in managed renderings of neutral
Kiln doctrine. When selected, the projection writes these harness user-level
instruction entrypoints:

- Codex: `~/.codex/AGENTS.md`
- Claude Code: `~/.claude/CLAUDE.md`
- OpenCode: `~/.config/opencode/AGENTS.md`

These files are signed whole-file projections recorded in private install-state.
Unmanaged files and managed drift are diagnosed and require explicit review
before adoption or repair. Global instruction projection never changes
repository guidance. The direct-provider boundary remains explicit:
`codex-oauth`, `opencode-go`, and `opencode-zen` are Kiln direct providers
governed by Kiln runtime authority. Native Codex/OpenCode/Claude CLI permission
files apply only to explicit native harness routes, not to Kiln direct-provider
execution.

The signed instruction body is self-contained for disconnected native
continuity: it includes the complete effective global doctrine and carries a
versioned continuity contract beside target, source-profile, generator, and
content-digest provenance. References to `~/.kiln` identify the canonical owner;
they are not imports and the harness must not need to read Kiln state at load
time. The body also states that native continuity is guidance only and cannot
establish Runtime authority or enforcement.

Native skill projection follows the same artifact rule. Every admitted file and
nested resource is copied into the harness skill root, recorded independently in
global install-state, and checked for drift. Projection must not create symlinks
or runtime-only imports back to the canonical package. Discoverability does not
prove activation, behavioral effect, or availability of capabilities named by a
skill.

## Native Route Defaults

Kiln projects native default routes only from canonical Kiln config. The
resolved route is the merged `provider` plus `model.default`; native files never
become route truth. Before writing a native default, the projection layer must
validate that the selected provider/model can be represented by that harness:

- Codex native config receives `model = "<model>"` only for Codex-native
  provider ids such as `codex` or `codex-oauth`.
- OpenCode native config receives `model: "<provider>/<model>"` when the
  selected provider/model has OpenCode-native syntax.
- Claude Code generic provider defaults remain unsupported. A canonical
  `modelGateway.surfaces.anthropicMessages` principal with
  `nativeHarness: claude` projects its virtual model through Claude Code's
  public `model` setting only when exactly one model is admitted. Multiple
  models remain unset as a default and are exposed through gateway discovery.

Each native config file has one composed writer for its managed route field.
The Claude Code writer owns `claude-settings`, the Codex writer owns
`codex-config`, and the OpenCode writer owns `opencode-config`. Route defaults are composed with permissions and supported
settings before the atomic file write, then recorded in install-state with
per-field hashes. Hook, agent, and skill projections remain separate target
families and must not write the native `model` field.

Unmanaged native fields are preserved. A preexisting native `model` is never
deleted on first sync merely because the canonical route targets another
harness. Kiln may remove a stale native default only when install-state proves
Kiln previously owned the `model` field. After removal, ownership of `model` is
dropped from install-state so status surfaces do not report a false missing
default for a harness that is no longer targeted.

No compatibility aliases or obsolete model mappings are allowed. If a canonical
route cannot be encoded for a harness, Kiln omits or removes only previously
managed native route fields and reports the unsupported capability through the
shared status contract.

## Model Gateway Native Projection

Canonical `modelGateway` surfaces use harness-specific composed writers and a
shared install-state contract:

The canonical gateway value comes only from resolved global config. Command and
application boundaries read global and project config once, derive effective
project policy, and pass the same global `modelGateway` value into native
projection. Projection code does not read a project-local gateway authority or
any repository `.kiln` path.

- Codex composite lifecycle owns only `model_provider`,
  `model_providers.kiln`, `model_catalog_json`, and its generated catalog. It
  does not own `model` or `web_search`.
- OpenCode receives only `provider.kiln`. Kiln does not create or modify
  `enabled_providers` and does not select a default `model`.
- Claude Code receives only the admitted project-local Messages settings and
  model selection derived from that global gateway value.
- Existing native providers, picker catalogs, defaults, search behavior, and
  sessions remain owned by the native harness and operator.

Every native picker principal references at least one unique virtual-model id.
A referenced id must resolve to exactly one canonical virtual-model definition
with validated display name, context limit, and output limit. Empty principals,
repeated references, ambiguous duplicate definitions, missing models, or
incomplete picker metadata fail before any generated native file is written.
Responses and Messages projections share this resolution boundary; harness-
specific model-id rules are additional validation, not a second resolver.

The Codex composite installs a custom `kiln` provider whose base URL is the
supervised loopback, whose authentication remains Codex's first-party OpenAI
login, and whose wire API is HTTP Responses. `supports_websockets=false`
prevents Codex from attempting a WebSocket transport that the composite does
not implement; request and stream retries are zero so ambiguous turns are not
silently duplicated. The provider retains the upstream-compatible name
`OpenAI` because Codex uses that value as a feature discriminator for native
compaction, metadata, and reasoning behavior. The loopback is addressed by an
HMAC capability derived from the dedicated Codex principal token. Native model
ids retain caller OAuth and are forwarded to the native Codex backend; admitted
virtual ids re-enter canonical Model Gateway ingress under the Codex principal.
The generated catalog starts from `codex debug models --bundled`, preserves
native entries structurally, rejects id collisions, and appends virtual entries
that advertise only canonical capabilities. A missing ready listener, missing
token, malformed or empty native catalog, unmanaged field collision, or managed
drift fails closed. Updating an older owned `openai_base_url` projection strips
that field before atomically installing the provider contract; it is not kept
as a compatibility path.

`kiln model-gateway sync-native --client codex` installs or repairs the
projection only after exact listener inspection. `--uninstall` removes only
owned fields and the owned catalog; general model-gateway uninstall composes
that restore before deleting runtime lifecycle state. Permission sync remains
a separate writer and records evidence in Kiln install state instead of adding
private tables to Codex's native schema. Historical permission-projection
ownership is retired through its own install-state evidence; current Model
Gateway ownership of `model_providers.kiln` remains isolated under the global
gateway target rather than inferred from field names.

Claude Code receives an explicitly configured Anthropic Messages gateway
configuration in project-local `.claude/settings.json`:

- `ANTHROPIC_BASE_URL` points to the loopback gateway origin without `/v1`.
- `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` enables authenticated
  `/v1/models` discovery on Claude Code 2.1.129 or later.
- Claude-native virtual model ids start with `claude` or `anthropic`, matching
  Claude Code's public gateway discovery contract; projection fails closed for
  ids that the picker cannot expose.
- `tokenEnv` must be `ANTHROPIC_AUTH_TOKEN`; the token value stays in the
  process environment and is never written to settings or install-state.
- attribution reshaping, experimental beta fields, thinking, interleaved
  thinking, prompt caching, and native retries are disabled because the
  admitted Messages subset does not represent those semantics.

Kiln owns individual `env.<KEY>` paths rather than the whole `env` object, so
unrelated operator settings survive sync, drift checks, force, rollback, and
uninstall. Normal projection does not disable Claude Code's nonessential
traffic because that switch also disables gateway model discovery. The live
harness probe may disable it inside its disposable environment.

This is a technical Anthropic Messages compatibility route. It does not turn a
Claude subscription into gateway credit, and it must not be represented as
Anthropic support for non-Claude upstream models. The configured gateway
credential and upstream provider terms remain authoritative.

Claude picker parity is capability-bounded rather than name-bounded. The
authenticated discovery catalog contains every canonical virtual route that
proves the admitted Anthropic Messages subset and Claude Code model-id
constraints, and excludes other routes with an explicit protocol or capability
reason on canonical status surfaces. The projection must not duplicate route
eligibility in a Claude-local allowlist. Native Claude subscription selection,
explicitly billed Anthropic API routing, and gateway-backed virtual selection
remain distinct credential and billing classes even when Claude Code presents
them through model-selection workflows.

## Route Integrity Evidence

`KilnConfigStatusSnapshot` carries native route integrity evidence for managed
native default fields. Operator surfaces must keep these fields separate:

- canonical route: the provider/model resolved from Kiln config
- native configured default: the provider/model represented by the native file
- selected runtime route: the route observed from native proof when available,
  or the configured native default when only static evidence exists
- catalog status: whether the provider/model is available, unknown, stale,
  disabled, missing, or not observable
- explicit probe status: credential-safe route probe result
- credential source class: `env`, `kiln-auth-store`, `native-auth-store`,
  `none`, or `unknown`
- bare proof support: whether the harness can non-destructively prove its bare
  invocation default
- classification: the normalized failure layer

Setup, status, doctor, sync, GUI, TUI, resource, and model-callable config-read
surfaces consume this shared contract. They must not re-read native files and
invent their own route health, credential health, or drift language.

## Permission Integrity Evidence

Kiln models trusted or full-access execution as evidence, not as one flattened
provider enum. Canonical permissions describe the operator's desired policy;
native files, desktop session selection, runtime observation, harness
capability, projection ownership, and operator authorization remain distinct
fields in `TrustedExecutionIntegrity`.

The shared config/status contract must keep these facts separate:

- canonical desired policy from Kiln config or operator-local trusted profile
- persisted native projection and whether Kiln owns the managed fields
- session-only override such as a desktop Full Access selector
- observed effective runtime policy when the harness exposes proof
- harness enforcement capability for approval, filesystem, and network
- evidence source, freshness, proof status, and last verification time
- operator authorization scope, revocability, and approval requirement
- mismatch classification and exact recommended action

Classifications such as `current-verified`, `intentional-operator-override`,
`native-projection-drift`, `runtime-policy-mismatch`,
`effective-policy-unproven`, `unsupported-semantic-translation`,
`dangerous-unapproved-broadening`, `stale-evidence`, `partial-observation`,
and `observation-failed` are Gateway/Core vocabulary. CLI, doctor, setup, GUI,
TUI, model-callable config reads, and workspace health consume that vocabulary;
they do not recalculate policy from native files, UI labels, or assistant text.

A desktop UI selection is never runtime proof. A session-only override is not
promoted into canonical config or persisted native policy unless the operator
uses Kiln's governed proposal, approval, and apply lifecycle. Conversely, an
operator-approved personal trusted profile is not unexplained drift when the
authorization evidence is current and scoped to the local operator.

Codex app-server `0.149.1` provides the first genuine Runtime observation
producer through `kiln config verify-runtime codex`. The producer starts one
content-free ephemeral thread, sends no turn or model prompt, and records the
approval policy, filesystem sandbox, and network-access components reported by
that exact app-server process. Evidence is bound to the requested component
digests, executable SHA-256 digest, process ID, hashed thread identity,
protocol, Runtime version, and freshness window. Every component must be
`proven` for aggregate proof to be `proven`; an aggregate label supplied
without component and runtime identity evidence is rejected. Other native
harness observations remain inferred until an equivalent producer exists, and
a different Codex version fails closed until its protocol contract is admitted.

Kiln's own attended operator surface has a narrower, enforceable meaning. When
an operator explicitly selects Full Access for a GUI turn, the attached Kiln
runtime records `operator_interactive` execution use and applies session,
tenant, and route bounds before admitting Kiln-owned local tools only. This is
valid
authority for that attended Kiln turn; it is not evidence about a native
harness sandbox, is not persisted as provider policy, and is not inherited by
managed, background, or unattended children. Those children continue to require
their own goal, work-item, route, and effective-runtime authority evidence.

Projection remains idempotent and preserves unmanaged native fields. When a
harness cannot preserve Kiln's canonical semantics, the adapter must emit
lossy or unsupported evidence and fail closed for authority-sensitive
background work instead of silently broadening or narrowing the policy.

## Repository Guidance And Native Projections

Repository guidance is a project/team-owned source, not a Kiln-generated
projection. `AGENTS.md` is the shared guidance file consumed natively by Codex
and OpenCode. A project-owned `CLAUDE.md` may import `@AGENTS.md` and add only genuine
Claude-specific deltas. An existing `AGENTS.md` or `CLAUDE.md` is therefore
project-owned by default, and Kiln never routinely regenerates or overwrites
either file.

The `agent-context-doctor` skill diagnoses ownership, classification, private or
global leakage, duplicate policy, and a proposed diff. The default result is
diagnosis plus proposed diff. Mutation requires an explicit user request and a
clear project-owned authority.

Repository guidance may contain project context and durable team conventions,
but it must not become a private workflow or runtime configuration file.
Provider, model, routing, workers, depth, permissions, sandbox, and MCP
credentials remain in canonical runtime configuration. Reusable procedures use
skills, and hard policy is executable in schemas, runtime, tools, hooks, or
tests. See [Repository Hygiene](../../guides/ops/repo-hygiene.md) for the full
content-placement classification.

Global native instruction projections are a separate, opt-in target family.
They are managed renderings of neutral doctrine in harness-owned user locations
and do not become repository guidance. Ownership and drift evidence stay in
private state. A native adapter may translate the neutral projection or add a
genuine harness delta, but it must not copy private runtime state or invent
project policy.

The private workflow snapshot remains a generated projection under the bound
private namespace, with a v2 private manifest and content hash when enabled. v1
used the obsolete default admission-profile field and is not the current
projection identity. It is
for private consumers that need a static context view; it is not repository
guidance, durable doctrine, or execution authority. It must never be exported
by a repository-guidance operation or used to overwrite `AGENTS.md` or
`CLAUDE.md`. Stale or drifted snapshot diagnostics are read-only and do not
mutate canonical workflow state.

Configuration inspection uses the same canonical status contract across
operator surfaces. Status evidence V3 replaces the former untyped raw
effective-config record with `KilnEffectiveConfigSnapshot`, a secret-free
root-field projection. Every returned field carries a canonical JSON-pointer
identity, effective value or redacted presence, effective scope, selected
source and source path, default status, ordered global/project contribution or
override chain, health, schema revision, sensitivity, and activation behavior.
MCP, web, and hook fields can contain inline secret material, so the projection
emits only `{ present: true }` for those families. The resolved runtime object is kept
request-local by the CLI application owner and is never part of the transport.

`KilnConfigStatusSnapshot` also reports resolved project root, global config
status, project config status, private project-context status,
repository-guidance diagnostics, native projection install-state status,
workflow snapshot manifest status, skill catalog status,
permission integrity, and harness integration capabilities. Skill catalog
status includes origin, built-in flag, source path, native projection status
for Claude Code, Codex, and OpenCode, and admission availability. CLI commands,
runtime setup
endpoints, GUI/TUI setup screens, SDK/widget descriptors, and audit events must
consume that shared contract instead of re-reading YAML or native files
independently. The model-callable `kiln_config.read` tool is a read-only
projection of this contract; it may inspect effective config and status but
must not mutate configuration or native provider files.

`effective` and `settings` are canonical narrow reads. They capture global and
project configuration directly and are intentionally unable to invoke native
projection, MCP, skill, or plugin diagnostic readers. Settings additionally
derives activation evidence because mutation previews expose that lifecycle;
the effective view does not synthesize unrelated diagnostic state.

Projection health is derived, not stored. Native drift yields `drifted`, stale
projection or permission evidence yields `stale`, and unproven or failed
permission observation yields `unknown`; none may be labeled `current` by a
consumer. Missing optional projections remain visible in the projection list
without making canonical configuration itself stale. Project broadening is
rejected by effective-config admission before any read model is emitted, so a
project omission or rejected override cannot silently remove global safety
posture.

For setup surfaces, `KilnConfigStatusSnapshot.setup` is the domain-specific
read model. It contains private project-context status,
repository-guidance diagnostics, native projection status, global instruction
projection status, permission-integrity status, skill projection/admission
diagnostics, and deterministic recommended actions for diagnosis, explicit
native projection, and reviewed adoption. Native skill adoption is explicit:
setup
may copy parseable, non-conflicting harness-local skills into the canonical
global Kiln registry, then run native skill projection so every supported
harness sees the same governed copy. Conflicting same-name native skills block
adoption until the operator reconciles them. GUI, TUI, CLI, SDK/widget, and
runtime tools must use this setup read model instead of locally filtering
generic projection lists.

Full skill inventory has one process-local diagnostic owner. The owner runs the
blocking filesystem/plugin scanner outside the operator event loop, single-flights
equivalent refreshes, and exposes `pending`, `current`, `failed`, `stale`,
`empty`, or `not_collected` evidence through `setup.skillDiagnostics`.
`not_collected` is terminal and means a narrow effective/settings read
intentionally did not attempt diagnostics; it is not a scan failure. A setup request returns the
latest lifecycle immediately; current or stale inventory may accompany it, but
no diagnostic inventory state participates in managed execution admission. The
worker has an internal deadline and is terminated on timeout, so a filesystem
or plugin stall settles as failed evidence rather than retaining an unbounded
worker. A failed refresh remains terminal even when its last catalog payload is
retained; passive reads never launch a replacement scan. Only an explicit setup
refresh retries it. The process owner retains at most eight least-recently-used
diagnostic keys, never evicts live work, and fails closed when every retained
entry is busy. Worker and deadline handles are unreferenced where the runtime
supports it. These bounds are runtime-owned and are not operator configuration.

Interactive GUI and TUI setup adapters attach the already-derived
`effectiveConfig` projection to this setup response. They do not re-read YAML
or recompute precedence. GUI exposes expandable field value/provenance rows;
TUI prints the same value, source, health, activation, and ordered chain. The
field is absent when effective configuration admission fails. While the health
view is open, GUI polls only `pending` or `stale` skill diagnostics and stops at
`current`, `empty`, or `failed`. TUI does not own a polling lifecycle; pending
output explicitly tells the operator to run `/setup` again. GUI renders the
diagnostic lifecycle independently from the retained catalog completeness, so
a stale payload cannot hide a terminal refresh failure.

The setup read model remains the shared source of truth. `kiln config read
setup` prints the raw setup snapshot, `kiln status` includes deterministic
setup actions, the GUI reads `/gui/api/config/setup`, and the TUI `/setup`
command renders the same status. GUI passive reads omit query parameters;
`refreshSkillDiagnostics=true` is the explicit retry port used only by the
operator refresh action. Surfaces must not infer setup state by re-reading YAML,
repository guidance, or native harness files.

GUI setup actions use a separate governed action boundary:
`POST /gui/api/config/setup/actions`. The runtime validates the request through
the shared gateway contract, enforces the shared GUI-executable action allowlist,
and delegates only allowed actions to CLI-owned setup services. Button disabled
state is defense in depth, not the authority boundary: valid but disallowed
actions return a deterministic blocked setup result and never reach CLI mutation
services. GUI may execute private project-context adoption and explicitly
selected native projection actions. It may present repository-guidance
diagnosis and proposed diffs, but it must not write repository guidance as a
side effect. The global projection service itself blocks unmanaged files and
managed drift unless the CLI receives a separate explicit adoption or repair
request. Adoption or backup actions and drift-sensitive actions return blocked
results and keep the operator in an explicit review flow.

Global instruction projection setup snapshots carry canonical `harness` identity from
the shared setup contract (`codex`, `claude-code`, or `opencode`); GUI and TUI
render that field directly and do not derive identity from target IDs.

This boundary is not model-callable config mutation. Agents still use
`kiln_config.read` for setup inspection and `kiln_config.propose_change` /
`kiln_config.apply_change` for governed canonical config changes.

## Governed Config Mutation

Governed config mutation is the only path by which model-callable tools may
change Kiln configuration. It exists so an agent can help the operator add a
skill, adjust an agent profile, or attach skills without receiving generic
filesystem write authority and without editing YAML or native harness files
directly.

Config mutation is a control-plane lifecycle owned by one application
authority, `config-mutation-authority`, for both the project and global
configuration scopes. No surface writes canonical configuration itself:

1. inspect effective config through read-only setup/config views
2. create a structured proposal bound to the canonical base revision
3. obtain an explicit operator approval bound to the stored proposal hash
   whenever the proposal expands authority, and always for a model-called apply
4. apply only if the canonical base revision is unchanged, writing through a
   same-directory temporary file and atomic replacement
5. converge declared reconciliation targets through the single reconciliation
   owner
6. read effective state back and settle the operation durably
7. emit canonical config mutation evidence for every operator surface

The model-callable tool surface is deliberately small:

```ts
kiln_config.read({
  view: "effective" | "providers" | "routes" | "agents" | "skills" |
    "permissions" | "memory" | "projections" | "setup" | "health" |
    "settings"
})

kiln_config.propose_change({
  operation: "skill.upsert" | "agent.upsert" | "agent.attach_skills" |
    "context_governance.adapt" | "setting.set" | "setting.reset" |
    "mutation.rollback",
  payload: { ... }
})

kiln_config.apply_change({
  proposalId: "...",
  approvalId: "..."
})
```

A model-called apply always requires `approvalId`. Approval-free commits exist
only for direct operator actions whose proposal reports `approvalRequired` as
false, and a model never holds that authority.

`targetRouting.set_default`, `target.set_enabled`, `projection.sync`, third-party pack
installation, team/cloud distribution, and rich GUI editing are not implicit
config-mutation operations. They require their own explicit contracts before an
agent may request them through tools. Until then, agents must not simulate those
changes by editing config files.

`kiln_config.read` is read-only. It exposes the same bounded views as
`kiln config read` and the setup/status surfaces. The `effective` view returns
the complete secret-free projection. Provider, route, permission, skill, and
memory views select field records from that projection instead of rebuilding
raw values. The `settings` view projects the same descriptor-backed snapshot
consumed by `kiln config settings`, TUI `/settings`, GUI Settings, the typed SDK
client, and trusted native-harness settings tools.
It has one schema revision and nine stable sections: General, Providers, Models,
Permissions, Tools, Usage and Limits, Agents, Health, and Advanced. Entries
carry effective value or redacted presence, source, override state, allowed
write scopes, authority impact, activation, health, and canonical revisions.
Each write target separately projects its current value, override state, owners,
authority impact, approval requirement, and activation class; a multi-scope key
never borrows project governance for a global write or vice versa. Entries
never carry absolute operator paths or credential-like material. The settings
snapshot also requires the canonical aggregate activation status: desired
revision, observed state, boundary, active revision, settlement lineage, and
qualifying read-back, reconciliation, turn, or session evidence. CLI, GUI, TUI,
SDK, native-harness, and model-callable settings readers consume that value
without recomputing activation policy.
`kiln config explain <identity>` returns the same field record used by the
bounded effective-config views. The tool may report provider health, projection
status, and setup recommendations, but it does not grant mutation authority.

`kiln_config.propose_change` returns a `KilnConfigMutationProposal`, not a
patch string. A proposal records:

- operation id and mutation scope (`project` or `global`)
- the canonical base revision the proposal was derived from
- normalized payload of desired intent
- affected bounded-context owners and canonical config paths
- reconciliation targets
- authority impact, derived by comparing current and proposed authority
- whether approval is required
- activation class (`hot`, `next-turn`, `next-session`, `reconcile`, or
  `restart-required`)
- validation diagnostics
- preview diff
- whether the change will be restorable by rollback

Proposal identity is derived from scope, operation, normalized payload, target
path, proposed content, and base revision. The same intent against the same
base always produces the same `proposalId`, which is what lets a retried apply
be recognised as the same operation rather than a new one.

Authority impact is a delta. Restating tools an agent profile already holds is
not an expansion and needs no approval; adding `write` or `bash` is
`expands-write` and does.

Skill proposals validate against the canonical `SKILL.md` parser. Agent
profile proposals validate against the Kiln agent-profile parser used by
runtime discovery and native projection. `agent.upsert` supports canonical
profile fields such as `displayName`, `nicknameCandidates`, `tools`, `skills`,
`instructionProfiles`, `taskAffinity`, `targetId`, and `authorityProfileId`.
Duplicate aliases, aliases that collide with the canonical
profile id or display name, invalid ids, invalid task affinities, unsupported
tool names, and malformed profile files fail closed. Write-capable tool names
such as `write` and `bash` are allowed only as explicit proposal data with
`authorityImpact` surfaced for review; arbitrary or misspelled tool names fail
closed.

Config proposals are durable runtime state, not prompt text. Kiln stores
proposals, approvals, and settlements under the private namespace's
`mutations/config/` with the
proposal hash, canonical target paths, desired content, and the exact prior
bytes rollback would restore. Approval is also durable: `kiln config approve
<proposalId>` creates a proposal-bound `approvalId`. Apply loads both records
and verifies that the approval points to the same proposal hash before it
writes anything. The model cannot self-approve by repeating an approval id in
natural language.

Project applies write only canonical project config files under the private
namespace's `agents/`, `skills/`, and `config.yaml`. Global applies write only the canonical
global configuration file, delegating to the global configuration owner so the
same lock, revision fence, validation, and atomic replacement apply. Global
content is produced by editing the YAML document tree, so operator comments,
ordering, and scalar style survive a mutation. Apply rejects invalid proposals,
missing or mismatched approvals, consumed approvals, path traversal, writes
outside canonical config roots, and stale proposals whose base revision changed.

A settings change never mints canonical configuration. If the target scope has
not been adopted yet, the proposal fails closed and directs the operator to setup
or `kiln init` instead of writing a default file as a side effect.

`setting.set` and `setting.reset` are the only paths that change an admitted
configuration key. The settings operation catalog supplies scope eligibility,
value admission, and reconciliation targets. It resolves activation, owning
bounded contexts, and sensitivity from the nearest canonical schema field
descriptor for the selected scope. A key classified high or critical is treated as authority-affecting
and requires an explicit approval; the authority does not guess whether a
specific value widens or narrows. A reset removes only the descriptor's exact
canonical YAML path, rejects aliases, prunes newly empty parent mappings, and
preserves unrelated keys, comments, ordering, and scalar style. Its authority,
activation, ownership, and reconciliation requirements come from the same
descriptor as `setting.set`; it is not a whole-scope replacement or a second
mutation policy.

Every settings proposal request carries the revision of the selected write
scope from the snapshot the operator reviewed. Proposal creation rejects a
mismatch before producing a valid mutation. The settings apply port accepts
only stored `setting.set` and `setting.reset` proposals; proposal ids from any
other mutation domain fail closed before approval. Durable proposal records are
versioned. Unversioned records cannot begin a new write, while an old record
whose in-progress marker proves its bytes already landed is settled honestly
before that legacy lifecycle is retired.

Settlement is write-once and keyed by proposal identity. A retried apply of an
already committed proposal replays its stored settlement instead of writing
again, and reports `replayed` as true. Rejections are deliberately not settled
durably, so the same intent can be retried once the conflict that caused the
rejection clears.

The path-scoped mutation lock spans the revision fence, canonical commit,
reconciliation, and terminal settlement. The existing in-progress marker makes
that open window observable without adding a second state authority. Competing
applies fail closed, terminal timestamps are monotonic per operation, and read
models must treat an active marker as pending rather than infer completion from
canonical bytes alone. A terminal settlement makes a leftover marker inactive;
replay removes it. An interrupted mutation is resumed by its exact proposal and
original approval rather than replaced by a no-op proposal, preserving the base
revision, restore point, rollback token, and approval lineage of the write that
actually landed. Every competing proposal for that canonical path fails closed,
regardless of operation, until that recovery settles.

After canonical writes succeed, the single reconciliation owner converges the
targets the proposal declared, and effective state is read back. Native Claude
Code, Codex, and OpenCode files are regenerated projections; config mutation
tools never patch them directly. Reconciliation failures are returned as
structured effects and diagnostics instead of hidden shell output.

The terminal outcome is honest. `committed` means the canonical write and
reconciliation both succeeded. `committed-reconciliation-failed` means the
canonical write committed and reconciliation did not; it is never reported as a
rejection, and every operator surface projects it as an applied change carrying
failed projection effects. A later retry remains pending until its own terminal
settlement and cannot race another reconciliation for the same canonical path.
`rejected` means nothing was written.

Each settlement also carries a secret-free activation observation. `active`
names the committed revision only after hot read-back or a stable reconciliation
pass; `scheduled` names the next-turn or next-session boundary without claiming
that the revision is active early; `failed`, `superseded`, and `unsupported`
remain distinct. A superseded reconciliation re-runs the newest canonical
generation under the same target lock before it releases the projection owner,
so an older writer cannot remain the final published generation. Mutation,
setup, and sync share that target lock, including a bounded interprocess wait.

Runtime captures a content-addressed, secret-free global/project revision set
once when a turn is admitted. The exact snapshot is immutable for the complete
turn. A logical session separately binds its first admitted revision and
persists that evidence, so later turns may observe a newer next-turn revision
without rewriting the session boundary. Revision evidence identifies the
configuration used by an execution; it does not duplicate configuration values
or become a second effective-config authority. Activation lineage carries only
portable logical configuration identifiers such as `config.yaml` and
`context`; absolute operator paths remain forbidden in admission and
session-facet evidence.

Operator route admission captures the effective execution catalog and that
revision set as one Runtime value before candidate selection, capacity fencing,
or credential resolution. Snapshot activation is serialized only through
credential resolution; provider dispatch is concurrent afterward and carries
the committed route, account, credential identity, and exact captured revision.
The account runtime resolves candidates and credentials against the supplied
snapshot rather than a mutable startup catalog. Runtime owns the broader
`EffectiveAuthorityAdmissionBundle`. Operator-turn and App Gateway admission
compose it once, before consequential dispatch, from the real session,
governance, permission, budget, route, sanitized data-policy, and
execution-binding decisions. The complete bundle and session facet are durable
evidence; credential material remains an ephemeral post-fence value. Gateway
and referenced app YAML contribute content digests to the admitted revision set
without persisting their values. `PerCallToolConfig.authorityAdmission` is the
sole productive Runtime authority field and may be omitted only at explicitly
non-dispatching construction seams. Mutable revision, route, binding, turn,
adoption, and effective-authority candidates exist only before Runtime composes
and persists the bundle; consequential execution cannot reconstruct authority
from them.

Model Gateway, managed-child, webhook, media, channel, and tenant-WebSocket
effects converge on the Runtime Execution Kernel. Each workload persists and
reads back the complete bundle, binds its `admissionId` to the canonical action
claim, and obtains at most one process-local dispatch permit. Exact replay,
restart, cancellation, timeout, transport ambiguity, and adapter fallback cannot
redispatch a fenced attempt. Revision-only sessions remain non-authority
transcript context.

`restart-required` remains part of the shared vocabulary but has no admitted
production descriptor in the current project/global pilot. Such a mutation is
reported as `unsupported`; a future configuration family must name its real
Runtime supervisor and drain owner before it can claim restart activation.

Config mutation authority is separate from filesystem write authority. A
read-only child may receive `kiln_config.read` at most. Proposal authority can
be admitted without apply authority. Apply authority requires an approved
proposal and the config mutation tool; it does not imply workspace write
permission for source files.

Config mutation evidence is part of the operator session model. The shared
contracts define `config_change_proposed`, `config_change_approved`,
`config_change_applied`, and `config_change_failed` event shapes. Runtime
session projection emits proposal/apply events from `kiln_config.*` tool
results, and all operator surfaces must render those through the shared
operator-event presentation contract rather than local string parsing.

## Install State And Drift

Each projection owner records managed targets in its own install-state. Project-
scoped targets use the bound private project's `projections/install-state.json`;
user-scoped targets use `<Kiln home>/runtime/native-projections/install-state.json`.
Document targets track managed field paths and field hashes. File targets track
the whole-file `$file` hash.

On sync, Kiln compares current native content against install-state before
writing. Drift on managed fields or managed files aborts that target unless the
operator confirms `--force`. Unmanaged native keys remain outside the drift
contract and are preserved by document-field projection.

Global instruction and communication projections use the global state under
`<Kiln home>/runtime/native-projections`, so different repositories do not
compete for ownership of the same user-scoped native harness files or settings.

Continuity status is always derived from this shared evidence and the native
target bytes. A current instruction target may report
`native-guidance-available`; current skill targets may report
`native-skills-discoverable`. Missing, unmanaged, stale, drifted, unreadable, or
unsupported targets cannot be promoted to those states. Neither state may be
reported as `runtime-authoritative`; only Runtime admission owns that status.

`kiln import-native <target>` is the explicit path to absorb selected native
settings into Kiln config. It is not reverse sync. It supports Codex and
OpenCode native settings that Kiln can represent in canonical global config.

`kiln uninstall [target]` removes only recorded managed projection state.
Harness aliases such as `codex` resolve to all recorded targets for that
harness, including config, agents, skills, and hooks. Exact target IDs remain
available for surgical removal.

## Managed Agent Target Projection

Every managed agent references one canonical `targetId` and one reusable
`authorityProfileId`. The target owns physical execution identity. The
authority profile owns tools, workspace, network, memory, timeout, voice, and
write posture. Neither agent definition duplicates provider, model, account,
credential, economics, or authority fields. Runtime projects a direct target
into account-backed execution and a harness target into its native or remote
adapter, while preserving the same target identity end to end.

CLI run consumes one admitted execution target. Task suitability can describe
healthy targets but cannot replace target selection, synthesize write authority,
or bypass managed-agent admission.

When at least one healthy route exists, runtime tool projection exposes
`managed_agent.invoke`. Missing or unhealthy routes fail closed with operator
diagnostics. Surfaces do not decide their own child-agent provider list.

`sessionTurnBudget`, when configured, projects only into normal session pre-turn
budget admission. CLI surfaces may supply `routing.budget` and a live usage
reader, but they do not evaluate that policy locally. Policy-bearing managed
children instead use the bounded managed-agent intent and Runtime's derived
economic evidence with the same atomic commitment authority; the session-turn
budget decision cannot authorize or widen a managed route. Policy identity,
candidate material, reservation, commitment, and settlement remain Runtime
state and are never authored or defaulted by a surface.

There is no synthesized or implicit agent roster. Ad hoc child execution may
select an access level only when exactly one concrete authority profile on
the target matches it; ambiguity fails closed. Configured agents always select
their exact `authorityProfileId`. Write-capable access levels require explicit
`writeAuthority` scope and approval config plus live-proven write evidence
support. `tools.writes: true` does not grant authority by itself. A harness that
can prove write evidence but cannot yet prove substantive read-only result
handoff remains unavailable for `read-only`. Synthesized route
profiles use a five-minute timeout budget; explicit route `timeoutMs` values
remain authoritative for deliberate shorter probes or longer bounded children.
Projection preserves this as timeout source diagnostics (`default` versus
`explicit-route`) instead of rewriting operator config at runtime. Timeout live
proofs use that same route authority: operators define or temporarily select an
explicit short-timeout read-only managed route and verify the terminal record,
timeout diagnostic, and `timeoutSource: "explicit-route"` evidence. Runtime,
GUI, CLI, and adapter code must not add request-local timeout shims that bypass
the resolved route profile.

Target-source provenance is required before managed invocation admission. CLI
projection records whether a target is direct, a local harness, or a remote
harness. It does not infer a physical target from enabled engines, provider
defaults, model names, or an agent persona.

The route source is projected into route health, unavailable-route diagnostics,
managed tool options, capability snapshots, session events, replay, CLI status,
and GUI/TUI cockpit state. It is not written into the YAML schema and must not
be guessed by runtime services.

Managed invocation capability and native file projection are separate
projections of the same canonical route admission. A policy-bound direct route
can be `admitted` for invocation because Runtime selects and leases its account
atomically after durable economic commitment, while remaining `unavailable`
for native projection with `capacity-policy-mismatch`; a generated harness file
cannot represent or enforce that Runtime capacity contract. Config status must
report both facts instead of using native projection eligibility as the route
catalog for managed invocation.

Remote harness routes are explicit managed-agent route overrides. Projection
requires HTTPS invoke and cancel endpoints, a portable auth-token environment
name when authentication is configured, `surface: remote-harness`,
`executionMode: remote-harness`, and read-only access authority. Endpoint
configuration proves that a remote route is configured; it does not prove live
tool behavior or write authority.

## Invariants

- Native user-level harness files are opt-in projected artifacts; repository
  guidance is project/team-owned.
- Harness integration decisions come from the shared capability model, not
  scattered per-command conditionals.
- Drift is an error condition, not a steady state.
- Projection targets are explicit and bounded to Claude Code, Codex, and
  OpenCode.
- Model names are provider-specific; cross-provider defaults must not be blindly
  copied into harness config.
- Config projection must be shared by all operator surfaces.
- `AGENTS.md` is project/team-owned guidance consumed natively by Codex and
  OpenCode; a project-owned `CLAUDE.md` may import `@AGENTS.md` and add only genuine
  Claude-specific deltas.
- Existing repository guidance is project-owned by default. Kiln does not
  routinely regenerate or overwrite it.
- Global native instruction projections are opt-in managed renderings of neutral
  doctrine and never become repository guidance.
- Private workflow snapshot markdown and its manifest are generated projections
  from canonical workflow evidence; status surfaces may report drift, but must
  not repair or export them as repository guidance implicitly.
- Managed-agent target projection is governed config, not assistant preference.
- The target catalog and authority-profile catalog remain separate; runtime and
  operator surfaces consume their exact references instead of inferring target
  or authority from provider, model, persona, or access level.
- Instruction profile, agent, and skill definitions are canonical only under
  global `~/.kiln` directories or the bound private project namespace, never in
  native harness folders or repository guidance.
- Native harness-local skills are setup diagnostics until explicitly adopted or
  imported into Kiln canonical config; they are never admitted into managed
  invocation by their native presence alone.
- Config mutation is a governed proposal/approval/apply lifecycle; direct YAML,
  native harness, or arbitrary filesystem edits are not configuration mutation.
