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

### Claude Code SDK — unexposed options (Phase 3.5 follow-on)

Audit of the official Claude Code CLI reference (2026-04-03) identified SDK options not yet
surfaced in `ClaudeSessionConfig` or `kiln run` flags. Priority order:

**High — add to `ClaudeSessionConfig` + `RunFlags`:**
- `model` — override model per session (`claude-sonnet-4-6`, `claude-opus-4-6`, etc.); required for model routing (STRATEGY Phase 4 agent_context) ✅ DONE
- `effort` — session effort level (`low | medium | high | max`); `max` Opus 4.6 only; maps directly to cost governance
- `maxTurns` — cap agentic turns; exits with error when limit reached; guardrail for runaway loops
- `maxBudgetUsd` — hard USD cap per session (print/headless mode only); complements Kiln's own budget tracking

**Medium — add when needed:**
- `tools` — restrict which built-in tools Claude can use (`""` = none, `"default"` = all, or explicit list like `"Bash,Edit,Read"`); enables least-privilege per session
- `allowedTools` / `disallowedTools` — fine-grained tool permission overlay without changing permission mode
- `addDir` — additional working directories; needed for monorepo workflows where agent reads across packages
- `forkSession` — create new session ID on resume instead of reusing original; maps to the deferred POST /fork story above

**Not relevant for Kiln:**
- `--chrome`, `--ide`, `--remote`, `--teleport`, `--remote-control` — interactive/browser features outside headless scope
- `--bare` — strips MCP + CLAUDE.md discovery that Kiln relies on
- `--betas` — API-key users only; Kiln targets subscription path too
- `--teammate-mode`, `--tmux` — Kiln has its own TUI/orchestration layer

**Subscription note (2026-04-04):** Anthropic confirmed that tools wrapping the Claude Code
harness (Agent SDK, `claude -p`, headless) remain covered by subscriptions. Only third-party
tools that use OAuth login to consume subscription capacity (e.g. OpenClaw) are restricted.
Kiln's `ClaudeSession` uses `@anthropic-ai/claude-agent-sdk` directly — unaffected.

### OpenCode CLI — unexposed options (Phase 3.5 follow-on)

Audit of the OpenCode CLI reference (2026-04-03). `OpenCodeSessionConfig` already wires:
`model` (✅ now forwarded via `config.update` PATCH), `port`, `baseUrl`, `permissionDefault`, `mcpServers`, `resumeSessionId`.

**High — add to `OpenCodeSessionConfig` + `RunFlags`:**
- `--agent` — specify an OpenCode agent by name; needed once Phase 4 agent configs land
- `--fork` — fork session on continue (use with `--continue`/`--session`); maps to deferred POST /fork story
- `--attach` — attach to a running `opencode serve` instance to avoid MCP cold-start on every `kiln run`; highest-value latency win for repeated runs

**Medium — add when needed:**
- `--title` — session title; surfaced in `opencode session list` and Kiln session report footer
- `--format json` — raw JSON event stream; already using ACP SSE but useful as fallback output mode
- `--share` — share session URL; optional telemetry/shareability feature

**Environment variables worth exposing via `OpenCodeSessionConfig.env`:**
- `OPENCODE_DISABLE_AUTOCOMPACT` — disable auto-compaction when Kiln manages compaction itself
- `OPENCODE_DISABLE_PRUNE` — prevent OpenCode from pruning session data Kiln may want to retain
- `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` — bash command timeout override

**`opencode serve` + `--attach` pattern (high value):**
`OpenCodeSession` currently spawns a fresh `opencode serve` per `kiln run` invocation, paying
MCP cold-start cost every time. The `opencode run --attach http://localhost:<port>` flag lets
a persistent server be reused. Design: `SessionRegistry` could manage a shared OpenCode server
process lifecycle (start on first use, reuse on subsequent calls, restart on failure).
Tracked under Phase 3 deferred: `--attach` lifecycle (blocked on OpenCode upstream session persistence).

### Codex CLI — unexposed options (Phase 3.5 follow-on)

Audit of the Codex CLI reference (2026-04-03). `CodexSessionConfig` already wires:
`model` (✅ `-m` flag now passed to spawn args), `approvalMode`, `sandboxMode`, `resumeSessionId`. Spawn args: `exec --json --ask-for-approval --sandbox --cd`.
Dynamic model list: ✅ `codex app-server` + JSON-RPC `model/list` at TUI gateway startup.

