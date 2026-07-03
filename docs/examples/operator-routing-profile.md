# Operator Routing Profile

This example documents the personal routing profile currently used to develop
Kiln on Ricardo's workstation. It is an operator example, not team doctrine.
Copy the decision shape only after running local discovery, route health, and
permission-integrity checks on the target machine.

## Purpose

The profile optimizes for high-quality engineering work with bounded token and
quota use:

- use Codex OAuth as the primary delegated engineering route;
- use OpenCode Go routes as specialized workers and fallback capacity;
- keep native OpenCode free routes as low-priority escape hatches only;
- let task suitability rank eligible routes without turning catalog membership
  into execution authority;
- expose reasoning effort only when the selected route advertises support for
  it;
- keep trusted/full-access execution as explicit evidence, not a UI label.

## Local Evidence

The local setup was diagnosed on 2026-07-02 with read-only Kiln commands:

```bash
bun packages\cli\src\index.ts doctor
bun packages\cli\src\index.ts route
bun packages\cli\src\index.ts config read health
bun packages\cli\src\index.ts config read setup
bun packages\cli\src\index.ts config read permissions
bun packages\cli\src\index.ts config read agents
```

Observed state:

- `route` resolves the default worker to `codex-oauth`.
- Codex OAuth is authenticated and advertises `gpt-5.5`, `gpt-5.4`, and
  `gpt-5.4-mini`.
- OpenCode is authenticated and advertises a large model catalog. That catalog
  is diagnostic evidence, not entitlement or route authority.
- Repo shims are current.
- Native projections are managed and current, including `codex-config` and
  `opencode-config`.
- The effective permission read model reports `workspace-write` for the active
  policy, while canonical global config still declares conservative safe
  defaults. This is expected evidence layering, not a reason to flatten policy.

No live provider probes, paid inference, destructive checks, or credentialed
model calls are required to use this example. The diagnostic pilot described
below was separately and explicitly authorized.

Benchmark-integrity repairs completed on 2026-07-02 now make follow-up route
comparisons safer to interpret:

- provider tool names round-trip to canonical Kiln identities across supported
  providers;
- route failures are classified as compatibility, auth, quota, rate-limit,
  transient, or unknown evidence instead of generic provider failure;
- subscription/free/unknown/metered economics are separate and comparable only
  when the evidence says they are comparable;
- internal benchmark baselines emit typed evidence artifacts for transcript,
  tool calls, diagnostics, usage, route, cost, and result.

The authorized post-repair `kiln-tool-agent` pilots recorded the following
bounded evidence through the normal benchmark path:

| Route | k | passAtK | Input tokens | Requests | Status |
|---|---:|---:|---:|---:|---|
| `codex-oauth/gpt-5.5` | 1 | 1.0 | 37,354 | 9 | Passed bounded pilot. |
| `opencode-go/kimi-k2.7-code` | 1 | 1.0 | 76,496 | 17 | Passed bounded pilot. |
| `opencode-go/glm-5.2` | 1 | 0.5 | 19,023 | 5 | Failed readiness on search latency. |
| `opencode-go/deepseek-v4-pro` | 1 | 0.5 | 71,366 | 15 | Failed search tool trajectory. |
| `codex-oauth/gpt-5.5` | 5 | 1.0 | 192,637 | 48 | Internal baseline ready for this profile. |
| `opencode-go/kimi-k2.7-code` | 5 | 1.0 | 388,909 | 67 | Internal baseline ready for this profile. |

These numbers validate the token-pressure repair and the local routing shape
for this workstation. They do not rank general model capability, because the
dataset is intentionally small and specific to Kiln read-only tool-agent work.

## Routing Policy

The current global routing shape is:

```yaml
routing:
  defaultWorker: codex-oauth
  fallback: opencode-go
  routes:
    - provider: codex-oauth
      model: gpt-5.5
    - provider: codex-oauth
      model: gpt-5.4-mini
    - provider: opencode-go
      model: kimi-k2.7-code
    - provider: opencode-go
      model: deepseek-v4-pro
    - provider: opencode-go
      model: qwen3.7-max
    - provider: opencode-go
      model: glm-5.2
    - provider: opencode-go
      model: minimax-m3
    - provider: opencode-go
      model: deepseek-v4-flash
    - provider: opencode
      model: opencode/minimax-m2.5-free
  budgetAware: false
```

This does not mean OpenCode Go is the main orchestrator. `codex-oauth` remains
the default worker and the default managed-agent provider. OpenCode Go appears
often because it supplies specialized route candidates for frontend,
backend/runtime, research, service, and mechanical work.

## Task Suitability

Task suitability is advisory ranking over routes that are already eligible. It
does not authorize a provider, prove a credential, bypass route health, or make
a stale catalog selectable.

