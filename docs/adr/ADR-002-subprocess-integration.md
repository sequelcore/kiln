# ADR-002: Subprocess Integration Model

## Status
Accepted (v0.23.2, 2026-03-31)

## Context
Kiln orchestrates 3 CLI backends (Claude Code, Codex CLI, OpenCode) as subprocesses. This is legally safe (real CLI binary handles its own auth) but introduces 5 confirmed technical limitations that required architectural solutions.

## Decision
Kiln spawns CLIs as subprocesses with --bare mode and compensates for limitations through preamble injection, permission bypass, and cross-agent memory.

## Limitations and Solutions

### 1. Stateless Between Calls
**Problem:** Subprocess calls do not preserve state across invocations.
**Status:** Partially mitigated. Claude Code has --resume/--session-id. Codex has resume. OpenCode has --session/--continue.
**Solution:** Hybrid approach: --session-id for intra-CLI chains, an explicit handoff artifact for cross-CLI handoffs, cross_agent_memory_* MCP tools at CLI boundaries only.

### 2. Startup Latency vs Hook/Skill Loss
**Problem:** --bare flag skips hooks, skills, plugins, auto-memory. Without it, startup is slow.
**Status:** Confirmed. CLAUDE.md still loads even with --bare.
**Solution:** Always use --bare. KilnHookProxy reimplements PreToolUse (security) and Stop (completion). Skills injected as XML block in prompt (max 2000 tokens). OpenCode: opencode serve + --attach eliminates cold boot.

### 3. Permission Prompts in Non-Interactive Mode
**Problem:** stdout parsing for permission prompts is fragile and fails with stream-json output.
**Status:** Confirmed with active bugs (#35718, #36192, #37181).
**Solution:** bypassPermissions + dedicated sandbox directory with pre-configured settings.json. --allowedTools pre-filtered. Memory dirs outside ~/.claude/. Do NOT rely on CLI flags alone.

### 4. Auto Mode Classifier Abort
**Problem:** 3 consecutive or 20 total classifier blocks cause abort in -p mode. Task decomposition does NOT reliably avoid this.
**Status:** Confirmed. Classifier evaluates subagents at spawn, during execution, AND on return independently.
**Solution:** bypassPermissions makes this a non-issue. If auto mode needed: detect exit code, max 2 retries, escalate to interactive.

### 5. Model Unaware of Subprocess Context
**Problem:** Mode flag is not passed to the model. The model does not know it is running as a Kiln subprocess.
**Status:** Confirmed.
**Solution:** kiln-preamble XML injected on every prompt via buildPreamble(). Sections: role, task, domain, constraints, memory (200-line cap), instructions. Sections omitted when empty. XML-escaped.

## Consequences
- All backends run in --bare mode, reducing startup time but requiring Kiln to compensate for lost hooks/skills
- Permission management is centralized in Kiln KilnPermissionPolicy, not delegated to backends
- Cross-CLI handoff requires explicit memory store calls, not implicit state sharing

## References
- Claude Code issues: #35718, #36192, #37181
- IKilnSession contract: packages/cli/src/wrapper/session.ts
- Preamble builder: packages/cli/src/wrapper/preamble-builder.ts
