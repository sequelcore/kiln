# Operator Routing Profile

This example documents the personal routing profile used to develop Kiln on
Ricardo's workstation. It is an operator example, not team doctrine. Copy its
decision shape only after validating route health, authority, and provider
availability on the target machine.

## Purpose

The profile keeps coordination, specialist advice, implementation authority,
and independent review explicit:

- Codex OAuth Terra is the default workday coordinator and implementation
  route;
- Codex OAuth Sol is a read-only architecture advisor;
- OpenCode Go specialists provide bounded frontend, backend, research, and
  mechanical-work capacity;
- frontend analysis uses a governed heterogeneous team before write authority
  is admitted;
- task suitability ranks only routes that are already eligible;
- native harness projections remain generated views of canonical Kiln config.

## Verify the Workstation

Use read-only commands before adopting or changing the profile:

```bash
bun packages\cli\src\index.ts doctor
bun packages\cli\src\index.ts route
bun packages\cli\src\index.ts config read health
bun packages\cli\src\index.ts config read setup
bun packages\cli\src\index.ts config read permissions
bun packages\cli\src\index.ts config read agents
```

The canonical global config is authoritative. Provider catalogs are discovery
evidence, not entitlement or route authority. Native Codex and OpenCode files
may drift from canonical config and must be regenerated through the supported
sync flow; a successful canonical health check does not prove that every native
projection is current.

Live provider probes are optional and explicit because they may use credentials,
quota, network access, or paid inference.

## Routing Shape

The current operator routing shape is:

```yaml
routing:
  defaultWorker: codex-oauth
  fallback: opencode-go
  routes:
    - provider: codex-oauth
      model: gpt-5.6-terra
    - provider: codex-oauth
      model: gpt-5.6-luna
    - provider: codex-oauth
      model: gpt-5.6-sol
    - provider: opencode-go
      model: kimi-k3
    - provider: opencode-go
      model: kimi-k2.7-code
    - provider: opencode-go
      model: glm-5.2
    - provider: opencode-go
      model: deepseek-v4-pro
    - provider: opencode-go
      model: qwen3.7-max
    - provider: opencode-go
      model: deepseek-v4-flash
```

OpenCode Go is not the orchestrator. It supplies eligible specialist routes;
Kiln owns admission, topology, authority, lifecycle, and evidence.

## Task Suitability

Task suitability is advisory ranking over eligible routes. It cannot authorize
a provider, prove credentials, bypass route health, or make a stale catalog
entry selectable.

| Task | Preferred route | Role |
| --- | --- | --- |
| Workday coding and tests | `codex-oauth/gpt-5.6-terra` | Balanced default and final integration. |
| Architecture and high-risk advice | `codex-oauth/gpt-5.6-sol` | Read-only critical advisor. |
| Independent React/TypeScript review | `codex-oauth/gpt-5.6-terra` | Separately routed correctness and accessibility reviewer. |
| Frontend visual production | `opencode-go/kimi-k3` | Read-only visual hierarchy, interaction, and acceptance-criteria producer. |
| Frontend implementation advice | `opencode-go/kimi-k2.7-code` | Read-only repository-grounded component and test handoff. |
| Frontend implementation | `opencode-go/kimi-k2.7-code` | Separate approved-write route after governance admits mutation. |
| Backend/runtime implementation | `opencode-go/glm-5.2` | Preferred OpenCode backend route for this workstation. |
| Backend comparison | `opencode-go/deepseek-v4-pro` | Challenger for bounded comparative diagnosis. |
| Research and synthesis | `opencode-go/qwen3.7-max` | Source-grounded comparison specialist. |
| Scout and mechanical work | `opencode-go/deepseek-v4-flash` | Fast low-risk route. |

Kimi K3 has a productive read-only role; it is not promoted to write authority
without frontend-specific implementation, visual, accessibility, and test
evidence. The approved-write Kimi K2.7 route remains a separate authority
contract rather than an implicit consequence of team membership.

## Governed Frontend Team

The analysis stage uses `managed_agent.orchestrate` with one bounded work graph:

```json
{
  "profile": "foundation-readonly-plan",
  "taskRisk": "medium",
  "requiresIndependentReview": false,
  "workItems": [
    {
      "id": "visual-producer",
      "roleIntent": "frontend-visual-producer",
      "task": "Produce visual hierarchy, interaction states, accessibility expectations, and acceptance criteria.",
      "agentProfile": "frontend-producer",
      "dependencies": []
    },
    {
      "id": "implementation-advisor",
      "roleIntent": "frontend-implementation-advisor",
      "task": "Verify the visual specification against repository evidence and produce component, state, test, and integration guidance.",
      "agentProfile": "frontend-implementation-advisor",
      "dependencies": ["visual-producer"]
    }
  ]
}
```

Runtime resolves each profile independently. The second child starts only after
the first succeeds and receives its bounded summary and resource URIs. A failed
producer blocks its dependent.

Independent review is a separate dependency-free graph using
`frontend-producer` and `react-ts-reviewer` with
`requiresIndependentReview: true`. Runtime admits it only when the two profiles
resolve to distinct provider/model identities. Implementation then proceeds as
a separate governed write task through `frontend-coder`; read-only team members
never acquire write authority by composition.

See [Coordination Guide](../guides/coordination-intelligence.md) for lifecycle
semantics and [Managed Invocation Routing Research](../research/21-managed-invocation-routing-2026.md)
for the evidence and decision record behind this topology.

## Reasoning Effort

The profile uses normalized, capability-gated effort:

```yaml
reasoningPolicy:
  default: medium
  unsupported: omit
  byTask:
    architecture-review: high
    backend-coding: high
    frontend-design: high
    test-writing: high
    research: high
    mechanical-edit: low
```

Kiln sends an effort value only when the selected provider/model advertises
support. Unsupported or unknown routes omit it instead of receiving an invented
provider-specific value.

## Permission Integrity

Trusted execution is evidence, not one UI enum. Kiln keeps these layers
separate:

- canonical desired policy from `~/.kiln/config.yaml`;
- generated native projections;
- session-only operator overrides;
- observed effective runtime policy;
- harness enforcement capability and semantic loss;
- operator authorization and evidence freshness.

A parent Full Access selection does not grant a managed child authority. Write
children require their own admitted authority envelope and an isolated worktree
when policy requires it.

## Operating Loop

Before changing routes:

```bash
bun packages\cli\src\index.ts config read health
bun packages\cli\src\index.ts config read setup
bun packages\cli\src\index.ts config read agents
bun packages\cli\src\index.ts route
```

After changing canonical config:

```bash
bun packages\cli\src\index.ts config read health
bun packages\cli\src\index.ts config read setup
bun packages\cli\src\index.ts config setup --action sync-repo-shims
git diff --check
```

Use `doctor` to diagnose drift, competing executables, catalog status, auth,
and permission layers. Do not treat diagnostics as silent repair.

## Benchmark Evidence

The operator pilots are local routing evidence, not a general model ranking.
The canonical methodology, historical results, limitations, and promotion
criteria live in [Managed Invocation Routing Research](../research/21-managed-invocation-routing-2026.md).
The `kiln-managed-frontend-team` profile freezes structural team composition,
handoff, route-diversity, and execution-integrity requirements. Team promotion
still requires a paired individual baseline under the same fixture, authority,
dataset, and scorer set.

Do not duplicate benchmark result tables in this operator example. Update the
research decision record and versioned benchmark artifacts instead.
