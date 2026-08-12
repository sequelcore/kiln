# Config Projection

Kiln treats `~/.kiln/config.yaml` as the global source of truth for local
operator and harness configuration. Project `kiln.yaml` may override it for a
workspace, but native harness files are projected artifacts, not source state.

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
- `packages/cli/src/config/harness-integration-capabilities.ts` owns harness
  integration capability declarations.
- `packages/cli/src/config/config-merger.ts` merges global and project config.
- `packages/cli/src/config/native-*-projection.ts` owns native file IO for
  permissions, hooks, agents, and skills.
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

## Execution Catalog Projection

`executionCatalog` is the single source for provider/model routes, accounts,
account policies, economics, and capacity intent. Config projection validates
references only; it cannot resolve a credential, acquire capacity, choose an
account, or construct an adapter.

Runtime owns selection and commitment in its shared local capacity authority.
Automatic policies gate safety, health, quota, and live capacity before
economics and pressure. A direct managed route names `executionRouteId`; the
same reference is used by Model Gateway virtual models. Neither overlay copies
an account list, credential, or economics route.

The committed binding contains one route ID, account ID, credential ID, and
credential revision. Adapter construction accepts only that binding and
rejection is fail-closed on mismatch, saturation, or post-fence credential
drift. Projection remains secret-free and exposes unavailable-route reasons and
repair guidance rather than a guessed fallback.

## Global Config

Global config is the active user-level contract. It includes:

- `engines` for harness availability and billing metadata
- `executionCatalog` and `executionRouting.defaultRouteId` for operator
  execution
- `workerRouting` and `workerModels` for separate native worker context
- `permissions`, `mcp`, and `hooks`
- `managedAgents` route policy
- `identity`, `ui.theme`, and bundled `components`

The current canonical schema version is `"1"`. Kiln does not support
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
Native harness-local skills discovered under Codex, OpenCode, or Claude Code
directories are not imported implicitly. Status surfaces classify them as
`native-harness` origin with `unmanaged-native` projection state so operators
can decide whether to install them into Kiln project/user config, ignore them,
or remove native drift.

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

Canonical `modelGateway` surfaces are projected through the same composed
native writers and install-state used for permission projection. The global
Codex and OpenCode projections are additive registration only:

- Codex receives only `model_providers.kiln`. Kiln does not set
  `model_provider`, `model_catalog_json`, `model`, or `web_search`.
- OpenCode receives only `provider.kiln`. Kiln does not create or modify
  `enabled_providers` and does not select a default `model`.
- Existing native providers, picker catalogs, defaults, search behavior, and
  sessions remain owned by the native harness and operator.

A Codex picker projection is not admitted until Kiln can preserve native
provider identity, materialize a verified composite catalog, and prove the
loopback listener healthy before changing native traffic. Merely declaring a
`modelGateway` principal must never replace the native picker. Sync migrates
legacy Kiln-owned replacement fields and catalogs away while preserving the
additive provider definition.

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
operator surfaces. `KilnConfigStatusSnapshot` reports resolved project root,
global config status, project config status, adopted project-context status,
effective config availability, repo-shim projection status, native projection
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

Config mutation is a control-plane lifecycle:

1. inspect effective config through read-only setup/config views
2. create a structured proposal against canonical Kiln config
3. require an explicit operator approval bound to the stored proposal hash
4. apply the approved proposal only if the current canonical files still match
   the proposal base hashes
5. run native projection through Kiln projection services
6. emit canonical config mutation evidence for every operator surface

The model-callable tool surface is deliberately small:

```ts
kiln_config.read({
  view: "effective" | "providers" | "routes" | "agents" | "skills" |
    "permissions" | "memory" | "projections" | "setup" | "health"
})

kiln_config.propose_change({
  operation: "skill.upsert" | "agent.upsert" | "agent.attach_skills",
  payload: { ... }
})

kiln_config.apply_change({
  proposalId: "...",
  approvalId: "..."
})
```

`routing.set_default`, `route.set_enabled`, `projection.sync`, third-party pack
installation, team/cloud distribution, and rich GUI editing are not implicit
config-mutation operations. They require their own explicit contracts before an
agent may request them through tools. Until then, agents must not simulate those
changes by editing config files.

`kiln_config.read` is read-only. It exposes the same bounded views as
`kiln config read` and the setup/status surfaces. It may report effective
config, provider health, projection status, and setup recommendations, but it
does not grant mutation authority.

`kiln_config.propose_change` returns a `KilnConfigChangeProposal`, not a patch
string. A proposal records:

- operation id
- normalized payload
- affected canonical config paths
- native projection effects
- authority impact
- validation diagnostics
- preview diff
- rollback hint

