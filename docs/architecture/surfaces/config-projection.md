# Config Projection

Kiln treats `~/.kiln/config.yaml` as the global source of truth for providers,
models, execution targets, reusable authority profiles, economics, and local
harness configuration. Project `kiln.yaml` may only add repository context and
narrow global limits for that workspace. It cannot redefine those global
catalogs. Native harness files are projected artifacts, not source state.

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

- `packages/cli/src/config/global-config.ts` owns canonical global config
  validation.
- `packages/cli/src/config/project-config-schema.ts` owns the strict runtime
  schema, inferred admitted type, stable structural diagnostics, editor schema,
  and field descriptors for project `.kiln/kiln.yaml`. The committed JSON
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
  generated global instruction entrypoints for native harness startup:
  `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, and
  `~/.config/opencode/AGENTS.md`.
- `packages/cli/src/application/instruction-profile-loader.ts` owns canonical
  instruction profile loading from Kiln filesystem config.
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
the same canonical `targetId`. Neither consumer copies
an account list, credential, or economics route.

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
- `identity`, `ui.theme`, and bundled `components`

The current canonical global schema version is `"3"`. Kiln does not support
compatibility shims for obsolete or partial global config files. Invalid global
config is an adoption error: commands that intentionally write a canonical
replacement must back up the invalid file before writing.

All global-config writers use one mutation owner in the CLI config layer. The
owner validates the current and proposed documents, serializes writers with an
acquisition-specific interprocess lock, detects expected-revision conflicts,
writes a same-directory temporary file, and atomically replaces the canonical
path. Lock recovery and release claim only acquisition-specific paths, so a
writer cannot delete a successor's lock. Direct-only bindings do not trigger
native projection.

Instruction profiles, agents, and skills are canonical filesystem config, not
inline YAML fields. Global definitions live under `~/.kiln/instructions/`,
`~/.kiln/agents/`, and `~/.kiln/skills/`; project definitions live under
`.kiln/instructions/`, `.kiln/agents/`, and `.kiln/skills/`. Native harness
agent, skill, and global instruction files remain generated projections.
Repo-local `AGENTS.md` and `CLAUDE.md` may reference active instruction profile
ids and canonical file paths for project startup, but they must not duplicate
global doctrine or global agent rosters.
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

`kiln sync` projects the merged Kiln config into supported native harness files
when native projection is the selected harness strategy. Projection is one-way.
The command requires explicit target flags, `--target`, or `--all`; a bare sync
does not infer permission to write every project and user-level target.

`kiln sync --all --dry-run` runs the same target classification without creating
directories, backups, projection files, or install-state. Preview output names
every affected path, its planned status, and any refusal reason.

Sync executes serially by projection surface and target. Successful writes remain
committed if a later target fails; Kiln does not automatically roll native files
back. It reports all observed target errors and exits non-zero on any target
operational failure. Protected managed drift is reported inline as `BLOCKED`
and does not make the command fail because the refusal preserves operator state.

Before overwriting an existing native projection file, Kiln writes an append-only
backup under `.kiln/backups/<target-id>/`. New files are not backed up.

If global config marks a known harness engine as `enabled: false`, sync first
uninstalls recorded managed projections for that harness and excludes that
harness from new permission, hook, agent, and skill projection writes.

`kiln sync --global-instructions` projects global Kiln instruction profiles
into the official native harness user-level instruction entrypoints:

- Codex: `~/.codex/AGENTS.md`
- Claude Code: `~/.claude/CLAUDE.md`
- OpenCode: `~/.config/opencode/AGENTS.md`

These files are signed whole-file projections recorded in install-state.
Unmanaged files, including symlinked entrypoints with no install-state
ownership, block until explicit adoption backs them up. Managed drift blocks
until explicit force. Symlinked entrypoints that Kiln already owns are treated
as stale because each harness target needs independent metadata, hash
ownership, and drift classification.

Global instruction shims include the direct-provider boundary: `codex-oauth`,
`opencode-go`, and `opencode-zen` are Kiln direct providers governed by Kiln
runtime authority. Native Codex/OpenCode/Claude CLI permission files apply only
to explicit native harness routes, not to Kiln direct-provider execution.

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
projection. Projection code does not read `.kiln/gateway.yaml` or another
project-local gateway authority.

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

Kiln's own attended operator surface has a narrower, enforceable meaning. When
an operator explicitly selects Full Access for a GUI turn, the attached Kiln
runtime records `operator_interactive` execution use and applies session,
tenant, and route bounds before admitting Kiln-owned local tools. This is valid
authority for that attended Kiln turn; it is not evidence about a native
harness sandbox, is not persisted as provider policy, and is not inherited by
managed, background, or unattended children. Those children continue to require
their own goal, work-item, route, and effective-runtime authority evidence.

Projection remains idempotent and preserves unmanaged native fields. When a
harness cannot preserve Kiln's canonical semantics, the adapter must emit
lossy or unsupported evidence and fail closed for authority-sensitive
background work instead of silently broadening or narrowing the policy.

## Project Roots And Repo Shims

Global native projections and repo-local instruction shims are different target
families.

Global native projections write into harness-owned user config locations such as
Claude Code, Codex, and OpenCode config, instruction, agent, and skill
directories. They make direct standalone harness use see Kiln's canonical
operator doctrine and projected capabilities.

Repo shims write into a specific project root, such as generated `AGENTS.md` and
generated `CLAUDE.md`. They are scoped project entrypoints for harnesses that
load repository guidance before Kiln runtime exists. Repo shims must be derived
from the merged canonical config for that project: global config, active
instruction profile references, project `kiln.yaml`, project context, and
project `.kiln/instructions|agents|skills`. Global doctrine and global agent
rosters belong to global native projections, not repo-local shim bodies.

Repo-shim projection must resolve the project root before writing. The durable
resolution order is:

1. explicit CLI path such as `--project` or `--cwd`
2. nearest ancestor containing `.kiln/kiln.yaml`
3. nearest repository root when it can be treated as a Kiln project root

The ancestor search for steps 2 and 3 is bounded by the user home directory.
The home directory and everything above it hold shared operator state, never a
single project, so no marker found there may be adopted while walking upward: a
git-tracked home directory would otherwise capture every nested directory,
including the Windows temporary directory. The starting directory named by step
1, or the current working directory when no explicit path is given, stays
eligible on its own; only the walk above it is bounded.

If the root is ambiguous or lacks enough Kiln project identity for a repo-local
shim, sync must fail closed instead of writing generated instructions into an
incidental current working directory. Running sync from a subdirectory of the
same project must resolve the same repo-shim target paths.

`kiln sync --repo-shims` generates repo instruction entrypoints. `AGENTS.md` is
the shared repo shim for Codex CLI and OpenCode. `CLAUDE.md` is the repo shim
for Claude Code. Future harness-specific repo entrypoints must be added to the
same projection pipeline instead of creating another source of truth. The
projection may summarize canonical doctrine and link profile ids, but it must
not become a second source of truth for identity, workflow, agent profiles,
skills, route policy, or permissions.

Repo context adoption may use a managed agent and a dedicated repo-context skill
to synthesize project guidance from real repository evidence. That agent output
is advisory until Kiln validates it against the project-context schema and the
operator approves adoption. Deterministic commands own root resolution, stack
and script detection, generated-file signatures, install-state records, drift
detection, backups, and projection writes.

`kiln project scout` exposes deterministic repository evidence. `kiln project
adopt` writes `.kiln/project-context.md` as canonical project context and blocks
when existing context differs unless the operator explicitly forces replacement.
Generated repo shims may project `.kiln/project-context.md`, but they must not
own its content. Project context, project instruction profiles, project agents,
and project skills are canonical repo config and should be versionable; runtime
state under `.kiln/` remains ignored.

Generated repo shims must contain a stable Kiln signature and projection
metadata: target kind, project root identity, source profile ids, generator
version, and content hash. Sync uses that metadata to block unmanaged files and
drifted managed files unless `--force` is explicit; forced overwrites are backed
up under `.kiln/backups/repo-shims/`. Config/status surfaces use the same
metadata to classify each repo guidance file as current managed projection,
stale managed projection, managed file with drift, unmanaged existing guidance,
missing projection, or blocked by ambiguous root. Unmanaged files are never
overwritten silently; Kiln may recommend adoption or backup, but the adoption
command must make the source and target explicit.

Repo-shim sync also exports a workflow snapshot for native harnesses and other
tools that can read project files but cannot query Kiln runtime state directly.
The canonical snapshot is built from deterministic project context, resolved
work-governance config, static workflow profiles, active instruction profiles,
authority posture, and model policy guidance. Sync writes:

- `.kiln/projections/workflow-snapshot.md` as a readable generated projection.
- `.kiln/projections/workflow-snapshot-manifest.json` as the manifest containing
  generator id, generation timestamp, source ids, generated file list, and the
  canonical snapshot hash.

These files are generated projections only. They are not durable doctrine and
must not be edited to change Kiln behavior. The manifest hash is computed from
canonical workflow evidence, not from the markdown projection alone. Re-running
sync with unchanged canonical evidence leaves the repo shims, manifest, and
workflow snapshot markdown unchanged. Config/status surfaces report
`workflow-snapshot:manifest` as missing, current, stale, or drifted; stale and
drifted diagnostics are read-only and must not mutate the manifest or canonical
workflow state.

Workflow snapshot export is intentionally static. It projects project context,
workflow policy, instruction profiles, authority posture, model policy, and
profile guidance for native harness startup. It does not project live goal
runs, work-item execution attempts, managed invocation records, or closeout
summaries. Those are session evidence and remain available through canonical
session events and resources such as `kiln://session/goals` and
`kiln://session/work-items`.

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
status, project config status, adopted project-context status, repo-shim projection status, native projection
install-state status, workflow snapshot manifest status, skill catalog status,
permission integrity, and harness integration capabilities. Skill catalog
status includes origin, built-in flag, source path, native projection status
for Claude Code, Codex, and OpenCode, and admission availability. CLI commands,
runtime setup
endpoints, GUI/TUI setup screens, SDK/widget descriptors, and audit events must
consume that shared contract instead of re-reading YAML or native files
independently. The model-callable `kiln_config.read` tool is a read-only
projection of this contract; it may inspect effective config and status but
must not mutate configuration or native provider files.

