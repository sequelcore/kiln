# Configuration Surface Inventory

Status: active repository inventory for Roadmap 12 Slice 0.

Owner: [Roadmap 12 — Configuration Experience](../../roadmap/12-configuration-experience.md)

Evidence cutoff: `dev` at
`3fa87a53748aad1337fd1349d45fc706f21562aa`, inspected 2026-08-20 with the
operator-owned dirty worktree paths excluded.

Promotion targets: the Roadmap 12 schema and mutation ADR, configuration
architecture, generated-schema policy, and the bounded fidelity spike.

Exit condition: every configuration field has a ratified structural and
semantic owner; blockers and unknowns are resolved or transferred to an exact
roadmap dependency; the accepted decisions are promoted to an ADR; and the
unique inventory evidence is deleted or reduced to durable evidence that the
ADR cannot carry.

## Question

What configuration contracts, readers, writers, merge rules, evidence stores,
projections, mutation paths, and surface consumers exist now, and which
contradictions must block schema-first implementation until Roadmap 12 assigns
one owner and one lifecycle to each field?

## Method And Limits

Three independent repository scouts inspected:

1. global and project configuration;
2. app and gateway configuration;
3. effective-state projection, mutation, setup, Available Models, target
   creation, and cross-surface consumers.

The synthesis traced source imports, callers, contract schemas, persistence,
tests, documentation, and generated/native edges. Text search was treated as a
lead rather than dependency proof. High-impact claims were checked against the
owning source. The generated gateway incompatibility was also reproduced by
passing `generateGatewayYaml()` output directly to `parseGatewayYaml()`.

This inventory did not inspect operator-specific files under `~/.kiln`,
installed package copies, generated `dist`, `node_modules`, external npm
consumers, or live native harness behavior. Field classifications marked
**inference** are proposed inputs to the ADR, not current executable metadata.

## Findings That Block Schema Implementation

### B1 — `kiln init` generates a gateway document its loader rejects