**High — add to `CodexSessionConfig` + spawn args:**
- `--sandbox` / `-s` — ✅ DONE (2026-04-08). `CodexSession` now passes `--sandbox` explicitly and preserves `read-only`, `workspace-write`, and `danger-full-access` instead of relying on `--full-auto`
- `--ephemeral` — ✅ DONE (2026-04-08). `kiln run --provider codex --ephemeral ...` now forwards Codex's native `--ephemeral` flag for non-persistent Codex sessions
- `--output-schema` — ✅ DONE (2026-04-08). `kiln run --provider codex --output-schema <file> ...` now forwards Codex's native `--output-schema <file>` flag

**Medium — add when needed:**
- `--profile` — ✅ DONE (2026-04-08). `kiln run --provider codex --profile <name> ...` now forwards Codex's native `--profile <name>` flag
- `--add-dir` — ✅ DONE (2026-04-08). `kiln run --provider codex --add-dir <path> ...` now forwards Codex's native `--add-dir <path>` flag (current Kiln CLI slice supports a single path)
- `--skip-git-repo-check` — ✅ DONE (2026-04-08). `kiln run --provider codex --skip-git-repo-check ...` now forwards Codex's native `--skip-git-repo-check` flag

**Already handled differently:**
- `--json` — already passed; JSONL parsing in `codex-session.ts` is correct
- `--resume` — wired via `resumeThreadId` from `SessionStore`
- `--cd` / `-C` — already passed as last positional args

**Resolved (2026-04-08):** `CodexSession` no longer relies on `--full-auto` for Kiln-managed
runs. Kiln now passes explicit `--ask-for-approval` and `--sandbox` flags, so the configured
Codex sandbox mode is enforced instead of silently collapsing to `workspace-write`.

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

### Phase 7 — Kiln TUI (The Final Destination)

**Status:** DONE (v0.25.0)
**Current state:** All sub-phases complete (7a through 7g). Kiln TUI is a working
terminal product surface with conversation shell, approval queue, routing
indicator, budget panel, session browser, and diff/change visibility. Phase 8
(Agent Teams) is next.

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
- Phase 5: cloud (kiln TUI connects to remote gateway) ✅ already live
- Phase 6: agent teams (swarm activation, plan mode)

**Tech stack (confirmed, updated 2026-04-02):**
- OpenTUI (@opentui/core) — imperative terminal renderer with Yoga flexbox layout
  - Ink was the original plan; OpenTUI chosen after studying t1code and opencode source
  - Key primitives: BoxRenderable (flex layout), ScrollBoxRenderable (sticky scroll),
    TextRenderable (styled text via fg()/t``), InputRenderable/TextareaRenderable (input)
  - Styling: use fg()/bold()/t`` API — never raw ANSI escape codes in content strings
  - Render order: add all renderables to root FIRST, then call renderer.start()
- @kilnai/react hooks available for future React-based variant (@opentui/react)
- EventBus 43 typed events — feeds real-time TUI updates
- Package: @kilnai/tui (exists, imperative implementation in progress)

**Routing and the TUI — design decision (locked 2026-04-02):**
The TUI has two distinct interaction modes with routing:

1. **Direct provider selection (user-driven):** When the user picks a provider/model
   in the TUI, routing is bypassed — `registry.createSession(id, config)` is called
   directly. The user is the decision-maker; no automatic routing needed.

