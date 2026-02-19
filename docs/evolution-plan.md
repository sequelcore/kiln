# Kiln Evolution Plan

> Generated: February 2026
> Based on: Competitive analysis of 10 frameworks + full codebase audit (1,238 tests, 14 bounded contexts)

---

## 1. Scope Definition

### What Kiln Is

**A YAML-configured, production-grade AI orchestration engine for TypeScript teams building multi-tenant, multi-agent SaaS applications.**

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
| Visual no-code builder | AutoGPT Platform | Non-engineer target, proprietary blocks, Polyform Shield license |
| Python framework | LangGraph, CrewAI | Different ecosystem; Python is saturated with options |
| Research prototype | BabyAGI | Educational, not production-grade |

### Competitive Position

Kiln occupies a unique niche that no competitor fills:

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

### Validated Strengths (from competitive analysis)

These are confirmed unique or best-in-class across all 10 competitors:

1. **YAML-first configuration** -- no competitor does comprehensive YAML-defined agents/teams/workflows/gates
2. **Multi-tenant gateway** -- zero competitors have native multi-tenant isolation
3. **5 scoped memory** -- richest scope model (user, agent, team, project, org); CrewAI has 4 types but different semantics
4. **MCP-native capabilities** -- aligned with Anthropic's standard; CrewAI added MCP later, LangGraph uses a bridge adapter
5. **Quality gates with verification loop** -- no competitor has iterative test/lint/typecheck enforcement
6. **Budget enforcement** -- cache-aware cost tracking with per-role pricing; unique
7. **Cross-app delegation** -- schema-contracted inter-app communication; unique
8. **Domain auto-detection + marketplace security** -- content hashing, path traversal blocking, extension whitelisting; unique
9. **TypeScript/Bun** -- only production framework in the Bun ecosystem (vs Python dominance)
10. **MIT license** -- clean IP; AutoGPT Platform is Polyform Shield, CrewAI has telemetry concerns

---

## 2. Current State (Audit Summary)

| Metric | Value |
|--------|-------|
| Packages | 4 (core, runtime, cli, console) |
| TypeScript files | 326 |
| Implementation lines | ~15,000 |
| Test lines | ~17,500 |
| Test files | 103 (vitest) + 2 (bun-only: checkpoint store, checkpoint integration) |
| Tests passing | 1,362 / 1,362 (vitest) + 15 / 15 (bun test) |
| Typecheck errors | 0 |
| Bounded contexts | 14 (all implemented) |

### Implementation Status by Context

| Context | Status | Notes |
|---------|--------|-------|
| engine/primitives | Pure interfaces | Identity Standard complete: Agent has name, role, goal, backstory, instructions + prompt assembler |
| engine/composites | Implemented | Team/Router/App validation |
| engine/loaders | Implemented | Full YAML-to-App mapping |
| orchestrator | Implemented | Phase machine + orchestration loop |
| agents | Implemented | 4 providers (Anthropic, OpenAI, DeepSeek, Ollama) |
| memory | Implemented | SQLite+FTS5, gzipped JSONL project store, 3-layer manager |
| tree | Implemented | Scoring, batch execution, concurrency limits |
| sandbox | Advisory only | Policy objects, not OS-level isolation |
| verification | Implemented | Real child_process.spawn gate execution |
| events | Implemented | 16 typed events, ring-buffer history |
| cost | Implemented | Cache-aware pricing formula |
| domain | Implemented | Registry, YAML parser, marketplace security |
| gateway | Implemented | Hono HTTP server, budget, delegation, tenants |
| channels | Implemented | All 5 adapters (CLI, Web, WhatsApp, Slack, API) |

---

## 3. Gap Analysis (vs. Competitors)

### Critical Gaps

