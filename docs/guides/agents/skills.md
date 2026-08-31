# Skill System

## Overview

Skills are reusable directory packages that give agents specialized capabilities without hardcoding domain knowledge into agent definitions. Every package contains `SKILL.md` and may include scripts, references, assets, and harness metadata. Skills are discovered through a 3-tier registry.

Skills package intent over canonical tools. They can tell an agent when to use
tools, which tool groups are appropriate, what workflow to follow, and what
policy hints or host installation metadata should travel with the package.
They do not define a private execution path for Kiln tools.

The external runtime contract for wrapper and host integrations is MCP. A
skill may reference MCP-exposed Kiln tools by name, but authorization,
execution, telemetry, audit, and result sanitization stay in the canonical
tool runtime. If a wrapper plugin installs a skill or exposes host UX around
it, that plugin is a projection layer over MCP or the canonical registry, not
a new tool executor.

## SKILL.md Format

A skill file is a markdown document with YAML frontmatter. The parser is in `packages/core/src/skill/md-parser.ts`.

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Portable lowercase kebab-case identifier, maximum 64 characters |
| `description` | string | Yes | What the skill does and when to use it, maximum 1024 characters |
| `license` | string | No | License name or bundled license reference |
| `compatibility` | string | No | Environment and harness requirements, maximum 500 characters |
| `metadata` | object | No | Portable or namespaced metadata preserved as string values |
| `tools` | string[] | No | Canonical tool names or tool groups this skill may use |
| `tags` | string[] | No | Tags for discovery (e.g., "database", "testing") |
| `triggers` | array | No | Event triggers that activate the skill |
| `handler` | string | No | Custom handler reference |

### Trigger Structure

```yaml
triggers:
  - event: ToolUseStart
    filter:
      toolName: "bash"
```

### Example SKILL.md

```yaml
---
name: database-migration-runner
description: Execute database migrations with rollback support
tools:
  - bash
  - read
  - write
tags:
  - database
  - migration
  - postgresql
triggers:
  - event: UserPromptSubmit
    filter:
      intent: "migration"
---

# Database Migration Runner

This skill handles database migration execution with automatic rollback on failure.

## Usage

When you need to run a migration:

1. Check current migration status with `ls -la migrations/`
2. Run migration: `npx prisma migrate deploy`
3. Verify with `npx prisma db push --preview`

## Rollback

On failure, the skill will:
- Capture the error output
- Rollback using `npx prisma migrate rollback`
- Report the failure to logs

## Common Issues

- **Locked migrations**: Kill stale connections before retrying
- **Missing env vars**: Ensure DATABASE_URL is set
```

## SkillRegistry

Skills are discovered through a 3-tier progressive disclosure model (`packages/core/src/skill/skill-registry.ts`):

### Discovery Tiers

| Tier | Location | Priority | Use Case |
|------|----------|----------|----------|
| Project | `~/.kiln/projects/<krp_sha256>/skills/` | Highest | Project-specific skills |
| User | `~/.kiln/skills/` | Medium | Cross-project skills |
| Builtin | Kiln core built-ins and domain packages | Lowest | Default skills |

The registry resolves conflicts by tier priority: project > user > builtin.
The project tier is selected only through the canonical private project binding;
the repository is never searched for a Kiln skill directory.

## Kiln Core Built-Ins

Kiln includes a compact neutral core skill pack. These skills are procedural
guidance only; they do not grant tool, filesystem, network, provider, or config
mutation authority.

Current core built-ins:

- `agent-context-doctor`
- `repo-context-review`
- `codebase-scouting`
- `implementation-planning`
- `tdd-workflow`
- `verification-evidence`
- `code-review-findings`
- `clean-architecture-boundary-review`
- `ddd-boundary-review`
- `concept-modeling`
- `refactoring-safety`
- `security-scope-review`
- `managed-agent-risk-review`
- `research-workflow`
- `orchestration-workflow`
- `kiln-control-plane-workflow`
- `benchmark-readiness-review`
- `config-projection-review`
- `action-first-communication`
- `clear-writing`

`concept-modeling` is the neutral procedure for discovering and naming domain
or technical concepts before they become cross-surface contracts. It owns the
concept contract and translation mapping; `ddd-boundary-review` owns business
capabilities, bounded contexts, aggregates, and domain invariants when DDD
complexity is justified. They may be paired, but concept modeling does not
impose DDD ceremony and DDD review does not own every technical concept.

The skill is available for explicit selection and governed catalog admission,
but it is not included in the static `architecture-review` recommendations.
That routing remains intentionally limited to `repo-context-review`,
`ddd-boundary-review`, and `clean-architecture-boundary-review` until a
separate routing decision is admitted.