2. **Supervisor/swarm orchestration (agent-driven):** When the active agent spawns
   sub-agents mid-conversation (e.g. "route this reasoning subtask to opus, this
   codegen to codex"), the routing layer, circuit breaker, and capability scoring
   all become active. The TUI surfaces this as a live stream of sub-agent activity.

   Example flow:
   ```
   User (TUI) → orchestrator (claude-sonnet)
                  ├── routes subtask A → opus   (deep reasoning)
                  ├── routes subtask B → codex  (code execution)
                  └── routes subtask C → haiku  (fast summarization)
   ```

   The TUI shows all activity as a unified conversation with per-backend cost tracking.
   This is the Phase 7c/7d/7e work — not needed for the minimal chat foundation.

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

**Sub-phases:**
7a. @kilnai/tui package scaffold — DONE (v0.23.x)
7b. Conversation component (input + message history) — DONE (v0.24.1)
   - OpenTUI renderer, input fixes (vim keys, Enter freeze, Ctrl+V paste)
   - Native session persistence (providerSessionId unification, crash-resilient restart)
   - /clear command (WS protocol: clear/cleared frames)
   - opencode-style layout: chatArea + divider + sidebar (provider, cost, cwd, turns, tool)
   - Theme token system: 12 built-in themes, --theme flag
   - Real-time activity bar (command bar integration): phase + tool + details
   - Sidebar tool counter (no duplicates), input clear on Enter fix
7c. TUI Gateway Integration — DONE (v0.24.2)
   - CliSubscriptionExecutor: stateless CLI subprocess executor (ProviderAdapter)
   - startTuiGateway(): in-process WS gateway on port 4801, ModeBOrchestrator wired
   - TuiWsClient: Bun WebSocket client with heartbeat + exponential backoff reconnect
   - GatewaySession: SessionLike over WS, maps frames to SessionEventInternal async iterator
   - TUI-specific WS protocol: message/clear/provider outbound; thinking/activity/done/error inbound
   - Activity event pipeline: tool_use/tool_result/cost_update routed to handlers
   - Token count pipeline: inputTokens/outputTokens threaded through all frames
   - /provider picker: provider+model selection UI with 2-screen navigation
   - Status guard: late WS frames discarded after turn completion
   - Bug fixes (v0.24.2): /provider command, tool routing, status race, token pipeline
7d. Budget panel (per-provider real-time cost + token breakdown) — DONE (v0.24.3)
   - FIXED: model selection wired end to end for all three providers. Claude Code via SDK `Options.model`, OpenCode via `config.update` PATCH, Codex via `-m` flag.
   - FIXED: dynamic model list — gateway runs `opencode models` (line output) and `codex app-server` + JSON-RPC `model/list` in parallel at startup; both lists sent in welcome frame. Claude stays hardcoded (no unauthenticated discovery path; `supportedModels()` SDK requires a live session).
7e. Routing indicator (which CLI was chosen and why) — DONE (v0.24.4)
   - Chat responses show provider/model labels
   - Sidebar provider display includes route mode badge (`user` vs future `auto`)
  7f. Full integration: kiln command launches TUI by default when interactive — DONE (v0.24.5)
  7g. Diff/change visibility (file diffs, change summary per turn) — DONE (v0.25.0)

---

### Phase 7c — TUI Gateway Integration (ADR-002)

**Status:** DONE (v0.24.2)  
**ADR:** [ADR-002](docs/adr/ADR-002-tui-gateway-architecture.md) (amended 2026-04-03)

All 7 scope items delivered. TUI routes through in-process gateway via WebSocket.
Gateway owns all orchestration (ModeBOrchestrator, SessionRegistry, memory, safety).
TUI is a pure rendering layer — no orchestration logic in `@kilnai/tui`.
See [ADR-002](docs/adr/ADR-002-tui-gateway-architecture.md) for protocol spec and architecture.

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

## Backend Architecture — Harness vs Provider

**Status:** DESIGN (implementation spread across multiple phases)

Kiln supports two fundamentally different backend types. This distinction must be
explicit in `kiln.yaml`, `kiln run`, and the TUI provider picker.

### Harness backends

Kiln spawns an external CLI process that brings its own agent loop, tool access,
permission model, and context management. Kiln orchestrates from the outside.

| Backend | Process | Session type |
|---|---|---|
| `claude-code` | `@anthropic-ai/claude-agent-sdk` | `ClaudeSession` |
| `codex` | `codex exec --json` | `CodexSession` |
| `opencode` | `opencode serve` + ACP SDK | `OpenCodeSession` |

Harness backends consume the user's subscription or CLI credits (ChatGPT Plus,
Claude subscription, OpenCode Go). No API key required for the model calls —
the CLI handles billing internally.

### Provider backends

Kiln calls the model API directly. Kiln IS the agent — it owns the loop, tools,
context, and prompt construction. The provider only returns tokens.

| Provider | Adapter | Notes |
|---|---|---|
| `anthropic` | `anthropic.ts` | Direct Anthropic API |
| `openrouter` | `openrouter.ts` | 300+ models, free tier available |
| `openai` | `openai.ts` | Direct OpenAI API |
| `deepseek` | `deepseek.ts` | Cost-efficient reasoning models |
| `ollama` | `ollama.ts` | Local models, zero API cost |

All provider backends require a `PROVIDER_API_KEY` env var (except Ollama).
OpenRouter is the most valuable for free-tier access — models like
`meta-llama/llama-3.1-8b-instruct:free` and `google/gemma-3-27b-it:free`
enable zero-cost testing, eval runs, and fallback routing.

### `kiln.yaml` schema

```yaml
session:
  backend:
    type: harness          # claude-code | codex | opencode
    provider: claude-code

  # or

  backend:
    type: provider         # anthropic | openrouter | openai | deepseek | ollama
    provider: openrouter
    model: meta-llama/llama-3.1-8b-instruct:free
```

### TUI provider picker

The existing provider picker (Phase 7b) should reflect this two-section layout:

```
Select backend

  ── Harness ──────────────────────────────
  ● Claude Code       (subscription)
  ○ Codex             (ChatGPT Plus)
  ○ OpenCode          (OpenCode Go)

  ── Direct API ───────────────────────────
  ○ Anthropic         (ANTHROPIC_API_KEY)
  ○ OpenRouter        (free tier available)
  ○ Ollama            (local, no API cost)
  ○ DeepSeek          (DEEPSEEK_API_KEY)
```

### Capability comparison

| Capability | Harness | Provider (today) | Provider + @kilnai/tools |
|---|---|---|---|
| File tools (Read/Write/Bash) | CLI owns | None | Kiln-native (rg/fd/jq) |
| Permission UX | CLI owns | None | Kiln layer — full control |
| Context compaction | CLI owns | Kiln must build | Kiln layer — full control |
| Cost tracking | Native | core ✓ | core ✓ |
| MCP tools | Full | core ✓ | core ✓ |
| Memory / RAG | Kiln layer | Kiln layer ✓ | Kiln layer ✓ |
| Safety pipeline | Kiln layer | Kiln layer ✓ | Kiln layer ✓ |
| Model routing | Fixed to CLI | 300+ via OpenRouter | 300+ via OpenRouter |
| Free tier models | No | OpenRouter free ✓ | OpenRouter free ✓ |
| Local / offline | No | Ollama ✓ | Ollama ✓ |
| Mid-session model switch | No | Yes | Yes |
| Per-tool observability | No — CLI owns | Full — Kiln owns | Full — Kiln owns |
| Intern tool interception | No | Full | Full |

**Trajectory:**
```
Today:     harness = powerful,   provider = limited
+ tools:   harness = powerful,   provider = equally powerful
Long term: harness = compatible, provider = primary
```

Harness backends are the practical path today because `@kilnai/tools` does not
exist yet. Once it ships, provider + tools owns the entire stack and becomes
the default mode. Harness backends become the compatibility path for users who
prefer their existing CLI setup or need IDE integration.

### Unified SessionRegistry — orchestrator calls both

The orchestrator does not choose between harness and provider — it draws from
both pools simultaneously. `SessionRegistry` already does priority-ordered
selection with circuit breaker fallback across harness backends. Extending it
to include provider sessions gives the orchestrator a unified backend pool:

```
SessionRegistry
├── Harness pool
│   ├── ClaudeSession        (priority 1 — most capable today)
│   ├── CodexSession         (priority 2)
│   └── OpenCodeSession      (priority 3)
│
└── Provider pool
    ├── ProviderSession(anthropic, opus)              (complex tasks)
    ├── ProviderSession(openrouter, llama-3.1-free)   (lightweight tasks)
    └── ProviderSession(ollama, local)                (offline / free)
```

This enables **per-agent backend assignment** in team configs:

```yaml
team:
  strategy: supervisor
  agents:
    - name: architect
      backend:
        type: harness
        provider: claude-code          # full tool access for coding tasks

    - name: researcher
      backend:
        type: provider
        provider: openrouter
        model: google/gemma-3-27b-it:free   # free, sufficient for research

    - name: reviewer
      backend:
        type: provider
        provider: anthropic
        model: claude-sonnet-4-6       # direct API for structured review
```

Each agent picks the right backend for its role. Expensive harness for the
coder, free model for the researcher, direct API for the reviewer. Cost
optimization is a first-class config concern, not an afterthought.

The circuit breaker already handles fallback — if Claude Code is rate-limited,
the registry can fall through to a provider backend automatically.

### What needs to be built

Provider backends are fully implemented in `packages/core/src/agents/infrastructure/`.
What is missing is the **session adapter layer** — a `ProviderSession` implementing
`IKilnSession` that drives the core `Orchestrator` directly instead of spawning a CLI.
Kiln owns the agent loop: tool execution, permission enforcement, context compaction,
and cost tracking all run inside Kiln rather than being delegated to the external CLI.

**Phases:**
- `P-backend-1`: `ProviderSession` implementing `IKilnSession` over core `Orchestrator`
- `P-backend-2`: `SessionRegistry` unified pool — harness + provider with shared circuit breaker
- `P-backend-3`: `kiln run --type provider --provider openrouter --model <id>` CLI flag
- `P-backend-4`: TUI provider picker two-section layout (harness / direct API)
- `P-backend-5`: `kiln.yaml` `session.backend` + per-agent backend assignment in team config
- `P-backend-6`: Free-tier OpenRouter models surfaced in TUI with zero-cost label
- `P-backend-7`: `@kilnai/tools` integration — provider sessions get rg/fd/jq natively (depends on Phase 9)

