# Kiln Strategy & Roadmap
> Living document. High-level vision and phased plan.
> Each phase will have its own dedicated research → architecture → 
> implementation pipeline before execution.
> Last updated: 2026-04-08

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

See [ADR-002: Subprocess Integration](docs/adr/ADR-002-subprocess-integration.md) for 5 confirmed limitations and Kiln's architectural solutions.

### 3.3 Per-User Architecture for OpenKiln (Future)

When Kiln becomes a product for others:
- Each user installs their own CLIs locally
- Kiln orchestrates local CLIs of each user
- Each user uses their own subscriptions
- Kiln gateway is the orchestrator (can be cloud-deployed)
- No token sharing, no OAuth proxying — legally clean

## 4. What Already Exists in Kiln (Reality Check)

### 4.1 Capability Status

| Capability | Status | Surface |
|------------|--------|---------|
| 25 MCP tools | Active | kiln-gateway localhost:3800 |
| Cross-agent memory | Active | handoff protocol in all agents |
| Cost/budget tracking | Active | cost_summary, budget_check |
| SQLite + FTS5 memory | Built, not MCP-exposed | core |
| Cron scheduler | Active | kiln cron CLI |
| Skill registry | Active | kiln skill CLI |
| 8 channel adapters | Built, not configured for personal use | runtime |
| Safety rails | Running, not visible in workflow | core |
| Eval scorers (23) | Built, not used in daily tasks | core |
| Circuit breaker | Active, not surfaced as metric | agents |

### 4.3 Configuration Redundancy (The Problem to Solve)

- **Permissions:** `KilnPermissionPolicy` (unified `{approval, sandbox}` contract) translated per-backend via `translatePermission()` — settings.json (Claude) + config.toml:75-173 (Codex) + opencode.json:6-48 (OpenCode) — single source of truth, 3 formats generated
- **autoformat.sh:** lives in .codex/hooks/ — should be in .claude/hooks/ with symlink (currently inverted)
- **MCP config:** Claude (.mcp.json) + Codex (config.toml:51-73) + OpenCode (opencode.json via `kiln mcp-config --client all`) ✅
- **Hooks:** Codex hooks.json + Claude settings.json — both active, partially overlapping

## 5. Phased Roadmap

### Phase 1 — Cross-CLI Orchestration (kiln run v2)

**Phase 1 — COMPLETE (v0.23.2)**
See [CLI Wrapper](docs/guides/cli-wrapper.md) and [Changelog](docs/changelog.md).

---

### Phase 2 — Config Sync (kiln config sync)

**Phase 2 — COMPLETE (v0.23.2)**
See [CLI Wrapper](docs/guides/cli-wrapper.md) and [Changelog](docs/changelog.md).

---

## Sprint 0 — Fix Broken Promises

**Sprint 0 — COMPLETE (v0.23.2)**
See [Changelog](docs/changelog.md).

---

### Phase 3 — Activate Existing Capabilities

**Phase 3 — COMPLETE (v0.23.2)**
See [Changelog](docs/changelog.md).

---

## Phase 3.5 — Session Power & Observability

**Phase 3.5 — COMPLETE (v0.23.2)**
See [CLI Wrapper](docs/guides/cli-wrapper.md), [Hooks](docs/guides/hooks.md), [Skills](docs/guides/skills.md), [Observability](docs/guides/observability.md), and [Changelog](docs/changelog.md).

Deferred items:
- Cost dashboard MCP tool, quota tracking (5h window + weekly resets)
- Compaction preview, ACON-inspired learnable policy (Phase 5+)
- GET /diff file change tracking, POST /fork session branching, mid-session model switch
- Skill improvement loop (eval-scored promotion), citation tracking, automatic consolidation
- Surface provider name + model in session report footer

**Pending harness flag backlog:** `effort`, `maxTurns`, `maxBudgetUsd` (Claude Code); `--agent`, `--fork`, `--attach` (OpenCode). See [CLI Wrapper](docs/guides/cli-wrapper.md) for current wired flags.

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
- feat(cli): CodexSession --sandbox flag passthrough (enforce, not ignore) ✅ DONE (2026-04-08)
- feat(cli): CodexSession --local-provider ollama/lmstudio support ✅ DONE (2026-04-08)
  (`kiln run --provider codex --local-provider <name> ...` now forwards Codex's native
  local backend selector for runs targeting providers such as `ollama` or `lmstudio`)