Concept modeling does not require `CONTEXT.md`, a glossary, an ADR, a registry,
or a new type. Durable knowledge stays with its natural authoritative owner;
create documentation or an ADR only when non-derivable meaning or a real,
consequential tradeoff requires it.

## Concept Modeling Evaluation

The paired internal fixture is
[`kiln-concept-modeling-v1.json`](../../../packages/core/evals/benchmark/kiln-concept-modeling-v1.json).
It compares baseline and skill arms on six synthetic tasks using
`gpt-5.6-luna` at high reasoning effort, with identical Codex harness,
authority, output schema, and task inputs. The skill arm uses a stable
application wrapper plus the candidate, while the baseline uses a neutral
no-tool wrapper. The bounded method and limitations are recorded in
[`methodology.md`](../../benchmarks/concept-modeling-v1/methodology.md) and
[`limitations.md`](../../benchmarks/concept-modeling-v1/limitations.md).

Use global config to make the policy explicit:

```yaml
skills:
  selection:
    mode: advisory
  builtin:
    enabled: true
    include:
      - repo-context-review
      - codebase-scouting
      - implementation-planning
      - tdd-workflow
      - code-review-findings
```

Project config may narrow or disable built-ins:

```yaml
skills:
  builtin:
    exclude:
      - benchmark-readiness-review
```

Built-ins are projected to supported native harness skill directories during
`kiln sync --skills`, unless disabled by config. Generated native skill files
remain projections; canonical user and project skills live under
`~/.kiln/skills` and the bound private project's `skills` directory.

`kiln-control-plane-workflow` is useful only when a session exposes the
governed Kiln control-plane operations. It teaches discovery, inspection,
idempotent Agent Task submission, and lifecycle reconciliation. It does not
install or authorize MCP, mirror the CLI, choose routes or credentials, or use
shell as a fallback for an unavailable operation. The same compact critical
instructions are projected through MCP server initialization; Core remains the
single semantic owner.

## Skill Status And Admission

### Native catalog visibility

Kiln owns native catalog visibility as provider-neutral policy:

- `implicit` skills may be advertised for model selection.
- `explicit-only` skills stay directly invocable without occupying the default
  model-facing description catalog.
- `disabled` skills are unavailable and their Kiln-owned projections are
  pruned.

Configure the default and exact skill-id exceptions under
global `skills.visibility`. Project-level visibility is rejected while native
skill targets are user-global. This policy is projected through harness-specific
adapters; native files remain generated output. When an installed harness
cannot prove an exact translation, shared status reports the capability gap.
Do not edit generated provider metadata to conceal that gap.

Catalog visibility is not runtime admission. The existing
`skills.selection.mode` contract independently decides whether recommendations
remain advisory or enter governed managed-task context.

External catalogs are governed separately by global `skills.externalCatalog`.
Each keep decision binds an exact portable source id to its complete package
digest. Codex sync disables only the remaining implicit external candidates by
absolute skill path, preserves unrelated `[[skills.config]]` entries, and
removes its owned entries when the policy is removed. Sync fails closed when
inventory is incomplete or reviewed content has drifted. `config read skills`
reports realized and suppressed counts plus fingerprint freshness; Claude and
OpenCode remain explicitly unsupported until an exact adapter is admitted.
After applying or changing exposure rules, verify behavior in a fresh Codex
session. Persisted config and status prove the configured rule order, but an
already-running harness may retain catalog state loaded before the change.

Stable OpenCode cannot represent `explicit-only`: it also discovers skills
from the user Claude catalog and its permission model cannot keep a denied
skill directly invocable. Kiln therefore projects an exact
`permission.skill.<name> = "deny"` rule as a fail-closed approximation. Status
continues to report the capability as unsupported and effective visibility as
disabled. The dedicated visibility owner preserves unrelated permission rules
and refuses an operator wildcard that would override the exact deny.
This is proof for the observed default merged configuration, not universal
proof across every OpenCode agent: project or agent-specific permission layers
may override the user-global rule. Status checks project-level OpenCode config
when present; agent-specific overrides remain an explicit unsupported-capability
residual. Validate the default agent in a fresh OpenCode session after sync.

Kiln reports skill status through `kiln config read skills`, `kiln config read
setup`, GUI setup, TUI setup, and the model-callable `kiln_config.read` view.
The status contract separates:

- configured registry entries from project, user, plugin, or built-in sources
- built-in versus user/project content
- native projection state for Claude Code, Codex, and OpenCode
- unmanaged native harness-local skills that exist outside Kiln
- route/session admission into current procedural context
- omission or unavailable reasons