**Dependency:** `P-backend-1` is the foundation — all others follow from it.
Timing: after Phase 4.5 permission layer is stable (provider sessions need
the same permission enforcement that harness sessions already have).

---

## Phase 9 — Native Developer Tools (`@kilnai/tools`) [URGENT]

**Status:** COMPLETED — Phases 9a-9f landed + review hardening; critical path cleared for Phases 10-12
**Priority:** URGENT — without native tools, provider backends cannot compete with harness backends
**Source:** Evolution research (2026-04-07): Claude Code, Codex, OpenCode, Goose, Aider, OpenClaw tool interface analysis
**Dependency:** Phase 4.5 (permission layer) must be stable

### Problem

Kiln's provider backends (Anthropic, OpenRouter, DeepSeek, Ollama) can call LLMs directly but
have no developer tools (bash, file read/write, search). Users must use harness backends
(Claude Code, Codex, OpenCode) for any real coding work. This makes Kiln a CLI wrapper, not a
runtime. Every competitor (Claude Code, Codex, OpenCode, Goose, Hermes, OpenClaw) owns their
tool execution — Kiln must too.

### Research Findings (2026-04-07)

Tool interfaces have converged across the industry:

| Tool | Claude Code | OpenCode | Goose | Codex |
|------|-------------|----------|-------|-------|
| Shell | `Bash` | `bash` | `developer__shell` | `shell` |
| Read file | `Read` | `read` | (via shell) | (via shell) |
| Edit file | `Edit` (old/new) | `edit` (old/new) | `text_editor` (str_replace) | `apply_patch` (diff) |
| Write file | `Write` | (via edit) | (via text_editor) | (via apply_patch) |
| Search content | `Grep` | `grep` | (via shell) | (via shell) |
| Find files | `Glob` | `glob` | (via shell) | (via shell) |

Two design philosophies exist:
- **Granular** (Claude Code, OpenCode): separate tool per operation — inspectable, permissionable
- **Minimal** (Codex): shell + patch only — fewer tokens, less control

**Decision:** Kiln uses the granular approach. It aligns with the existing permission policy
system (`KilnPermissionPolicy`), safety pipeline, and audit log. A dedicated `Grep` tool can be
permission-gated and audited; a `bash rg` cannot.

### Rules (apply to all sub-phases)

- Schemas are the product, implementations are swappable
- No reimplementation — wrap best CLI tools (rg, fd, jq), fallback to pure TS
- No dead code — old Phase 9 vendored-only scope is absorbed, not duplicated
- Same orchestrator, new tool category — no parallel execution system
- One implementation, two surfaces (native + MCP) — no duplication
- Test before done: typecheck + vitest after every sub-phase
- Update CLAUDE.md bounded context table after 9a completion (done)

### Sub-phases

#### 9a. Tool Interface Layer (foundation)

**Status:** COMPLETED (landed)

**Scope:** Domain types + registry in `core/src/tools/domain/`

- `DevTool` interface: `name`, `description`, `inputSchema` (JSON Schema), `execute(input, sandbox): Promise<ToolResult>`
- `DevToolRegistry`: register, lookup, list tools — same pattern as `CapabilityRegistry`
- `ToolResult` type: `{ output: string, isError: boolean, metadata?: Record<string, unknown> }`
- `ToolEnvironment` type: detected binary paths (rg, fd, jq, git) — cached at startup
- `detectToolEnvironment()`: runs once, logs availability, determines fast-path vs fallback
- 7 tool schemas matching industry standard: `bash`, `read`, `write`, `edit`, `grep`, `glob`, `git`

**Files:** `core/src/tools/domain/tool.ts`, `core/src/tools/domain/tool-registry.ts`, `core/src/tools/domain/tool-environment.ts`
**Tests:** Schema validation, registry CRUD, environment detection with/without binaries
**Reference:** Claude Code tool schemas (Read/Write/Edit/Bash/Glob/Grep), OpenCode tool schemas (bash/read/edit/grep/glob)
**Also landed:** `packages/core/src/tools/index.ts`, root export in `packages/core/src/index.ts`, and tests under `packages/core/tests/tools/domain/`
**Review hardening:** `DevToolRegistry.register()` throws on duplicate (no silent overwrite). `ToolEnvironment` uses readonly object spread. `clearToolEnvironmentCache()` added for test isolation.

#### 9b. Tool Implementations (executors)

**Status:** COMPLETED (landed)

**Scope:** Infrastructure implementations in `core/src/tools/infrastructure/`