Skill proposals validate against the canonical `SKILL.md` parser. Agent
profile proposals validate against the Kiln agent-profile parser used by
runtime discovery and native projection. `agent.upsert` supports canonical
profile fields such as `displayName`, `nicknameCandidates`, `tools`, `skills`,
`instructionProfiles`, `taskAffinity`, `authorityProfile`, `routeId`, and
`providerRoute`. Duplicate aliases, aliases that collide with the canonical
profile id or display name, invalid ids, invalid task affinities, unsupported
tool names, and malformed profile files fail closed. Write-capable tool names
such as `write` and `bash` are allowed only as explicit proposal data with
`authorityImpact` surfaced for review; arbitrary or misspelled tool names fail
closed.

Config proposals are durable runtime state, not prompt text. Kiln stores them
under `.kiln/proposals/config/` with the proposal hash, canonical target paths,
desired content, previous content hashes, and next content hashes. Approval is
also durable: `kiln config approve <proposalId>` creates a proposal-bound
`approvalId` under `.kiln/approvals/config/`. `kiln_config.apply_change` must
load both records and verify that the approval points to the same proposal hash
before it writes anything. The model cannot self-approve by repeating an
approval id in natural language.

Apply writes only canonical project config files under `.kiln/agents/` and
`.kiln/skills/`. It rejects invalid proposals, missing approvals, consumed
approvals, mismatched proposal hashes, path traversal, writes outside canonical
config roots, and stale proposals whose target files changed after proposal
creation. If the desired state already exists and the stored base hash still
matches, apply remains idempotent.

After canonical writes succeed, apply invokes the existing native projection
services for the affected family and the repo-shim projection service. Native
Claude Code, Codex, and OpenCode files are regenerated projections; config
mutation tools never patch them directly. Projection failures are returned as
structured effects and diagnostics instead of hidden shell output.

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

`kiln import-native <target>` is the explicit path to absorb selected native
settings into Kiln config. It is not reverse sync. It supports Codex and
OpenCode native settings that Kiln can represent in canonical global config.

`kiln uninstall [target]` removes only recorded managed projection state.
Harness aliases such as `codex` resolve to all recorded targets for that
harness, including config, agents, skills, and hooks. Exact target IDs remain
available for surgical removal.

## Managed Agent Route Projection

Managed-agent direct routes reference one canonical `executionRouteId`.
They do not carry or derive provider, model, account, credential, economics,
or fallback data. Runtime resolves the same route health, capacity, admission,
fence, and exact credential binding used by GUI, TUI, CLI run, and Gateway
ingress. Native-harness managed routes remain a separate physical-harness
concern and must carry only the evidence their boundary requires.

CLI run consumes one admitted execution route. Task suitability can describe
healthy routes but cannot replace route selection, synthesize write authority,
or bypass managed-agent admission.

When at least one healthy route exists, runtime tool projection exposes
`managed_agent.invoke`. Missing or unhealthy routes fail closed with operator
diagnostics. Surfaces do not decide their own child-agent provider list.

Budget-aware routing config projects only into normal runtime-session-turn
budget admission. CLI surfaces may supply `routing.budget` and a live usage
reader, but they do not evaluate that policy locally. Policy-bearing managed
children instead use the configured managed economic policy and Runtime's
atomic commitment authority; the session-turn budget decision cannot authorize
or widen a managed route.

Synthesized child routes are read-only and use `foundation-readonly-plan`. Write
capable routes require an explicit `managedAgents.routes[]` entry with
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

Route-source provenance is a separate projection field and is required before
managed invocation admission. CLI projection records:

- `execution-catalog` for managed direct routes tied to `executionRouteId`
- `explicit-managed-route` for `managedAgents.routes[]`
- `managed-default-route` for `managedAgents.enabled` with default provider or
  profile settings
- `enabled-engine-fallback` for the final supported enabled-engine fallback

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
- Managed-agent route projection is governed config, not assistant preference.
- execution catalog routes, explicit `managedAgents.routes[]`, managed-agent defaults,
  and enabled-engine fallback paths have distinct `routeSource` values; runtime
  and operator surfaces consume those projected values instead of inferring
  route provenance.
- Instruction profile, agent, and skill definitions are canonical only under
  Kiln-owned directories, never in native harness folders.
- Native harness-local skills are setup diagnostics until explicitly adopted or
  imported into Kiln canonical config; they are never admitted into managed
  invocation by their native presence alone.
- Config mutation is a governed proposal/approval/apply lifecycle; direct YAML,
  native harness, or arbitrary filesystem edits are not configuration mutation.
