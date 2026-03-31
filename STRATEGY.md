# Kiln Strategy & Roadmap
> Living document. High-level vision and phased plan.
> Each phase will have its own dedicated research → architecture → 
> implementation pipeline before execution.
> Last updated: 2026-03-29

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
- `kiln run` — Spawns Claude Code subprocess, supports `--apiKey`, `--provider`, `--dangerouslySkipPermissions`
- `kiln mcp-config` — Generates MCP config for clients (claude-code, stdio/sse)
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
- Kiln solution: <kiln_subprocess_context> XML preamble on every prompt. Most important instruction: "Do not ask clarifying questions." Budget remaining changes model verbosity. JSON Schema as output spec.

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

- **Permissions:** settings.json (Claude) + config.toml:75-173 (Codex) + opencode.json:6-48 (OpenCode) — same deny/prompt rules, 3 formats
- **autoformat.sh:** lives in .codex/hooks/ — should be in .claude/hooks/ with symlink (currently inverted)
- **MCP config:** Claude (.mcp.json) + Codex (config.toml:51-73) + OpenCode (none — not connected to kiln-gateway yet)
- **Hooks:** Codex hooks.json + Claude settings.json — both active, partially overlapping

## 5. Phased Roadmap

### Phase 1 — Cross-CLI Orchestration (kiln run v2)

**Goal:** `kiln run` becomes the single entry point for all 3 CLIs.

**Why first:** Everything else (learning loop, config sync, scheduler) depends on having reliable subprocess orchestration.

**Research needed before execution:**
- IKilnSession interface contract already defined at packages/cli/src/wrapper/session.ts
- How CodexSession and OpenCodeSession should mirror it
- bypassPermissions sandbox directory behavior on Windows
- opencode serve + --attach lifecycle management

**Planned work:**
- IKilnSession interface contract (packages/cli/src/wrapper/session.ts) — formalizes 6 event variants + capabilities + run/dispose contract; forces ClaudeSession refactor when implemented
  - ✅ ClaudeSession implements IKilnSession (2026-03-30): async generator `run()`, `dispose()`, `sessionId`, `capabilities`; cost flows via `cost_update` → `completed` events; old callback API (start/onMessage/onExit) removed; ghost Orchestrator removed from run.ts
  - ✅ OpenCodeSession implements IKilnSession (2026-03-30): spawns `opencode serve`, connects via `@opencode-ai/sdk` (HTTP), maps ACP SSE events (message.part.delta, message.part.updated, sessionUpdate, session.status) to `SessionEvent` variants; `serveProcess` public for testability; `baseUrl` config escape hatch; 19 tests pass
  - ✅ CodexSession (2026-03-30): spawns `codex exec --json --full-auto`, parses JSONL events (thread.started, turn.started, item.started, item.completed, turn.completed, error, turn.failed), maps to `SessionEvent` variants; `costTrackingMode: "computed"` (token × rate formula); 33 tests pass; end-to-end validation pending (usage credits needed)
- OpenCodeSession: spawn opencode run --attach --format json, manage opencode serve daemon lifecycle
- run.ts: --provider auto → calls routing_test → decides CLI
- preamble builder: generates <kiln_subprocess_context> XML with session_id, budget_remaining_pct, constraints, output_spec
- session_registry: maps task_id → session_id per provider, enables --resume/--continue between calls
- worktree_manager: creates isolated git worktree per parallel task, destroys on completion
- bypassPermissions sandbox: dedicated directory + scoped settings.json generated before each subprocess invocation

**Sub-phases:**
1a. CodexSession + OpenCodeSession (new, most work)
1b. run.ts --provider auto + routing_test integration
1c. preamble builder
1d. session_registry
1e. worktree_manager
1f. bypassPermissions sandbox manager

---

### Phase 2 — Config Sync (kiln config sync)

**Goal:** Single source of truth for permissions, hooks, MCP config across Claude Code, Codex, OpenCode. Zero manual duplication.

**Why second:** Depends on understanding all 3 CLIs from Phase 1.

**Research needed before execution:**
- Exact format of codex config.toml MCP section
- Exact format of opencode.json MCP section
- MCPorter imports compatibility with mcp-config output
- Symlink behavior on Windows for hooks

**Planned work:**
- kiln.yaml: canonical source for security rules + MCP endpoints
- mcp-config.ts: add --client codex, --client opencode, --client all
- security sync: generates permissions for all 3 tools from kiln.yaml
- autoformat.sh: move to .claude/hooks/, symlink from .codex/hooks/
- MCP for OpenCode: mcp-config --client opencode writes opencode.json
- Optional MCPorter integration evaluation

**Sub-phases:**
2a. kiln.yaml schema design
2b. mcp-config --client codex + opencode + all
2c. security sync generator
2d. autoformat.sh symlink fix
2e. OpenCode MCP connection

---

### Phase 3 — Activate Existing Capabilities

**Goal:** Wire what already exists in the codebase to daily workflow.

**Why third:** No new code needed — only configuration and exposure.