| Tool | Primary (fast) | Fallback (portable) | Key params |
|------|---------------|---------------------|------------|
| `bash` | spawn subprocess | same | `command`, `timeout`, `cwd` |
| `read` | `fs.readFile` | same | `filePath`, `offset`, `limit` |
| `write` | `fs.writeFile` | same | `filePath`, `content` |
| `edit` | string replace | same | `filePath`, `oldString`, `newString` |
| `grep` | `rg` (ripgrep) | `readline` + regex | `pattern`, `path`, `glob`, `outputMode` |
| `glob` | `fd` | `fast-glob` | `pattern`, `path` |
| `git` | `git` CLI | same | `subcommand`, `args` |

- All executors receive `SandboxContext` — filesystem + network isolation enforced
- All executors respect `KilnPermissionPolicy` tool rules
- `grep` and `glob` use `ToolEnvironment` to select fast-path vs fallback
- Output formatting: structured for LLM consumption (line numbers, truncation, token-aware limits)

**Files:** `core/src/tools/infrastructure/bash-tool.ts`, `read-tool.ts`, `write-tool.ts`, `edit-tool.ts`, `grep-tool.ts`, `glob-tool.ts`, `git-tool.ts`
**Tests:** Each tool tested with sandbox mock, both fast-path and fallback paths
**Reference:** Claude Code Grep wraps rg, OpenCode grep wraps rg — same pattern
**Landed:** Native executors for `bash`, `read`, `write`, `edit`, `grep`, `glob`, and `git` are implemented in the core tools slice with focused coverage.
**Review hardening:** `bash` uses `-c` (no `-l` profile sourcing). `read` uses line-based offset/limit. Shared fallback helpers (`runCommand`, `walkFiles`, `matchesGlob`, `globToRegExp`, `normalizePath`) extracted to `tool-helpers.ts` — eliminated ~140 lines of duplication across grep/glob.

#### 9c. Vendored Binaries (absorbed from old Phase 9)

**Status:** COMPLETED (landed)

**Scope:** Platform-specific binary packages following esbuild/tailwind pattern

- `@kilnai/tools-win32-x64`, `@kilnai/tools-darwin-arm64`, `@kilnai/tools-darwin-x64`, `@kilnai/tools-linux-x64`
- Binaries: `rg` (ripgrep) + `fd` + `jq` — ~5MB per platform
- Resolution: vendored binary preferred → system PATH fallback → pure TS fallback
- `detectToolEnvironment()` resolves paths in this order
- `kiln.yaml` integration: `shell.preferredTools` config (optional)

**Files:** `packages/tools/` package scaffold, platform-specific optional deps
**Tests:** Binary resolution on each platform, fallback chain verification
**Reference:** esbuild `optionalDependencies` pattern, `@tailwindcss/oxide` pattern
**Landed:** `packages/tools` plus platform packages are in place, vendored-first resolution for `rg`/`fd`/`jq` is wired into tool environment detection, and `git` remains PATH-only.

#### 9d. Tool Execution Loop

**Status:** COMPLETED (landed)

**Scope:** Wire dev tools into core Orchestrator's existing execution cycle

- Register `DevToolRegistry` tools as capabilities in Orchestrator
- Execution flow: LLM response → tool call extraction → permission check → sandbox execute → result injection
- Permission enforcement: `KilnPermissionPolicy` tool rules checked before execution (from Phase 4.5a)
- Sandbox enforcement: `core/src/sandbox/` per-agent isolation applied to all tool executions
- Cost tracking: tool execution events emitted to `EventBus` (existing 43 event types)
- Error handling: tool failures reported as structured `ToolResult` with `isError: true`

**Files:** Modifications to `core/src/orchestrator/orchestrator.ts`, new `core/src/tools/tool-executor.ts`
**Tests:** End-to-end: LLM mock → tool call → sandbox execute → result fed back
**Reference:** Mode B already executes webhook/integration tools via `ModeBOrchestrator` — same pattern, new tool category
**Rule:** No parallel execution system — extend existing orchestrator
**Landed:** `packages/core/src/tools/tool-executor.ts` bridges native tools into the orchestrator, and `packages/core/src/orchestrator/orchestrator.ts` now emits `tool_called`, `tool_authorized`, and `tool_result` with `annotations`, `authorizationLevel`, and `taskId` when available.
**Review hardening:** Single executor closure (no primary/fallback redundancy). Distinct error codes: `TOOL_AUTHORIZATION_DENIED` vs `TOOL_APPROVAL_REQUIRED`.

#### 9e. MCP Surface for Dev Tools

**Status:** COMPLETED (landed)

**Scope:** Expose dev tools as built-in MCP server (stdio + HTTP transports)

