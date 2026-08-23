# 12 - Configuration Experience

Status: Blocked at the Slice 8 checkpoint by an operator dependency decision
Priority: Urgent
Execution: Slices 0-7 and 7A are code/integration complete. Slice 8 has a
committed incomplete checkpoint and must not resume until the pre-resumption
gates below close. Live provider/runtime validation remains unrun.
Created: 2026-08-14
Reprioritized: 2026-08-20
Paused: 2026-08-22

## Objective

Make Kiln safe and useful without requiring a new operator to understand or
edit the full control-plane vocabulary. Common setup and maintenance must be
available through guided CLI, GUI, TUI, and governed agent operations while
declarative YAML remains the complete, reviewable, portable advanced surface.

The intended experience is task-oriented: connect a provider, choose a model,
select a safety posture, set a budget, or enable an admitted capability. Kiln
must derive, validate, persist, and explain the required policy and evidence.
The operator may inspect or override advanced material, but is not required to
author internal route identities, evidence digests, economic records, or
projection state for the common path.

This track is the roadmap owner for GitHub issue
[#72](https://github.com/sequelcore/kiln/issues/72). The issue records the
problem and architecture direction; this file owns implementation order,
dependencies, promotion gates, and residuals.

The 2026-08-20 operator priority decision makes Configuration Experience the
current product track. Slice 5 proved the first safe project turn without
opening YAML. Continue with the searchable settings foundation, updating the
queue after each slice, then reassess Kiln Connect sequencing. This is a
product sequence, not a claim that every slice in this track is a technical
dependency of Connect. Roadmap 08.5 Slice 0 remains independently admissible
safety hardening.

The 2026-08-22 operator dependency decision pauses further Slice 8 integration
until the active development branch has automatic CI, the Execution Kernel
ownership boundary is fixed, and the exact Slice 8 crash/recovery invariants
have a deterministic synthetic oracle. The pause prevents the admission bundle,
dispatch fencing, and settlement lifecycle from being copied into more Runtime
owners and then removed during later convergence. It does not transfer
configuration ownership out of this roadmap or admit the complete Execution
Kernel and reliability programs as prerequisites.

## Current Position

Kiln already has several foundations this track must reuse:

- global, project, app, and gateway YAML remain declarative configuration
  families with different owners;
- global configuration mutation is revision-aware and atomic;
- `KilnConfigStatusSnapshot` is the shared read model for setup, projection,
  drift, permission-integrity, and health surfaces;
- `kiln_config.read`, `kiln_config.propose_change`, and
  `kiln_config.apply_change` establish a proposal, approval, compare-and-swap,
  apply, projection, and evidence lifecycle for a bounded set of project
  changes;
- Available Models separates discovery from execution authority and provides a
  current-evidence, revision-fenced route-creation boundary;
- GUI theme mutation proves that a low-risk preference can be changed through a
  typed surface contract;
- CLI and GUI Available Models flows create targets from guided operator intent;
  Runtime derives and admits internal identity, account, policy, economics,
  capability, and revision evidence before the governed mutation;
- configuration types, handwritten validators, docs, examples, and surface
  controls do not yet derive uniformly from one runtime contract.

The audited global configuration demonstrates the product problem: human
intent is interleaved with repeated policy evidence, economics, route material,
native projection details, agent definitions, and operational state. The file
is valid and expressive, but its common operations are not discoverable or
safe to perform manually. Reducing this complexity requires moving ownership,
not hiding fields with an alternative editor.

## Product And Architecture Position

Kiln configuration has three distinct planes:

1. **Desired intent** - the smallest operator- or project-owned declaration of
   what Kiln should do.
2. **Managed evidence** - policy, economics, freshness, provenance, catalog,
   projection, and other authority evidence produced by named Kiln owners.
3. **Effective state** - the resolved value, source, scope, overrides, health,
   and activation status projected read-only to every surface.

These planes must not share one accidental YAML ownership boundary. Canonical
intent remains declarative. Managed evidence lives in named durable stores and
is referenced by exact identity or revision when execution admission needs it.
Effective state is a projection and never becomes mutation authority.

### Economic And Managed-Agent Product Contract

Kiln retains the internal economic machinery required to distinguish included
allowance, subscription usage, genuinely free execution, metered spend,
estimated cost, and unknown or non-comparable economics. Managed execution also
retains atomic reservation, exact route commitment, dispatch fencing,
authoritative settlement, recovery, and replay. Those concepts preserve runtime
invariants; they are not the operator's authoring vocabulary.

The common configuration surface asks only for material operator intent:

- provider connection and preferred or inherited execution target;
- managed-agent purpose and authority profile;
- inherited or explicit model choice;
- work limits such as turns, time, or concurrency when their owning
  governance contract admits them;
- paid-usage posture: included use only, ask before additional spend, an exact
  enforceable monetary cap, or an explicit advanced uncapped posture.

Kiln derives economic policy identity and revision, evidence requirements,
comparison domains, candidate ordering, worst-case reservation, commitment, and
settlement material through their existing owners. None of those derived values
is required input in onboarding, common settings, managed-agent setup, or route
creation. An exact monetary cap is offered only when current comparable evidence
supports conservative reservation; estimated or unknown cost is never presented
as a hard cap.

Common surfaces use distinct terms instead of one overloaded `budget` label:

- **usage** is observed consumption;
- **provider allowance or quota** is provider-reported capacity and reset state;
- **spend guard** is operator intent governing additional monetary spend;
- **work limit** bounds turns, time, concurrency, or another admitted
  unit of work;
- **context limit** bounds model context or local token consumption;
- **reservation** is internal economic evidence, never a common setting.

Provider allowance, estimated cost, price freshness, reservation, settlement,
and per-agent consumption project read-only with their source and confidence.
A fallback or overage transition that changes billing class, model, provider, or
price requires a new admitted commitment and any required operator approval; it
cannot occur as adapter-local hidden fallback.

Every configurable field exposed through a surface must have one descriptor
that names:

- canonical identity and owning bounded context;
- value type, constraints, default, description, and examples;
- supported scopes and precedence behavior;
- sensitivity and whether the value is a secret reference;
- authority impact and approval requirement;
- activation behavior: `hot`, `next-turn`, `next-session`, `reconcile`, or
  `restart-required`;
- read, propose, apply, rollback, and validation capabilities;
- schema and contract revision.

The descriptor is product metadata, not a second policy engine. Runtime schema
and semantic admission remain authoritative.

## Research Basis

Current products converge on a hybrid configuration experience rather than
choosing between a settings interface and a declarative file:

- Codex uses user, profile, trusted-project, command-line, and managed layers;
  CLI and IDE consume the same configuration hierarchy:
  <https://developers.openai.com/codex/config-basic/>.
- Claude Code exposes a tabbed `/config` interface for common options while
  retaining scoped JSON, an official JSON Schema, source precedence, and
  automatic backups:
  <https://code.claude.com/docs/en/configuration>.
- OpenCode V2 states that operators should not need to configure it manually,
  supports agent-assisted updates, keeps JSON/JSONC with a published schema,
  and separates provider connection and session model selection from durable
  configuration:
  <https://opencode.ai/v2/docs/config>,
  <https://opencode.ai/v2/docs/models>, and
  <https://opencode.ai/docs/providers>.
- Visual Studio Code combines a searchable, scoped Settings editor with the
  complete JSON surface, source precedence, modified-value filters, reset, and
  profiles:
  <https://code.visualstudio.com/docs/configure/settings>.

Economic and managed-agent surfaces reinforce the same boundary:

- OpenCode exposes agent purpose, model, permissions, and a step limit while
  inheriting the parent model when no override exists:
  <https://opencode.ai/docs/agents/>;
- Gemini CLI exposes interactive agent configuration, model, turn, and time
  limits, while model fallback remains an internal policy with operator consent
  on the common path:
  <https://geminicli.com/docs/core/subagents/> and
  <https://geminicli.com/docs/cli/model-routing/>;
- Claude Code exposes model, effort, turn limits, and a simple run-level monetary
  ceiling rather than asking users to author economic evidence:
  <https://code.claude.com/docs/en/agent-sdk/agent-loop> and
  <https://code.claude.com/docs/en/sub-agents>;
- RouteLLM, FrugalGPT, and AI Agents That Matter support joint cost-quality
  evaluation and evidence-backed routing, not an unevaluated `auto-cheapest`
  default:
  <https://arxiv.org/abs/2406.18665>,
  <https://arxiv.org/abs/2305.05176>, and
  <https://arxiv.org/abs/2407.01502>.

Community reports are not contract evidence, but they identify recurring
failure modes: hand-editing multiple agent configuration files, uncertainty
about which file owns a value, UI and file state diverging, and stale-revision
writes. These reports reinforce source visibility, one mutation authority, and
compare-and-swap requirements; they do not justify copying another product's
configuration model. Representative evidence includes:

- a Codex Desktop Preferences conflict after sequential writes reused a stale
  configuration revision:
  <https://github.com/openai/codex/issues/20538>;
- a Codex report where Desktop and CLI resolved different effective
  configuration from the same user file:
  <https://github.com/openai/codex/issues/14133>;
- a Claude Code report showing confusion between global preferences and
  `settings.json` ownership:
  <https://github.com/anthropics/claude-code/issues/3481>;
- community-built multi-harness settings managers motivated by repeated manual
  edits:
  <https://www.reddit.com/r/SideProject/comments/1talhwk/> and
  <https://www.reddit.com/r/coolgithubprojects/comments/1vcnmcv/>.

## Ownership

This track owns configuration discoverability, schema-derived product metadata,
guided onboarding, effective-value explanation, configuration mutation
semantics, activation planning, rollback presentation, and cross-surface
configuration parity.

It consumes but does not replace these owners:

- each bounded context owns its structural schema and semantic admission;
- global and project configuration services own canonical file mutation;
- config projection owns native convergence, install state, and drift;
- permission, data-policy, economics, budget, route, credential, and capability
  authorities own their decisions and evidence;
- Available Models owns secret-free discovery projection;
- Model Gateway owns model ingress and native model projection;
- operator surfaces own presentation and interaction, not policy;
- Work Governance and Coordination own the decision algorithm for direct,
  delegated, and orchestrated execution. [Issue
  #94](https://github.com/sequelcore/kiln/issues/94) may replace current policy
  defaults after benchmark promotion; this track owns only their schema,
  descriptors, effective-state explanation, activation, and governed mutation;
- Roadmap 06 owns communication-quality evaluation and default promotion through
  [issue #95](https://github.com/sequelcore/kiln/issues/95). This track may
  expose the admitted communication intent but cannot infer cross-harness
  behavior from a shared label;
- Bounded Work owns scope fidelity, resource ceilings, and semantic
  overengineering measurement through [issue
  #19](https://github.com/sequelcore/kiln/issues/19);
- Roadmap 11 owns capability discovery and execution, not whether a capability
  is enabled by configuration. It also owns the portable operator-question
  lifecycle and GUI-first, TUI-next, native-harness promotion sequence. This
  track reuses that interaction contract for onboarding, settings, and route
  creation instead of defining a configuration-only wizard protocol.

No GUI component, wizard, preset, agent tool, or YAML serializer may become a
second policy or default authority.

Schema migration may represent the current `workGovernance` and `communication`
contracts, but it must not fossilize their defaults, create compatibility aliases
around a superseded policy, or treat configuration metadata as benchmark
evidence. If #94 or #95 promotes a breaking replacement before the owning
configuration family migrates, this track adopts the replacement directly and
deletes the obsolete path in the same bounded slice.

## Scope

- One schema-first boundary per canonical configuration family.
- Generated, versioned editor schemas and machine-readable field descriptors.
- Minimal desired-intent documents and named managed-evidence stores.
- Effective-value queries with source, scope, default, override, health, and
  activation evidence.
- Guided first-run adoption and common configuration operations.
- Searchable GUI Settings with Basic, Providers, Models, Permissions, Tools,
  Usage and Limits, Agents, Health, and Advanced sections.
- A model-target wizard that consumes Available Models and builds admitted target
  material without raw JSON entry.
- Typed configuration operations shared by CLI, GUI, TUI, SDK, and admitted
  agent tools.
- Proposal, authority-impact preview, approval, revision fencing, atomic apply,
  reconciliation, verification, and rollback.
- Explicit hot, next-turn, next-session, reconcile, and restart-required
  activation behavior.
- Migration of useful durable local intent and evidence when a contract is
  replaced.
- Removal of superseded types, validators, writers, docs, generated artifacts,
  and state shapes in each bounded slice.

## Non-Goals

- No executable TypeScript configuration as an implicit canonical source.
- No generic form engine before bounded CLI and GUI task flows prove the
  descriptor contract.
- No single schema, loader, or merge policy for unrelated configuration
  families.
- No direct model edits to YAML, native harness files, or durable evidence
  stores.
- No preset that embeds independent permission, route, data, or economic
  policy.
- No common control that asks an operator to author economic policy identity,
  revision, evidence requirements, comparison domains, reservation material, or
  settlement state.
- No generic `budget` abstraction that conflates provider allowance, monetary
  spend, local tokens, context, time, turns, concurrency, or application billing.
- No assumption that every change can apply live.
- No hidden authority expansion, silent restart, or automatic credential use.
- No credentials, raw tokens, operator paths, or incident payloads in canonical
  intent, public schemas, previews, or audit evidence.
- No line-count target that removes advanced capability or weakens explicit
  policy.
- No compatibility alias, dual reader, legacy writer, deprecation window, or
  parallel mutation path without an evidenced consumer.

## Contract Replacement And Durable State

Kiln has no external configuration API consumers that require compatibility
shims. A code or public contract replacement removes the old path in the same
slice. Renamed fields are not accepted under both names, and surfaces do not
select between old and new schemas.

### Remaining-slice replacement rule

For every remaining Roadmap 12 slice, the operator is the sole consumer of
global configuration. Refactor the global configuration directly into the
target contract and delete the replaced shape, reader, writer, tests, fixtures,
documentation, and generated artifacts in the same slice. Do not add migration
code, legacy readers, compatibility aliases, dual-state operation, deprecation
windows, or state-conversion commands. Existing local configuration may be
discarded and re-adopted through the new canonical path.

This rule does not prohibit rollback within the current contract for an atomic
mutation. It prohibits preserving or reconstructing superseded configuration
contracts.

Durable local state is evaluated separately. A slice must classify existing
records as:

- useful intent or authority evidence that requires an atomic, idempotent,
  fail-closed migration;
- reconstructible managed state that should be regenerated from its owner; or
- obsolete state with no future-useful evidence that should be discarded
  explicitly.

Migration success is proven before retiring the old state. After retirement,
there is one reader and one writer. Recovery preserves a validated backup or a
documented re-adoption path; it never preserves a live legacy execution path.

## Ordered Slices

### Slice 0 - Configuration Inventory And ADR

Status: Complete. ADR-014 and ADR-015 are ratified, the project-schema
mechanism spike passes, the property-level ownership ledger names every current
field or repeated-record property, and the ADR-012 build/diagnostic fixture
covers linked, detached, and rebuilt checkout paths. Unresolved implementation
work is transferred to the exact later slice and owner recorded in the ledger.

Inventory every reader, writer, schema, type assertion, merge rule, default,
scope, generated artifact, durable store, projection, docs owner, CLI command,
GUI/TUI control, SDK contract, and model-callable operation. Classify each
field by owner, intent versus evidence versus effective state, sensitivity,
scope, precedence, authority impact, and activation behavior.

Record the schema technology, descriptor contract, generated-artifact policy,
YAML mutation policy, and durable-state replacement rules in one ADR. The ADR
must resolve how comments and formatting are treated rather than assuming a
serializer preserves them.

Acceptance: every current field has one named owner and classification;
unowned, duplicated, contradictory, or unsafe fields are listed as blockers;
the selected schema mechanism passes a bounded fidelity spike before adoption.

Recovery: research and generated spike artifacts do not alter canonical
configuration or runtime admission.

### Slice 1 - Project Schema Pilot

Status: Complete. The project family now has one strict TypeBox runtime schema
and inferred admitted type. `readKilnYaml()` parses from `unknown` through that
boundary before named MCP, communication, and authority semantic admission;
the former root allowlist, unchecked cast, handwritten project interface, and
quality-gate validator are deleted. Versioned editor-schema and field-descriptor
artifacts are generated deterministically and drift-checked, and all public
project fixtures pass the production reader.

Use `.kiln/kiln.yaml` as the first bounded schema-first migration. Replace the
unchecked or duplicated structural type and validator paths with one runtime
schema and inferred admitted type. Keep cross-context semantic rules in named
admission functions. Generate its editor schema and descriptor artifact.

Acceptance: malformed and unknown fields fail at the boundary with stable
path-addressed diagnostics; public examples and portable fixtures validate;
the old type and validator paths are deleted in the same change.

Recovery: configuration bytes remain unchanged until the new reader validates
them; rejected existing state requires explicit correction or re-adoption, not
a fallback parser.

### Slice 2 - Effective Configuration Read Model

Status: Complete. Gateway status evidence V3 replaces the raw effective-config
record with one schema-revisioned, secret-free root-field projection. The CLI
application owner derives canonical JSON-pointer identity, effective value or
redacted presence, effective scope, selected source, default status, exact
global/project contribution chain, health, schema revision, and activation for
each returned field. Inline-secret-capable MCP, web, and hook families expose
only redacted presence. Resolved runtime detail remains request-local and is never
serialized as operator evidence.

`kiln config show`, `kiln config read`, `kiln config explain`, `kiln status`,
`kiln_config.read`, native governance inspection, SDK types, GUI setup, and TUI
setup consume that projection. Invalid broadening still fails before projection;
drifted, stale, and unproven evidence downgrade projection health rather than
appearing current. Contract, CLI, native inspection, GUI, and TUI tests cover
the shared behavior.

Define the shared secret-free configuration query contract. Each returned
value binds canonical identity, effective value or redacted presence, scope,
source, default status, override chain, health, schema revision, and activation
behavior. Extend `config read`, `config explain`, setup/status, GUI, TUI, SDK,
and `kiln_config.read` through one projection owner.

Acceptance: every surface explains the same effective value and source; project
overrides cannot silently remove safety posture; unknown, drifted, or stale
state remains visible and cannot be presented as current.

### Slice 3 - Desired Intent And Managed Evidence Separation

Status: Complete. Global configuration V4 now persists only material execution-
target intent and an exact SHA-256 reference to an immutable managed-evidence
snapshot. One admission owner validates exact account and target identity,
provider/model agreement, data policy, economics, discovery freshness, and the
referenced digest before projecting the Core execution catalog. CLI, GUI, TUI,
benchmark, model-gateway, status, account-usage, and managed-agent paths consume
that admitted projection; missing, stale, widened, or mismatched evidence fails
closed.

Target creation validates the complete pair, publishes evidence, then atomically
replaces intent under a revision fence. No active consumer state justified a
migration: the former contract, reader, writer, fixtures, and command are
deleted. Re-adoption regenerates current evidence through the V4 owner; there is
no compatibility alias, dual reader, legacy writer, or embedded-evidence
fallback.

Start with execution targets because they currently expose the largest repeated
policy and economic material. Define minimal target intent and move generated
data-policy, economic, discovery, freshness, and projection evidence to their
owning durable stores. Intent references exact admitted evidence revisions; it
does not duplicate their contents.

Replace the global target contract outright. Revalidate the complete target
catalog before publication, prove the new read model, then delete the former
shape and writer. Reconstructible evidence is regenerated by its owner.

Acceptance: the common target declaration contains only material operator
choices; admission remains at least as strict; no target executes with missing,
stale, widened, or mismatched evidence; only the new contract remains.

Recovery: invalid or obsolete state requires explicit V4 re-adoption. No
migration or dual read exists.

### Slice 4 - Configuration Mutation Authority V2

Status: Complete. The V2 authority owns both the project and
global scopes: `config-mutation-authority` builds base-revision-bound proposals,
derives authority impact by comparing current and proposed authority, requires
approval when authority expands and always for a model-called apply, commits
through same-directory temporary files and atomic replacement, converges one
reconciliation owner, reads effective state back, and settles write-once so a
retried apply replays instead of committing twice. Terminal outcomes are
`committed`, `committed-reconciliation-failed`, or `rejected`, and the runtime
session ledger projects a reconciliation-failed commit as an applied change
rather than a failure. Rollback restores exact prior bytes through a governed
`mutation.rollback` operation instead of a prose hint. Global content is edited
through the YAML document tree, so operator comments and ordering survive, and
a preference change fails closed rather than minting canonical configuration.
The V1 proposal, approval, and apply modules, their contracts, and their store
paths are deleted; no V1 records existed on disk, so nothing required migration
or explicit discard. The ownership ledger's two `T4` activation rows
(`identity.name`, `identity.timezone`) are resolved as `hot` against their
actual read sites.

`kiln config set` and `kiln config reset` now run through the authority as the
`setting.set` and `setting.reset` operations. A key table owns only the command
surface - which keys are settable, where they live, which scopes admit them, and
how an operator string becomes a value. Authority, activation, and ownership are
read from the canonical project schema descriptors, which already carry
`x-kiln-authority-impact`, so the command surface cannot become a second policy
engine; a key with no descriptor fails closed as authority-affecting. The global
family has no runtime schema until Slice 9, so its governance facts stay explicit
and ledger-sourced. An authority-bearing change requires an explicit operator
approval, which `kiln config set --approve` supplies in the same invocation.
Project results are admitted by the project schema before the write, scope must
be stated exactly, and a key resolving through a YAML alias is rejected rather
than rewritten.
Project documents are edited through the YAML document tree like global ones, so
operator comments survive, and neither scope is created implicitly by a settings
change. The in-command setter and value-parsing machinery, its `writeKilnYaml`
and unfenced `mutateGlobalConfig` calls, and the duplicated key list are deleted;
the admitted key set now has one owner.

The final cut added typed `target.select`, `target.create`, and `native.import`
operations; admitted both project and user `skill.upsert`; and migrated `kiln
target`, `kiln import-native`, and execution-route creation.
Target creation keeps managed evidence under its content-addressed owner and
binds the canonical intent to the exact already-published revision. Native
import fails closed on invalid canonical state and reconciles through the one
native-permission projection owner. The unused route-preference writer and the
unfenced object-level global mutator were deleted, leaving exact-byte commit as
the authority's single low-level global write primitive.

Standalone permission-profile and capability-enablement operations are not
part of this slice. No admitted preset vocabulary, capability catalog, or
current product caller owns them, so adding them would create speculative
configuration and a second policy vocabulary. `native.import` owns the real
permission delta that has a demonstrated consumer. Slice 5 may admit a minimal
safe-permission preset through the canonical permission owner when onboarding
proves that consumer; capability enablement waits for an admitted capability
owner and concrete first-turn requirement. Spend-guard, work-limit, and
managed-agent operations remain in Slice 7A. `kiln init` remained the one
direct first-run adoption writer and transferred to Slice 5 rather than
becoming a settings mutation.

Concurrency and crash behavior are explicit. The window from revision recheck
through settlement is held under a path-scoped cross-process lock whose owner is
reclaimed when its process is gone, so two applies cannot both pass the fence
and overwrite each other. An apply entering that window writes a durable
progress marker, and recovery resumes only a commit that this exact proposal
started: byte-identical content written by anyone else is a conflict, not an
interrupted commit. Settlement records are linked into place, so a crash cannot
leave a truncated record that fails to parse forever.

Known residual risk carried into later slices: multi-path atomicity is
unproven because every admitted operation writes exactly one canonical path; a
rollback whose restored surface has no complete authority evaluator fails closed
as `unknown`, which requires approval even when the restore is harmless; and
`setting.set` classifies authority from schema metadata rather than comparing
values, so narrowing an authority-bearing key also requires approval. A future
permission-profile consumer must first prove ordered comparison and the
merger's attenuation semantics; the current command surface therefore keeps
global `permissions.*` unavailable rather than introducing a partial contract.
Target creation may leave an unreferenced immutable evidence snapshot when its
later config proposal loses the revision fence. That snapshot is not authority
until canonical intent references its exact digest; the evidence-store owner
may add garbage collection only when retained snapshots become an observed
operational cost.

Generalize the existing governed lifecycle without creating a generic patch
escape hatch. Add typed operations such as preference selection, provider
connection intent, model-target creation or disablement, permission-profile
selection, spend-guard changes, work-limit changes, managed-agent configuration,
and capability enablement. Public operations accept desired intent and never raw
economic policy, evidence, reservation, or settlement material. Every proposal
binds its base revision, normalized operation, affected owners, preview,
authority impact, activation plan, validation diagnostics, and rollback evidence.

Apply requires the matching durable approval when authority expands, rejects a
stale base, writes atomically, invokes the single reconciliation owner, reads
back effective state, and reports committed, committed-but-reconciliation-
failed, or rejected outcomes honestly.

Acceptance: CLI, GUI, TUI, SDK, and agent tools invoke the same application
ports; no surface writes files directly; retries cannot duplicate a committed
operation; partial reconciliation never masquerades as mutation rejection.

Recovery: the previous exact revision remains restorable through the same
authority. Rollback is another validated operation, not filesystem copying.

### Slice 5 - Guided Onboarding

Status: Complete. The shared secret-free onboarding contract derives readiness
from canonical project configuration and the current globally admitted direct
target catalog. Its only Slice 5 permission posture is `read-only`; broader
permission choices remain governed settings work. It stores no completion flag,
step, draft, provider material, credential, or machine path.

`kiln init` and GUI Settings > Configuration invoke the same onboarding
application port. Project adoption is a typed `project.adopt` operation through
the Slice 4 authority, and default-target changes use the governed
`target.select` operation. The CLI provides interactive confirmation and
deterministic `--non-interactive`, `--target-id`, and `--approve` inputs. A
declined confirmation or target-selection approval returns before apply, so
cancellation writes nothing. `--approve` cannot choose an unnamed first catalog
entry: changing an absent default requires an exact target identity. Reruns
derive `complete` from canonical state and perform no mutation after successful
reconciliation; a committed reconciliation failure remains `ready` and is
retried through a new governed settlement before the first turn. The existing
path lock stays held through reconciliation and settlement, while the durable
in-progress marker keeps the read model at `ready`; concurrent retries fail
closed and cannot hide a later reconciliation failure. Terminal markers are
ignored and cleaned without leaving onboarding permanently pending after a crash;
an interrupted write resumes its exact proposal and approval so rollback still
restores the pre-crash bytes; other operations targeting the same canonical path
fail closed until recovery settles.
The GUI keeps
its draft only in component memory and
requires the ephemeral local operator capability for apply; remote attach has
no mutation token and remains read-only.

The bounded first-turn proof starts from an already admitted current direct
target. A completely virgin provider and target cannot be admitted honestly
without data-policy, economic, discovery, and identity evidence. Manufacturing
that evidence in onboarding would create a second authority and duplicate the
Slice 7 target wizard. Slice 5 therefore does not ask for provider connection,
paid-usage posture, capabilities, or raw route material when no owner can yet
complete those choices. It blocks with an actionable explanation and transfers
true provider-to-target first run to Slice 7.

The obsolete init templates and direct project writer were deleted. `kiln init`
no longer creates `app.yaml`, `gateway.yaml`, memory directories, channels,
team mode, or provider intent; deployable app and gateway authoring remains with
Slice 9. Project adoption and target selection still touch separate canonical
paths, so an unexpected second-operation failure can settle honestly as
`partial`; routine missing approval is preflighted before either write.

Acceptance evidence: cancellation and declined approval are side-effect free;
stable rerun is a no-op and failed reconciliation is not forgotten;
an in-progress reconciliation never reports `complete`, and concurrent recovery
attempts never publish competing terminal outcomes;
non-interactive target changes are explicit; the adopted project composes to
`on-request` or stricter approval with a `read-only` sandbox; structurally valid
but globally inadmissible project policy blocks before readiness; the first
route resolves to the exact admitted provider/model; GUI apply rejects a missing
or incorrect local capability; and wire results redact paths, including paths
with spaces, and credential-like diagnostics.

### Slice 6 - Searchable Settings Foundation

Status: Complete. Slices 1, 2, 4, and 5 provide the descriptor,
effective-value, mutation, and first-run surface contracts.

Build one cross-surface settings information architecture: General, Providers,
Models, Permissions, Tools, Usage and Limits, Agents, Health, and Advanced.
Usage and Limits separates editable spend guards and work limits from read-only
provider allowance, reset, observed usage, estimate, reservation, settlement,
freshness, and confidence. Common settings use curated task controls. Advanced
mode provides descriptor-backed search, scope and source inspection, open-YAML,
import/export, and validation; it does not expose an unbounded generated form
tree by default.

Each control shows whether a value is inherited or overridden, where it will be
written, what authority changes, and when it takes effect. Modified values can
be filtered and reset to inheritance through a typed operation.

Acceptance: keyboard, narrow-layout, screen-reader, pending, conflict,
reconciliation-failure, and focus-restoration behavior pass on real flows;
surface state always comes from the shared read model.

Delivered one schema-revisioned, secret-free settings snapshot for CLI, TUI,
and GUI with the nine canonical sections, descriptor-backed controls,
provenance, write scope, authority impact, activation, health, and modified
state. `kiln config settings [query] [--modified]` and TUI `/settings [query]` consume
that snapshot; GUI adds keyboard search, narrow navigation, curated controls,
proposal review, revision-fenced apply, keyed reset to inheritance, focused
conflict and reconciliation feedback, safe export validation, and bounded
open-YAML access. The superseded Appearance, Configuration, and Available
Models settings routes and the whole-scope reset behavior were deleted.

Usage and Limits does not manufacture economic facts. It renders admitted work
limits and explicitly leaves provider allowance, observed usage, estimates,
reservations, settlements, freshness, and confidence unreported until their
existing runtime owners project them through Slice 7A. The category boundary is
present now; economic evidence and managed-agent intent remain owned by Slice
7A rather than becoming settings-local state.

### Slice 7 - Available Models Target Wizard

Status: Complete. Slices 3, 4, and 6 provide the required evidence, mutation,
and settings-surface contracts.

Replace raw target-material JSON with a guided wizard backed by current Available
Models evidence. The operator selects a discovered model and answers only
material unresolved choices. Runtime constructs and admits provider identity,
account selection, data policy, economics, capability, and revision evidence.
Advanced review may expose the normalized proposal but cannot bypass admission.

Acceptance: a current eligible model can be added from CLI or GUI without
typing internal IDs or evidence; stale discovery, changed identity, missing
policy, revision conflict, or authority widening fails before mutation;
success, rejection, and committed-but-reconciliation-failed are correlated and
actionable.

Delivered one typed preview/apply protocol shared by CLI, GUI, and Runtime.
The operator selects one unambiguous discovered provider/model, chooses a data
classification and optional label, and explicitly confirms the conservative
data-policy posture. Kiln derives a collision-safe target identity, the unique
configured provider account or account policy, provider execution capability,
economic evidence, policy evidence, and current revisions. Preview performs
full admission without publishing; apply re-resolves current evidence and is
bound to the exact normalized proposal. A full discovery revision retains the
complete observation, while a material revision omits only refreshed observation
timestamps and binds expiry, raw provenance, eligibility and policy state, and
exact adapter model capabilities. Every apply re-resolves current discovery;
materially changed same-identity evidence fails closed and negative tool evidence
narrows the target to text-only. Stale discovery, identity drift,
ambiguous or absent accounts, missing provider capability/economics, revision
drift, and unapproved authority expansion fail before mutation. The removed raw
material request, legacy frames, source-file/stdin command path, and GUI JSON
editor have no compatibility alias.

### Slice 7A - Managed-Agent Intent And Economic Visibility

Status: Complete for code and integration. Focused CLI, Runtime, Gateway,
GUI, and TUI tests and affected package typechecks pass; live provider/runtime
validation is intentionally unrun because the operator Runtime is unavailable.
Slices 4, 6, and 7 supplied the mutation, projection, and guided target
contracts.

Replace operator-authored managed economic policy material with minimal
managed-agent intent. Common setup captures agent purpose, authority profile,
inherited or explicit target/model choice, admitted work limits, and paid-usage
posture. The economic authority derives immutable policy identity, comparable
candidate material, reservation, commitment, and settlement evidence without a
second policy owner or UI-local defaults.

Project one cross-surface managed-run explanation: selected target and reason,
billing class, provider allowance when reported, work-limit progress, reserved
and settled amounts when comparable, per-child consumption, evidence freshness,
and terminal cause. Reaching a limit returns a bounded partial handoff and
distinguishes work-limit exhaustion, provider exhaustion, spend denial, and
technical failure.

Acceptance: a new operator can configure a bounded reviewer agent and prevent
additional spend without editing YAML or naming an internal policy; unsupported
hard monetary caps fail closed with an explanation; hidden fallback cannot
change economics after commitment; fan-out and per-child consumption are
visible; limit termination preserves available partial evidence. The replaced
economic intent shape, validator, reader, writer, fixtures, docs, and operations
are deleted in the same slice with no alias or dual read.

Delivery evidence: `managedAgents.intents[]` is the only operator-authored
managed-agent economic input. CLI composition derives ephemeral policy identity,
candidate and reservation material from the canonical execution catalog, while
Runtime remains the commitment and settlement authority. The shared session
event, Gateway cockpit projection, CLI, GUI, and TUI expose selected target and
reason, billing, allowance, work progress, comparable reservation/settlement,
per-child consumption, freshness, and distinct terminal causes without secrets
or workspace paths. The retired economic policy fixture and test are removed;
negative validation proves the old YAML shape is rejected.

### Slice 8 - Live Activation And Reconciliation

Status: In progress. The shared activation observation, Runtime turn/session
revision evidence pinning, target-aware generation-fenced reconciliation, and
convergent status projection are implemented. Hot activation requires read-back
proof; legacy settlements fail closed; rollback uses the governed mutation and
reconciliation path. Operator turns now compose and persist one immutable,
secret-free, content-addressed `EffectiveAuthorityAdmissionBundle` from the
session skill/ceiling, work governance, exact tool permissions/effect ceiling,
session-turn budget, sanitized route/data-policy decision, execution binding,
and economic commitment evidence where one exists. Route, account, credential,
and budget admission precede provider dispatch. At this checkpoint credential
material remains ephemeral after the current capacity `dispatch-fenced` state;
the Execution Kernel decision now classifies that as resource commitment, not
the final action fence. Canonical run, GUI, TUI, and most App
Gateway ingress now carry the committed revision and bundle rather than
re-reading live configuration. App Gateway admission also captures gateway/app
configuration digests, records the true requested authority, supplies the
configured session budget, fences native delegation, and owns early-startup
cleanup.

The issue #98 Execution Kernel convergence is complete in this checkpoint;
Slice 8 remains in progress for its separate activation families. Runtime now
owns one named durable action claim immediately before every Kiln-owned
consequential model-round, tool, media, channel-egress, Agent Task, and managed
external-invocation effect. Exact replay returns no permit, post-fence
cancellation, timeout, restart, transport failure, and adapter fallback cannot
redispatch the attempt, and workload owners retain their real settlement and
reconciliation domains. Native and remote harnesses remain opaque: Kiln fences
only the launch or send it owns and makes no claim about hidden inner effects.

The complete `EffectiveAuthorityAdmissionBundle` and its persisted read-back
receipt are the only consequential execution authority. The obsolete
revision, route, binding, turn, adoption, and effective-authority fields in
`PerCallToolConfig`, their reconstruction paths, and their bundle-to-legacy
projection are deleted outright. Model Gateway remains ingress and target
resolution into the Runtime kernel; Core, GUI, TUI, CLI, SDK, and adapters do
not own a parallel lifecycle. No production descriptor owns
`restart-required`; supervisor drain and restart wiring remains deferred until
Slice 9 admits a real configuration family and owner.

Completion evidence (2026-08-22): repository source and test typechecking,
production build, documentation validation, and diff whitespace validation
pass. The component suites pass 10,904 tests: scripts 248; foundation 4,176;
Runtime 3,248; CLI 2,506; and surfaces 726. Six platform- or
permission-specific tests remain intentionally skipped. Focused claim-store,
crash, replay, cancellation, settlement, harness-ingress, and authority
cutover tests are included in those lanes.

#### Pre-resumption gates (operator decision 2026-08-22)

No new Slice 8 production integration begins until all of these bounded gates
are complete:

1. **Active-branch CI** — [#96](https://github.com/sequelcore/kiln/issues/96)
   runs the existing complete workflow for `dev` without deleting, weakening,
   or allowing failure in a lane. This is validation reachability, not a new
   release process.
2. **Execution Kernel ownership** — decision complete in
   [Execution Kernel](../architecture/core/execution-kernel.md). The decision
   distinguishes resource commitments from the canonical action claim, maps
   `admit -> acquire -> resolve binding -> persist admission -> dispatch fence
   -> execute -> settle/reconcile`, binds
   `EffectiveAuthorityAdmissionBundle.admissionId` at
   the fence, retains workload-owned claim stores and recovery, and limits an
   external-harness claim to the invocation Kiln launches. The full
   [#98](https://github.com/sequelcore/kiln/issues/98) migration is not a
   resumption gate.
3. **Deterministic recovery oracle** — the bounded Slice 8 subset of
   [#97](https://github.com/sequelcore/kiln/issues/97) covers configuration
   mutation during an admitted turn, crash before and after the dispatch fence,
   crash before settlement, duplicate replay/ingress, cancellation-settlement
   races, and restart with active evidence. A generic chaos platform and the
   complete credential-bearing live matrix are not resumption gates.
4. **Recoverable checkpoint** — commit `bf43298b` exists on a remote checkpoint
   ref before more production work starts, and the three recorded fixture groups
   pass root test typechecking. This preserves the exact paused candidate and a
   usable compile oracle; it is not Slice 8 completion evidence.

The ownership decision must update the canonical Runtime architecture before
its first consumer changes. The synthetic oracle must exercise existing
observable contracts rather than introduce a second lifecycle or state owner.
That resumption work is now complete: the legacy `PerCallToolConfig` authority
path is deleted, and managed-child, Model Gateway, webhook, media, channel, and
tenant-WebSocket execution converge on the decided boundary without a
compatibility or dual-read path.

Implement activation behavior as an explicit contract. Hot preferences apply
immediately. Next-turn and next-session changes bind the new revision at their
defined boundary. Reconcile changes update owned projections or runtime
catalogs through generation fencing. Restart-required changes use the owning
supervisor and graceful drain. Authority-expanding changes remain approval
gated regardless of activation speed.

In-flight executions retain their committed revision. No live setting may
alter permissions, route, budget, data policy, or credential authority midway
through an admitted effect.

Acceptance: activation ordering, in-flight revision stability, projection
failure, rollback, and status convergence are deterministic and visible from
every surface. `restart-required` remains deterministically unsupported until
Slice 9 admits a real configuration family, supervisor, and graceful-drain
owner; Slice 8 must not simulate that proof.

### Slice 9 - Remaining Configuration Families

Status: Blocked on the project pilot and global intent proof.

Migrate global, app, and gateway configuration one bounded owner at a time.
Generate separate schemas and descriptors, retain graph and cross-resource
admission in composition owners, validate all examples, and delete each
superseded path atomically. Do not infer one family's merge, scope, or
activation semantics from another.

Acceptance: every public family has one runtime schema, admitted type, editor
schema, diagnostics contract, mutation posture, and docs owner; no production
reader returns asserted typed YAML.

### Slice 10 - Cross-Surface Promotion And Cleanup

Status: Blocked on vertical task proofs.

Prove configuration parity across CLI, GUI, TUI, SDK, Codex, Claude, and
OpenCode V2. Promote stable contracts and operations to architecture and
task-oriented guides. Remove duplicated reference tables, stale examples,
superseded generated artifacts, obsolete state, and transitional roadmap prose.

Acceptance: each supported operation has one semantic result across surfaces;
no surface recomputes policy, scope, defaults, activation, or rollback; all
named legacy residues are removed or classified as durable migration evidence.

## Promotion Gates

- Every field has one structural schema owner and one semantic admission owner.
- Desired intent, managed evidence, and effective state have distinct storage
  and dependency direction.
- Common setup and model-route tasks require no manual YAML or raw material
  JSON.
- Common managed-agent setup requires no economic policy ID, revision,
  comparison-domain, reservation, or settlement input.
- Usage, provider allowance, spend guards, work limits, context limits, and
  reservations retain distinct names and owners across every surface.
- YAML remains complete, schema-assisted, reviewable, exportable, and usable by
  automation.
- Every exposed value reports scope, source, override, and activation behavior.
- All mutations use typed operations, revision fencing, atomic writes, and
  read-back verification.
- Authority expansion is previewed and approved before mutation or external
  effect.
- Secrets remain in credential authorities and never enter canonical intent,
  previews, schemas, logs, or public evidence.
- Live changes preserve in-flight revision identity and use the correct
  reconciliation or supervisor owner.
- Migration leaves one reader and writer; no compatibility alias, fallback,
  legacy writer, or dual-state authority remains.
- Independent product, accessibility, security, configuration-boundary, and
  findings-first reviews have no unresolved high or medium findings.

## Verification

Each slice begins with focused behavioral evidence and ends with the affected
schema, application, projection, and surface gates. Verification is selected by
the dependency surface rather than by test count.

The track-level evidence set must include:

- schema/type drift and generated-artifact reproducibility;
- malformed, unknown-field, cross-field, and secret-bearing negatives;
- scope, precedence, source, inheritance, and effective-value conformance;
- proposal, approval, stale revision, atomicity, idempotency, and rollback;
- committed-but-reconciliation-failed and restart-failed outcomes;
- durable-state migration interruption, conflict, idempotency, and retirement;
- CLI onboarding cancellation, rerun, and non-interactive output;
- GUI/TUI accessibility, keyboard, narrow-layout, pending, error, and focus
  behavior;
- cross-surface semantic fixtures for the same operation and revision;
- representative operator usability tasks measuring successful completion,
  configuration errors, time to recover, and need to open advanced YAML;
- managed-agent fan-out, per-child usage, economic-transition approval,
  enforceable-cap negatives, limit termination, and partial-handoff evidence.

Live validation requires explicit operator authority when it touches real
credentials, subscriptions, native harness configuration, network access,
restart, or destructive restore. Synthetic portable fixtures remain the
default for tests and persisted evidence.

## Completion Criteria

This track is complete when a new operator can connect an admitted provider,
select a model, choose a safe posture, and run Kiln without editing YAML; an
existing operator can discover, explain, change, preview, apply, reconcile, and
rollback common settings from any supported surface; and an advanced operator
retains the complete declarative configuration surface with schema validation
and exact authority semantics.

A new operator must also be able to configure a bounded managed agent, prevent
unapproved additional spend, inspect allowance and per-agent consumption, and
understand why work stopped without learning Kiln's internal economic evidence
model.

Completion also requires that configuration no longer mixes human intent with
duplicated managed evidence, that every effective value identifies its owner
and source, and that all replaced readers, writers, state shapes, aliases, and
documentation paths have been removed or promoted as bounded migration
evidence. Stable doctrine moves to architecture and guides, delivery evidence
moves to the release record, and this roadmap is removed.