- feat(cli): CodexSession --profile support for named config sets ✅ DONE (2026-04-08)
- fix(cli): OpenCodeSession sandbox semantics are explicit ✅ DONE (2026-04-08)
  (`translatePermission()` and `OpenCodeSession` now surface deterministic warnings
  that OpenCode does not natively enforce Kiln sandbox modes; Kiln maps sandbox
  intent to permission prompting semantics only)

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

## Research: CLI Integration Philosophy

See [ADR-003: Meta-Orchestrator Model](docs/adr/ADR-003-meta-orchestrator-model.md) for the analysis of plugin vs direct API vs meta-orchestrator approaches.

---

## Phase 3.6 — Memory Quality (Post-3.5)

**Status:** COMPLETE
**Source:** Engram scout (2026-04-01)

- feat(core): topic key upserts — `topic_key` field on memory observations; if provided on
  `mem_save`, UPDATE increments `revision_count` + `last_seen_at` instead of creating new entry.
  Family/segment key format (e.g. `architecture/auth-model`). Direct topic_key lookup bypasses
  FTS5 when query contains `/` — deterministic retrieval for known keys.
- feat(core): `revision_count` + `last_seen_at` columns on `Observation` schema (SQLite migration)
- feat(core): Added `deleted_at` column for soft-delete support
- fix(test): `:memory:` databases in vitest-bun-sqlite-mock now return fresh instances to prevent cross-test state leakage

**Released in:** v0.25.0

---

## Phase 4.5 — Permission & Safety

**Status:** STARTED (`4.5a` complete, `4.5b` complete, `4.5c` effectively complete/closable, `4.5d` in progress with multiple landed slices, including runtime pii-detected, security-alert, and policy-evaluated Prometheus propagation)
**Priority:** HIGH — #1 universal pain point: "no middle ground between approve-all and yolo"
**Source:** User research across all 3 tools + Claude Code permission/safety scouts

### Current state

- `4.5a` complete: canonical permission decision engine landed in CLI wrapper
- `4.5b` complete: richer backend translation contract, adapter consumption,
  and sync-writer persistence landed with explicit Kiln-managed metadata for
  translated-vs-enforced backend rules
- `4.5c` effectively complete/closable: approval-memory and enforcement integration is in
  place, with approval-memory persistence, application-backed context
  governance, first runtime data-firewall slices underway, and the first
  execution-time tool-scope, bash-command, and scoped MCP-tool enforcement
  slices landed in the CLI run loop; MCP-origin event metadata now exists in
  Codex, Claude, and OpenCode wrapper paths to support honest scoped
  enforcement, and scoped MCP matching now uses canonical selectors instead of
  raw backend-emitted tool names; CLI run-loop tool denies now consult
  approval memory, preserve normal allowed-tool flow on matching grants,
  consume `once` grants only after later gates pass, and use stable logical
  Kiln session IDs for session-scoped matching (including resume paths);
  bash-like command denies now also consult command-surface approval memory
  with the same stable session semantics and delayed `once` consumption; and
  file-governance deny decisions are now enforced in the CLI run loop for
  path-bearing tool inputs (`input.filePath`, `input.path`)
- `4.5d` started: safety-hardening scout complete and two core slices landed
  (currently uncommitted): prompt-scanner detection-time normalization for
  Unicode/homoglyph and invisible-character variants while preserving the
  original input for audit, plus a new dangerous-command detector contract in
  engine/domain with deterministic core security implementation and
  shell-aware `allow | ask | deny` decisions covering Unix destructive,
  Windows destructive, download-and-exec, and ambiguous ask boundaries; the
  detector is now enforced in runtime before tool execution via
  `ModeBOrchestrator`, wired from `gateway-server`, with fail-closed behavior
  for `deny`/`ask`, detector-error handling, and empty-command blocking;
  cached tool results now also pass through `ToolResultSanitizer` before
  reinjection in `ModeBOrchestrator`, and sanitizer failure on cache hit no
  longer re-executes tools; runtime gateway sanitizer wiring now threads
  `securityConfig.promptInjection` into `ToolResultSanitizer` construction so
  indirect reinjection scanning honors runtime prompt-injection configuration
  and allowlist behavior; runtime observability now also propagates
  `pii_detected`, `security_alert`, and `policy_evaluated` events into
  Prometheus via dedicated counters with deterministic fallback labels