| Gap | Best Implementation | Impact |
|-----|-------------------|--------|
| **Agent identity model** | CrewAI (role + goal + backstory), OpenClaw (SOUL.md + IDENTITY.md) | Agents have no persona, no cognitive perspective, no distinct viewpoint. Multi-agent teams offer no diversity of thought. |
| **Checkpointing / Resume** | LangGraph (checkpoint every super-step, time-travel, fork) | Cannot recover from mid-workflow failures |
| **Fine-grained HITL** | LangGraph (`interrupt()` + checkpoint resume), CrewAI (`@human_feedback`) | Only phase-level approval; cannot interrupt mid-task |
| **Supervisor/Swarm patterns** | LangGraph (first-party `langgraph-supervisor`, `langgraph-swarm`), CrewAI (hierarchical process) | Static team assignment; no dynamic delegation within teams |
| **Prompt injection detection** | PocketPaw (2-tier: regex + LLM deep scan) | No defense against adversarial inputs |
| **Encrypted secrets** | PocketPaw (AES `secrets.enc`) | API keys in environment variables or plain config |

### Important Gaps

| Gap | Best Implementation | Impact |
|-----|-------------------|--------|
| **Task output guardrails** | CrewAI (guardrail function + retry loop per task) | Quality gates only at verification phase, not per-task |
| **Memory decay / compaction** | OpenClaw (FSRS-6 spaced repetition, auto-compaction) | Memory grows unbounded, no relevance decay |
| **Streaming depth** | LangGraph (token, tool-call, state, node-transition levels) | Event bus exists but no structured streaming to clients |
| **Structured outputs** | CrewAI (Pydantic models on task output), LangGraph (Trustcall) | No schema-validated agent responses |
| **OS-level sandbox** | (none do this well -- OpenClaw's is advisory too) | Policy objects are advisory; callers must check |

### Nice-to-Have Gaps

| Gap | Best Implementation | Impact |
|-----|-------------------|--------|
| **Visual debugger** | LangGraph Studio (graph viz + state inspector + replay) | CLI-only debugging |
| **Skills/templates format** | OpenClaw (SKILL.md + YAML frontmatter, 5,700+ community skills) | No community-shareable capability format |
| **Audit logging** | PocketPaw (append-only JSONL + self-audit daemon) | No structured audit trail |
| **A2A protocol** | Google A2A (emerging cross-vendor standard) | No inter-framework agent communication |

---

## 4. Phased Roadmap

### Phase 0: Foundation Polish + Agent Identity Standard

**Goal:** Harden the existing implementation AND establish the definitive Agent identity model. No backward compatibility -- firm vision.

**Rationale:** The audit shows 100% test pass rate and zero typecheck errors, but the Agent primitive is a minimal config blob with no persona, role, or cognitive perspective. This must be fixed at the foundation level before building supervisor/swarm patterns (Phase 2), because those patterns depend on agents having distinct identities. Production SaaS also demands robust error handling.

#### 0.1 Agent Identity Standard -- COMPLETE

> Implemented February 2026. Agent interface rewritten with identity fields (name, role, goal, backstory, instructions). System prompt assembler (`assembleAgentPrompt()`) added as pure engine function. YAML loader updated. 33 new tests added. All presets (example, ehrlich, artu) updated.

**Principle:** An agent is a persona with expertise, not a config blob. If you can't describe who your agent is, you haven't designed your team well enough.

**Agent fields (definitive, no backward compat):**

| Field | Required | Type | Purpose |
|-------|----------|------|---------|
| *(YAML key)* | yes | string | Internal identifier for references (`arch`, `impl`, `sec`) |
| `name` | **yes** | string | Persona name (`"Aria"`, `"Marcus"`, `"Dr. Voss"`) |
| `role` | **yes** | string | Expertise / function (`"Senior Architect"`) |
| `goal` | **yes** | string | What this agent is trying to achieve |
| `backstory` | no | string | Personality, perspective, behavioral boundaries |
| `tier` | **yes** | AgentTier | Model class: `"reasoning"` \| `"coding"` \| `"fast"` |
| `tools` | **yes** | string[] | Capability references (can be `[]`) |
| `instructions` | no | string | Operating rules and constraints |
| `structured` | no | boolean | Require JSON output |
| `count` | no | number | Parallel instance pool size |
| `sandbox` | no | boolean | Enable filesystem/network isolation |

**Removed:** `systemPrompt` -- replaced by auto-assembled prompt from identity fields + `instructions`.

**System prompt auto-assembly order:**

```
1. Identity:    "You are {name}, {role}. Your goal: {goal}"
2. Backstory:   "{backstory}" (if provided)
3. Instructions: "## Operating Rules\n{instructions}" (if provided)
4. Team context: "Team '{teamName}', {mode} mode. Teammates: {name + role for each}"
5. Capabilities: "## Available Tools\n{capability descriptions}"
6. Quality gates: "## Quality Standards\n{gate descriptions}" (if applicable)
```

**YAML example:**

```yaml
agents:
  arch:
    name: Aria
    role: Senior Architect
    goal: Design robust, maintainable solutions with minimal complexity
    backstory: >
      Pragmatic architect who values simplicity over cleverness.
      Always considers failure modes and edge cases first.
      Has seen every over-engineered system collapse under its own weight.
    tier: reasoning
    tools: []
    structured: true

  impl:
    name: Marcus
    role: Implementation Specialist
    goal: Write clean, well-tested code that follows team conventions
    backstory: >
      Detail-oriented developer who questions vague requirements before
      writing a single line. Takes pride in code that other developers
      enjoy reading. Believes tests are documentation.
    tier: coding
    tools: [memory_save, memory_recall, verify]
    count: 2
    sandbox: true

  sec:
    name: Dr. Voss
    role: Security & Quality Reviewer
    goal: Find vulnerabilities and design flaws before they reach production
    backstory: >
      Skeptical reviewer who assumes every input is malicious and every
      edge case will be hit. Trusts no one, verifies everything.
    tier: reasoning
    tools: [verify]
    instructions: >
      Never approve code that handles user input without validation.
      Flag any use of eval(), dangerouslySetInnerHTML, or raw SQL.
```

**Value:** Different agents naturally argue from different perspectives:
- **Aria** sees architecture: "This design has a single point of failure."
- **Marcus** sees implementation: "This abstraction adds complexity without benefit."
- **Dr. Voss** sees risk: "This endpoint accepts unvalidated input from the client."

#### 0.2 Foundation Hardening -- COMPLETE

> Implemented February 2026. KilnError base class with `code`, `context`, `retryable` fields; all 7 error classes migrated. Startup config validation (`validateStartupConfig`). Circuit breaker (3-state: closed/open/half-open) wired into budget middleware. HealthRegistry + deep `/health` endpoint. Integration test suite (pipeline + startup validation). 77 new tests added.

| Task | Description | Priority |
|------|-------------|----------|
| ~~**Agent primitive rewrite**~~ | ~~Implement the Agent Identity Standard across: primitive interface, YAML loader, system prompt assembler, all tests. Breaking change -- no backward compat.~~ DONE | ~~Critical~~ |
| ~~**Structured error hierarchy**~~ | ~~Unify error types across all bounded contexts. Define `KilnError` base with `code`, `context`, `retryable` fields. Every public API surface should throw typed errors.~~ DONE | ~~High~~ |
| ~~**Graceful degradation**~~ | ~~Budget middleware is fail-open by design -- document this explicitly. Add circuit breaker pattern for external service calls (billing, WhatsApp, Slack APIs).~~ DONE | ~~High~~ |
| ~~**Configuration validation**~~ | ~~Add runtime validation for all environment variables and external service URLs at startup. Fail fast with clear error messages.~~ DONE | ~~High~~ |
| ~~**Health check depth**~~ | ~~Expand `/health` endpoint: include memory store connectivity, provider reachability, channel adapter status.~~ DONE | ~~Medium~~ |
| ~~**Integration test suite**~~ | ~~Add end-to-end tests that exercise the full pipeline: YAML load -> orchestrator -> provider (mocked) -> memory -> event -> channel.~~ DONE | ~~Medium~~ |

**Definition of Done:** Agent Identity Standard fully implemented. Zero known production-readiness gaps. Health check covers all subsystems. Error hierarchy documented.

---

### Phase 1: Reliability & Observability -- COMPLETE

> Implemented February 2026. Checkpoint store (SQLite), orchestrator checkpoint/resume/fork/replay methods, auto-checkpoint on phase transitions, structured tracing (TraceSpan model + trace_span events), multi-level streaming (state/phase/tool/token levels, onLevel() on EventBus, EventBridge level filtering). Adversarial review found and fixed: replay() override ordering, fork() auto-checkpoint race condition, recursive delete, cost double-counting, checkpoint lineage tracking, circular import in CircuitBreaker, EventBus onLevel() unsubscribe. 15 new tests added.

**Goal:** Make workflows recoverable, traceable, and streamable. Inspired by LangGraph's production-grade primitives.

**Rationale:** LangGraph's adoption by LinkedIn, Uber, Klarna is driven by checkpointing and debugging. For Kiln to serve production SaaS, workflows must survive failures and be debuggable.

| Task | Description | Inspired By |
|------|-------------|-------------|
| ~~**Checkpointing**~~ | ~~Persist workflow state (phase, task tree, memory snapshot) after each phase transition. Store as JSON in SQLite. Resume from any checkpoint after process restart.~~ DONE | ~~LangGraph checkpointer~~ |
| ~~**Checkpoint forking**~~ | ~~Allow creating alternative branches from any checkpoint (for A/B testing different agent approaches on the same input).~~ DONE | ~~LangGraph time-travel~~ |
| ~~**Structured tracing**~~ | ~~OpenTelemetry-compatible trace spans: one span per phase, nested spans for agent calls, tool executions, memory operations.~~ DONE (TraceSpan model + events; OTLP export deferred to Phase 4) | ~~LangGraph + LangSmith~~ |
| ~~**Multi-level streaming**~~ | ~~Extend EventBus with structured streaming: token-level, tool-call-level, phase-level, state-level. Expose via SSE on API channel.~~ DONE (EventBus onLevel() + EventBridge level filtering) | ~~LangGraph streaming~~ |
| ~~**Replay mode**~~ | ~~Given a checkpoint ID, replay the workflow from that point with optional state overrides.~~ DONE | ~~LangGraph replay~~ |

**Definition of Done:** Workflows can be checkpointed, resumed after crash, forked, and replayed. Traces are exportable via OTLP. SSE streaming works end-to-end.

---

### Phase 2: Agent Intelligence -- COMPLETE

**Goal:** Make agent teams smarter with dynamic delegation, interruption, and self-correction. Inspired by LangGraph multi-agent patterns and CrewAI guardrails.

**Depends on:** Phase 0 (Agent Identity Standard -- supervisor/swarm modes use agent name, role, and backstory for delegation and handoff targeting).

**Rationale:** Static team assignment (planner + N workers) is limiting. Production use cases need agents that can dynamically delegate, be interrupted by humans, and validate their own outputs.

**Completed:** 2026-02-19. All 7 deliverables implemented across 4 sub-phases (2A-2D). Test count: 1476 across 110 files.

| Task | Description | Inspired By |
|------|-------------|-------------|
| **Team mode + Supervisor** | Add `mode` field to Team: `"sequential"` (default), `"supervisor"`, `"swarm"`. Supervisor mode requires `manager` field pointing to the agent identifier. Manager agent (with its name, role, goal, backstory) receives all tasks, delegates to workers by name, validates results. | LangGraph `langgraph-supervisor` |
| **Swarm pattern** | In `mode: swarm`, agents hand control to each other via a `handoff` capability. No central coordinator. Active agent tracked in team state. Agent identity (name + role) used for handoff targeting. | LangGraph `langgraph-swarm` |
| **Interrupt / Resume** | Add `interrupt()` primitive usable within any phase handler. Pauses execution, checkpoints state, emits `interrupt_requested` event. External input resumes via `Command(resume=value)`. | LangGraph `interrupt()` |
| **Task output guardrails** | Add optional `guardrail` field to Capability config (YAML). A validation function (or JSON Schema) applied to agent output before acceptance. Retry with feedback on failure, up to `guardrailRetries`. | CrewAI `guardrail` |
| **Structured outputs** | Add `outputSchema` field to Capability config. Agent responses are validated against JSON Schema. Invalid responses trigger retry with schema error feedback. | CrewAI `output_pydantic` |
| **Memory decay** | Implement time-based relevance decay on memory entries. Add `applyDecay()` to SqliteMemoryStore that reduces scores over time. Configurable decay curve. | OpenClaw FSRS-6 |
| **Memory compaction** | When memory store exceeds a configurable threshold, trigger auto-compaction: summarize older entries into compressed form, archive originals, keep summaries in active store. | OpenClaw auto-compaction |

**Definition of Done:** YAML can configure supervisor or swarm team modes. Interrupts work mid-phase. Task outputs are schema-validated. Memory decays and compacts automatically.

---

### Phase 3: Security Hardening

**Goal:** Multi-layered security suitable for multi-tenant SaaS. Inspired by PocketPaw's 7-layer model and the OpenClaw security crisis.

**Rationale:** OpenClaw's 512 vulnerabilities and 135,000 exposed instances demonstrate that security is not optional for agent frameworks. Multi-tenant SaaS has even higher stakes -- one tenant's agent must not compromise another's data.

| Task | Description | Inspired By |
|------|-------------|-------------|
| **Guardian review** | Add optional secondary LLM review for destructive operations. Before executing any capability tagged `destructive: true`, send the action + context to a reviewer model. Block if reviewer flags risk. Configurable per-tenant. | PocketPaw Guardian AI |
| **Prompt injection detection** | Two-tier detection: fast regex heuristics for known injection patterns, optional LLM-based deep scan for sophisticated attacks. Run on all user inputs before they reach the agent. | PocketPaw 2-tier scanner |
| **Encrypted secrets** | Encrypt API keys and credentials at rest using AES-256. Decrypt on-demand in memory only. Never write plaintext secrets to disk or logs. Add `kiln secrets` CLI commands for management. | PocketPaw `secrets.enc` |
| **Audit logging** | Append-only JSONL audit log for all agent actions, capability executions, memory operations, and administrative changes. Include tenant ID, timestamp, action type, and outcome. Tamper-evident via hash chaining. | PocketPaw audit logging |
| **Tenant isolation enforcement** | Harden memory namespace isolation. Add runtime assertions that prevent cross-tenant memory access. File system jail per tenant. Network policy per tenant. | Multi-tenant security best practices |
| **Self-audit daemon** | Scheduled health check that validates: secrets encryption status, audit log integrity, tenant isolation, sandbox policy compliance. Generate JSON reports. | PocketPaw self-audit |

**Definition of Done:** No capability tagged `destructive` executes without Guardian review. All user inputs are scanned. Secrets are encrypted at rest. Audit trail is tamper-evident. Tenant isolation is enforced at runtime.

---

### Phase 4: Developer Experience

**Goal:** Lower the barrier to building with Kiln. Inspired by OpenClaw's skill system and CrewAI's YAML templates.

**Rationale:** Adoption depends on time-to-first-working-agent. The current YAML format is powerful but has no starter templates, no community skill sharing, and no visual feedback.

| Task | Description | Inspired By |
|------|-------------|-------------|
| **Skill format** | Define a `SKILL.yaml` format with frontmatter (name, description, tools, triggers, tags) + instructions. Skills are directories containing the YAML + optional TypeScript handlers. Discovery: workspace > user > builtin. | OpenClaw SKILL.md |
| **Prebuilt domain kits** | Ship 5-10 domain kits as first-party packages: `@kilnai/domain-react-ts`, `@kilnai/domain-python`, `@kilnai/domain-docs`, `@kilnai/domain-support`, `@kilnai/domain-data`. Each kit includes quality gates, tool tags, examples. | Kiln domain system + CrewAI templates |
| **`kiln init` wizard** | Interactive CLI wizard: select domain, choose providers, configure channels, generate a working `app.yaml` + `gateway.yaml`. First agent running in under 2 minutes. | OpenClaw setup wizard |
| **`kiln dev` mode** | Local development server with hot-reload on YAML changes. Live event stream in terminal. Memory inspector. Phase visualizer (ASCII art in terminal). | LangGraph Studio (terminal equivalent) |
| **Web debugger** | Lightweight web UI served by the gateway in dev mode. Shows: phase machine state, task tree visualization, memory contents, event stream, cost summary. Read-only. No workflow editing. | LangGraph Studio |
| **Error messages** | Every error includes: what happened, why it happened, how to fix it. Include links to relevant documentation sections. | Rust compiler error philosophy |

**Definition of Done:** New users can go from `bun add @kilnai/core` to a running multi-agent workflow in under 5 minutes. Web debugger shows real-time workflow state.

---

### Phase 5: Ecosystem & Scale

**Goal:** Enable community growth and horizontal scaling. Inspired by marketplace patterns across competitors.

**Rationale:** OpenClaw reached 200K stars partly through its skill ecosystem. CrewAI's growth came from enterprise features. Kiln needs both community and enterprise paths.

| Task | Description | Inspired By |
|------|-------------|-------------|
| **Skill marketplace** | Registry for community-contributed skills. Content-hash verified (reuse existing marketplace security). CLI commands: `kiln skill publish`, `kiln skill install`. | OpenClaw ClawHub (minus the malware) |
| **Horizontal scaling** | Stateless gateway mode: checkpoints in shared PostgreSQL, session state in Redis. Multiple gateway instances behind a load balancer. | LangGraph Platform |
| **Agent-to-Agent protocol** | Implement Google's A2A protocol for cross-framework agent communication. A Kiln agent can delegate to an external A2A-compatible agent and vice versa. | Google A2A |
| **Webhook triggers** | External events (GitHub push, Stripe payment, custom webhook) trigger workflow execution. Define triggers in YAML. | CrewAI AMP triggers |
| **Scheduled workflows** | Cron-style scheduled workflow execution. Define schedules in YAML. | OpenClaw heartbeat, CrewAI AMP cron |
| **Visual workflow editor** | Low-code web UI for building app.yaml visually. Drag-and-drop team composition, phase ordering, gate configuration. Generates valid YAML. | CrewAI visual editor, AutoGPT Platform |

**Definition of Done:** Skills can be published and installed via CLI. Gateway can scale horizontally. External events trigger workflows.

---

## 5. Implementation Priority Matrix

```
                    High Impact
                        │
         Phase 1        │        Phase 2
     (Checkpointing,    │    (Supervisor/Swarm,
      Streaming,        │     HITL, Guardrails,
      Tracing)          │     Structured Output)
                        │
  Low Effort ───────────┼─────────── High Effort
                        │
         Phase 0        │        Phase 3
     (Error hierarchy,  │    (Guardian AI,
      Health checks,    │     Prompt injection,
      Config validation)│     Encrypted secrets)
                        │
                    Low Impact
```

Phase 4 and 5 are high-impact but depend on Phases 1-3 being solid.

---

## 6. Strategic Decisions

### Decision 1: Simplicity vs. Robustness

**Answer: Both, layered.**

OpenClaw won developer love through simplicity. LangGraph won enterprise trust through robustness. Kiln should be simple by default (YAML config, sensible defaults, minimal setup) but robust when configured (checkpointing, security layers, audit logging). Every advanced feature should be opt-in via YAML flags.

```yaml
# Simple mode (default -- works out of the box)
name: my-app
teams:
  main:
    agents:
      worker:
        tier: coding

# Robust mode (opt-in production features)
name: my-app
checkpoint:
  enabled: true
  backend: sqlite
security:
  guardian: true
  promptInjectionScan: true
  secretsEncryption: true
audit:
  enabled: true
  hashChaining: true
```

### Decision 2: Multi-Agent Model

**Answer: Support both supervisor and swarm, configured via YAML.**

LangGraph proved both patterns are needed. Supervisor is better for structured workflows (more tokens, more control). Swarm is better for exploratory tasks (less tokens, more autonomous). Let the YAML author choose.

```yaml
teams:
  research:
    mode: swarm          # agents hand off to each other
    agents: [researcher, analyst, writer]

  production:
    mode: supervisor     # manager delegates to workers
    manager:
      tier: reasoning
    agents: [implementer, tester, reviewer]
```

### Decision 3: Memory Architecture

**Answer: Keep scoped stores, add decay and compaction.**

Kiln's 5-scope memory model is already richer than any competitor. Don't replace it with flat-file Markdown (OpenClaw). Instead, enhance the existing SQLite+FTS5 stores with:
- Time-based decay (configurable curve)
- Auto-compaction when store exceeds threshold
- Cross-scope relevance search (already have in MemoryManager)

### Decision 4: Security Model

**Answer: Defense-in-depth, all opt-in.**

PocketPaw's 7-layer model is the right direction, but every layer must be opt-in to maintain Kiln's simplicity principle. Default to safe (no destructive capabilities without annotation) but don't force Guardian AI on a developer running locally.

---

## 7. Success Metrics

| Phase | Metric | Target |
|-------|--------|--------|
| 0 | Zero unhandled exceptions in gateway under load test | 100% |
| 1 | Workflow recovery after process kill | < 30s to resume |
| 1 | End-to-end trace from request to response | 100% coverage |
| 2 | Supervisor mode reduces task rework vs. static | > 30% reduction |
| 2 | Memory recall relevance after decay | > 80% precision |
| 3 | Prompt injection detection rate | > 95% on standard benchmarks |
| 3 | Zero cross-tenant data leaks under adversarial test | 100% |
| 4 | Time from install to first working agent | < 5 minutes |
| 5 | Community-published skills | > 50 in first 6 months |

---

## 8. Appendix: Competitor Lessons

### From OpenClaw (200K stars)
- **Adopt:** Simplicity wins. Readable memory files. Skill discovery. Always-on heartbeat concept.
- **Avoid:** Binding to 0.0.0.0 by default. Trusting community-submitted code without security review. 512 vulnerabilities.

### From LangGraph (25K stars, production at LinkedIn/Uber)
- **Adopt:** Checkpointing as a core primitive. Time-travel debugging. Supervisor and swarm as first-party patterns. Multi-level streaming.
- **Avoid:** Code-only graph definition (YAML is Kiln's advantage). Platform lock-in (keep self-hosted as first-class).

### From CrewAI (30K stars)
- **Adopt:** Role-based agent identity (role + goal + backstory). Task guardrails with retry. Flows for deterministic orchestration alongside autonomous crews.
- **Avoid:** Telemetry by default. Python-only. Tight coupling to ChromaDB.

### From AutoGPT (160K stars)
- **Adopt:** Sub-agent composition (agent as a block within a workflow). Event-driven triggers.
- **Avoid:** Abandoning autonomous agents entirely. Polyform Shield licensing. No declarative config format.

### From PocketPaw (small but security-focused)
- **Adopt:** Guardian AI for destructive operations. 2-tier prompt injection detection. Encrypted secrets. Audit logging with self-audit.
- **Avoid:** Abandoning YAML config. Targeting only personal-agent use case.

### From BabyAGI (archived, historical)
- **Adopt:** Iterative task decomposition (Kiln's task tree already does this better). Short planning horizon.
- **Avoid:** No stopping conditions. No tool use. Hallucination propagation.