Projection health is derived, not stored. Native drift yields `drifted`, stale
projection or permission evidence yields `stale`, and unproven or failed
permission observation yields `unknown`; none may be labeled `current` by a
consumer. Missing optional projections remain visible in the projection list
without making canonical configuration itself stale. Project broadening is
rejected by effective-config admission before any read model is emitted, so a
project omission or rejected override cannot silently remove global safety
posture.

For setup surfaces, `KilnConfigStatusSnapshot.setup` is the domain-specific
read model. It contains project-context status, repo-shim status, native
projection status, global instruction shim status, permission-integrity
status, skill projection/admission diagnostics, and deterministic recommended
actions such as `adopt-project-context`, `sync-repo-shims`,
`sync-native-projections`, `sync-global-instruction-shims`,
`adopt-or-back-up-global-instructions`, or
`review-global-instruction-drift`. Native skill adoption is explicit: setup
may copy parseable, non-conflicting harness-local skills into the canonical
global Kiln registry, then run native skill projection so every supported
harness sees the same governed copy. Conflicting same-name native skills block
adoption until the operator reconciles them. GUI, TUI, CLI, SDK/widget, and
runtime tools must use this setup read model instead of locally filtering
generic projection lists.

Interactive GUI and TUI setup adapters attach the already-derived
`effectiveConfig` projection to this setup response. They do not re-read YAML
or recompute precedence. GUI exposes expandable field value/provenance rows;
TUI prints the same value, source, health, activation, and ordered chain. The
field is absent when effective configuration admission fails.

