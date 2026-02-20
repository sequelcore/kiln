# Kiln Evolution Plan

## 1. Vision

### What Kiln Is

A YAML-configured, production-grade AI orchestration engine for TypeScript teams building multi-tenant, multi-agent SaaS applications.

### Target Users

Engineering teams who need:
- Multi-tenant isolation (SaaS products with per-customer AI agents)
- Quality assurance enforcement (gates, verification loops, reproducibility)
- Budget control (per-role cost tracking, tier enforcement)
- Multi-channel deployment (CLI, Web, WhatsApp, Slack, API)
- Self-hosted / white-label capability
- Declarative configuration (YAML over code)

### What Kiln Is NOT

| Not This | That's For | Why Not |
|----------|-----------|---------|
| Personal AI assistant | OpenClaw | Consumer space, single-user, chat-first UX |
| Visual no-code builder | AutoGPT Platform | Non-engineer target, proprietary blocks |
| Python framework | LangGraph, CrewAI | Different ecosystem; Python is saturated with options |
| Research prototype | BabyAGI | Educational, not production-grade |

### Competitive Position

```
                    Code-First ──────────────────── YAML-Declarative
                        │                                │
  Production-Grade ─────┼── LangGraph                    │── Kiln ◄── ONLY ONE HERE
                        │                                │
  Framework ────────────┼── CrewAI                       │
                        │                                │
  Consumer Agent ───────┼──                              │── (none)
                        │                                │
  No-Code ──────────────┼── AutoGPT Platform             │── (none)
```

### Validated Strengths

These are confirmed unique or best-in-class across 10 competitors:

1. **YAML-first configuration** -- comprehensive YAML-defined agents/teams/workflows/gates
2. **Multi-tenant gateway** -- native multi-tenant isolation with per-app routes and budget enforcement
3. **5 scoped memory** -- richest scope model (user, agent, team, project, org) with decay and compaction
4. **MCP-native capabilities** -- aligned with Anthropic's Model Context Protocol standard
5. **Quality gates with verification loop** -- iterative test/lint/typecheck enforcement
6. **Agent Identity Standard** -- name/role/goal/backstory persona model with auto-assembled system prompts
7. **Budget enforcement** -- cache-aware cost tracking with per-role pricing
8. **Cross-app delegation** -- schema-contracted inter-app communication
9. **Security layers** -- prompt injection (2-tier), Guardian review, encrypted secrets, audit logging
10. **TypeScript/Bun** -- only production framework in the Bun ecosystem

---

## 2. Current Status

| Metric | Value |
|--------|-------|
| Packages | 3 (core, runtime, cli) |
| Bounded contexts | 21 |
| Tests passing | 1,984+ (vitest) + 15 (bun test) |
| Primitives | 7 (Agent, Capability, Workflow, Memory, Task, Channel, Trigger) |
| Composites | 3 (Team, Router, App) |

---

## 3. Roadmap

Three items remain from the original plan:

| Item | Description |
|------|-------------|
| **Horizontal scaling** | Stateless gateway mode: checkpoints in shared PostgreSQL, session state in Redis. Multiple gateway instances behind a load balancer. |
| **Agent-to-Agent protocol** | Google A2A protocol for cross-framework agent communication. A Kiln agent can delegate to an external A2A-compatible agent and vice versa. |
| **Visual workflow editor** | Low-code web UI for building app.yaml visually. Drag-and-drop team composition, phase ordering, gate configuration. Generates valid YAML. |

---

## 4. Design Principles

### Simplicity vs. Robustness: Both, Layered

Kiln is simple by default (YAML config, sensible defaults, minimal setup) but robust when configured (checkpointing, security layers, audit logging). Every advanced feature is opt-in via YAML flags. A minimal app.yaml with one agent and one team works out of the box. Production deployments enable Guardian review, prompt injection scanning, encrypted secrets, and audit logging by adding a few YAML fields.

### Multi-Agent Model: Supervisor + Swarm, YAML-Configured

Both supervisor and swarm patterns are supported and configured via a single `mode` field on the Team composite. Supervisor mode requires a `manager` agent that receives all tasks, delegates to workers by name, and validates results. Swarm mode lets agents hand control to each other via a `handoff` capability without a central coordinator. Sequential mode (the default) chains agents in workflow order.

### Memory: Scoped Stores + Decay + Compaction

Five memory scopes (user, agent, team, project, org) are backed by SQLite + FTS5 with configurable exponential decay curves. When a store exceeds a configurable threshold, auto-compaction summarizes older entries into compressed form and archives originals. Git-synced project and org scopes use gzipped JSONL for cross-developer sharing.

### Security: Defense-in-Depth, All Opt-In

Six security layers are available: 2-tier prompt injection detection (regex heuristics + deep LLM scan), Guardian review for destructive capabilities, AES-256-GCM encrypted secrets with PBKDF2 key derivation, append-only JSONL audit logging with SHA-256 hash chaining, tenant isolation enforcement (memory namespace + FS jail), and periodic self-audit health checks. Every layer is opt-in to maintain simplicity for local development.