- later sub-phases still pending: full enforcement integration and remaining
  safety hardening slices

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
- feat(cli): global user config at `~/.kiln/config.yaml` — permission policy,
  preferred provider, API keys; resolution chain: kiln.yaml (project) >
  ~/.kiln/config.yaml (global) > hardcoded fallback (read-only/on-request);
  unblocks `kiln run` outside app repos without needing per-project kiln.yaml.
  **Known gap:** current DEFAULT_POLICY in run.ts is temporarily set to
  `workspace-write/never` as a usability fix until global config lands —
  revert to `read-only/on-request` once ~/.kiln/config.yaml is implemented.

### Safety Pipeline Improvements
- fix(core): Unicode/homoglyph-safe detection pipeline in prompt scanning
  (normalization at detection-time, original input retained for audit)
- feat(core): dangerous-command detector in core security with shell-aware
  `allow | ask | deny` decisions and explicit ambiguous-boundary asks
- feat(runtime): dangerous-command detector enforcement before tool execution
  in `ModeBOrchestrator`, wired from gateway startup with fail-closed
  handling for `deny`, `ask`, detector errors, and empty commands
- feat(runtime): cache-hit tool-result sanitization before reinjection in
  `ModeBOrchestrator`; sanitizer failure keeps cache-hit flow and does not
  re-execute tools
- feat(runtime): runtime now wires prompt-injection scanning into
  `ToolResultSanitizer` construction through a gateway factory
- feat(runtime): runtime sanitizer now honors
  `securityConfig.promptInjection` during reinjection
- test(runtime): regression coverage exists for enabled, disabled, and custom
  `allowedPatterns` behavior through the runtime tool-result reinjection path
- feat(runtime): Prometheus collector now emits `pii_detections_total` for
  `pii_detected` events with stable `direction`, `action`, and `tier` labels
  plus deterministic `unknown` fallbacks for malformed or missing values
- feat(runtime): Prometheus collector now emits `security_alerts_total` for
  `security_alert` events with stable `severity` and `category` labels plus
  deterministic `unknown` fallbacks for malformed/unsupported category values
- feat(runtime): Prometheus collector now emits `policy_evaluations_total` for
  `policy_evaluated` events with stable `rail_type`, `allowed`, and
  `direction` labels plus deterministic `unknown` fallbacks for malformed or
  missing values
- feat(core): reuse tool-result scanning patterns as safety sink controls
  across prompt and tool-output surfaces