It also inventories shared `.agents` roots, enabled Codex plugins, Codex system
skills, and native harness directories as diagnostic sources. Same-name sources
with identical complete-package digests are equivalent duplicates; different
digests are collisions. Kiln-managed native copies are related projections and
are not counted as independent collisions. These inventory rows never become
managed-task skills without explicit adoption into a canonical Kiln source.

Catalog pressure is reported as exact UTF-8 description bytes and visibility
counts per harness. Codex status also records its documented discovery budget:
two percent of model context, or an 8,000-character fallback when context is
unknown. Claude and OpenCode remain unknown unless a versioned authority
supplies comparable evidence.

Every candidate also carries bounded complete-package health: portable identity,
file and package size, local Markdown resource integrity, and review signals for
scripts, network access, credentials, and outside-package filesystem access.
Those signals tell an operator what to inspect; they do not label the package
safe or malicious. Explicit broken packages fail closed, and automatic
recommendations never load them.

GUI Setup presents this as a diagnostic Skill Catalog with explicit copy-path
controls; TUI Setup prints the same shared evidence deterministically. In both
surfaces, `available` means Kiln governance may admit the skill. It does not
mean the skill is already loaded in the active session; only `admitted` records
that context state.

This distinction is deliberate. A local Codex skill such as `shadcn` may exist
under `~/.codex/skills`, but Kiln treats that as `native-harness` and
`unmanaged-native` until it is adopted or installed into `~/.kiln/skills` or
the private project's `skills` directory. Managed invocation does not silently import native harness
folders, because those folders may have different trust, policy, plugin, or
route assumptions than the current Kiln session.

When setup recommends `adopt-or-back-up-native-guidance`, the governed repair
is to run the setup action. Kiln copies parseable, non-conflicting native
skills into the global Kiln registry once, then projects that canonical copy to
Claude Code, Codex, and OpenCode. If two harnesses contain the same skill name
with different content, adoption blocks and reports the conflict so the
operator can reconcile the source before Kiln admits it.

Explicit skill requests fail closed when the skill is not in the governed Kiln
registry. Recommended skills are advisory unless `skills.selection.mode: auto`
is enabled. Auto mode admits only configured skills and records the admission
in managed invocation context metadata; unavailable recommendations are skipped
instead of invented.

## Work-Aware Selection

Models and routes may advertise recommended skills for task classes such as
`architecture-review`, `backend-coding`, `frontend-design`, `mechanical-edit`,
`research`, and `test-writing`. Recommendations are advisory by default. Kiln
loads skills automatically only when `skills.selection.mode: auto` is set and
the recommended skill exists in the admitted project, user, or built-in skill
catalog.

Auto-selection is still governed admission:

- it does not grant tool, filesystem, network, provider, or write authority
- it does not invent unknown skills
- unavailable recommended skills are skipped
- explicitly requested missing skills fail closed
- admitted skills are recorded in managed invocation context metadata

Route task suitability and work classification are separate contracts.
Suitability describes whether a provider/model route is appropriate for a
bounded execution class. `WorkClassification` describes the operator's work
through independent `intents`, `artifacts`, `domains`, `evidenceScopes`,
`effects`, and `modes` facets. This keeps writing, support, education,
business, document, and other non-programming work from being forced into
software-oriented route labels.

Managed invocations may supply an explicit classification:

```json
{
  "workClassification": {
    "intents": ["write"],
    "artifacts": ["document"],
    "domains": ["education"],
    "evidenceScopes": ["provided"],
    "effects": ["write-artifact"],
    "modes": ["coauthor"]
  }
}
```

The `research` task suitability class describes model/route capability; it does
not choose a research procedure. A work classification with intent `research`
and evidence scope `repository` recommends `codebase-scouting`. Scope
`external` or `provided` recommends `research-workflow`; an explicit mixed
scope recommends both. An unscoped research classification recommends neither,
so Kiln does not silently turn repository analysis into web research or vice
versa. Prose-like research output may additionally recommend `clear-writing`.
These procedures govern method, not network admission, route choice, provider
identity, or citation tooling.

Work with mode `delegate` recommends `orchestration-workflow`. It consumes
executable work governance, builds conflict-free child contracts and an acyclic
work graph, treats child output as an untrusted proposal, and reports requested,
admitted, executed, and adopted work separately. It cannot create delegation,
route, permission, budget, approval, or lifecycle authority.

## Value Evaluation

Do not promote a skill from frontmatter validity, popularity, installation
count, stars, author reputation, or one successful example. Use paired baseline
and skill observations on representative tasks and retain per-task regressions,
routing errors, authority failures, context cost, latency, cost, environment,
and replay evidence. Material changes to skill digest, candidate catalog,
model, harness, tools, permissions, or fixture version require re-evaluation.

