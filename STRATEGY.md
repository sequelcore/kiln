# Kiln Strategy & Roadmap
> Living document. High-level vision and phased plan.
> Each phase will have its own dedicated research → architecture → 
> implementation pipeline before execution.
> Last updated: 2026-04-01

## 1. What Kiln Is

**The end goal in one line:**
Kiln TUI replaces claude TUI as your primary terminal interface —
same conversational experience, three CLIs orchestrated underneath,
zero manual routing decisions.

### 1.1 Today (v0.23.2)

Kiln is a domain-agnostic AI orchestration engine built as a Bun monorepo with 6 packages. License: MIT open source.

| Package | Scope | Purpose |
|---------|-------|---------|
| `packages/core` | `@kilnai/core` | Engine primitives, implementations, YAML loader |
| `packages/runtime` | `@kilnai/runtime` | Gateway server, channel adapters, triggers |
| `packages/cli` | `@kilnai/cli` | CLI commands, init wizard, dev mode |
| `packages/sdk` | `@kilnai/react` | React hooks |
| `packages/widget` | `@kilnai/widget` | Embeddable chat widget |
| `packages/studio` | `@kilnai/studio` | Dev UI SPA |

**CLI Commands (today):**
- `kiln run` — Spawns Claude Code subprocess, supports `--apiKey`, `--provider`, `--permissionPolicy`
- `kiln mcp-config` — Generates MCP config for all backends (`--client claude-code|codex|opencode|all`); writes to `.mcp.json` (Claude Code), `~/.codex/config.toml` (Codex), `~/.config/opencode/opencode.json` (OpenCode); supports `--name`, `--command`, `--args` overrides
- `kiln skill list|install|publish` — Skill management (3-tier discovery)
- `kiln init` — Interactive wizard for app.yaml + gateway.yaml
- `kiln dev` — Dev mode with YAML hot-reload
- `kiln domain` — Domain kit management

**25 MCP Tools (today):**
| Category | Tools |
|----------|-------|
| Memory | `memory_recall`, `memory_store`, `memory_delete` |
| Knowledge | `knowledge_search`, `knowledge_sources` |
| Cost | `cost_summary` |
| Safety | `safety_metrics` |
| Integrations | `integration_list`, `integration_execute` |
| Routing | `routing_test` |
| Eval | `eval_score` |
| Enrichment | `enrichment_get`, `enrichment_list` |
| Cross-agent memory | `cross_agent_memory_recall`, `cross_agent_memory_store`, `cross_agent_memory_list`, `cross_agent_memory_delete` |
| Budget | `budget_check`, `budget_report` |
| Swarm primitives | `swarm_join`, `swarm_leave`, `swarm_status`, `swarm_broadcast`, `swarm_claim`, `swarm_release` |

### 1.2 The Problem It Solves

For a developer using Claude Code + Codex CLI + OpenCode simultaneously:

- **Redundant configuration** across 3 tools (hooks, permissions, MCP config duplicated)
- **No shared state** between CLI sessions
- **No budget tracking** across subscriptions
- **No cross-CLI skill sharing**
- **No active orchestration** — everything manual

### 1.3 The Core Insight

"Every other orchestrator routes between models.
Kiln routes between subscriptions."

- Claude Code → Anthropic subscription ($20/mo flat)
- Codex CLI → OpenAI subscription ($20/mo flat)
- OpenCode → OpenCode subscription ($10/mo flat)
- Kiln treats three flat-rate subscriptions as a unified resource pool
- This is the unique differentiator no other tool has

## 1.4 Kiln vs OpenKiln — Two Distinct Products

Kiln is the engine. OpenKiln is an app built on top of Kiln.
This separation is intentional and architecturally clean.

The parallel in the market:
- LangChain (engine) → LangSmith (product built on top)
- LlamaIndex (engine) → LlamaCloud (product built on top)
- Kiln (engine) → OpenKiln (product built on top)

Kiln already ships example apps in the repo:
hello-agent/, support-agent/, booking-assistant/,
whatsapp-bot/, multi-app-gateway/
OpenKiln is one more — but the most complete and opinionated.

Two distinct launches, two distinct audiences:

Launch 1 — Kiln engine (for developers)
Target: developers who want to build their own AI orchestration app
Value: MIT, @kilnai/core + @kilnai/runtime, example templates
Timing: can happen before OpenKiln is ready
Differentiator: subscription arbitrage, multi-tenant, domain-agnostic,
Windows native, no competitor with this combination

Launch 2 — OpenKiln (for end users)
Target: developers who want a personal AI agent, ready to use
Value: npx openkiln init, Telegram/Discord/CLI, local-first
Timing: after Phase 5
Differentiator: Hermes + OpenClaw + subscription arbitrage
+ mature engine underneath

## 1.5 What OpenKiln Inherits From Kiln (Day One)

Hermes (the closest competitor) had to build everything from scratch.
OpenKiln inherits all of this from Kiln without writing a line:

| Capability | Where it exists |
|------------|----------------|
| FTS5 memory search | core (BM25, decay, compaction) |
| Cron scheduler | runtime (drift-free) |
| Skill registry | core (3-tier discovery) |
| Channel adapters | runtime: CLI, Web, WhatsApp, Instagram, Messenger, Slack, Email, API |
| Safety rails | core (PII, 4 policy rails) |
| Eval scorers | core (23 scorers) |
| Multi-tenant | core from day one |
| Studio UI | studio package |
| Circuit breaker | agent adapters |

Hermes took months to build what OpenKiln has available on day one.
The engine investment pays forward into the product layer.

## 2. Market Context & Competition

### 2.1 Landscape (March 2026)