**Research needed before execution:**
- Which MCP tool slot to use for memory_search (#26)
- Optimal FTS5 query interface for agent use
- SkillTrigger event filter design for skill_generate
- Cron CLI UX design

**Planned work:**
- memory_search MCP tool (#26): expose sqlite-store.search() as MCP tool with BM25 ranking
- skill_generate: SkillTrigger on Stop event with complexity filter → analyzes task result → generates SKILL.md automatically → saves to .kiln/skills/ via SkillRegistry → immediately available cross-tool
- kiln cron add/list/remove: CLI surface for existing scheduler ✅ (Phase 3c)
- Verification gates: wire test/lint/type-check loop to agent workflow
- Eval scorers: surface per-task quality score in status command
- Per-role cost breakdown: surface in cost_summary MCP tool

**Sub-phases:**
3a. memory_search tool #26
3b. skill_generate via SkillTrigger
3c. kiln cron CLI commands ✅
3d. Verification gates integration
3e. Eval scorers in status

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

**Sub-phases:**
4a. kiln-context SKILL.md (static parts)
4b. agent_context tool #27 (dynamic parts)
4c. Migration: remove clause from 22 files one by one with testing

---

### Phase 5 — OpenKiln (Personal Product Layer)

**Goal:** OpenKiln as personal agent product on top of Kiln engine. Single-user, local-first, channel-connected.

**Why fifth:** Requires all previous phases stable. This is packaging + channel defaults, not a fork.

**Research needed before execution:**
- Channel adapter status: Telegram, Discord, Signal in runtime
- npx openkiln init UX design
- SQLite local-first vs cloud sync decision
- Legal review of per-user CLI orchestration pattern

**Planned work:**
- Separate bounded context: packaging + channel defaults
- npx openkiln init: quick-start wizard
- Telegram + Discord + Signal adapters (may already exist in runtime)
- Local-first SQLite as default (no cloud required)
- Per-user architecture: each user runs their own CLIs locally, OpenKiln orchestrates them
- Legal constraint: each user uses their own subscriptions, Kiln never touches OAuth tokens

**Sub-phases:**
5a. Channel adapter audit (what exists in runtime today)
5b. npx openkiln init wizard
5c. Telegram adapter activation
5d. Discord + Signal adapters
5e. Local-first SQLite config
5f. Legal review of multi-user pattern

---

### Phase 6 — Cloud Deployment

**Goal:** Kiln gateway accessible from any device, not just localhost.

**Why last:** All phases must be stable before exposing externally.

**Research needed before execution:**
- Railway vs Fly.io for Kiln runtime
- JWT auth for remote MCP access
- Cost of always-on cloud deployment
- Mobile access patterns

**Planned work:**
- Deploy @kilnai/runtime to Railway or Fly.io
- Update .mcp.json + config.toml with remote URL via mcp-config
- JWT auth layer (already implemented: RS256 via JWKS, HS256)
- Update CLAUDE.md and agent configs with cloud URL
- OpenCode MCP pointing to cloud gateway

---

### Phase 7 — Kiln TUI (The Final Destination)

**Goal:** Replace claude TUI as the primary entry point.
Kiln TUI is the conversational interface that orchestrates
Claude Code, Codex, and OpenCode transparently underneath.
The user talks to Kiln. Kiln decides which CLI handles what.

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
- Phase 6: cloud (kiln TUI connects to remote gateway)

**Tech stack (confirmed):**
- Ink + @inkjs/ui — React for terminal (same model as @kilnai/react)
- @kilnai/react hooks — useKilnChat, useKilnState, useKilnEvents
- EventBus 40 typed events — feeds real-time TUI updates
- New package: @kilnai/tui in the monorepo
- Upgrade path: Rezi (C-backed engine, 50+ widgets) if Ink hits limits

**Upgrade path:**
Ink → for initial TUI (spinners, inputs, progress bars)
Rezi → when richer widgets needed (split panes, charts, modals)

**TUI layout vision:**
Persistent conversational interface showing:
- Conversation panel: user ↔ Kiln dialogue
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
7a. @kilnai/tui package scaffold (Ink + @kilnai/react)
7b. Conversation component (input + message history)
7c. Swarm status panel (real-time via EventBus)
7d. Budget panel (per-provider, updates on cost events)
7e. Routing indicator (which CLI was chosen and why)
7f. Full integration: kiln command launches TUI
7g. OpenKiln TUI variant (channel-aware, personal branding)

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
- **Phase 1:** bypassPermissions sandbox behavior on Windows — test first
- **Phase 2:** MCPorter imports compatibility — evaluate before building
- **Phase 3:** SkillTrigger complexity filter design — design doc needed
- **Phase 5:** Channel adapter audit — scout before planning
- **Phase 5:** Legal review of multi-user orchestration pattern
- **All phases:** Monitor Claude Code issues #35718, #36192, #37181 (bypassPermissions bugs — version-dependent behavior)

---

*This document is the strategic source of truth for Kiln development. Each phase will produce its own dedicated research document, architecture decision record (ADR), and implementation plan before any code is written.*
