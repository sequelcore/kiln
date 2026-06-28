# Skill System

## Overview

Skills are reusable knowledge packages that give agents specialized capabilities without hardcoding domain knowledge into agent definitions. Skills use the SKILL.md format (markdown with YAML frontmatter) and are discovered through a 3-tier registry.

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
| `name` | string | Yes | Kebab-case identifier (max 40 chars) |
| `description` | string | Yes | One-sentence description |
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
| Project | `{project}/.kiln/skills/` | Highest | Project-specific skills |
| User | `~/.kiln/skills/` | Medium | Cross-project skills |
| Builtin | Kiln core built-ins and domain packages | Lowest | Default skills |

The registry resolves conflicts by tier priority: project > user > builtin.

## Kiln Core Built-Ins

Kiln includes a compact neutral core skill pack. These skills are procedural
guidance only; they do not grant tool, filesystem, network, provider, or config
mutation authority.

Current core built-ins:

- `repo-context-review`
- `codebase-scouting`
- `implementation-planning`
- `tdd-workflow`
- `code-review-findings`
- `clean-architecture-boundary-review`
- `ddd-boundary-review`
- `refactoring-safety`
- `security-scope-review`
- `managed-agent-risk-review`
- `benchmark-readiness-review`
- `config-projection-review`
- `clear-writing`

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
`~/.kiln/skills` and `.kiln/skills`.

## Skill Status And Admission

Kiln reports skill status through `kiln config read skills`, `kiln config read
setup`, GUI setup, TUI setup, and the model-callable `kiln_config.read` view.
The status contract separates:

- configured registry entries from project, user, plugin, or built-in sources
- built-in versus user/project content
- native projection state for Claude Code, Codex, and OpenCode
- unmanaged native harness-local skills that exist outside Kiln
- route/session admission into current procedural context
- omission or unavailable reasons

This distinction is deliberate. A local Codex skill such as `shadcn` may exist
under `~/.codex/skills`, but Kiln treats that as `native-harness` and
`unmanaged-native` until it is adopted or installed into `~/.kiln/skills` or
`.kiln/skills`. Managed invocation does not silently import native harness
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
through independent `intents`, `artifacts`, `domains`, `effects`, and `modes`
facets. This keeps writing, support, education, business, document, and other
non-programming work from being forced into software-oriented route labels.

Managed invocations may supply an explicit classification:

```json
{
  "workClassification": {
    "intents": ["write"],
    "artifacts": ["document"],
    "domains": ["education"],
    "effects": ["write-artifact"],
    "modes": ["coauthor"]
  }
}
```

Unknown explicit facet values fail closed. In advisory mode, the classification
is recorded and recommendations remain diagnostics. In auto mode, Kiln may
admit a recommended skill only when it exists in the governed registry. The
invocation metadata records requested classification, resolved classification,
recommended skill ids, and admitted skill ids.

`clear-writing` is a neutral first-party writing procedure. Use it when an
agent is asked to write, rewrite, or review prose in reports, research briefs,
proposals, support replies, UI copy, public content, internal communication,
education, or technical documentation. It is not a brand voice, legal style, or
regional government style; stricter project, organization, legal, academic, or
regulatory formats remain higher-precedence constraints.

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
memory, knowledge, summaries, and coordination state. Runtime code must not
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

## Skill Capture

Kiln can generate skills from completed session transcripts.

### CLI Command

```
kiln skill capture [sessionId] [options]
```

Options:
- `--last`: use the most recent session
- `--scope project|user`: where to save the generated skill
- `--yes`: skip interactive review
- `--dry-run`: preview without writing
- `--name <name>`: override generated skill name
- `--provider <provider>`: LLM provider (anthropic, openai, etc.)
- `--api-key <key>`: API key for LLM calls

### Two-Phase Pipeline

SkillCaptureService (`packages/core/src/skill/skill-capture.ts`) runs a two-phase extraction:

#### Phase 1: extractSummary

Analyzes the session transcript and produces a JSON summary:

```typescript
export interface SkillCaptureSummary {
  readonly title: string;
  readonly goal: string;
  readonly reusableWhen: string;
  readonly tools: string[];
  readonly steps: string[];
  readonly pitfalls: string[];
  readonly tags: string[];
}
```

The summary is generated by prompting an LLM with the conversation text and metadata (tool count, turn depth).

#### Phase 2: generateSkill

Takes the summary and generates a complete SKILL.md file:

```typescript
export interface SkillDraft {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}
```

The generated content includes YAML frontmatter and markdown body.

### Fallback Generation

When no transcript is available, SkillGenerator falls back to single-pass generation from session metadata only.

### Transcript Persistence

TranscriptStore (`packages/cli/src/wrapper/session-store.ts`) persists session data for capture:

| File | Content |
|------|---------|
| `.kiln/sessions/{id}/meta.json` | Session metadata (provider, duration, cost, tool count, turn depth) |
| `.kiln/sessions/{id}/transcript.jsonl` | Full SessionEvent stream |

Sessions run in CLI-wrapper mode without an API key print a capture hint after completion.

## CLI Commands

| Command | Description |
|---------|-------------|
| `kiln skill list` | Show available skills (all 3 tiers) |
| `kiln skill install <path>` | Install a SKILL.md file to project |
| `kiln skill publish` | Validate SKILL.md for npm publishing |
| `kiln skill capture [sessionId]` | Generate a skill from a session transcript |

Use `kiln config read skills` when you need origin, projection, unmanaged
native, or admission diagnostics. Use `kiln skill list` for the shorter
operator-facing configured registry list.

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

- [Context Governance](../architecture/context-governance.md) -- context
  admission, budget, and audit policy
- [CLI Wrapper](cli-wrapper.md) -- session lifecycle and transcript persistence
- [Tool Use](tool-use.md) -- canonical tool surface, MCP projection, and
  execution policy
