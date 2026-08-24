# Global configuration

## Overview

`~/.kiln/config.yaml` is the global source of truth for operator intent. It
owns target and account choices, reusable authority, model policy, native
projections, and operator preferences. Managed target facts live in immutable
snapshots beside it. The canonical global schema version is `"5"`.

Project configuration has a narrower job. The private project
`~/.kiln/projects/<krp_sha256>/config.yaml` may define project context and
restrictions, but it cannot define or override providers, models, targets,
accounts, economics, deliberation policy, or authority profiles.

Keep the related filesystem configuration beside the owning scope:

| Scope | YAML | Profiles and packages |
| --- | --- | --- |
| Global operator | `~/.kiln/config.yaml`, `~/.kiln/evidence/execution-targets/<sha256>.json` | `~/.kiln/instructions`, `~/.kiln/agents`, `~/.kiln/skills` |
| Project | `~/.kiln/projects/<krp_sha256>/config.yaml` | `~/.kiln/projects/<krp_sha256>/instructions`, `agents`, `skills`, `context` |

Native Codex, Claude Code, and OpenCode files are generated projections. They
are not configuration authority and should not be edited as a substitute for
Kiln config.

See [Config projection](../../architecture/surfaces/config-projection.md),
[Model routing](model-routing.md), and
[Agent context](../../architecture/context/agent-context.md) for the owning
contracts.

## Inspect and change settings

Use the shared settings projection when you need searchable effective values
and provenance without reading raw YAML:

```bash
kiln config settings
kiln config settings permissions
kiln config settings --modified
```

TUI `/settings [query]` renders the same snapshot. It also accepts
`/settings set [--global] [--approve] <key> <value>` and
`/settings reset [--global] [--approve] <key>` through the same proposal and
apply contracts. GUI Settings organizes the snapshot as
General, Providers, Models, Permissions, Tools, Usage and Limits, Agents,
Health, and Advanced. Every setting row identifies inheritance or override,
write scope, authority impact, activation, and health. Provider allowance and
economic lifecycle evidence remain read-only and absent until their runtime
owner reports them; an absent observation never means unused allowance or zero
spend.

Change only descriptor-admitted keys through the governed mutation lifecycle:

```bash
kiln config set [--global] [--approve] <key> <value>
kiln config reset [--global] [--approve] <key>
```

Reset removes that exact override so the inherited or default value becomes
effective. It does not replace the project or global document. GUI reviews the
same typed proposal before apply and refreshes the shared read model after the
commit. Advanced mode may open canonical project YAML and export or validate a
secret-free settings snapshot, but importing a snapshot never bypasses the
mutation authority or revision fence.

The typed SDK exposes `loadSettings`, `proposeSettingsMutation`, and
`applySettingsMutation` over the operator gateway. Trusted Codex, Claude Code,
and OpenCode native sessions expose `kiln_settings_read`,
`kiln_settings_propose`, and `kiln_settings_apply`. Native apply always
requires an externally issued approval id. These adapters exchange shared wire
contracts and do not derive governance policy locally.

## Global schema

`packages/cli/src/config/global-config-schema.ts` owns the strict root schema,
schema-inferred admitted type, stable structural diagnostics, field
descriptors, and generated editor schema. Named validators in
`packages/cli/src/config/global-config/admission/` retain semantic and
cross-resource admission for imported Core and CLI contracts. The document
store performs one YAML parse and returns only the schema-admitted value;
`global-config.ts` remains their public boundary. The committed projections are
`packages/cli/schemas/global-config-v2.json` and
`packages/cli/schemas/global-config-descriptors-v2.json`. Regenerate them with
`bun run --cwd packages/cli config:schema:generate` after changing the owner.

The main V5 fields are:

| Field | Purpose |
| --- | --- |
| `version` | Must be `"5"`. Older or partial global documents are rejected. |
| `ui.appearance` | Atomic color-scheme mode and light/dark theme selections for operator surfaces. |
| `targetCatalog` | Minimal account and target intent plus the exact admitted `evidenceRevision`. |
| `targetRouting.defaultTargetId` | Default target for operator sessions. |
| `authorityProfiles` | Reusable tool, workspace, memory, timeout, approval, and optional voice authority. |
| `managedAgents` | Managed-child enablement, default authority, worktree policy, approval posture, and economic policies. |
| `permissions` | Default approval and sandbox request. |
| `permissionCeiling` | Maximum approval and sandbox authority a project or session may request. |
| `modelTaskSuitability` | Global provider/model task evidence used to rank already-admitted targets. |
| `deliberationPolicy` | Global provider-neutral inference-work policy. |
| `modelGateway` | Authenticated virtual-model ingress over catalog targets. |
| `engines` | Native harness availability and billing metadata. |
| `mcp`, `hooks`, `skills` | Global tool and procedural configuration. |
| `verification` | Operator-owned machine tools used for deterministic verification. |
| `identity`, `communication`, `operatorVoice`, `ui` | Operator-facing defaults. |
| `workGovernance` | Default work posture, delegation triggers, and completion evidence. |

Use the parser-validated examples instead of assembling a partial operational
catalog:

- [V5 target catalog](../../examples/configs/managed-targets-v5-subscription.yaml)
- [V5 task-aware model team](../../examples/configs/task-aware-model-team.yaml)

The examples contain synthetic identities. Replace them with current provider
and account intent before use. Managed discovery, data-policy, capacity, and
pricing facts are published by the evidence owner, not copied into YAML.

Older global target shapes are not read or migrated. Re-adopt targets through
the V4 setup and target-creation paths so current evidence is generated by its
owner.

## Communication defaults

Use global communication config for stable personal or organization-wide
preferences that should follow the operator across repositories:

```yaml
communication:
  responseDetail: concise
  onUnsupported: omit
```

Kiln keeps this intent canonical in `~/.kiln/config.yaml`. Native harness
settings are projections. For Claude Code, `kiln sync --global-instructions`
projects the concise preference to `outputStyle: "Concise"` in user-scoped
settings while preserving unrelated fields. A project-level communication
override is justified only when that repository genuinely requires a different
response contract; it should not duplicate the operator's normal workflow.

## Formal verification

Dafny is a global machine capability, not project configuration. Configure the
operator-selected executable and the exact expected version once in
`~/.kiln/config.yaml`:

```yaml
verification:
  formal:
    dafny:
      executable: dafny
      expectedVersion: 4.11.0
```

`executable` may be an explicit path or a bare command written by the operator.
Kiln never discovers Dafny when this field is absent and never installs it. At
startup Kiln executes the configured binary with `--version`, reduces accepted
build metadata to the canonical three-part version, and registers
`formal_verify` only when the observed version exactly matches
`expectedVersion`. On Windows, only a native `.exe` or `.com` target is
accepted; `.cmd` and `.bat` shims are rejected.

A repository does not repeat the executable, version, or a `required` flag.
Whether a particular bounded task needs formal proof is already owned by its
adopted Assurance obligations. If those obligations exist but the validated
global capability is unavailable, admission pauses before any work budget is
reserved.

## Targets

A target is the one operator-facing execution choice. It has a stable ID and
names one physical provider/model destination. A direct target also declares
how Runtime selects an account and its material execution constraints. A
harness target declares its native boundary. Both bind managed facts through
`targetCatalog.evidenceRevision`.

```yaml
version: "5"

targetCatalog:
  evidenceRevision: sha256:<exact-admitted-snapshot>
  accounts:
    - id: codex-primary
      providerId: codex-oauth
      credentialId: codex-primary
      maxConcurrency: 1
      reservedAffinitySlots: 0
      economics: { creditPosture: disabled, overagePosture: disabled }

  accountPolicies:
    - id: codex-automatic
      accountIds: [codex-primary]
      strategy: economic-least-pressure

  targets:
    - id: codex-terra
      kind: direct
      label: Terra - balanced implementation
      providerId: codex-oauth
      providerModelId: gpt-5.6-terra
      dataClassification: internal
      accountSelection: { mode: automatic, accountPolicyId: codex-automatic }
      economics:
        authBillingChannel: oauth-subscription
        executionMode: direct
        serviceTier: standard
        fallbackPosture: disabled
        overagePosture: disabled
        executionEnvelope: { limits: [] }

targetRouting:
  defaultTargetId: codex-terra
```

The referenced snapshot must exist, match its digest, cover exactly the
configured accounts and targets, and remain fresh. Missing, extra, stale, or
identity-mismatched evidence fails before dispatch.

Select targets through the same vocabulary on every operator surface:

```bash
kiln target
kiln run --target codex-terra "Inspect this repository"
```

GUI and TUI use a target picker. The TUI command is `/target`. Surfaces send a
target ID, never a raw provider, model, credential, or account-policy choice.

Create a target from current Available Models evidence without writing target
material by hand:

```bash
kiln target available
kiln target create <provider>/<model> --classification internal --confirm-data-policy
kiln target create <provider>/<model> --classification internal --confirm-data-policy --approve
```

The first create command previews the normalized proposal. The approved command
prints its freshly derived proposal, asks for an interactive yes/no confirmation,
and applies only that confirmed proposal after revalidating the same intent
against current discovery and configuration. A declined or non-interactive
confirmation writes nothing. `--confirm-data-policy` accepts provider service
operation, potentially permitted training, and retention up to 3650 days for
data at the selected classification; it does not assert a stricter provider
privacy guarantee. `--label` is optional; route IDs, account selection,
data-policy evidence, economics, capability evidence, and revisions are
Runtime-derived.

Runtime may record an internal `routeId` after admission and commitment. That
identifier belongs to execution evidence, settlement, and replay. It is not a
second user-configured target name.

## Accounts and economics

The target catalog separates three concerns:

- `accounts` identify configured capacity intent and carry opaque credential
  references. Secret material remains under `~/.kiln/auth` or the operator environment.
- `accountPolicies` define which accounts are eligible and how an automatic
  choice is ordered.
- `targets` define the selectable provider/model destination and material
  operator constraints. The referenced evidence supplies discovery, data
  policy, capacity classification, adapter facts, and prices.

Runtime admits safety, data use, health, quota, and capacity before comparing
economics and pressure. It then fences the exact account and credential
revision before dispatch. A provider effect is never retried through a second
target as an invisible fallback.

An optional `ui.targetSelection.accountOverrideId` may narrow an automatic
target to an eligible account alias. It cannot name a credential or add an
account outside the target's policy.

## Authority profiles

Physical execution identity and authority are separate. `authorityProfiles`
defines reusable child environments without duplicating provider or model
facts:

```yaml
authorityProfiles:
  - id: readonly-plan
    admissionProfile: foundation-readonly-plan
    workingDirectory: project
    tools:
      allowed: [read, tree, grep, glob]
      network: false
      writes: false
    memory: { access: read-only }

  - id: approved-work
    admissionProfile: foundation-apply-approved-writes
    workingDirectory: isolated-worktree
    tools:
      allowed: [read, tree, grep, glob, write, edit, apply-patch]
      network: false
      writes: true
    memory: { access: write-proposals }
    writeAuthority:
      workspace:
        mode: apply-approved
        allowedPaths: [.]
        deniedPaths: [.git, node_modules, .kiln]
      approval:
        mode: required-before-apply
```

`managedAgents.defaultAuthorityProfileId` may select a configured default.
Economic policy candidates reference `targetId`. They do not repeat a target's
provider, model, account, credential, or price evidence.

## Agent profiles

Agent profiles are explicit executable roles. Global profiles live in
`~/.kiln/agents/*.md`. Project profiles in the bound private namespace's
`agents/*.md` may add roles or shadow a global profile for Kiln execution in
that repository, but they still reference global targets and authority
profiles.

A valid profile declares `name`, `role`, `goal`, and `tier`. Optional fields
include display identity, instructions, tools, skills, instruction profiles,
task affinity, communication intent, `targetId`, and `authorityProfileId`.

```markdown
---
name: architecture-reviewer
role: Architecture reviewer
goal: Review boundaries and return evidence-backed findings.
tier: reasoning
targetId: codex-sol
authorityProfileId: readonly-plan
tools: [read, tree, grep, glob]
skills: [clean-architecture-boundary-review]
taskAffinity: [architecture-review]
---

Review in findings-first order. Do not modify files.
```

Agents reference global target and authority IDs; they do not define provider,
model, economics, or permission authority inline. Kiln does not inject an
implicit executable specialist roster. Only configured agent files appear in
the resolved catalog.

HOME-level native projection consumes global agents only. Project agents do not
overwrite global Codex, Claude Code, or OpenCode agent files. Run a dry run
before projecting the configured global roster:

```bash
kiln sync --agents --dry-run
kiln sync --agents
```