The setup read model remains the shared source of truth. `kiln config read
setup` prints the raw setup snapshot, `kiln status` includes deterministic
setup actions, the GUI reads `/gui/api/config/setup`, and the TUI `/setup`
command renders the same status. Surfaces must not infer setup state by
re-reading YAML, repo shims, or native harness files.

GUI setup actions use a separate governed action boundary:
`POST /gui/api/config/setup/actions`. The runtime validates the request through
the shared gateway contract, enforces the shared GUI-executable action allowlist,
and delegates only allowed actions to CLI-owned setup services. Button disabled
state is defense in depth, not the authority boundary: valid but disallowed
actions return a deterministic blocked setup result and never reach CLI mutation
services. GUI may
execute project-context adoption, repo-shim sync, native projection sync, and
safe global instruction shim sync. The global sync service itself blocks
unmanaged files and managed drift unless the CLI receives a separate explicit
adoption or force request. Adoption or backup actions, force, and
drift-sensitive actions return blocked results and keep the operator in an
explicit review flow.

Global instruction shim setup snapshots carry canonical `harness` identity from
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
consumed by `kiln config settings`, TUI `/settings [query]`, and GUI Settings.
It has one schema revision and nine stable sections: General, Providers, Models,
Permissions, Tools, Usage and Limits, Agents, Health, and Advanced. Entries
carry effective value or redacted presence, source, override state, allowed
write scopes, authority impact, activation, health, and canonical revisions.
Each write target separately projects its current value, override state, owners,
authority impact, approval requirement, and activation class; a multi-scope key
never borrows project governance for a global write or vice versa. Entries
never carry absolute operator paths or credential-like material.
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
proposals, approvals, and settlements under `.kiln/mutations/config/` with the
proposal hash, canonical target paths, desired content, and the exact prior
bytes rollback would restore. Approval is also durable: `kiln config approve
<proposalId>` creates a proposal-bound `approvalId`. Apply loads both records
and verifies that the approval points to the same proposal hash before it
writes anything. The model cannot self-approve by repeating an approval id in
natural language.