- feat(core): CROSS_PLATFORM_CODE_EXEC dangerous pattern expansion
  (align with Claude Code's broader dangerous command/code coverage)
- feat(core): continue denial propagation and broader metrics/event wiring
  across governed surfaces (fail-closed semantics + observable counters)
- verification: targeted core compile passed; focused test execution for this
  slice remains blocked in the current environment
- verification: targeted runtime compile passed; focused runtime tests exist
  for the enforcement path
- verification: targeted runtime compile passed and focused
  `mode-b-orchestrator-tools` test passed for cache-hit sanitization slice

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

**Phase 6 — COMPLETE (pre-existing)**
Gateway live at gw.kilvo.app on Coolify. See [Gateway YAML](docs/configuration/gateway-yaml.md).

---

### Phase 7 — Kiln TUI [COMPLETE v0.25.0]

Unified terminal interface over all providers (claude/codex/opencode + 5 direct API backends). Two-column layout (chat + sidebar), 5 built-in themes (`--theme`), in-process TUI gateway on port 4801 (`startTuiGateway`), `GatewaySession` WS adapter, `/clear` and `/plan` commands, two-section provider picker (Harness / Direct API), per-provider cost tracking, diff/change visibility. TUI is a pure rendering layer — the Orchestrator owns the agent loop. See [docs/guides/tui.md](docs/guides/tui.md) and [ADR-002](docs/adr/ADR-002-tui-gateway-architecture.md).

---

## Phase 8 — Agent Teams

**Status:** IN PROGRESS (8.1 Plan Mode)
**Priority:** MEDIUM-HIGH — top request across all 3 tools, Kiln already has primitives
**Source:** Market research + swarm scout + academic findings (Workforce, Conductor)

### Swarm Activation
- feat(cli): activate swarm primitives end-to-end (join/leave/broadcast/claim/release)
- feat(cli): activate worktree isolation for parallel agents
  (code exists, isolate flag never wired)
- feat(core): parallel agent coordination with write serialization
  (prevent concurrent file conflicts)

### Plan Mode (Phase 8.1 — IN PROGRESS)

**Design:** Best-of-three synthesis from Claude Code, Codex, and Hermes.

#### Item 1: `kiln plan` Command

**Status:** IMPLEMENTING (v0.25.0)

**Prerequisites existing:**
- `permissionMode: "plan"` in CLI wrapper (read-only permissions)
- `plan-summary` artifacts in CG4 context governance
- `context-governor.ts` with `planArtifactKey` handling

**Implementation scope:**
- CLI command: `kiln plan <task>` — separate planning phase from execution
- Flags: `--plan` flag on `kiln run`, adds `"plan-mode"` session
- Execution boundary: block Edit/Write/MultiEdit tools in plan mode
- 3-phase workflow: Explore → Intent Chat → Implementation Chat
- Final output: `<proposed_plan>` block rendered to user

**3-phase workflow (from Codex, adapted):**

| Phase | Goal | Agent Behavior |
|-------|------|--------------|
| 1. Explore | Ground in environment | Run read-only exploration first — resolve unknowns from repo |
| 2. Intent Chat | Clarify what they actually want | Ask via `request_user_input` until goal + success criteria + constraints locked |
| 3. Implementation Chat | Design decision-complete solution | Explore approach, APIs, edge cases, testing |

**Execution boundaries (enforced):**

| Allowed (non-mutating) | Not Allowed (mutating) |
|------------------------|---------------------|
| Read, glob, grep, rg | Edit, Write, apply_patch |
| Static analysis, type inspection | Formatters, linters |
| Dry-run commands (no file changes) | sed, tee, echo → files |
| Tests/builds to `target/`, `.cache/` | Commits, pushes, external actions |

**Final plan output format:**

```
<proposed_plan>
## Summary
[concise summary]

## Implementation Changes
- [bullet by subsystem, not file-by-file]

## Test Plan
- [verification steps]

## Assumptions
- [defaults chosen where ambiguous]
</proposed_plan>
```

#### Item 2: APC — Agentic Plan Caching

**Status:** COMPLETE (v0.25.0)
**Implemented:** Context-artifact cache with `plan-summary:{projectPath}:{normalizedTask}` key — already exists in CG4 via `contextGovernor.ts` + `sessionManager.ts`. Plan summaries are cached and retrieved on resume for similar tasks.

#### Item 3: Review Flow

**Status:** PENDING
**Scope:** plan → review → approve → execute pipeline
**Key:** approval-gated transition from plan mode to execution mode

#### Item 4: PlanExitTool

**Status:** PENDING
**Scope:** Read-only planning agent equivalent to Codex `update_plan`

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

---

## Phase 9 — Native Developer Tools (`@kilnai/tools`) [COMPLETE v0.24.0]

Seven native executors (`bash`, `read`, `write`, `edit`, `grep`, `glob`, `git`), `ToolEnvironment` binary detection (vendored → PATH → pure TS), `DevToolExecutionBridge` wired into the Orchestrator event loop, `DevToolsMcpServer` stdio surface (`kiln tools --mcp`), platform vendored binary packages. See [docs/guides/tool-use.md](docs/guides/tool-use.md).

---

## Phase 10 — ProviderSession (Direct API Backend) [COMPLETE v0.25.0]

`ProviderSession` implementing `IKilnSession` for 5 direct API providers (anthropic, openai, deepseek, openrouter, ollama), unified `SessionRegistry` pool (8 providers, dynamic priority, shared circuit breaker), `translatePermissionForProvider()`, `buildProviderSystemPrompt()`, `ProviderContextTracker`, CLI `--provider`/`--model` flags, TUI Harness/Direct API picker. See [docs/guides/cli-wrapper.md](docs/guides/cli-wrapper.md).

---

## Phase 11 — Layered Runtime Config [URGENT]

**Status:** PLANNED — depends on Phase 10 (config needs backends to configure)
**Priority:** URGENT — every competitor has layered config; Kiln's config is the #1 adoption barrier
**Source:** Evolution research (2026-04-07): Codex ConfigLayerStack, OpenCode 4-tier config, Claude Code settings.json scoping

### Problem

Kiln requires `app.yaml` + `gateway.yaml` for any non-trivial use. Competitors require zero
config (Claude Code), one TOML file (Codex), or one JSON file (OpenCode). The research
confirmed: developers reward minimal surface area for the 90% case. Any framework requiring
gateway config to run a simple agent loses to one that doesn't.

### Rules

- Progressive disclosure: complexity scales with ambition
- No backward compat shims — if config schema changes, it changes cleanly
- Merge semantics must be explicit and documented — no magic
- YAML format throughout (consistent with existing kiln.yaml)
- Test before done: config loading tested with all layer combinations

### Sub-phases

#### 11a. Global Config (`~/.kiln/config.yaml`)

**Status:** COMPLETE
Global config now lives in `packages/cli/src/config/global-config.ts` with `KilnGlobalConfig`, XDG-aware resolution, YAML read/write helpers, and `defaultGlobalConfig()` defaults for provider + permissions.

#### 11b. Project Config (`./kiln.yaml`) with Merge Semantics

**Status:** COMPLETE
Project `kiln.yaml` now merges cleanly over `~/.kiln/config.yaml` via `packages/cli/src/config/config-merger.ts`, with scalar override semantics and additive MCP server merging exposed through `loadKilnConfig(projectPath)`.

#### 11c. Zero-Config First Run

**Status:** COMPLETE
Env-aware runtime defaults now resolve through `packages/cli/src/config/env-config.ts`: CLI flag > `KILN_PROVIDER`/`KILN_MODEL` > `~/.kiln/config.yaml` > undefined.
`packages/cli/src/commands/tui.ts` now resolves provider from env/global config and theme from `tui.theme`; `packages/cli/src/commands/run.ts` resolves model from env/global config.

#### 11d. Agent Definitions as Markdown

**Status:** COMPLETE
Markdown agent profiles now load from `~/.kiln/agents/*.md` and `<project>/.kiln/agents/*.md`, with project definitions overriding global ones by `name`. `kiln run --agent <name>` resolves the profile, applies its default `model` when `--model` is absent, and appends the markdown body to the generated system prompt.

#### 11e. AGENTS.md Generation

**Status:** COMPLETE
`kiln sync --agents-md` (and `kiln sync` with no flags) now generates a valid GFM `AGENTS.md` at the project root from `kiln.yaml` + markdown agent definitions, readable by Claude Code, Codex, OpenCode, and Cursor without Kiln-specific config.

#### 11f. Agent Sync

**Status:** COMPLETE
`kiln sync --agents` (and `kiln sync`) now translates Kiln markdown agent definitions into native Claude Code `.md`, Codex `.toml`, and OpenCode `.md` agent files, then writes them into each CLI's agents directory.

**Files:** New `cli/src/sync/agents-md-sync.ts`, modifications to `cli/src/commands/sync.ts`
**Tests:** Generation from various config combinations, idempotent re-generation
**Reference:** ECC finding — AGENTS.md is the universal cross-tool context file standard

---

## Phase 12 — Runtime Polish & Competitive Parity [URGENT]

**Status:** PLANNED — depends on Phases 9-11
**Priority:** URGENT — competitive parity features that prevent churn
**Source:** Evolution research (2026-04-07): OpenClaw, Hermes, Aider, Goose, ECC feature analysis

### Rules

- Each sub-phase is independent — can ship in any order
- No speculative abstractions — build only what research validated
- Test before done

### Sub-phases

#### 12a. Provider Fallback Chain

- Config: `providers: [anthropic, openrouter/anthropic, deepseek]` — tries in order
- Integrates with existing circuit breaker (no new system)
- Auth rotation for providers with multiple keys
- Exponential backoff per provider (existing `withRetry` pattern)

**Files:** Modifications to `cli/src/wrapper/session-registry.ts`, `core/src/agents/` adapters
**Reference:** OpenClaw auth rotation + fallback chain, Aider litellm fallback

#### 12b. External Model Registry

- Fetch model catalog from `models.dev/api.json` at startup (cache for 24h)
- Bundled snapshot as offline fallback
- Replaces hardcoded 17 `ModelCapabilityProfile` entries in `model-capability-registry.ts`
- TUI model picker populated from registry (not hardcoded list)

**Files:** New `core/src/agents/model-registry.ts`, modifications to `model-capability-registry.ts`
**Reference:** OpenCode `models.ts:88-99` fetches from `https://models.dev/api.json`

#### 12c. Session Resume & Fork

- `kiln run --resume` — enhance existing SessionStore resume
- `kiln run --fork <session-id>` — create new session from checkpoint
- `kiln sessions list` — browse prior sessions with metadata
- Session metadata: provider, model, cost, duration, task summary

**Files:** Modifications to `cli/src/wrapper/session-store.ts`, new `cli/src/commands/sessions.ts`
**Reference:** Codex `resume`/`fork`, Claude Code `--resume`

#### 12d. MCP Auto-Discovery

- `kiln mcp search <query>` against MCP registry (mcpregistry.io or similar)
- `kiln mcp install <name>` auto-configures in kiln.yaml
- Token budget warning: alert when >80 tools active (context degradation threshold)
- Reference model list from registry for available servers

**Files:** New `cli/src/commands/mcp-search.ts`
**Reference:** OpenClaw `mcp-hub` skill (1,200+ servers auto-discovered), ECC token budget finding

#### 12e. Skill Registry Hub

- `kiln skill search <query>` against public index
- `kiln skill install <name>` downloads SKILL.md to project `.kiln/skills/`
- Index starts as GitHub repository (JSON manifest), evolves to hosted registry
- Skills installable at global (`~/.kiln/skills/`) or project (`.kiln/skills/`) scope

**Files:** New `cli/src/commands/skill-search.ts`, modifications to `cli/src/commands/skill.ts`
**Reference:** OpenClaw ClawHub (800+ skills, searchable), ECC 181 skills

#### 12f. Subagent Model Routing

- `KILN_SUBAGENT_MODEL` env var to route subagents to cheaper models
- Config: `subagentModel: claude-haiku-4-5` in kiln.yaml
- Applied when spawning subagent sessions (both harness and provider)
- Surfaces as `CLAUDE_CODE_SUBAGENT_MODEL` for Claude Code harness backend

**Files:** Modifications to `cli/src/wrapper/session-manager.ts`, kiln.yaml schema
**Reference:** ECC finding — `CLAUDE_CODE_SUBAGENT_MODEL` is undocumented Claude Code knob

---

### Dependency Chain (Phases 9-13)

```
Phase 4.5 (permissions, IN PROGRESS) ──┐
                                        ├── Phase 9 (native tools)
Phase 8 (agent teams, IN PROGRESS) ────┘       │
                                          Phase 10 (ProviderSession)
                                                │
                                          Phase 11 (layered config)
                                                │
                                          Phase 12 (runtime polish)
                                                │
                                          Phase 13 (external validation)
```

Phases 9-12 are all marked [URGENT]. Phase 9 is the critical path — everything depends on it.
Phase 8 (Agent Teams) and Phase 4.5 (Permissions) continue in parallel — they are prerequisites.

---

## Phase 13 — External Validation

**Status:** PLANNED
**Timing:** After Phases 9-12 are stable enough to represent the real Kiln experience.
Do not optimize the roadmap around benchmark chasing.

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

- Phases 9-12 implemented to a stable standard
- Kiln TUI is the real primary interface, not a prototype shell
- Provider sessions work end-to-end with native tools
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
- Timing: after Phase 7 (TUI complete, npx openkiln init working)

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

### Evolution Research (2026-04-07)
- Local scouts: Claude Code, Codex CLI, OpenCode, Hermes Agent (full source reconnaissance)
- Web research: Aider, Goose, Claude Code public docs, Codex public docs
- Market validation: LangGraph, CrewAI, AutoGen/MAF, Bedrock AgentCore, agentgateway.dev, Julep, Letta
- OpenClaw capabilities analysis (250K+ stars, 800+ skills, 25+ channels)
- ECC (Everything Claude Code) patterns analysis (47 agents, 181 skills, 14 MCP servers)
- Tool interface research: Claude Code, Codex, OpenCode, Goose, Aider tool schemas
- Key finding: two-layer architecture (runtime + gateway) validated by market
- Key finding: native dev tools are prerequisite for provider-agnostic runtime
- Key finding: Kiln is the only open, self-hostable product covering both layers

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