Unknown explicit facet values fail closed. In advisory mode, the classification
is recorded and recommendations remain diagnostics. In auto mode, Kiln may
admit a recommended skill only when it exists in the governed registry. The
invocation metadata records requested classification, resolved classification,
recommended skill ids, admitted skill ids, and per-skill diagnostic state:
`admitted`, `advisory`, or `unavailable`.

For governed work, the long-lived source is the approved plan work item. A
classified plan work item stores `workClassification` and
`workClassificationProvenance` together, binds both to the approved content
hash, and materializes them into the durable `WorkItem`. A managed invocation
generated from that work item carries the stored classification automatically;
operators do not need to restate it in the child request. If the classification
changes, the plan must be revised and re-approved before the new value can
govern execution.

Manual governed work may also be classified through `work_item.update` by
supplying `workClassification` and matching `workClassificationProvenance`.
Agent profiles may declare a default `workClassification` for specialized
roles such as report writing, support, or education. Explicit invocation or
work-item classification takes precedence over profile defaults.

`clear-writing` is a neutral first-party writing procedure. Use it when an
agent is asked to write, rewrite, or review prose in reports, research briefs,
proposals, support replies, UI copy, public content, internal communication,
education, or technical documentation. It is not a brand voice, legal style, or
regional government style; stricter project, organization, legal, academic, or
regulatory formats remain higher-precedence constraints.

`action-first-communication` is a neutral, explicit response profile for users
who prefer the result or next action first, bounded steps, visible state, and
matter-of-fact errors. It is not enabled for every turn, does not infer a
medical condition, and yields to safety, accuracy, requested explanation depth,
and required output formats. Assign it through an agent profile or request the
skill explicitly.

Future official packs are deferred. They may later provide web, backend,
security, data, brand, regional-content, or opinionated engineering workflows,
but packs must be installable/removable content rather than core doctrine.

### Registry API

```typescript
export class SkillRegistry {
  constructor(options?: SkillRegistryOptions);
  
  // Register a skill index
  register(index: SkillIndex): void;
  
  // Register a full config
  registerFull(config: SkillConfig): void;
  
  // Get by name
  get(name: string): SkillIndex | undefined;
  
  // List all
  all(): SkillIndex[];
  
  // Load full config on demand
  load(name: string): SkillConfig | undefined;
  
  // Resolve by names or tags
  resolve(names?: readonly string[], tags?: readonly string[]): SkillIndex[];
  
  // Discover from directory
  discoverFrom(dirPath: string): number;
  
  // Discover all 3 tiers
  discoverAll(projectPath: string, userHome: string): number;
}
```

## Runtime Context Admission

Runtime active skills are resolved by `SkillRegistry`, converted into
procedural context candidates, and admitted through the core
`ContextGovernor`. They are ranked and deferred under the same turn budget as
memory, summaries, and coordination state. Runtime code must not
inject skills through `PerCallToolConfig` or another parallel system-prompt
path.

Runtime admission is not tool authorization. A skill can make instructions
available to the model, but the concrete tool call still passes through the
same runtime authorization and execution path as any other Kiln tool call.

```typescript
// packages/core/src/skill/types.ts
export interface SkillConfig extends SkillIndex {
  readonly instructions: string;
}
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `kiln skill list` | Show available skills (all 3 tiers) |
| `kiln skill install <path>` | Validate and atomically install a complete local package; refuse overwrite |
| `kiln skill update <name> [path] [--force]` | Update an owned package with drift protection and backup |
| `kiln skill remove <name> [--force]` | Remove an owned package with drift protection and recoverable backup |
| `kiln skill publish` | Validate SKILL.md for npm publishing |

Use `kiln config read skills` when you need origin, projection, unmanaged
native, or admission diagnostics. Use `kiln skill list` for the shorter
operator-facing configured registry list.

Installation records a complete-package digest and source path in the bound
private project's `skill-install-state.json`. Update and removal refuse locally
modified content unless the operator explicitly uses `--force` after review.
Backups are stored under the private project's `backups/skills/<name>/`. These commands operate on local
packages; Kiln does not infer trust from a marketplace listing.

## Event Triggers

Skills can be triggered by events. The supported event types are defined in `packages/core/src/events/index.js`:

| Event | Description |
|-------|-------------|
| `ToolUseStart` | Tool invocation begins |
| `ToolUseEnd` | Tool invocation completes |
| `UserPromptSubmit` | User submits a prompt |
| `AgentStart` | Agent starts processing |
| `AgentEnd` | Agent completes processing |

## Related

- [Context Governance](../../architecture/context/context-governance.md) -- context
  admission, budget, and audit policy
- [CLI Wrapper](../gui/cli-wrapper.md) -- session lifecycle and transcript persistence
- [Tool Use](../channels/tool-use.md) -- canonical tool surface, MCP projection, and
  execution policy