Project applies write only canonical project config files under `.kiln/agents/`,
`.kiln/skills/`, and `.kiln/kiln.yaml`. Global applies write only the canonical
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
configuration key. Each key has one descriptor, projected from the canonical
ownership ledger, that supplies its scope eligibility, value admission,
activation class, owning bounded contexts, reconciliation targets, and ledger
sensitivity. A key classified high or critical is treated as authority-affecting
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
or become a second effective-config authority.

Operator route admission captures the effective execution catalog and that
revision set as one Runtime value before candidate selection, capacity fencing,
or credential resolution. Snapshot activation is serialized only through
credential resolution; provider dispatch is concurrent afterward and carries
the committed route, account, credential identity, and exact captured revision.
The account runtime resolves candidates and credentials against the supplied
snapshot rather than a mutable startup catalog. The broader
`EffectiveAuthorityAdmissionBundle` remains a validated Runtime contract until
all enforcing owners can compose it atomically; it is not installed as an
optional authority alongside the existing per-call fields.

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

`.kiln/install-state.json` records each managed projection target. Document
targets track managed field paths and field hashes. File targets track the
whole-file `$file` hash.

On sync, Kiln compares current native content against install-state before
writing. Drift on managed fields or managed files aborts that target unless the
operator confirms `--force`. Unmanaged native keys remain outside the drift
contract and are preserved by document-field projection.

Global communication projection uses the global native-projection state under
`~/.kiln/runtime/native-projections`, so different repositories do not compete
for ownership of the same user-scoped Claude setting.

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
select an admission class only when exactly one concrete authority profile on
the target matches it; ambiguity fails closed. Configured agents always select
their exact `authorityProfileId`. Write-capable profiles require explicit
`writeAuthority` scope and approval config plus live-proven write evidence
support. `tools.writes: true` does not grant authority by itself. A harness that
can prove write evidence but cannot yet prove substantive read-only result
handoff remains unavailable for `foundation-readonly-plan`. Synthesized route
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
`executionMode: remote-harness`, and read-only profile authority. Endpoint
configuration proves that a remote route is configured; it does not prove live
tool behavior or write authority.

## Invariants

- Native harness files are projected artifacts.
- Harness integration decisions come from the shared capability model, not
  scattered per-command conditionals.
- Drift is an error condition, not a steady state.
- Projection targets are explicit and bounded to Claude Code, Codex, and
  OpenCode.
- Model names are provider-specific; cross-provider defaults must not be blindly
  copied into harness config.
- Config projection must be shared by all operator surfaces.
- Repo-local generated shims require an explicitly resolved project root; the
  command's current working directory is not a sufficient architecture contract.
- Generated repo shims must be self-identifying through Kiln projection
  metadata so status surfaces can explain whether a file is managed, stale,
  drifted, unmanaged, or missing.
- Workflow snapshot markdown and manifest files are generated projections from
  canonical workflow evidence; status surfaces may report drift, but must not
  repair them implicitly.
- Managed-agent target projection is governed config, not assistant preference.
- The target catalog and authority-profile catalog remain separate; runtime and
  operator surfaces consume their exact references instead of inferring target
  or authority from provider, model, persona, or admission class.
- Instruction profile, agent, and skill definitions are canonical only under
  Kiln-owned directories, never in native harness folders.
- Native harness-local skills are setup diagnostics until explicitly adopted or
  imported into Kiln canonical config; they are never admitted into managed
  invocation by their native presence alone.
- Config mutation is a governed proposal/approval/apply lifecycle; direct YAML,
  native harness, or arbitrary filesystem edits are not configuration mutation.
