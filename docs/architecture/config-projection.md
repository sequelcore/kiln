# Config Projection

Kiln treats `~/.kiln/config.yaml` as the global source of truth for local
operator and harness configuration. Project `kiln.yaml` may override it for a
workspace, but native harness files are projected artifacts, not source state.

Supported native projection targets are Claude Code, Codex, and OpenCode.
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

## Global Config

Global config is the active user-level contract. It includes:

- `engines` for harness availability and billing metadata
- `routing` and optional budget-aware fallback behavior
- `models.default` and provider-specific `models.<engine>` values
- `permissions`, `mcp`, and `hooks`
- `managedAgents` route policy
- `identity`, `ui.theme`, and bundled `components`

The current canonical schema version is `"1"`. Kiln does not support
compatibility shims for obsolete or partial global config files. Invalid global
config is an adoption error: commands that intentionally write a canonical
replacement must back up the invalid file before writing.

Instruction profiles, agents, and skills are canonical filesystem config, not
inline YAML fields. Global definitions live under `~/.kiln/instructions/`,
`~/.kiln/agents/`, and `~/.kiln/skills/`; project definitions live under
`.kiln/instructions/`, `.kiln/agents/`, and `.kiln/skills/`. Native harness
agent and skill files remain generated projections, and `AGENTS.md` may project
active instruction profile ids and canonical file paths for direct harness use.
Kiln core built-in skills are lowest-precedence product defaults controlled by
`skills.builtin` activation policy. They are projected like other skills during
native sync, but user and project skills with the same id override them.

## Sync Contract

`kiln sync` projects the merged Kiln config into supported native harness files
when native projection is the selected harness strategy. Projection is one-way.

Sync executes serially by projection surface and target. Successful writes remain
committed if a later target fails; Kiln does not automatically roll native files
back. It reports all observed target errors and exits non-zero on any target
failure.

Before overwriting an existing native projection file, Kiln writes an append-only
backup under `.kiln/backups/<target-id>/`. New files are not backed up.

If global config marks a known harness engine as `enabled: false`, sync first
uninstalls recorded managed projections for that harness and excludes that
harness from new permission, hook, agent, and skill projection writes.

## Project Roots And Repo Shims

Global native projections and repo-local instruction shims are different target
families.

Global native projections write into harness-owned user config locations such as
Claude Code, Codex, and OpenCode config, agent, and skill directories. They make
direct standalone harness use see Kiln's canonical operator doctrine and agent
roster.

Repo shims write into a specific project root, such as generated `AGENTS.md` and
generated `CLAUDE.md`. They are scoped project entrypoints for harnesses that
load repository guidance before Kiln runtime exists. Repo shims must be derived
from the merged canonical config for that project: global config, global
instruction profiles, global agents, global skills, project `kiln.yaml`, and
project `.kiln/instructions|agents|skills`.

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
install-state status, workflow snapshot manifest status, and harness integration
capabilities. CLI commands, runtime setup endpoints, GUI/TUI setup screens,
SDK/widget descriptors, and audit events must consume that shared contract
instead of re-reading YAML or native files independently. The model-callable
`kiln_config.read` tool is a read-only projection of this contract; it may
inspect effective config and status but must not mutate configuration or native
provider files.

For setup surfaces, `KilnConfigStatusSnapshot.setup` is the domain-specific
read model. It contains project-context status, repo-shim status, native
projection status, and deterministic recommended actions such as
`adopt-project-context`, `sync-repo-shims`, `sync-native-projections`, or
`adopt-or-back-up-native-guidance`. GUI, TUI, CLI, SDK/widget, and runtime tools
must use this setup read model instead of locally filtering generic projection
lists.

The setup read model remains the shared source of truth. `kiln config read
setup` prints the raw setup snapshot, `kiln status` includes deterministic
setup actions, the GUI reads `/gui/api/config/setup`, and the TUI `/setup`
command renders the same status. Surfaces must not infer setup state by
re-reading YAML, repo shims, or native harness files.

GUI setup actions use a separate governed action boundary:
`POST /gui/api/config/setup/actions`. The runtime validates the request through
the shared gateway contract and delegates to CLI-owned setup services. Only
non-force actions may execute from the GUI: project-context adoption,
repo-shim sync, and native projection sync. Review-only or drift-sensitive
actions, including force sync and native guidance adoption, return blocked
results and keep the operator in an explicit review flow.

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

Ordered `routing.routes` project into governed read-only managed-agent runtime
routes. Explicit `managedAgents.routes` entries are merged on top as authority
exceptions or overrides; they do not replace the canonical route hierarchy.
Eligible direct providers require an explicit tool-call-capable model; harnesses
require live-proven result handoff for the requested managed profile and use
their route model, provider-specific `models.<engine>`, or the adapter's safe
default. If the same provider appears with multiple models, the synthesized
managed route IDs include a model slug so those candidates remain distinct. If
no ordered route list exists, enabled supported child engines project into the
same read-only route contract only when their handoff proof is complete. The CLI
resolves route health once using global config, engine availability, credential
state, provider-advertised model catalogs, model capability, profile-specific
harness proof, and optional managed-agent overrides, then passes the same
`ManagedInvocationToolOptions` to
GUI, TUI, CLI run, and operator gateway sessions.

CLI run also consumes the same provider/model task suitability contract when
ordering configured `routing.routes`. This is a ranking step over canonical
config, not a native harness projection and not a second route graph. Explicit
`managedAgents.routes` is the exception layer for child invocation; task
suitability can explain and rank healthy child routes but cannot synthesize
write authority or bypass managed-agent admission.

When at least one healthy route exists, runtime tool projection exposes
`managed_agent.invoke`. Missing or unhealthy routes fail closed with operator
diagnostics. Surfaces do not decide their own child-agent provider list.

Budget-aware routing config projects into the runtime/session budget admission
service. CLI surfaces may supply `routing.budget` and a live usage reader, but
they do not evaluate a parallel child admission policy locally. Enabled
budget-aware orchestration fails closed when every eligible route is over its
ceiling or when required live usage is unavailable.

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
- `routing.routes` is the managed-agent route source for read-only routes;
  explicit `managedAgents.routes` is an exception and authority layer, not a
  second routing graph to keep in sync.
- Instruction profile, agent, and skill definitions are canonical only under
  Kiln-owned directories, never in native harness folders.
- Config mutation is a governed proposal/approval/apply lifecycle; direct YAML,
  native harness, or arbitrary filesystem edits are not configuration mutation.