The init template emits `apps[*].path` and `modeB`
([`init-templates.ts`](../../../packages/cli/src/commands/init-templates.ts#L118)),
while the gateway loader consumes `apps[*].config` and rejects unknown root
fields
([`gateway-loader.ts`](../../../packages/core/src/engine/gateway/gateway-loader.ts#L194)).

A bounded Bun probe passed the generated document directly to
`parseGatewayYaml()` and received:

```text
Invalid gateway YAML:
  apps[0].config: must be a non-empty string
```

This is a proven generated-artifact/reader contradiction. Existing template
tests validate YAML syntax and selected keys but do not admit the generated
document through the production loader
([`init-templates.test.ts`](../../../packages/cli/tests/commands/init-templates.test.ts#L89)).

### B2 — Project effective status bypasses the runtime narrowing check

Runtime composition uses `deriveEffectiveKilnYaml()`, which calls
`assertProjectDoesNotBroadenGlobal()` before merging
([`config-merger.ts`](../../../packages/cli/src/config/config-merger.ts#L100)).
`readConfigStatusSnapshot()` instead calls `mergeKilnYaml()` directly
([`config-status.ts`](../../../packages/cli/src/application/config-status.ts#L355)).

The status projection can therefore describe an effective configuration that
the runtime composition boundary rejects. A focused negative fixture must prove
the exact divergence before the ADR assigns the shared effective-state owner.

### B3 — Project YAML is asserted after partial validation

`readKilnYaml()` rejects unknown root fields and validates selected MCP, skill,
and communication concerns, then returns parsed YAML as `KilnProjectConfig`
([`kiln-yaml.ts`](../../../packages/cli/src/kiln-yaml.ts#L89)). Most nested
permissions, web, interactive-use, quality-gate, context-governance, numeric,
and governance fields do not pass one complete structural boundary.

This is the admitted reason that `.kiln/kiln.yaml` is the Slice 1 pilot. The old
asserted type and partial validation path must not survive beside the new
runtime schema.

### B4 — App configuration has overlapping readers and incomplete admission

`parseAppYaml()` maps one `RawApp` contract
([`app-loader.ts`](../../../packages/core/src/engine/loader/app-loader.ts#L1549)),
while runtime mode and events are parsed independently from the same bytes
([`runtime-mode-loader.ts`](../../../packages/core/src/engine/gateway/runtime-mode-loader.ts#L124),
[`events-loader.ts`](../../../packages/core/src/engine/gateway/events-loader.ts#L8)).

The main loader does not call `validateAppGraph()`. Repository references to
that validator were found only in its declaration and tests
([`app-loader.ts`](../../../packages/core/src/engine/loader/app-loader.ts#L1699)).
Runtime resolution catches runtime-mode and event parse errors and continues
without those sub-configurations
([`app-resolver.ts`](../../../packages/runtime/src/gateway/app-resolver.ts#L44)).

The app pilot must distinguish structural fields, app-graph semantic admission,
and optional runtime degradation. It cannot encode all three as one oversized
schema refinement.

### B5 — Declared app fields can be discarded by the loader

The domain contract declares knowledge mode, reranker, contact memory,
contextual chunking, source type, and evaluation scorer policies
([`knowledge-config.ts`](../../../packages/core/src/engine/domain/knowledge-config.ts#L31),
[`eval-config.ts`](../../../packages/core/src/engine/domain/eval-config.ts#L15)).
The raw app shapes and mappers omit some of them
([`app-loader.ts`](../../../packages/core/src/engine/loader/app-loader.ts#L153)).

Runtime nevertheless reads some of the omitted knowledge fields from the typed
app object
([`gateway-server.ts`](../../../packages/runtime/src/gateway/gateway-server.ts#L584)).
The inventory must resolve whether each field is supported intent, obsolete
contract residue, or a missing reader path.

### B6 — Canonical writers do not share one mutation lifecycle

The global mutation primitive provides byte revisions, expected-revision CAS,
an interprocess lock, validation, same-directory temporary writes, and atomic
replacement
([`global-config.ts`](../../../packages/cli/src/config/global-config.ts#L243)).
Other writers bypass the governed proposal lifecycle:

- project `config set/reset` calls the direct `writeKilnYaml()` writer
  ([`config.ts`](../../../packages/cli/src/commands/config.ts#L180));
- target selection and target creation mutate global config directly
  ([`target.ts`](../../../packages/cli/src/commands/target.ts#L32),
  [`execution-route-creation.ts`](../../../packages/cli/src/application/execution-route-creation.ts#L14));
- persisted theme changes call the global primitive directly
  ([`operator-theme-preferences.ts`](../../../packages/cli/src/application/operator-theme-preferences.ts#L47));
- `kiln init` writes project, app, and gateway YAML directly
  ([`init.ts`](../../../packages/cli/src/commands/init.ts#L151));
- cron mutation rewrites `app.yaml` directly
  ([`cron.ts`](../../../packages/cli/src/commands/cron.ts#L142)).

Direct human operations are not automatically defects. The blocker is the lack
of one typed application-port contract defining which operations require
proposal, approval, revision fencing, atomicity, reconciliation, and rollback.

### B7 — Governed apply overstates atomicity and reconciliation success

Stored proposals and approvals are parsed with unchecked JSON assertions
([`config-mutation-store.ts`](../../../packages/cli/src/application/config-mutation-store.ts#L26)).
Apply performs sequential `writeFileSync()` calls
([`config-apply.ts`](../../../packages/cli/src/application/config-apply.ts#L67)).
Projection errors become warnings while the result remains `status: "applied"`
([`config-apply.ts`](../../../packages/cli/src/application/config-apply.ts#L86)).

By contrast, target creation already distinguishes `created`,
`committed-refresh-failed`, and `rejected`
([`execution-route-creation.ts`](../../../packages/gateway-contracts/src/execution-route-creation.ts#L24)).
Roadmap 12 should generalize that honest terminal-state distinction.

### B8 — Effective configuration is not a field-level read model

`KilnConfigStatusSnapshot` is a real shared transport contract, but its
effective payload is not a descriptor-backed collection of canonical values
([`config-status.ts`](../../../packages/gateway-contracts/src/config-status.ts#L697)).
It cannot currently report, per field, owner, source, scope, default status,
override chain, sensitivity, authority impact, schema revision, or activation
behavior.

The SDK exports status types but exposes no config query or mutation method
([`types.ts`](../../../packages/sdk/src/types.ts#L8),
[`index.ts`](../../../packages/sdk/src/index.ts#L14)). Cross-surface parity is
therefore type exposure, not yet behavior parity.

### B9 — Activation and rollback are mostly undocumented behavior

No inspected configuration contract defines the Roadmap 12 activation enum:
`hot`, `next-turn`, `next-session`, `reconcile`, or `restart-required`.
`KilnConfigChangeProposal` has a rollback hint, not a rollback operation or
evidence contract
([`config-mutation.ts`](../../../packages/gateway-contracts/src/config-mutation.ts#L22)).

Observed behavior provides leads only:

- session theme changes can apply immediately;
- native projections require explicit reconciliation;
- app/gateway development watchers report restart required;
- target creation can commit while catalog refresh fails;
- most CLI, GUI, TUI, and run paths load resolved config at startup.

These observations must become explicit descriptors and lifecycle tests rather
than surface-local inference.

## Configuration Families And Owners

| Family | Canonical structural owner | Semantic/composition owner | Current mutation posture | Effective-state coverage |
| --- | --- | --- | --- | --- |
| Global `~/.kiln/config.yaml` | CLI `KilnGlobalConfig` plus handwritten validators | CLI composition with Core-owned routing, MCP, economics, communication, voice, and gateway contracts | Atomic global primitive; several direct typed and untyped callers | Source status plus merged raw effective object |
| Project `.kiln/kiln.yaml` | CLI handwritten `KilnProjectConfig`; partially validated reader | CLI merge and widening admission | Direct non-atomic writer plus hash-fenced governed writes | Included in raw effective object; status merge bypasses narrowing admission |
| `app.yaml` | Core `RawApp` mapper plus domain types | Core app validators and Runtime startup | Init and cron direct non-atomic writes | Not represented in `KilnConfigStatusSnapshot` |
| `gateway.yaml` | Core gateway loader and handwritten nested validators | Core gateway validation plus Runtime binding/startup | Init direct non-atomic write | Not represented in `KilnConfigStatusSnapshot` |

The shared YAML extension does not make these one bounded context, schema, or
merge policy.

## Field Group Inventory

The paths below group repeated records only when the current source defines one
shared structural shape. `Intent`, `evidence`, and activation classifications
are ADR inputs where the code does not encode them.

### Global configuration

| Field group | Current owner | Plane | Sensitivity / authority | Scope and activation |
| --- | --- | --- | --- | --- |
| `version`, `identity.*`, `activeInstructionProfiles[]` | CLI global config | intent | identity and profile selection; no raw secret | global; next-session or reconcile unknown |
| `workGovernance.*`, including direct-execution limits, delegation triggers, evidence, allowed/denied roots, and maximum limits | CLI config; work-governance application owns decisions | intent | high authority over work effects | global default, project may narrow; next invocation/session unknown |
| `engines.<id>.{enabled,billing}` | CLI config | intent plus billing classification | execution availability and economics | global; next-session/reconcile unknown |
| `targetCatalog.accounts[]`, `.accountPolicies[]`, `.targets[]` | CLI structural config; Core execution routing and data/economic admission | mixed intent and managed evidence | credential references, provider/model identity, classification, data-policy and price evidence; high | global only; next-turn/session/reconcile unknown |
| `targetRouting.defaultTargetId` | CLI config; Runtime target admission | intent | changes execution selection; high | global default; next session/turn unknown |
| `authorityProfiles[]`, `permissions.*`, `permissionCeiling.*` | CLI structural config; permission/runtime owners | intent | workspace, tool, network, memory, write, and approval authority; critical | global with project narrowing; next session/reconcile unknown |
| `sessionTurnBudget.*`, `managedAgents.*`, `managedAgents.economicPolicies[]` | CLI config; Runtime/Core budget and managed-agent owners | mixed intent and evidence | budgets, target candidates, reservations, approval and worktree authority; high | global; next turn/session unknown |
| `mcp.servers.<id>.*`, `hooks.<event>[]` | Core MCP contract and CLI hook config | intent | command, URL, environment/credential references and external effects; high | global plus project additive/override MCP; reconcile/next session unknown |
| `modelTaskSuitability[]`, `deliberationPolicy.*`, `communication.*` | Core policy contracts, CLI persistence | mixed intent and evidence revision/reason | model/provider and response behavior; medium | global with project communication precedence; next turn/session unknown |
| `web.*`, `skills.*`, `components.include[]` | CLI structural config and feature owners | intent plus external-catalog fingerprints | network providers, visibility, package digests; medium | global defaults; project owns selected narrowing/extensions; reconcile/next session unknown |
| `ui.{theme,targetSelection}` | CLI global config and surface controllers | intent | preference; target selection can affect execution | global operator preference; theme hot/session or persisted, target activation unknown |
| `operatorVoice.*` | Core voice contract, CLI persistence | intent | command/environment references and artifact retention; medium/high | global; next session unknown |
| `modelGateway.*` | Core gateway contract, CLI persistence, Runtime ingress | mixed intent and evidence references | principals, scopes, tokens by env, replay HMAC, virtual targets, budgets; critical | global; restart/reconcile likely but not declared |

The complete structural declarations live in
[`global-config.ts`](../../../packages/cli/src/config/global-config.ts#L113),
[`kiln-yaml-types.ts`](../../../packages/cli/src/kiln-yaml-types.ts#L33), and
the referenced Core routing, MCP, voice, communication, and gateway contracts.

### Project configuration

| Field group | Current owner | Plane | Sensitivity / authority | Precedence and activation |
| --- | --- | --- | --- | --- |
| `version`, `domain`, `channels[]`, `teamMode`, `maxDepth`, `parallelWorkers`, `requireApproval` | CLI project config | intent | execution shape and approval posture | project; startup/session unknown |
| `activeInstructionProfiles[]`, `workGovernance.*` | CLI config and governance owner | intent | work authority; high | lists merge/deduplicate; project posture/direct limits may narrow |
| `mcp.servers.<id>.*` | Core MCP plus CLI composition | intent | external command/network/credential-reference effects; high | additive by id, project fields override global server fields; reconcile unknown |
| `permissions.*` | CLI config and permission owners | intent | critical authority | project may narrow global; next session/reconcile unknown |
| `communication.*` | Core communication policy | intent/evidence references | response behavior; medium | project precedes global; next turn/session unknown |
| `web.*`, `interactiveUse.*` | CLI config and runtime tool owners | intent | network/browser/computer effects; high | project owns enablement/domains and may override provider defaults; next session unknown |
| `skills.{builtin,selection}` | CLI skill owners | intent | capability exposure; medium | merged with global; visibility/external catalog are global-only; reconcile unknown |
| `qualityGates[]` | CLI/project workflow | intent | command execution metadata; medium | project only; next workflow/session unknown |
| `contextGovernance.*` | context-governance owner | mixed intent and adaptation evidence | turn budget, active policy, hashes and rollback evidence; high | project only; next turn/session unknown |

Project root fields and explicit global-only rejections are defined in
[`kiln-yaml-types.ts`](../../../packages/cli/src/kiln-yaml-types.ts#L649) and
[`kiln-yaml.ts`](../../../packages/cli/src/kiln-yaml.ts#L69).

### App configuration

| Field group | Current owner | Plane | Sensitivity / authority | Activation |
| --- | --- | --- | --- | --- |
| `name`, `channels[]`, `memory.*` | Core app loader/composite | intent | app identity and state topology | restart required in dev observer |
| `router.*`, `teams.<team>.agents.*`, `.workflow.*`, `.capabilities[]`, `.qualityGates[]`, `.mode`, `.manager` | Core team/router/capability owners | intent | model, tools, effects, workflow and commands; high | restart required/unknown |
| `triggers[]` webhook/event/schedule variants | Core trigger types, Runtime registration | intent | webhook secrets by env and autonomous effects; high | restart required/unknown |
| `knowledge.*`, `eval.*`, `mcp.*`, `toolSelection.*` | Core domain owners | intent | connection strings, API-key references, external capabilities; medium/high | restart required/unknown |
| `voice.*`, `safety.*` | Core voice and safety owners | intent | command/env references, artifact retention and safety policy; high | restart required/unknown |
| partial roots `runtime`, `provider.*`, `billing.*`, `events.*` | separate Core readers, Runtime consumer | intent plus economic/runtime material | provider/API references, billing endpoints/headers, event webhook; high | restart required/unknown |

App field declarations and mappers are concentrated in
[`app-loader.ts`](../../../packages/core/src/engine/loader/app-loader.ts#L62).
Unknown app fields are generally discarded rather than rejected.

### Gateway configuration

| Field group | Current owner | Plane | Sensitivity / authority | Activation |
| --- | --- | --- | --- | --- |
| `port`, `apps[].{name,config,workspace,channels[]}` | Core gateway loader, Runtime binding | intent | listener exposure, routes, tokens/env references and tenant behavior; critical | restart required |
| `observability.*` | Core observability config | intent | endpoint and attributes; low/medium | restart required |
| `auth.*` | Core gateway auth | intent | JWT secret/JWKS references, issuer/audience; critical | restart required |
| `mcp.*` | Core gateway MCP | intent | endpoint, auth and evaluator credentials; critical | restart required |
| `modelGateway.*` | Core gateway contract, Runtime ingress | mixed intent and evidence references | principals, scopes, replay key, virtual targets, capacity and budgets; critical | restart/reconcile unknown |

Root and model-gateway unknown fields reject; several other nested gateway
objects ignore unknown keys. Structural mapping is in
[`gateway-loader.ts`](../../../packages/core/src/engine/gateway/gateway-loader.ts#L37).

## Merge And Precedence Rules

Global configuration is the base and project configuration is the override
([`config-merger.ts`](../../../packages/cli/src/config/config-merger.ts#L100)).

- Scalars use project values when present.
- Active profiles, selected governance lists, and builtin skill include/exclude
  lists concatenate, trim, and deduplicate.
- Work-governance nested objects merge by concern; project values must not
  widen global limits.
- MCP servers merge additively by id; project server fields override matching
  global fields.
- Communication resolves project before global.
- Project owns web enablement, network policy, and allowed domains while it may
  override global provider choices.
- Skills merge builtin selection while visibility and external-catalog policy
  remain global-only.
- App and gateway files have no global/project merge policy. Gateway bindings
  resolve app paths relative to the selected gateway document.
- `startGateway({port})` overrides gateway YAML `port`; `kiln dev` supplies a
  default port of `4800`, making command precedence explicit but currently not
  visible as effective-state evidence.

## Read, Mutation, Projection, And Evidence Surfaces

| Surface | Read authority | Mutation behavior | Durable evidence | Material gap |
| --- | --- | --- | --- | --- |
| `KilnConfigStatusSnapshot` / `kiln_config.read` | global/project/status/setup and projections | read-only | status is recomputed | no field descriptors or exact override chain |
| Setup actions | setup read model | bounded adoption and projection sync | install/projection state | review-only actions block; not general config mutation |
| Config propose/approve/apply | four project operations | stored proposal, durable approval, hash/path fences, sequential apply | `.kiln/proposals/config`, `.kiln/approvals/config` | unchecked store parsing, no atomic multi-write, no real rollback, projection failure reported as applied |
| Global mutation primitive | current global bytes | CAS, lock, validation, temp file, atomic rename | revision and optional invalid backup | callers do not share one typed operation lifecycle |
| Available Models | secret-free discovery/configuration projection | no dispatch authority | discovery cache only | GUI/CLI creation still requires complete raw policy/economic material |
| Target creation | current discovery plus expected global revision | CAS global mutation and catalog refresh | global config and request result | no durable retry/idempotency receipt |
| Theme | session and persisted preference | immediate surface update and optional global mutation | global UI preference | bypasses config proposal/events |
| Native/repo projections | shared status and canonical config | reconcile generated files | install state, hashes, drift evidence | no unified canonical revision → projection revision → activation record |
| SDK | exported types | none found | none | no behavioral parity API |

Canonical config events declare proposed, approved, applied, and failed kinds
([`frames.ts`](../../../packages/gateway-contracts/src/frames.ts#L504)). Runtime
projects propose and apply tool results, but no CLI approval event emission was
found. This is a cross-surface evidence gap, not proof that an approval did not
occur.

## Durable State Classification Candidates

The ADR must classify each store before replacing its contract:

| Store/material | Preliminary classification | Required decision |
| --- | --- | --- |
| Global and project YAML | useful desired intent | atomic migration or explicit re-adoption; never a dual reader |
| App and gateway YAML | useful desired intent | admission and writer replacement per family |
| Target data-policy, price, discovery and economic material embedded in global YAML | mixed managed evidence | move to named owners or justify remaining operator intent |
| Context-governance policy/evaluation hashes | managed evidence mixed with project intent | identify authoritative store and exact revision references |
| Config proposals and approvals | durable authority evidence | runtime schema, retention, replay/idempotency, and migration rules |
| Native install state and managed hashes | reconstructible projection evidence with drift value | preserve only evidence needed for safe reconciliation; regenerate projection bytes |
| Provider discovery cache | reconstructible managed state | regenerate; never migrate as current authority |
| Runtime gateway SQLite/memory/tenant stores | runtime state, not configuration | exclude from config migration while preserving their binding invariants |
| Backups created during invalid global replacement | bounded recovery evidence | retention and validated restore/re-adoption contract |

## Verification Ownership

Focused existing gates:

- global validation, persistence, CAS, locking, and atomic mutation:
  `packages/cli/src/config/global-config.test.ts`,
  `packages/cli/tests/config/global-config-validation.test.ts`, and
  `packages/cli/tests/config/global-config-mutation.integration.test.ts`;
- project parsing, merging, widening, and writing:
  `packages/cli/tests/kiln-yaml.test.ts` and
  `packages/cli/src/config/config-merger.test.ts`;
- effective/status/setup projections:
  `packages/cli/tests/application/config-status.test.ts` and
  `packages/gateway-contracts/tests/config-status.test.ts`;
- proposals and apply:
  `packages/cli/tests/application/config-proposal.test.ts` and
  `packages/cli/tests/application/config-apply.test.ts`;
- app and gateway loading/admission:
  `packages/core/tests/engine/loader/app-loader.test.ts`,
  `packages/core/tests/engine/composites/app.test.ts`,
  `packages/core/tests/engine/gateway/gateway-loader.test.ts`, and
  `packages/core/tests/engine/gateway/gateway-config.test.ts`;
- runtime app resolution/startup:
  `packages/runtime/tests/gateway/app-resolver.test.ts` and gateway startup
  suites;
- Available Models and target creation:
  Runtime projector/handler tests plus GUI and TUI catalog tests;
- init and cron writers:
  CLI command/template tests.

Shared gateway-contract changes require at least Gateway Contracts, CLI,
Runtime, GUI, TUI, and SDK typechecks. Family migrations additionally require
their owning package tests and public example validation.

## Bounded Fidelity Spike

The first spike should test mechanisms, not migrate production readers. Use
synthetic portable fixtures and do not touch canonical operator configuration.

### Required fixture set

1. **Global V3 fixture** — one direct target, one harness target, accounts and
   policy, authority profile, permission ceiling, MCP environment/credential
   references, operator voice, model gateway, and managed economic/data-policy
   evidence.
2. **Project fixture** — every accepted project family plus forbidden
   global-only fields and one attempted authority widening.
3. **App fixture** — minimum app plus runtime/provider/billing, events, trigger,
   knowledge, voice, MCP, one unknown field, and one broken graph reference.
4. **Gateway fixture** — one app binding, API/web channels, auth, MCP, model
   gateway, one unknown root, one unknown nested field, and a duplicate route.
5. **Mutation fixture** — global CAS/atomic replacement and project
   proposal/approval/apply with stale revision, corrupt store record, partial
   write, projection failure, rollback, and retry.
6. **Effective projection fixture** — canonical identity, value/redacted
   presence, source, scope, default, override chain, health, schema revision,
   authority impact, and activation for representative fields from all four
   families.

### Questions the spike must answer

- Can the selected runtime-schema mechanism infer the admitted TypeScript type
  without a parallel handwritten interface?
- Does deterministic editor-schema generation preserve supported unions,
  descriptions, defaults, examples, sensitivity metadata, and stable output?
- Which semantic rules remain named composition/admission functions rather than
  structural refinements?
- Can the YAML mutation approach preserve or deliberately replace comments,
  ordering, quoting, anchors, aliases, unknown fields, and exact bytes according
  to a stated policy?
- Can path-addressed diagnostics identify family, source, field, rejected value
  category, allowed alternatives, schema revision, and running build?
- Can one typed operation represent rejected, committed,
  committed-but-reconciliation-failed, rollback, and restart-required outcomes
  without turning descriptors into a policy engine?

## ADR Decision Backlog

The inventory supports an ADR only after these decisions are explicit:

1. runtime schema technology and bounded-context module layout;
2. descriptor identity, metadata, revision, and ownership contract;
3. runtime-schema versus semantic-admission dependency direction;
4. deterministic editor-schema and generated-artifact policy;
5. YAML comment, formatting, anchor, alias, unknown-field, and byte-fidelity
   policy;
6. one typed mutation/application-port model and the boundary between direct
   operator actions and approval-gated authority expansion;
7. atomicity, idempotency, honest reconciliation outcomes, activation, restart,
   and rollback evidence;
8. desired-intent versus managed-evidence storage, exact revision references,
   and durable-state retirement;
9. relationship to accepted
   [ADR-012](../../adr/ADR-012-global-config-schema-evolution.md): preserve its
   breaking-version and build-identified-diagnostic decisions while explicitly
   replacing or narrowing interface-derived allowlists where schema ownership
   moves;
10. the Roadmap 11 operator-question dependency required by onboarding;
11. exact vertical proofs required before cross-surface promotion.

## Residual Unknowns

- Operator-specific global state was not inspected, so useful local intent and
  migration volume remain unknown.
- Installed runner/build drift was not inspected; ADR-012 diagnostics remain the
  authority for that operational question.
- Complete dynamic consumers outside repository imports were not proven absent.
- Per-field activation behavior is almost entirely unknown and must be observed
  or assigned by its runtime owner.
- The app graph admission gap and status/runtime merge divergence are strongly
  evidenced statically but still need dedicated failing behavior tests.
- No schema library has been evaluated yet. Existing Zod use in shared gateway
  contracts is repository evidence, not a decision for configuration schemas.

