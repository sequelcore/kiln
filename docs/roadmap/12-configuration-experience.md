# 12 - Configuration Experience

Status: In progress
Priority: Urgent
Execution: Slices 0-2 complete - begin Slice 3 desired-intent and managed-evidence separation.
Created: 2026-08-14
Reprioritized: 2026-08-20

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
current product track. Execute bounded slices through Slice 5's first safe turn
without opening YAML, updating the queue after each slice, then reassess Kiln
Connect sequencing. This is a product sequence, not a claim that every slice in
this track is a technical dependency of Connect. Roadmap 08.5 Slice 0 remains
independently admissible safety hardening.

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
- GUI setup and Available Models pages exist, but the latter still exposes raw
  material JSON for policy and economics instead of a guided product flow;
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
  Budgets, Agents, Health, and Advanced sections.
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

Status: Ready.

Start with execution targets because they currently expose the largest repeated
policy and economic material. Define minimal target intent and move generated
data-policy, economic, discovery, freshness, and projection evidence to their
owning durable stores. Intent references exact admitted evidence revisions; it
does not duplicate their contents.

Migrate useful global state atomically. Revalidate the complete target catalog
before publication, prove the new read model, then retire the former
shape and writer. Evidence that can be reconstructed is regenerated instead of
copied blindly.

Acceptance: the common target declaration contains only material operator
choices; admission remains at least as strict; no target executes with missing,
stale, widened, or mismatched evidence; only the new contract remains.

Recovery: migration publishes the new state only after complete validation and
retains one bounded recoverable backup or explicit re-adoption path. No dual
read follows publication.

### Slice 4 - Configuration Mutation Authority V2

Status: Blocked on the read model and first intent contract.

Generalize the existing governed lifecycle without creating a generic patch
escape hatch. Add typed operations such as preference selection, provider
connection intent, model-target creation or disablement, permission-profile
selection, budget changes, and capability enablement. Every proposal binds its
base revision, normalized operation, affected owners, preview, authority
impact, activation plan, validation diagnostics, and rollback evidence.

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

Status: Blocked on Slices 1, 2, and 4.

Implement a minimal first-run CLI flow and the equivalent GUI entry point. Ask
only for provider connection, default target, safe permission posture,
scope, and optional capabilities required for the first useful run. Resolve
defaults and presets through canonical owners and emit only intent that differs
materially from defaults.

Acceptance: a new operator can complete a safe first turn without opening YAML;
cancellation causes no partial state; rerun is idempotent; non-interactive mode
is deterministic; secrets and machine paths are never written to canonical
configuration.

### Slice 6 - Searchable Settings Foundation

Status: Blocked on the descriptor and mutation contracts.

Build one cross-surface settings information architecture: General, Providers,
Models, Permissions, Tools, Budgets, Agents, Health, and Advanced. Common
settings use curated task controls. Advanced mode provides descriptor-backed
search, scope and source inspection, open-YAML, import/export, and validation;
it does not expose an unbounded generated form tree by default.

Each control shows whether a value is inherited or overridden, where it will be
written, what authority changes, and when it takes effect. Modified values can
be filtered and reset to inheritance through a typed operation.

Acceptance: keyboard, narrow-layout, screen-reader, pending, conflict,
reconciliation-failure, and focus-restoration behavior pass on real flows;
surface state always comes from the shared read model.

### Slice 7 - Available Models Target Wizard

Status: Blocked on Slices 3, 4, and 6.

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

### Slice 8 - Live Activation And Reconciliation

Status: Blocked on Slice 4.

Implement activation behavior as an explicit contract. Hot preferences apply
immediately. Next-turn and next-session changes bind the new revision at their
defined boundary. Reconcile changes update owned projections or runtime
catalogs through generation fencing. Restart-required changes use the owning
supervisor and graceful drain. Authority-expanding changes remain approval
gated regardless of activation speed.

In-flight executions retain their committed revision. No live setting may
alter permissions, route, budget, data policy, or credential authority midway
through an admitted effect.

Acceptance: activation ordering, in-flight revision stability, drain, restart,
projection failure, rollback, and status convergence are deterministic and
visible from every surface.

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
  configuration errors, time to recover, and need to open advanced YAML.

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

Completion also requires that configuration no longer mixes human intent with
duplicated managed evidence, that every effective value identifies its owner
and source, and that all replaced readers, writers, state shapes, aliases, and
documentation paths have been removed or promoted as bounded migration
evidence. Stable doctrine moves to architecture and guides, delivery evidence
moves to the release record, and this roadmap is removed.
