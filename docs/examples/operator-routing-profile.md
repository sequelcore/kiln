# Operator Target Profile

This sanitized example shows how one operator can configure a model team for
Kiln development. It demonstrates the shape of the decision, not a portable
model ranking. Revalidate provider terms, model capabilities, account health,
and economics on the machine that will run it.

## Design

The profile separates four concerns:

- `targetCatalog` defines selectable execution targets and their account,
  policy, data-use, and economic evidence.
- `targetRouting.defaultTargetId` selects the normal interactive target.
- `authorityProfiles` define admitted tools, writes, memory, and working
  directory independently of the model target.
- explicit agent files bind one `targetId` and one `authorityProfileId` to a
  named role. No executable agent roster is created implicitly.

The complete parser-validated example is
[Task-aware Model Team](configs/task-aware-model-team.yaml). It includes Codex
OAuth targets for balanced implementation, architecture review, and bounded
mechanical work, plus an OpenCode Go target for approved service work.

## Inspect Before Changing

From a source checkout, inspect canonical state with read-only commands:

```bash
bun packages/cli/src/index.ts doctor
bun packages/cli/src/index.ts target
bun packages/cli/src/index.ts config read health
bun packages/cli/src/index.ts config read setup
bun packages/cli/src/index.ts config read permissions
bun packages/cli/src/index.ts config read agents
```

Provider catalogs are discovery evidence. They do not grant entitlement,
authority, or target eligibility. Live probes are explicit because they can use
credentials, quota, network access, or paid inference.

## Target Selection

The example exposes stable target IDs:

| Work intent | Target ID | Derived provider/model |
| --- | --- | --- |
| Balanced implementation | `codex-terra` | `codex-oauth/gpt-5.6-terra` |
| Architecture and critical review | `codex-sol` | `codex-oauth/gpt-5.6-sol` |
| Bounded mechanical work | `codex-luna` | `codex-oauth/gpt-5.6-luna` |
| Approved service work | `opencode-go-glm` | `opencode-go/glm-5.2` |

The operator selects the target, not a raw provider/model pair or credential:

```bash
kiln target
kiln run --target codex-terra "Implement the admitted change"
kiln plan --target codex-sol "Review the proposed boundary"
```

In the TUI, use `/target`. The GUI uses its target picker. A persisted
`ui.targetSelection.targetId` takes precedence for that surface; otherwise
`targetRouting.defaultTargetId` supplies the default.

Automatic targets may select among eligible account aliases through an account
policy. The target remains the authority. Account choice cannot switch the
provider, model, data classification, or economic commitments declared by that
target.

## Authority and Agents

Target choice answers *where the model call runs*. An authority profile answers
*what that child may do*. Keep those decisions independent:

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

  - id: approved-service-work
    admissionProfile: foundation-apply-approved-writes
    workingDirectory: project
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

Each configured agent is explicit and globally owned. A read-only advisor never
acquires write authority because its target can write, and a write-capable
authority profile does not make an unavailable target executable.

Managed-agent economic policies rank only already-eligible `targetId` values.
They cannot authorize a provider, repair credentials, weaken data policy, or
activate uncommitted fallback or overage.

## Project Scope

Projects do not redefine the operator's provider, model, target catalog,
authority profiles, agent roster, permissions, or native harness projections.
Project config contains repository identity and project limits only. Durable
repository guidance belongs in `.kiln/project-context.md` and generated repo
shims.

## Model Gateway

Native harnesses enter through virtual model names. Each virtual model binds to
one canonical target:

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

The virtual name is an ingress alias. It does not duplicate provider, model,
account, or economics configuration.

## Operating Loop

After editing `~/.kiln/config.yaml` or global agent files:

```bash
kiln config read health
kiln config read setup
kiln config read agents
kiln target
kiln sync --agents
kiln sync --global-instructions
kiln sync --repo-shims
```

`doctor` diagnoses catalog health, authentication, competing executables,
permissions, and managed projection drift. Diagnostics do not silently repair
state.

Runtime may record an internal `routeId` after it resolves a target. That ID is
lifecycle and replay evidence, not an operator-facing configuration key or an
alternate selection command.

Local benchmarks are admission evidence for this profile, not universal model
rankings. Keep methodology, limitations, and promotion decisions in the
[coordination intelligence foundation](../research/foundations/10-coordination-intelligence.md)
rather than duplicating result tables here.