- `DevToolsMcpServer`: registers all 7 tools as MCP tool schemas
- stdio transport: `kiln tools --mcp` starts stdio server
- HTTP transport: auto-registered in gateway when dev tools are active
- External agents (Claude Code, Codex) can use Kiln's tools via MCP
- Same tool implementations, same sandbox, same permissions — two transports

**Files:** `core/src/tools/mcp/dev-tools-server.ts`
**Tests:** MCP tool call → executor → result roundtrip
**Reference:** Goose ships developer tools as MCP server (`developer__shell`, `developer__text_editor`)
**Rule:** One implementation, two surfaces — no code duplication
**Landed:** `DevToolsMcpServer` now exposes the native dev tools over MCP, and `kiln tools --mcp` provides the stdio entrypoint.
**Review hardening:** SDK promise moved to instance state (failed loads retryable, no module-level singleton).

#### 9f. TUI Direct Connection

**Status:** COMPLETED (landed)

**Scope:** `kiln tui` connects to orchestrator directly without gateway config

- Lightweight in-process bridge: TUI → Orchestrator (reuse `startTuiGateway` pattern)
- No `app.yaml` or `gateway.yaml` required
- Provider selection: `--provider` flag or `kiln.yaml` config
- Dev tools active by default in TUI mode
- Memory, safety pipeline, cost tracking all active (same as gateway path)

**Files:** Modifications to `packages/tui/src/gateway-session.ts`, `packages/cli/src/commands/tui.ts`
**Tests:** TUI startup without any YAML files, conversation with tool execution
**Reference:** Codex TUI is same-process (ratatui), OpenCode TUI connects to local `opencode serve`
**Rule:** TUI is a rendering layer — orchestrator owns agent loop
**Landed:** `packages/cli/src/commands/tui.ts` now uses an extracted bootstrap seam, direct transport is the default path, gateway mode is the explicit fallback override, and normal `kiln tui` startup no longer hard-depends on YAML/gateway bootstrap.
**Review hardening:** Removed dead code branches (unreachable default case, redundant env var check).

---

## Phase 10 — ProviderSession (Direct API Backend) [URGENT]

**Status:** COMPLETE (implemented 2026-04-08, pre-release)

**Status:** PLANNED — depends on Phase 9 (native tools)
**Priority:** URGENT — enables Kiln as true provider-agnostic runtime
**Source:** Evolution research (2026-04-07), existing P-backend design in STRATEGY.md
**Dependency:** Phase 9 (native tools must exist for provider sessions to be useful)

### Problem

Kiln has 5 provider adapters (`anthropic.ts`, `openai.ts`, `deepseek.ts`, `openrouter.ts`,
`ollama.ts`) that call LLMs directly, but no `IKilnSession` implementation that drives them
for developer-facing tasks. Users who want to use OpenRouter, DeepSeek, or Ollama cannot —
they must use a harness backend. With Phase 9 tools available, a `ProviderSession` completes
the stack: Kiln owns the agent loop, tools, permissions, and context.

Phase 10 landed the direct-provider path for `anthropic`, `openai`, `deepseek`,
`openrouter`, and `ollama` under the same `IKilnSession` contract as the
existing CLI harness backends. The registry now supports an 8-provider pool,
`kiln run` can select direct API providers without MCP, the TUI exposes both
Harness and Direct API providers, and direct-provider prompt construction no
longer duplicates governed preamble context.

### Rules

- Same `IKilnSession` contract — no special-casing for provider vs harness
- No dead code — `ProviderSession` replaces nothing, extends the pool
- Harness backends remain — they become optional, not deprecated
- Test before done: full session lifecycle tested with mock provider

### Sub-phases

#### 10a. ProviderSession implementing IKilnSession

- New `ProviderSession` class in `cli/src/wrapper/provider-session.ts`
- Drives core `Orchestrator` directly via provider adapter
- Kiln owns: tool execution (Phase 9), permission enforcement, context management, cost tracking
- Maps Orchestrator events → `SessionEvent` stream (same as ClaudeSession/CodexSession/OpenCodeSession)
- Provider selected by name: `anthropic`, `openrouter`, `openai`, `deepseek`, `ollama`
- Model selected by ID: `claude-sonnet-4-6`, `meta-llama/llama-3.1-8b-instruct:free`, etc.

**Files:** `cli/src/wrapper/provider-session.ts`
**Tests:** Full session lifecycle with mock provider adapter

#### 10b. Unified SessionRegistry Pool

