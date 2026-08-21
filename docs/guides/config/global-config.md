# Global configuration

## Overview

`~/.kiln/config.yaml` is the global source of truth for operator execution.
It owns providers, models, accounts, targets, economics, reusable authority,
model policy, native projections, and operator preferences. The canonical
global schema version is `"3"`.

Repository configuration has a narrower job. `.kiln/kiln.yaml` may define
project context and restrictions, but it cannot define or override providers,
models, targets, accounts, economics, deliberation policy, or authority
profiles.

Keep the related filesystem configuration beside the owning scope:

| Scope | YAML | Profiles and packages |
| --- | --- | --- |
| Global operator | `~/.kiln/config.yaml` | `~/.kiln/instructions`, `~/.kiln/agents`, `~/.kiln/skills` |
| Project | `.kiln/kiln.yaml` | `.kiln/instructions`, `.kiln/agents`, `.kiln/skills`, `.kiln/project-context.md` |

Native Codex, Claude Code, and OpenCode files are generated projections. They
are not configuration authority and should not be edited as a substitute for
Kiln config.

See [Config projection](../../architecture/surfaces/config-projection.md),
[Model routing](model-routing.md), and
[Agent context](../../architecture/context/agent-context.md) for the owning
contracts.

## Global schema

The main V3 fields are:

| Field | Purpose |
| --- | --- |
| `version` | Must be `"3"`. Older or partial global documents are rejected. |
| `targetCatalog` | Accounts, account policies, and selectable direct or harness targets. |
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

- [V3 target catalog](../../examples/configs/managed-targets-v3-subscription.yaml)
- [V3 task-aware model team](../../examples/configs/task-aware-model-team.yaml)

The examples contain synthetic identities and evidence. Replace them with
current provider, account, pricing, and data-policy facts before use.

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
how Runtime selects an account and the economic evidence required for that
dispatch. A harness target declares its native harness boundary instead.

```yaml
version: "3"

targetCatalog:
  accounts:
    - id: codex-primary
      providerId: codex-oauth
      credentialId: codex-primary
      maxConcurrency: 1
      reservedAffinitySlots: 0
      economics:
        capacityIdentity: codex-primary
        subscriptionClass: subscription
        quotaClassId: codex-primary
        creditPosture: disabled
        overagePosture: disabled

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
      # Complete dataPolicyEvidence, accountSelection, and economics are
      # required. Use the validated example for their full shape.

targetRouting:
  defaultTargetId: codex-terra
```

Do not copy the abbreviated target above into operational config. It omits
required evidence intentionally so the guide does not create a second schema.

Select targets through the same vocabulary on every operator surface:

```bash
kiln target
kiln run --target codex-terra "Inspect this repository"
```

GUI and TUI use a target picker. The TUI command is `/target`. Surfaces send a
target ID, never a raw provider, model, credential, or account-policy choice.

Runtime may record an internal `routeId` after admission and commitment. That
identifier belongs to execution evidence, settlement, and replay. It is not a
second user-configured target name.

## Accounts and economics

The target catalog separates three concerns:

- `accounts` identify configured capacity and carry opaque credential
  references. Secret material remains under `~/.kiln/auth` or the operator
  environment.
- `accountPolicies` define which accounts are eligible and how an automatic
  choice is ordered.
- `targets` define the selectable provider/model destination and its complete
  data-policy and economic contract.

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
`~/.kiln/agents/*.md`. Project profiles in `.kiln/agents/*.md` may add roles or
shadow a global profile for Kiln execution in that repository, but they still
reference global targets and authority profiles.

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

Project config may also contain project MCP, communication, interactive-use,
skills, quality-gate, context-governance, depth, and parallelism settings. It
cannot declare providers, models, target catalogs, target routing, economics,
model suitability, deliberation policy, authority profiles, or Model Gateway.
Unknown or forbidden fields fail validation instead of being silently merged.

The runtime contract is `packages/cli/src/config/project-config-schema.ts`.
Kiln validates parsed YAML against that schema before any semantic admission or
execution. Diagnostics identify the exact JSON-pointer field path and identify
the running CLI build when an unknown field could indicate an outdated install.

The versioned editor projection is published as
`@kilnai/cli/schemas/project-config-v1.json`; its companion descriptor artifact
is `project-config-descriptors-v1.json`. Both are generated from the runtime
schema with `bun run --cwd packages/cli config:schema:generate`, and tests reject
committed artifact drift. Editors may map `.kiln/kiln.yaml` to the schema in the
installed package. JSON Schema provides completion and early feedback, but the
runtime schema plus named semantic admission remain authoritative.

Global web providers may supply reusable adapters and credential references.
The project still controls whether network use is enabled and which domains
are admitted.

## Instruction profiles and skills

Durable doctrine belongs in instruction profiles, not agent copies or generated
harness files. Global profiles live in `~/.kiln/instructions`; repository
profiles live in `.kiln/instructions`.

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