Kiln backs up owned files and blocks unmanaged or drifted content unless the
explicit force workflow authorizes replacement. Native files do not become
managed merely because their names match a Kiln profile.

## Model Gateway

Model Gateway provides authenticated virtual names over the same target
catalog. Each virtual model references exactly one `targetId`:

```yaml
modelGateway:
  virtualModels:
    - id: managed-codex-terra
      displayName: Codex Terra through Kiln
      contextTokens: 200000
      outputTokens: 8192
      targetId: codex-terra
      capabilities: [text]
      affinity: { continuity: none }
```

Virtual models contain ingress and picker metadata only. Provider, model,
account, credentials, data policy, and economics remain owned by the target.
See [Operate the Model Gateway](../../operations/model-gateway.md).

## Permissions and ceiling

`permissions` is the normal default request. `permissionCeiling` is the
maximum authority a project or session may request.

```yaml
permissions:
  approval: on-request
  sandbox: read-only

permissionCeiling:
  approval: on-request
  sandbox: workspace-write
```

A project may narrow permissions or request authority within this ceiling. It
cannot widen past the ceiling. Managed children still require a matching
authority profile and any required approval; the session ceiling alone does
not grant child writes.

## Project configuration boundary

Project config contains repository facts and restrictions:

```yaml
version: "1"

activeInstructionProfiles:
  - sequel-engineering

workGovernance:
  defaultPosture: direct
  requireDelegationFor: [security]
  requiredEvidence: [surface-map, plan, tests, typecheck, residual-risk]

permissions:
  approval: on-request
  sandbox: workspace-write

web:
  enabled: true
  netPolicy: documentation
  allowedDomains: [docs.example.com]
```

Project config may also contain attenuated MCP, communication, web policy, skills,
context-governance, depth, and parallelism settings. It
cannot declare providers, models, target catalogs, target routing, economics,
model suitability, deliberation policy, authority profiles, interactive-use,
quality gates, or Model Gateway.
Unknown or forbidden fields fail validation instead of being silently merged.

The runtime contract is `packages/cli/src/config/project-config-schema.ts`.
Kiln validates parsed YAML against that schema before any semantic admission or
execution. Diagnostics identify the exact JSON-pointer field path and identify
the running CLI build when an unknown field could indicate an outdated install.

The versioned editor projection is published as
`@kilnai/cli/schemas/project-config-v1.json`; its companion descriptor artifact
is `project-config-descriptors-v1.json`. Both are generated from the runtime
schema with `bun run --cwd packages/cli config:schema:generate`, and tests reject
committed artifact drift. Editors may map the private `config.yaml` to the schema in the
installed package. JSON Schema provides completion and early feedback, but the
runtime schema plus named semantic admission remain authoritative.

Global web providers may supply reusable adapters and credential references.
The project still controls whether network use is enabled and which domains
are admitted.

## Instruction profiles and skills

Durable doctrine belongs in instruction profiles, not agent copies or generated
harness files. Global profiles live in `~/.kiln/instructions`; project profiles
live in the bound private namespace's `instructions` directory.

Skills are procedural packages, not permissions. Built-in skills are a
separate first-party skill catalog governed by `skills.builtin`; this does not
create built-in executable agents. Project skills may override global skills
for project execution, subject to catalog and visibility admission.

## Safe mutation and inspection

Prefer governed config commands over direct edits:

```bash
kiln config read health
kiln config read effective
kiln config explain permissions
kiln config read setup
kiln config read agents
kiln sync --all --dry-run
```

`kiln config read effective` returns the shared secret-free field projection,
not the runtime configuration object. Each field explains its canonical
identity, effective value (or redacted presence), source, override chain,
health, schema revision, and activation. `kiln config explain` accepts a
top-level identity with or without the leading `/`. MCP, web, and hook values
are redacted as complete sensitive families; inspect their separate status views
for non-secret health and admission evidence.

Global mutations use one interprocess lock, revision checks, validation, and an
atomic replacement. Replacing an invalid or older global document requires an
explicit backup-and-replace operation. Kiln does not maintain a dual-read
compatibility path for V2 configuration.

After a reviewed change:

```bash
kiln sync --all
kiln config read health
```

The expected result is one global execution authority, narrow project
restrictions, and generated native projections whose ownership and drift are
visible.