| Task | Preferred route | Reason |
|---|---|---|
| Architecture, planning, high-risk coding | `codex-oauth/gpt-5.5` | Highest-quality primary delegated route for complex Kiln work. |
| TDD and regression design | `codex-oauth/gpt-5.5` | Strong default for edge-case reasoning and contract changes. |
| Final review | `codex-oauth/codex-auto-review` | Review-specialized route; not a general implementation model. |
| Frontend implementation | `opencode-go/kimi-k2.7-code` | Specialist route for React, TypeScript, layout, and visual work. |
| Backend/runtime implementation | `opencode-go/deepseek-v4-pro` | Specialist route for runtime contracts, provider routing, and debugging. |
| Service/adapters/refactors | `opencode-go/glm-5.2` | Structured route for medium-complexity implementation. |
| Research and synthesis | `opencode-go/qwen3.7-max` | Specialist route for source-grounded comparison work. |
| Scout and mechanical edits | `opencode-go/deepseek-v4-flash` | Fast route for read-only scouting and repetitive low-risk edits. |

The large OpenCode catalog should stay searchable and explainable, but operator
surfaces should show eligible routes first. A model that appears in the catalog
is still rejected when canonical eligibility, permission integrity, route
health, or task policy fails.

## Reasoning Effort

The profile uses normalized Kiln reasoning effort:

```yaml
reasoningPolicy:
  default: medium
  unsupported: omit
  byTask:
    architecture-review: xhigh
    backend-coding: high
    frontend-design: high
    test-writing: high
    research: high
    mechanical-edit: low
```

This policy is capability-gated. If the selected provider/model advertises
supported reasoning efforts, Kiln may send the requested normalized effort. If
the selected route does not advertise effort support, Kiln omits the setting by
default instead of inventing a provider-specific value.

## Managed Agents

Managed routes use the same evidence plane as interactive routing:

- read-only scout and research routes are explicit;
- write-capable routes require explicit managed-agent entries;
- write authority remains `apply-approved`, scoped to the project workspace;
- background/unattended children require proven runtime authority;
- parent Full Access does not automatically prove child authority.

For this workstation, Codex OAuth handles critical planning, TDD, primary
coding, and review. OpenCode Go handles specialized implementation routes when
the task class matches and the route is eligible.

## Permission Integrity

Trusted/full-access operation is intentionally not encoded as a single enum.
Kiln distinguishes:

- canonical desired policy from `~/.kiln/config.yaml`;
- persisted native projection, such as Codex or OpenCode config files;
- session-only overrides, such as a Codex Desktop Full Access selector;
- observed effective runtime policy when the harness exposes proof;
- harness enforcement capability and semantic loss;
- operator authorization, freshness, and recommendation.

For personal unattended development, the operator may run Codex Desktop in Full
Access. Kiln must still report that as session/effective evidence rather than
silently persisting it into canonical config. Background agents fail closed when
the child route cannot prove the required runtime authority.

## Recommended Operating Loop

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

Use `doctor` as read-only evidence. It should diagnose drift, competing
executables, catalog status, auth state, and permission-integrity layers; it
should not silently repair native config.

## Public Benchmark Readiness

Benchmark evidence can support public marketing only after the claim is scoped
to Kiln's governance value rather than broad model superiority. A publishable
claim should separate:

- model performance on a named task profile;
- Kiln's provider-neutral tool projection and authority governance;
- token-pressure reduction relative to an earlier Kiln execution path;
- non-comparable subscription economics from metered cost.

Before publishing, require resolvable artifacts, profile and dataset versions,
commit, provider/model identifiers, scorer set, `k`, config hash, transcripts,
tool calls, diagnostics, usage evidence, failed cases, and explicit
limitations. Current `k=5` evidence is suitable for internal routing decisions
and product narrative exploration, not yet a public leaderboard or broad model
claim.

## Current Follow-Up Items

- Re-run discovery and suitability review when an eligible provider catalog
  adds or materially changes a frontier model; update canonical config and
  this example only after the route is actually available and evidenced.
- Treat `codex-oauth/gpt-5.5` as the primary route for this
  `kiln-tool-agent` profile. It matched Kimi's `passAtK = 1.0` at `k=5` while
  using about half the input tokens and fewer provider requests.
- Keep `opencode-go/kimi-k2.7-code` as an eligible fallback or specialist
  route for this profile. It passed `k=5`, but used more token and request
  budget in this local comparison.
- Do not promote GLM 5.2 or DeepSeek V4 Pro for this profile until their
  failed `k=1` cases are diagnosed and revalidated.
- Consider pruning or ranking the visible OpenCode model catalog in operator
  surfaces so the large discovered catalog does not bury eligible routes.
- Review competing Codex executables on `PATH`; current Codex auth and model
  discovery work, but duplicate entries can confuse native invocation evidence.
- Keep live provider probes optional and explicit because they can use
  credentials, quota, network, or paid inference.