- `SessionRegistry` accepts both harness + provider sessions in a single pool
- Shared circuit breaker + priority scoring across both types
- Per-agent backend assignment: team configs can mix harness + provider
- Fallback: if harness backend is rate-limited, registry falls through to provider

**Files:** Modifications to `cli/src/wrapper/session-registry.ts`
**Tests:** Mixed pool selection, circuit breaker fallback across types

#### 10c. CLI + TUI Integration

- `kiln run --provider openrouter --model deepseek-r1` creates ProviderSession
- `kiln tui` provider picker: two-section layout (Harness / Direct API)
- Free-tier OpenRouter models surfaced with `(free)` label
- `kiln.yaml` `session.backend` schema supports both types

**Files:** Modifications to `cli/src/commands/run.ts`, `cli/src/commands/tui.ts`, `tui/src/app.tsx`
**Tests:** CLI flag parsing, TUI picker rendering, provider session creation

#### 10d. Context Management for Provider Sessions

- Context window tracking (token counting per provider/model)
- Compaction strategy: Kiln-owned sliding window (not delegated to CLI)
- System prompt construction via `buildPreamble()` — already exists
- Memory injection: same pipeline as Mode B gateway (user, agent, project scopes)
- Knowledge injection: same RAG pipeline as gateway

**Files:** New `cli/src/wrapper/provider-context.ts`, modifications to `cli/src/wrapper/preamble-builder.ts`
**Tests:** Context window overflow handling, compaction trigger, memory injection

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

- Provider + model defaults
- Global MCP servers
- TUI preferences (theme, keybinds)
- Default permission policy
- Identity (name, timezone — for buildPreamble personalization)
- Resolution: `~/.kiln/config.yaml` on all platforms (XDG-aware on Linux)
- Created by first-run wizard or `kiln init --global`

**Files:** New `cli/src/config/global-config.ts`, schema definition, loader
**Tests:** Load, merge with defaults, missing file handling, first-run creation
**Reference:** Codex `~/.codex/config.toml`, OpenCode `~/.config/opencode/opencode.json`

#### 11b. Project Config (`./kiln.yaml`) with Merge Semantics

- Project-specific overrides committed to git
- Merge rules (explicit, documented):
  - Scalar fields: project overrides global (model, provider, theme)
  - Agent definitions: deep merge (project adds skills/tools to global agent)
  - MCP servers: additive (both global and project servers active)
  - Permission rules: project can tighten, never loosen global policy
- `loadKilnConfig(projectPath)`: returns merged config from global + project

**Files:** New `cli/src/config/config-merger.ts`, modifications to existing `cli/src/config.ts`
**Tests:** All merge scenarios: override, additive, tighten-only permissions, missing layers
**Reference:** Codex `ConfigLayerStack` (system > user > project), OpenCode 4-tier precedence

#### 11c. Zero-Config First Run

- `kiln tui` works with zero files: `--provider openrouter --model deepseek-r1`
- `KILN_PROVIDER` + `KILN_MODEL` env vars as alternative to flags
- First-run wizard: interactive provider selection → creates `~/.kiln/config.yaml`
- `kiln init` creates project `kiln.yaml` from template (existing command, enhanced)
- Target: < 60 seconds from install to first conversation

**Files:** Modifications to `cli/src/commands/tui.ts`, `cli/src/commands/init.ts`
**Tests:** Cold start with no files, env var resolution, wizard flow
**Reference:** OpenClaw first-run wizard, Claude Code zero-config with `ANTHROPIC_API_KEY`

#### 11d. Agent Definitions as Markdown

- `~/.kiln/agents/*.md` (global) + `.kiln/agents/*.md` (project)
- Format: YAML frontmatter + markdown body (same as SKILL.md):
  ```markdown
  ---
  name: coder
  role: Senior TypeScript developer
  tools: [bash, edit, read, glob, grep]
  model: claude-sonnet-4-6
  skills: [sequel-spring, code-reviewer]
  ---
  Additional instructions for this agent...
  ```
- Loaded by config loader, merged into agent registry
- Available in TUI agent picker and `kiln run --agent <name>`

**Files:** New `cli/src/config/agent-loader.ts`
**Tests:** Parse frontmatter, merge with config agents, missing directory handling
**Reference:** ECC `agents/*.md`, OpenCode `agents/*.md`, OpenClaw `SOUL.md`

#### 11e. AGENTS.md Generation

- `kiln sync --agents-md` generates cross-tool context file at project root
- Content: agent names, roles, tools, skills — derived from merged kiln.yaml + agents/*.md
- Readable by Claude Code, Codex, OpenCode, Cursor without any Kiln-specific config
- Auto-generated, not hand-maintained — single source of truth is kiln.yaml

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