| Tier | Tools | Characteristics |
|------|-------|-----------------|
| Tier 1 | Claude Code, Cursor | Single interactive agent |
| Tier 2 | Conductor, OpenClaw, Claude Squad, OMO/Sisyphus | Multi-agent with local dashboard |
| Tier 3 | Claude Code Web, Codex Web, Jules | Autonomous cloud VMs |

### 2.2 Key Competitors Analyzed

#### Hermes Agent (Nous Research, Feb 2026)
- Learning loop: auto-generates skills from experience
- Multi-level memory: MEMORY.md, USER.md, FTS5 SQLite search
- Cron scheduler in natural language
- Multi-platform: Telegram, Discord, Slack, WhatsApp, Signal
- MIT, runs on $5 VPS, successor to OpenClaw
- **Gap vs Kiln:** no cross-CLI orchestration, no subscription arbitrage, no Windows native, multi-agent still in development (issue #344)

#### OpenClaw → Next Version as MCP
- Pioneered async messaging agents
- Next version: native MCP server connecting to wider message providers
- **Gap vs Kiln:** channel bridge only, not orchestration engine

#### oh-my-opencode (OMO/Sisyphus)
- 11 specialized agents, 46 hooks in 7 tiers, 26 tools
- Dynamic prompt builder per agent from single config
- Single oh-my-opencode.json — no redundancy within OpenCode
- **Gap vs Kiln:** lives inside OpenCode only, not cross-tool

#### Graphite MCP
- Stacked PRs: dependent PRs in series, auto-rebase on merge
- MCP server built into CLI (v1.6.7+)
- Relevant for Phase 3 migration PRs
- Not an orchestrator — a code review tool

#### MCPorter (steipete)
- Calls MCP tools as typed TypeScript API
- Converts MCP servers to standalone CLIs
- Imports MCP config from claude-code, codex, opencode, cursor
- Complementary to kiln mcp-config — opposite direction
- Use case: mcp-config generates → MCPorter imports

#### claude-better
- Reimplements Claude CLI using GPT-5.4 behind the scenes
- 73% faster startup, 80% lower memory
- Masquerades as Claude to every header and analytics call
- **RISK:** Not Claude — OpenAI model in disguise. TOS violation.
- **Decision:** Discarded. Never use.

### 2.3 What Kiln Has That Nobody Else Does

1. Cross-CLI subscription arbitrage (Claude+Codex+OpenCode as pool)
2. kiln config sync — generates config for 3 tools from single source
3. Swarm primitives cross-provider (already implemented)
4. Budget tracking cross-platform (already implemented)
5. Windows native (Hermes requires WSL2)
6. Domain-agnostic engine (not coding-specific by design)
7. Kiln TUI — conversational TUI that orchestrates 3 CLIs transparently.
   Claude Code TUI orchestrates one CLI.
   Kiln TUI orchestrates three — transparently, with budget tracking,
   swarm visibility, and subscription arbitrage built in.
   No other orchestrator has this combination in a TUI.

OpenKiln specific position:
OpenKiln = Hermes capabilities
         + OpenClaw async messaging
         + subscription arbitrage (unique)
         + cross-CLI orchestration (unique)
         + mature engine underneath (unique)
         - months of engine construction time

Hermes is the closest competitor to OpenKiln.
The gap: Hermes has no cross-CLI orchestration, no subscription
arbitrage, no Windows native, multi-agent still in development.

## 3. Legal & Compliance Constraints

### 3.1 Anthropic TOS — The Critical Boundary

**LEGAL:** spawn("claude", ["-p", task]) as subprocess. The real CLI binary handles its own auth. Same as typing in terminal. This pattern is used by Conductor, GoBot, Antfarm.

**ILLEGAL:** extracting OAuth tokens from Claude Code npm package and using them to make direct API calls to api.anthropic.com

**What triggered enforcement (Jan 9, 2026):** Anthropic deployed server-side blocks on OAuth tokens used outside the official Claude Code CLI. Tools affected: OpenCode, Roo Code, Cline, and others that spoofed Claude Code client identity.

**Kiln's position:** never touches tokens. Coordinates CLIs as subprocesses. This is architecturally safe, not just legally compliant.

### 3.2 Subprocess Limitations (Research-Confirmed)

**Limitation 1 — Stateless between calls**
- Status: Partially confirmed. Claude Code has --resume/--session-id. Codex has resume. OpenCode has --session/--continue.
- Kiln solution: hybrid — --session-id for intra-CLI chains, kiln-context.md for cross-CLI handoffs, cross_agent_memory_* only at CLI boundaries.

**Limitation 2 — Startup latency vs hook/skill loss with --bare**
- Status: Confirmed. --bare skips hooks, skills, plugins, auto-memory. CLAUDE.md still loads even with --bare.
- Kiln solution: --bare always for subprocess calls. KilnHookProxy reimplements PreToolUse (security) and Stop (completion). Skills injected as XML block in prompt (max 2000 tokens). OpenCode: opencode serve + --attach eliminates cold boot entirely.

**Limitation 3 — Permission prompts in non-interactive mode**
- Status: Confirmed with active bugs (#35718, #36192, #37181). stdout parsing is fragile and fails with stream-json output.
- Kiln solution: bypassPermissions + dedicated sandbox directory with pre-configured settings.json scoped to Kiln working directory. --allowedTools pre-filtered. Memory dirs outside ~/.claude/. Do NOT rely on CLI flags alone — bugs are version-dependent.

**Limitation 4 — Auto mode aborts on classifier block**
- Status: Confirmed. 3 consecutive / 20 total blocks → abort in -p mode. Task decomposition does NOT reliably avoid this — classifier evaluates subagents at spawn, during execution, AND on return independently.
- Kiln solution: bypassPermissions makes this a non-issue. If auto mode needed: detect exit code → max 2 retries → escalate to interactive.

**Limitation 5 — Model unaware of subprocess context**
- Status: Confirmed. Mode flag not passed to model.
- Kiln solution: `<kiln-preamble>` XML on every prompt via `buildPreamble()`. Sections: `<role>` (name, role, goal, backstory), `<task>`, `<domain>` (project type, tool tags, quality gates), `<constraints>` (approval mode, sandbox), `<memory>` (200-line cap with truncation), `<instructions>`. Sections omitted when empty. XML-escaped content.

### 3.3 Per-User Architecture for OpenKiln (Future)

When Kiln becomes a product for others:
- Each user installs their own CLIs locally
- Kiln orchestrates local CLIs of each user
- Each user uses their own subscriptions
- Kiln gateway is the orchestrator (can be cloud-deployed)
- No token sharing, no OAuth proxying — legally clean

## 4. What Already Exists in Kiln (Reality Check)

### 4.1 Activated in Daily Workflow

- 25 MCP tools via kiln-gateway at localhost:3800
- cost_summary, budget_check in all 15 agents
- cross_agent_memory_* for handoff protocol
- routing_test (available, underused)
- swarm_* (available, not used for coding tasks)
- knowledge_search (available, not configured)

### 4.2 Exists in Codebase But Not Activated

- SQLite + FTS5 memory search (BM25 ranking, decay, compaction) → not exposed as MCP tool yet
- Cron scheduler (drift-free setTimeout chains) → ✅ kiln cron CLI: list/add/remove/run (Phase 3c complete)
- SkillRegistry + SkillTrigger (3-tier discovery, event-based) → no auto-generation from task completion yet
- 8 channel adapters (WhatsApp, Instagram, Slack, Messenger, Email, API) → not configured for personal use yet
- Verification gates (test/lint/type-check loop) → not wired to agent workflow yet
- Eval scorers (23 scorers: 11 rule + 12 LLM-as-judge) → not used in daily tasks yet
- Per-role:model cost tracking → cost_summary used but per-role breakdown not surfaced
- Safety rails (PII scanner, 4 policy rails, grounding rail) → running but not visible in workflow
- Circuit breaker in agent adapters → active but not surfaced as metric

### 4.3 Configuration Redundancy (The Problem to Solve)

- **Permissions:** `KilnPermissionPolicy` (unified `{approval, sandbox}` contract) translated per-backend via `translatePermission()` — settings.json (Claude) + config.toml:75-173 (Codex) + opencode.json:6-48 (OpenCode) — single source of truth, 3 formats generated
- **autoformat.sh:** lives in .codex/hooks/ — should be in .claude/hooks/ with symlink (currently inverted)
- **MCP config:** Claude (.mcp.json) + Codex (config.toml:51-73) + OpenCode (opencode.json via `kiln mcp-config --client all`) ✅
- **Hooks:** Codex hooks.json + Claude settings.json — both active, partially overlapping

## 5. Phased Roadmap

### Phase 1 — Cross-CLI Orchestration (kiln run v2)

**Phase 1 — COMPLETE (v0.23.2, 2026-03-31)**
See changelog: docs/changelog.md

---

### Phase 2 — Config Sync (kiln config sync)

**Phase 2 — COMPLETE (v0.23.2, 2026-03-31)**
See changelog: docs/changelog.md

---

## Sprint 0 — Fix Broken Promises

**Sprint 0 — COMPLETE (v0.23.2, 2026-03-31)**
See changelog: docs/changelog.md

---

### Phase 3 — Activate Existing Capabilities

**Phase 3 — COMPLETE (v0.23.2, 2026-03-31)**
See changelog: docs/changelog.md

---

## Phase 3.5 — Session Power & Observability

**Status:** COMPLETE ✅ (3.5a ✅ 3.5b ✅ 3.5c ✅ 3.5d ✅ 3.5e ✅ 3.5f ✅ — main, 2026-04-01)
**Priority:** HIGH — addresses #1, #2, #3 universal pain points from market research
(permissions opacity, cost blindness, compaction unpredictability)
**Source:** Claude Code scout + Codex scout + OpenCode scout + user research

### Multi-Turn Session Resume ✅ (Phase 3.5b, feat/phase-3-5)
- ✅ feat(cli): SessionStore — append-only JSONL at .kiln/sessions.jsonl, fail-open
- ✅ feat(cli): ClaudeSession resume via reuseEnvironmentId, --resume flag on `kiln run`
- ✅ feat(cli): OpenCodeSession resume via stored remoteSessionId, --attach flag
- ✅ feat(cli): CodexSession thread_id capture via --conversation-id (deferred: Codex upstream)

### Cost & Quota Observability ✅ (Phase 3.5c, feat/phase-3-5)
- ✅ feat(cli): per-turn cost breakdown surfaced in session report
- ✅ feat(core): models.dev API integration — 24h TTL cache at .kiln/models-cache.json
- ✅ feat(cli): token budget diminishing returns detection (3+ continuations, delta < 500)
- Deferred: cost dashboard MCP tool, quota tracking (5h window + weekly resets)

### Compaction — Transparent & Controllable ✅ (Phase 3.5d, feat/phase-3-5)
- ✅ feat(core): configurable compaction threshold via kiln.yaml compaction.threshold (default 1000)
- ✅ feat(core): PreCompact/PostCompact events added to EventBus (level: state) + OTel span mapping
- ✅ feat(core): SqliteMemoryStore auto-triggers compaction after save(), emits pre/postcompact
- ✅ feat(cli): preamble-builder.ts static kiln-compaction-recovery section (layer 1 of 3)
- ✅ feat(cli): KilnCompactionConfig type in kiln-yaml-types.ts (threshold, previewBeforeApply)
- Deferred: compaction preview, ACON-inspired learnable policy (Phase 5+)

### Hook Event System ✅ (Phase 3.5a, feat/phase-3-5)
- ✅ feat(cli): HookRegistry + HookExecutor — 7 events, Command/Prompt/Agent modes
- ✅ feat(cli): KilnHooksConfig type in kiln-yaml-types.ts, wired into kiln.yaml
- ✅ feat(runtime): eager vs deferred MCP tool split — 8 eager, 18 deferred admin tools

### OpenCode Power Unlocks ✅ (Phase 3.5e, feat/phase-3-5)
- ✅ feat(cli): Permission PATCH always fires — derives edit+bash from permissionPolicy.approval
- ✅ feat(cli): experimental.batch_tool:true PATCH (up to 25 parallel tool calls)
- Deferred: GET /diff file change tracking, POST /fork session branching, mid-session model switch

### CLI Bootstrap Fix ✅ (feat/phase-3-5)
- ✅ fix(cli): import.meta.main guard — kiln binary now self-invokes without consumer calling createCli()
- ✅ fix(cli): cli-wrapper mode — kiln run works without --api-key, routes to installed CLIs
- ✅ refactor(cli): remove dead KilnAppConfig identity fields (appName/dirName/version/description/mcpServerName)

### Session Report Backlog (Phase 3.6+)
- feat(cli): surface provider name + model in session report footer
  (`Provider: opencode (claude-haiku-4-5)` line after Mode)
- feat(cli): KilnAppConfig white-label — evaluate removing identity fields or keeping for open-source
  (see deferred decision in STRATEGY.md research section)

### kiln skill capture ✅ (Phase 3.5f, main, 2026-04-01)
- ✅ feat(core): SkillCaptureService — two-phase pipeline: extractSummary (Phase 1, JSON) → generateSkill (Phase 2, SKILL.md)
- ✅ feat(core): PersistedTranscriptEvent type; SkillGenerator uses two-phase when transcript provided, single-pass fallback
- ✅ feat(cli): TranscriptStore — persists .kiln/sessions/{id}/meta.json + transcript.jsonl per session (fail-open)
- ✅ feat(cli): run.ts real turnDepth + toolCount tracking (were hardcoded 0); transcript written on session success
- ✅ feat(cli): `kiln skill capture [sessionId] --last --scope project|user --yes --dry-run` — interactive review before write
- ✅ feat(cli): cli-wrapper sessions without API key print capture hint: `kiln skill capture --last` after setting key
- Research basis: Codex two-phase memory pipeline, OpenCode lazy skill discovery, Reflexion/ExpeL/Voyager academic patterns
- Deferred: skill improvement loop (eval-scored promotion), citation tracking, automatic consolidation (Phase 3.6+)

### Token Budget Intelligence
- feat(core): token budget diminishing returns detection —
  3+ continuations + delta < 500 tokens = stop signal
- feat(cli): denial tracking — 3 consecutive denials or 20 total → escalate

### OpenCode Power Unlocks
- feat(cli): OpenCodeSession GET /session/:id/diff for file change tracking
- feat(cli): OpenCodeSession experimental.batch_tool enablement
  (up to 25 parallel tool calls)
- feat(cli): OpenCodeSession POST /session/:id/fork for session branching
- feat(cli): runtime PATCH /config for model switching mid-session

---

### Phase 4 — kiln config sync for Agents

**Goal:** Eliminate kiln-gateway clause from 22 agent files. Replace with dynamic context injection via MCP.

**Why fourth:** Requires Phase 1 (subprocess) + Phase 3 (memory_search) to be stable first.

**Research needed before execution:**
- Optimal size of agent_context payload (avoid context bloat)
- Which parts of kiln clause are static vs dynamic
- SKILL.md format for kiln-context skill

**Planned work:**
- kiln-context SKILL.md: static parts of kiln clause (when to use each tool, handoff protocol, cost reporting format) → lives in ~/.claude/skills/kiln-context/ → read automatically by Claude + Codex + OpenCode → replaces hardcoded clause in 22 files
- agent_context MCP tool (#27): dynamic parts only (budget_remaining, active_swarm, model_override, session_id) → called at agent start, returns 3-4 fields max → not 15 lines of text — just what changes per session
- Remove kiln clause from all 22 agent MD/TOML files after SKILL.md is confirmed working

**Additional Phase 4 scope (from competitive intelligence):**
- feat(core): AGENTS.md support + CLAUDE.md↔AGENTS.md bridge —
  cross-tool instruction standard (top request in Claude Code community)
- feat(cli): CodexSession --sandbox flag passthrough (enforce, not ignore)
- feat(cli): CodexSession --local-provider ollama/lmstudio support
  (local model routing via Codex backend)
- feat(cli): CodexSession --profile support for named config sets
- feat(cli): OpenCodeSession sandbox mode actually enforced
  (currently silently ignored)

**Sub-phases:**
4a. kiln-context SKILL.md (static parts)
4b. agent_context tool #27 (dynamic parts)
4c. Migration: remove clause from 22 files one by one with testing

---

## Deferred Decision: KilnAppConfig white-label fields (2026-04-01)

**Context:** `KilnAppConfig` has `appName`, `description`, `dirName`, `mcpServerName`, `version` —
all configurable, all hardcoded to `"kiln"` in every consumer (tests + mcp-entry). Zero real
white-label consumers exist today.

**Immediate fix applied:** Added `import.meta.main` guard to `packages/cli/src/index.ts` so the
binary self-invokes. Uses hardcoded defaults inline. Binary now works standalone.

**Deferred question:** Should `appName`/`description`/`dirName`/`mcpServerName`/`version` be removed
from `KilnAppConfig` and hardcoded inside `createCli`?

**Arguments for removing:**
- No real consumers — violates "3 uses before abstracting"
- All competing CLIs (Claude Code, Codex, OpenCode) hardcode their identity
- Removes ~15 `config.appName` references replaced with `"kiln"` literals
- Eliminates dead fields from a public interface

**Arguments for keeping:**
- Cost is nearly zero — they're strings, no runtime complexity
- Open source: future contributors may want white-label use case
- Removing them is a minor breaking change for any external consumers

**Decision needed:** Remove or keep. Revisit when starting Phase 4 cleanup.
**Owner:** Ricardo. **Effort if removing:** small (4 field removals + ~15 call sites).

---

## Research: CLI Integration Philosophy (codex-plugin-cc scout, 2026-04-01)

**Source:** codex-plugin-cc architecture scout + comparative analysis

### Three integration approaches

**1. Plugin/slash command (codex-plugin-cc model)**
Claude Code is the host. Other tools are subprocesses invoked from within Claude's session.
Communication is one-directional — Claude calls out, gets a result back. State lives in flat files.
Zero coordination between tools; they don't know each other exist.

**2. Direct API calls**
Each tool talks to provider APIs independently. No shared state, session handoff, or cost aggregation.
Works for single-tool workflows. Breaks down when you need cross-CLI handoff or unified budgets.

**3. Meta-orchestrator (Kiln's model)**
Kiln owns the session lifecycle above all CLIs. Routes tasks by capability and quota, tracks cost
across providers, handles mid-task handoff. CLIs become interchangeable workers, not fixed hosts.

### Where Kiln wins
- Cross-CLI session resume (threadId → reuseEnvironmentId handoff)
- Unified cost budget enforced across Claude + Codex + OpenCode
- Circuit breaking — quota exhausted on one backend, falls to another automatically
- EventBus observability across all backends from one stream
- Provider-agnostic: adversarial review, job tracking, rescue all work regardless of which CLI runs

### Where plugin wins
- Zero setup friction for Claude Code users — install plugin, done
- Stop hook is deeply integrated into the host process lifecycle
- Slash commands feel native inside Claude Code

### The genuine gap
The Stop hook is the one thing Kiln cannot replicate natively. It requires being *inside* the
Claude Code process. Everything else — job tracking, adversarial review, rescue — Kiln can do
natively and better because it's provider-agnostic.

### Verdict
**Plugin: LATER.** Build native CLI primitives first. Plugin becomes a thin UX wrapper for Claude
Code users once native Kiln is stable. Kiln's differentiation is cross-CLI unification — a plugin
re-locks users into Claude Code-only UX.

### Steal list (native Kiln implementation)

| Pattern | What plugin does | Kiln approach | Owner | Effort | Phase |
|---------|-----------------|---------------|-------|--------|-------|
| Adversarial review | prompts/adversarial-review.md → structured skepticism, JSON findings | `kiln review --adversarial`, prompt in core/src/review/ | cli + core | medium | 4+ |
| In-flight job tracking | state.json + per-job files, kiln status/cancel | Extend session-store.ts: add status/phase/pid fields; add `kiln status`, `kiln cancel` commands | cli | large | 4+ |
| EventBus phase emission | None (plugin doesn't emit events) | Emit CodexPhase events from codex-session.ts as JSONL arrives — small delta from current | cli | small | next Codex commit |
| Stop gate (review gate) | Stop hook blocks Claude from finishing, runs Codex review | opt-in via kiln.yaml hooks:, SessionEnd event | cli + runtime | large | 4+ (opt-in only) |

---

## Phase 3.6 — Memory Quality (Post-3.5)

**Status:** BACKLOG
**Source:** Engram scout (2026-04-01)

- feat(core): topic key upserts — `topic_key` field on memory observations; if provided on
  `mem_save`, UPDATE increments `revision_count` + `last_seen_at` instead of creating new entry.
  Family/segment key format (e.g. `architecture/auth-model`). Direct topic_key lookup bypasses
  FTS5 when query contains `/` — deterministic retrieval for known keys.
- feat(core): `revision_count` + `last_seen_at` columns on `Observation` schema (SQLite migration)
- feat(core): What/Why/Where/Learned structured save format — enforce in `mem_save` schema
  validation (currently partial)

**Blocked on:** SQLite schema migration — coordinate with any Phase 3.5 schema changes first.

---

## Phase 4.5 — Permission & Safety

**Status:** STARTED (`4.5a` complete, `4.5b` complete, `4.5c` in progress)
**Priority:** HIGH — #1 universal pain point: "no middle ground between approve-all and yolo"
**Source:** User research across all 3 tools + Claude Code permission model scout

### Current state

- `4.5a` complete: canonical permission decision engine landed in CLI wrapper
- `4.5b` complete: richer backend translation contract, adapter consumption,
  and sync-writer persistence landed with explicit Kiln-managed metadata for
  translated-vs-enforced backend rules
- `4.5c` started: approval-memory and enforcement integration planning is in
  place, with approval-memory persistence, application-backed context
  governance, first runtime data-firewall slices underway, and the first
  execution-time tool-scope and bash-command enforcement slices landed in the
  CLI run loop
- later sub-phases still pending: full enforcement integration and core safety
  hardening

### Granular Permission Policy
- feat(core): per-tool permission rules (allowlist by tool name/pattern)
- feat(core): per-command permission rules (allowlist by bash pattern)
- feat(core): per-agent permission scoping (subagent gets subset of tools)
- feat(core): non-blocking permission UX — pattern-based auto-approve
  with audit log (eliminates constant approval prompts)
- feat(core): scoped MCP tools per subagent — least privilege model
  (top Claude Code community request)

### Data Governance
- feat(core): data firewall — policy per destination
  (prevent accidental exfiltration via small models, logging, CI)
- feat(core): sensitive file governance — .env, secrets, keys,
  credentials excluded from agent context by default
- feat(runtime): CI/PR safety — no env variable leaks in GitHub Actions
- feat(cli): --safe-defaults flag — privacy-first configuration preset

### Safety Pipeline Improvements
- fix(core): close homoglyph/Unicode prompt injection bypasses
  (Cyrillic + German patterns — documented TODOs in adversarial tests)
- feat(core): CROSS_PLATFORM_CODE_EXEC dangerous pattern expansion
  (align with Claude Code's extended list: python, node, npx, ssh, etc.)
- feat(core): denial tracking propagation to safety pipeline

---

### Downstream Consumer — OpenKiln (Separate Product)

OpenKiln is not a Kiln engine phase. It is a separate product/application that
consumes Kiln as its engine.

Kiln may still do enabling work that benefits a downstream OpenKiln app, but
that work should be tracked here only when it is engine-native, for example:

- `feat(runtime)`: session state export — checkpoints, progress artifacts,
  resumable session snapshots
- `feat(runtime)`: OpenTelemetry tracing opt-in
- `feat(runtime)`: Prometheus metrics — circuit breaker health, cost/turn,
  latency/backend, error rates
- `feat(cli)`: hook execution pipeline — wire PreToolUse/PostToolUse through
  all channel adapters

OpenKiln-specific product work belongs in its own roadmap/repo, not as a core
Kiln implementation phase.

#### Downstream Note — LocalSession / TurboQuant (Future Backend)

- **Status:** backlog — revisit when llama.cpp mainline PR stabilizes (~Q3 2026)
- **What:** fourth IKilnSession backend that spawns llama-server from TheTom/llama-cpp-turboquant fork with --cache-type-v turbo3
- **Why:** zero API cost, offline, ~4.6x KV cache compression vs fp16, enables 35B+ models with extended context on consumer hardware (validated: Qwen 3.5 35B-A3B on M5 Max via Metal)
- **Integration:** fits IKilnSession exactly — one new file, no registry refactor
- **Context for PreambleBuilder:** local session can advertise larger maxContextTokens in SessionCapabilities; PreambleBuilder can fill aggressively with repo context and memory snapshots
- **Does NOT help Claude Code, Codex, or OpenCode backends** — TurboQuant only applies to inference processes Kiln owns
- **Blocked on:** llama.cpp mainline merge (issue #20977), turbo3 Metal quality regression resolution (issue #6)
- **Reference:** arxiv.org/abs/2504.19874 (Google paper, ICLR 2026), github.com/TheTom/turboquant_plus (indie implementation), github.com/TheTom/llama-cpp-turboquant (llama.cpp fork)

---

### Phase 6 — Cloud Deployment

**Status: COMPLETE ✅ (pre-existing, kiln-gateway repo)**

Gateway is live at `gw.kilvo.app` on Coolify (sequel-core-01, SFO3, DigitalOcean).
Serving: Kilvo (WhatsApp + Instagram + Messenger + Email + Web Widget), Artu, Admit.
Dockerfile (Bun Alpine) + Doppler secrets + RS256 JWT auth all in production.

See: `C:\Proyectos\Sequel\kiln-gateway\CLAUDE.md` and
`C:\Proyectos\Sequel\infra\docs\projects\kiln\kiln-gateway.md`

---

### Phase 7 — Kiln TUI (The Final Destination)

**Status:** STARTED
**Current state:** `7a` foundation is in place. `@kilnai/tui` exists as a
package boundary, and `packages/cli/src/commands/run.ts` has begun extraction
into reusable CLI application services (`session-report`, `session-resume`,
`session-hooks`, `run-session`). No real terminal UI has been built yet.

**Documentation decision:**
When Phase 7 starts real implementation beyond foundation work, completed-phase
technical detail should begin moving into structured docs under `/docs`
(`docs/phases`, `docs/packages`, `docs/adr`, `docs/plans`) instead of
continuing to accumulate primarily inside `STRATEGY.md`. `STRATEGY.md` should
remain the strategic roadmap and status document; `/docs` should become the
technical source of truth for completed phase implementation details.

**Goal:** Replace claude TUI as the primary entry point.
Kiln TUI is the conversational interface that orchestrates
Claude Code, Codex, and OpenCode transparently underneath.
The user talks to Kiln. Kiln decides which CLI handles what.

**Product goal (decision locked):**
Kiln TUI is not "a prettier kiln run". It is the primary operator surface for
the engine. The TUI must beat competitor terminal products on orchestration
quality, observability, and approval UX, not just match their chat loop.
Specifically, the TUI must make the following visible in one shell:
- Conversation + current phase
- Backend routing decision and fallback reason
- Approval queue with scoped allow/deny controls
- Changed files and diff summary for the current turn
- Budget/cost state across providers
- Session continuity: resume context, last actions, and handoff status

**Success criteria:**
- A user can understand what Kiln is doing without opening a second terminal
- A user can approve or deny risky actions without leaving the conversation flow
- A user can see which backend is active and why
- A user can resume work without losing tool history or change context
- Kiln feels like one terminal product even when multiple CLIs are running underneath

**Why this is the end goal:**
Today the developer uses claude TUI as the entry point,
and Maria manually orchestrates Codex and OpenCode.
With Kiln TUI, Kiln is the orchestrator — Maria becomes
a worker like any other, spawned as a subprocess when needed.

Before:  Tú → claude TUI → Maria decides → bash: codex/opencode
After:   Tú → kiln TUI  → Kiln decides  → subprocess: claude/codex/opencode

**Why last:**
All previous phases are prerequisites:
- Phase 1: subprocess management (kiln TUI spawns CLIs)
- Phase 2: config sync (kiln TUI configures everything)
- Phase 3: capabilities activated (kiln TUI surfaces them)
- Phase 4: agent context dynamic (kiln TUI orchestrates)
- Phase 5: OpenKiln channels (kiln TUI + Telegram/Discord)
- Phase 6: cloud (kiln TUI connects to remote gateway) ✅ already live

**Tech stack (confirmed):**
- Ink + @inkjs/ui — React for terminal (same model as @kilnai/react)
- @kilnai/react hooks — useKilnChat, useKilnState, useKilnEvents
- EventBus 43 typed events — feeds real-time TUI updates
- New package: @kilnai/tui in the monorepo
- Upgrade path: Rezi (C-backed engine, 50+ widgets) if Ink hits limits

**Upgrade path:**
Ink → for initial TUI (spinners, inputs, progress bars)
Rezi → when richer widgets needed (split panes, charts, modals)

**TUI layout vision:**
Persistent conversational interface showing:
- Conversation panel: user ↔ Kiln dialogue
- Approval queue: pending risky actions with scoped decisions
- Diff/change panel: files touched this turn + risk markers
- Routing panel: active backend, next fallback, and rationale
- Swarm status: which agents are active + progress
- Budget panel: per-provider spend in real time
- Last tasks: recent completions with cost + duration
- Input: conversational, not command-based

**Research needed before execution:**
- Ink vs OpenTUI (@opentui/react) comparison for Kiln use case
- @inkjs/ui component inventory vs Kiln needs
- Rezi capabilities and when to upgrade from Ink
- How Claude Code and OpenCode implement their TUIs
  (study their source as reference implementations)
- Windows terminal compatibility: ANSI, color, resize handling
- SSH session compatibility for remote use

**Sub-phases:**
7a. @kilnai/tui package scaffold (Ink + @kilnai/react) — foundation started
7b. Conversation component (input + message history)
7c. Swarm status panel (real-time via EventBus)
7d. Budget panel (per-provider, updates on cost events)
7e. Routing indicator (which CLI was chosen and why)
7f. Full integration: kiln command launches TUI
7g. OpenKiln TUI variant (channel-aware, personal branding)

---

## Phase 7.5 — Agent Teams

**Status:** PENDING
**Priority:** MEDIUM-HIGH — top request across all 3 tools, Kiln already has primitives
**Source:** Market research + swarm scout + academic findings (Workforce, Conductor)

### Swarm Activation
- feat(cli): activate swarm primitives end-to-end (join/leave/broadcast/claim/release)
- feat(cli): activate worktree isolation for parallel agents
  (code exists, isolate flag never wired)
- feat(core): parallel agent coordination with write serialization
  (prevent concurrent file conflicts)

### Plan Mode
- feat(cli): kiln plan — separate planning phase from execution
- feat(core): Agentic Plan Caching (APC) — reuse plan templates
  for similar tasks (reduce re-planning cost)
- feat(cli): plan → review → approve → execute flow
- feat(cli): PlanExitTool equivalent (read-only planning agent)

### Coordination Intelligence
- feat(core): Conductor-inspired coordination policy —
  learned task-to-agent assignment (not just priority scoring)
- feat(core): Workforce hierarchical model —
  Planner / Coordinator / Worker separation
- feat(core): EvoMAC-inspired team adaptation —
  adjust agent composition based on task domain

### Benchmarking
- feat(runtime): per-harness benchmark runner —
  measure scaffold decisions (compaction/permissions/tools) independently
  from model performance (fills gap identified in market research)
- feat(core): SWE-bench integration for coding task evaluation

---

## Phase 8 — External Validation

**Status:** PLANNED
**Timing:** After all remaining product phases are stable enough to represent the
real Kiln experience. Do not optimize the roadmap around benchmark chasing.

### Terminal-Bench Submission

- Submit Kiln to Terminal-Bench only after the remaining phases are complete
  enough that the benchmark reflects the real product, not a benchmark harness
- Use Terminal-Bench as external validation for terminal task execution quality,
  not as the primary definition of success
- Keep internal evaluation broader than Terminal-Bench: orchestration quality,
  approval UX, observability, session continuity, and multi-backend routing are
  core Kiln differentiators that Terminal-Bench does not fully measure today
- If feasible, contribute benchmark scenarios to future Terminal-Bench versions
  that better capture orchestration, approvals, resumability, and multi-agent
  coordination

### Readiness Gate Before Submission

- Phase 4 / 4.5 / 5 / 7 / 7.5 implemented to a stable standard
- Kiln TUI is the real primary interface, not a prototype shell
- Resume, approvals, routing visibility, and diff visibility are production-ready
- Internal benchmark and regression suites are already green

---

## 6. What Was Considered and Discarded

### claude-better
Reimplements Claude CLI using GPT-5.4 behind the scenes. Sends fake headers to appear as Claude to Anthropic analytics. **Decision:** Hard no. It is not Claude — it is OpenAI masquerading as Claude. TOS violation. Architecturally wrong for Kiln.

### stdout parsing for permissions
Initial hypothesis: parse subprocess stdout to detect permission prompts and auto-respond based on security-rules.yaml. **Why discarded:** fails with stream-json output, fragile across versions, active bugs make bypass flags inconsistent. Better solution: bypassPermissions + scoped sandbox directory.

### task decomposition to avoid classifier
Initial hypothesis: decompose complex tasks into smaller subtasks to avoid classifier blocks. **Why discarded:** classifier evaluates subagents at 3 independent points (spawn, execution, return). Decomposition does not guarantee evasion. Better solution: bypassPermissions mode eliminates the problem entirely.

### approve_tool as permission-prompt-tool
Initial hypothesis: Kiln exposes approve_tool MCP endpoint, Claude Code calls it via --permission-prompt-tool. **Why deprioritized:** bypassPermissions + sandbox makes it unnecessary for personal use. May revisit for OpenKiln multi-user scenarios where full bypass is inappropriate.

### skillshare (external tool)
External npm tool that symlinks skills across AI CLIs. **Why not adopted:** ~/.claude/skills/ is already the canonical location read by Claude Code and OpenCode natively. Skillshare solves a problem Kiln already doesn't have for skills. mcp-config handles MCP sync. Hooks need symlinks, not a full tool.

### Commander (Mac-only)
Desktop app for coding agents. Mac-only. Not applicable to Windows setup.

---

## 7. Launch Comms Reference

### Two-Launch Strategy

**Launch 1 — Kiln engine (for developers):**
- Hacker News: "Show HN: Kiln — domain-agnostic AI orchestration engine"
- Focus: MIT, subscription arbitrage concept, example apps
- Timing: after Phase 1 (kiln run cross-CLI working)

**Launch 2 — OpenKiln (for end users):**
- Reply to @CRudinschi thread (saved in likes)
- Target Hermes and OpenClaw communities
- Focus: "Hermes but with subscription arbitrage and cross-CLI"
- Timing: after Phase 5 (npx openkiln init working)

---

### OpenClaw MCP Consolidation Thread (March 2026)

Saved in developer likes on X/Twitter. Context: Thread celebrating OpenClaw moving to MCP-native architecture.

- @CRudinschi: "Consolidating adapters frees teams to focus on AI outcomes"
- @SlackHookHQ: "Infra maturity becomes the real differentiator over time"

These tweets validate exactly what Phase 2 (config sync) solves.

**Planned action when Phase 2 ships:**
Reply to @CRudinschi:
"Been building this for orchestration — one config, three tools (Claude Code + Codex + OpenCode), zero drift."
Target also: @SlackHookHQ whose "infra maturity" framing is the exact Kiln pitch.
**Timing:** When Phase 2 (mcp-config --client all) ships.

---

## 8. Open Questions (to be resolved per phase)

- **Phase 1:** IKilnSession interface contract — **resolved** (packages/cli/src/wrapper/session.ts defines CostTrackingMode, SessionEvent discriminated union, SessionCapabilities, IKilnSession)
- **Phase 1:** bypassPermissions sandbox behavior on Windows — **resolved** (tested, bypassPermissions + scoped sandbox dir works reliably)
- **Phase 1:** OpenCodeSession --attach lifecycle — **deferred to Phase 3** (blocked on OpenCode built-in session persistence: github.com/anomalyco/opencode-sdk-js/issues/26; partial path available: `opencode run --attach` works while server is alive, no restart safety)
- **Phase 1f:** `KilnPermissionPolicy` design — **resolved** (`packages/cli/src/wrapper/session-registry.ts` defines `translatePermission()`, `packages/cli/src/wrapper/session.ts` defines types)
- **Phase 2:** MCPorter imports compatibility — evaluate before building
- **Phase 2b:** `kiln mcp-config --client all` — **resolved** (packages/cli/src/mcp/config-generator.ts + packages/cli/src/commands/mcp-config.ts; smol-toml for Codex TOML; JSONC comment stripping for OpenCode; all 3 configs generated with merge-only semantics)
- **Phase 2e:** OpenCode runtime MCP — **resolved** (packages/cli/src/wrapper/opencode-session.ts: PATCH /config after permissions with mcpServerEntryPath from SessionContext; fail-open on both permission and MCP config PATCH)
- **Phase 3:** SkillTrigger complexity filter design — design doc needed
- **Phase 5:** Channel adapter audit — scout before planning
- **Phase 5:** Legal review of multi-user orchestration pattern
- **All phases:** Monitor Claude Code issues #35718, #36192, #37181 (bypassPermissions bugs — version-dependent behavior)

---

## Intelligence Sources

**Last updated:** 2026-03-31

This roadmap was enriched with intelligence from:

### Codebase Scouts (2026-03-31)
- Claude Code — full source reconnaissance (leaked NPM source map)
- OpenCode (anomalyco/opencode) — full source reconnaissance
- Codex CLI (openai/codex) — full source reconnaissance
- Kiln v0.23.2 — full self-reconnaissance

### Market & User Research (2026-03-31)
- GitHub Issues: claude-code, opencode, codex (top reactions)
- Reddit: r/ClaudeAI, r/LocalLLaMA, r/ChatGPT
- Hacker News: Claude Code, OpenCode, Codex discussions
- Academic: ACON, HippoRAG, GraphRAG, A-MEM, SYNAPSE,
  Workforce (NeurIPS 2025), Conductor (2026), CodeSim (NAACL 2025),
  APC, KVFlow (NeurIPS 2025), SWE-EVO (2025)

### Key Findings That Shaped This Roadmap
1. No tool has a middle ground between approve-all and yolo permissions
2. Cost/quota opacity is universal — users find out too late
3. Compaction is feared as "lobotomy" — needs transparency + control
4. Community is building meta-harnesses manually (Gigacode, Sandbox Agent)
5. AGENTS.md is converging as cross-tool standard
6. MCP is converging as universal tool/context bus
7. Graph-based memory outperforms flat vector store for multi-hop reasoning
8. Scaffold quality (not just model) drives SWE-bench performance significantly

---

*This document is the strategic source of truth for Kiln development. Each phase will produce its own dedicated research document, architecture decision record (ADR), and implementation plan before any code is written.*
