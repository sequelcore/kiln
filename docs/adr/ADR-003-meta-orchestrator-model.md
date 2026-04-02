# ADR-003: Meta-Orchestrator Integration Model

## Status
Accepted (2026-04-01)

## Context
Three integration approaches exist for coordinating multiple AI CLI tools:
1. **Plugin/slash command** (e.g., codex-plugin-cc): One CLI is the host, others are subprocesses invoked from within. Communication is one-directional. State lives in flat files. Tools do not know each other exists.
2. **Direct API calls**: Each tool talks to provider APIs independently. No shared state, session handoff, or cost aggregation. Works for single-tool workflows, breaks for cross-CLI scenarios.
3. **Meta-orchestrator** (Kiln model): Kiln owns the session lifecycle above all CLIs. Routes tasks by capability and quota, tracks cost across providers, handles mid-task handoff. CLIs become interchangeable workers.

## Decision
Kiln uses the meta-orchestrator model. Plugin integration is deferred as a thin UX wrapper for Claude Code users once native Kiln is stable.

## Where Meta-Orchestrator Wins
- Cross-CLI session resume (threadId to reuseEnvironmentId handoff)
- Unified cost budget enforced across Claude + Codex + OpenCode
- Circuit breaking: quota exhausted on one backend, falls to another automatically
- EventBus observability across all backends from one stream
- Provider-agnostic: adversarial review, job tracking, rescue all work regardless of which CLI runs

## Where Plugin Wins
- Zero setup friction for Claude Code users
- Stop hook is deeply integrated into the host process lifecycle
- Slash commands feel native inside Claude Code

## The Genuine Gap
The Stop hook is the one thing Kiln cannot replicate natively. It requires being inside the Claude Code process. Everything else (job tracking, adversarial review, rescue) Kiln can do natively and better because it is provider-agnostic.

## Steal List (Native Kiln Implementation)

| Pattern | Plugin Approach | Kiln Approach | Effort | Phase |
|---------|----------------|---------------|--------|-------|
| Adversarial review | prompts/adversarial-review.md, structured skepticism | kiln review --adversarial, prompt in core | medium | 4+ |
| In-flight job tracking | state.json + per-job files | Extend session-store.ts: status/phase/pid fields, kiln status/cancel | large | 4+ |
| EventBus phase emission | None | Emit CodexPhase events from codex-session.ts as JSONL arrives | small | next |
| Stop gate (review gate) | Stop hook blocks Claude, runs Codex review | opt-in via kiln.yaml hooks, SessionEnd event | large | 4+ |

## Consequences
- Kiln differentiation is cross-CLI unification; a plugin re-locks users into Claude Code-only UX
- Plugin becomes viable as thin wrapper once native Kiln TUI is stable
- The Stop hook gap is acceptable because bypassPermissions mode eliminates the classifier abort issue

## References
- Source: codex-plugin-cc architecture scout (2026-04-01)
- SessionRegistry: packages/cli/src/wrapper/session-registry.ts
- IKilnSession: packages/cli/src/wrapper/session.ts