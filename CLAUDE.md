# Kiln - Domain-Agnostic AI Orchestration Engine

MIT-licensed. YAML-configured AI orchestration with 7 primitives (Agent, Capability, Workflow, Memory, Task, Channel, Trigger) + 3 composites (Team, Router, App). Multi-tenant gateway, 6 channel adapters, provider adapters, cross-app delegation, eval framework, enterprise safety pipeline.

## Architecture

Bun monorepo with 5 packages:

| Package | Scope | Purpose |
|---------|-------|---------|
| `packages/core` | `@kilnai/core` | Engine primitives, implementations, YAML loader |
| `packages/runtime` | `@kilnai/runtime` | Gateway server, channel adapters, triggers |
| `packages/cli` | `@kilnai/cli` | CLI commands, init wizard, dev mode |
| `packages/sdk` | `@kilnai/react` | React hooks (KilnProvider, useKilnChat, useKilnEvents, useKilnMemory, useKilnState) |
| `packages/studio` | `@kilnai/studio` | Dev UI SPA (private, served at `/studio` in dev mode) |

### Bounded Contexts

| Context | Location | Purpose |
|---------|----------|---------|
| engine | `core/src/engine/` | 7 primitives + 3 composites + YAML loader + gateway config + cron parser. Zero external deps except `yaml`. |
| orchestrator | `core/src/orchestrator/` | Phase machine, checkpoint/resume, strategies (sequential, supervisor, swarm) |
| agents | `core/src/agents/` | Provider adapters (Anthropic, OpenAI, DeepSeek, Ollama), tool cache, MCP client (Streamable HTTP, official SDK), circuit breaker, Tool RAG |
| memory | `core/src/memory/` | Scoped storage (user, agent, team, project, org), SQLite + FTS5, git sync, decay, compaction |
| tree | `core/src/tree/` | Task tree (scoring, deepen/branch/prune), batch executor |
| sandbox | `core/src/sandbox/` | Per-agent filesystem + network isolation |
| verification | `core/src/verification/` | Gate runner: test, lint, type-check loop |
| events | `core/src/events/` | EventBus (32 typed events, ring buffer), EventStore sink |
| security | `core/src/security/` | Audit log (JSONL + hash chain), prompt injection (2-tier), AES-256-GCM secrets, Guardian, self-audit |
| safety | `core/src/safety/` | PII scanner (2-tier, 6 types), content classifier (6 categories), 4 policy rails, pipeline orchestrator |
| cost | `core/src/cost/` | Per-role cache-aware cost tracking |
| knowledge | `core/src/knowledge/` | RAG: chunkers, embedding adapters, vector store, retrieval pipeline, knowledge_search auto-injection |
| domain | `core/src/domain/` | Domain config: tech stack detection, YAML schema, DomainRegistry. Built-in kits at `core/src/domains/*.yaml` |
| package | `core/src/package/` | Distribution: versioning, content hashing, security validation |
| skill | `core/src/skill/` | SKILL.yaml format, SkillRegistry (3-tier discovery) |
| eval | `core/src/eval/` | 12 scorers (6 rule + 6 LLM-as-judge), dataset loader, experiment runner, comparator |
| observability | `core/src/observability/` | OTel span mapper + exporter (EventStore sink) |
| gateway | `runtime/src/gateway/` | Multi-app loading, Mode B routes, budget middleware, delegation, dev routes, safety/security middleware |
| a2a | `runtime/src/a2a/` | Agent Card, JSON-RPC 2.0 server/client, task store |
| trigger | `runtime/src/trigger/` | TriggerRegistry, webhook handler (HMAC-SHA256), event listener, cron scheduler |
| session | `runtime/src/session/` | ModeBSession, ModeBOrchestrator, SessionRegistry |
| tenant | `runtime/src/tenant/` | TenantRegistry (JSON persistence), system prompt builder |
| channels | `runtime/src/channels/` | 6 adapters (CLI, Web, WhatsApp, Slack, API, Voice), ChannelRouter, MessageFormatter |
| sdk | `sdk/src/` | React hooks, ApiClient, SseClient. Types-only import from core. |
| studio | `studio/src/` | React 19 + Vite + TanStack Router/Query + @xyflow/react. 5 views. |

### Dependency Rules (STRICT)

1. Engine primitives have zero external dependencies -- pure TypeScript interfaces
2. Application layer depends on engine interfaces, never infrastructure
3. Infrastructure implements engine interfaces
4. No cross-context imports -- communicate via barrel exports
5. Provider SDKs ONLY in `agents/infrastructure/`
6. Channel adapters ONLY in channel implementations
7. `@kilnai/runtime` depends on `@kilnai/core` only, never reverse
8. `@kilnai/react` imports only types from `@kilnai/core` -- never implementations
9. `@kilnai/studio` depends on `@kilnai/react` + UI libs -- runtime serves its `dist/` as static files

## Commands

```bash
bun install                    # Install all workspace deps
bun run typecheck              # tsc -b (project references across all packages)
bun run test                   # Vitest all packages
```

**WARNING:** Always use `bun run test`, never `bun test`. The latter invokes Bun's built-in test runner without Vitest config, causing false failures from mock leakage.

## Quality Gates

- TypeScript: `bun run typecheck` -- zero errors
- Tests: `bun run test` -- all pass
- No `@temper` references: `grep -r "@temper" packages/` -- zero results

## Commit Format

```
type(scope): description
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

Scopes: core, engine, orchestrator, agents, domain, package, skill, memory, tree, events, cost, sandbox, verification, security, safety, observability, knowledge, eval, a2a, runtime, gateway, trigger, session, tenant, channel, cli, sdk, studio, docs

## Key Entry Points

### Core (`packages/core/src/`)

| File | Purpose |
|------|---------|
| `engine/domain/agent.ts` | Agent interface (name, role, goal, backstory, tier, tools, modalities) |
| `engine/domain/capability.ts` | Capability interface (schema, tags, annotations: cacheTtl, guardrail, outputSchema) |
| `engine/domain/workflow.ts` | Workflow interface (phases, gates) |
| `engine/domain/memory.ts` | Memory interface (5 scopes, store/recall/forget) |
| `engine/domain/task.ts` | Task interface (tree structure, statuses, actions) |
| `engine/domain/channel.ts` | Channel interface (receive/send/stream), IncomingMessage/OutgoingMessage with `ContentPart[]` |
| `engine/domain/content.ts` | ContentPart union (Text, Image, Audio, File) + helpers (textPart, textParts, extractText, hasModality) |
| `engine/domain/trigger.ts` | Trigger union (Webhook, Event, Schedule) + validateTrigger() |
| `engine/composites/app.ts` | App composite + validateApp() |
| `engine/composites/team.ts` | Team composite + validateTeam() |
| `engine/composites/router.ts` | Router composite + validateRouter() |
| `engine/loader/app-loader.ts` | YAML -> App (parseAppYaml, validateAppGraph) |
| `engine/errors.ts` | KilnError base class (55 codes) + KilnErrorCode union type |
| `engine/error-catalog.ts` | getErrorSuggestion(): context-aware suggestions + doc URLs |
| `orchestrator/orchestrator.ts` | Session lifecycle, checkpoint/resume, strategy-based execution |
| `orchestrator/phase-machine.ts` | Configurable phases + gates |
| `agents/infrastructure/anthropic.ts` | Anthropic SDK adapter (retry, streaming, structured outputs) |
| `agents/infrastructure/openai.ts` | OpenAI adapter |
| `agents/infrastructure/deepseek.ts` | DeepSeek adapter |
| `agents/infrastructure/ollama.ts` | Ollama adapter (local models) |
| `agents/mcp-client.ts` | MCP client (Streamable HTTP via official SDK, circuit breaker) |
| `agents/tool-rag.ts` | Embedding-based tool selection |
| `memory/sqlite-store.ts` | SQLite + FTS5 memory (decay, compaction, tenant namespacing) |
| `safety/safety-pipeline.ts` | PII -> content -> rails pipeline (fail-open) |
| `eval/experiment-runner.ts` | Generate outputs, score with error isolation |
| `knowledge/retrieval-pipeline.ts` | Ingest (chunk -> embed -> store) + retrieve (embed -> search -> rerank) |

### Runtime (`packages/runtime/src/`)

| File | Purpose |
|------|---------|
| `gateway/gateway-server.ts` | startGateway() + startDevServer(): Bun.serve, multi-app, Mode B, triggers, dev mode, lightweight Mode A dashboard |
| `gateway/gateway-routes.ts` | Hono app factory: health + per-App routes + A2A + webhooks |
| `gateway/mode-b-routes.ts` | POST /message, GET/DELETE /sessions |
| `gateway/delegation-handler.ts` | DelegationRegistry, executeDelegation() (Kiln-native + A2A) |
| `gateway/budget-middleware.ts` | checkBudget(), reportUsage() -- fail-open |
| `gateway/dev-routes.ts` | Dev-mode: /dev/state, /dev/events (SSE), /dev/memory, /dev/cost |
| `channels/voice-channel.ts` | STT/TTS adapter (modalities: text + audio) |
| `channels/whatsapp-channel.ts` | WhatsApp Business API webhook adapter |
| `channels/slack-channel.ts` | Slack Bot Events + Web API adapter |
| `session/session-registry.ts` | Multi-user session management + cleanup |
| `trigger/trigger-registry.ts` | Per-app lifecycle, webhook app, event listener, scheduler |
| `a2a/a2a-server-routes.ts` | Agent Card + JSON-RPC 2.0 dispatch |

### CLI (`packages/cli/src/`)

| File | Purpose |
|------|---------|
| `index.ts` | Command dispatch (init, run, dev, domain, gateway, skill, memory, config, status) |
| `commands/init.ts` | Interactive wizard: generates app.yaml + gateway.yaml |
| `commands/dev.ts` | Dev mode with YAML hot-reload |

## Documentation

See `docs/` for full documentation:

| Guide | Content |
|-------|---------|
| [Getting Started](docs/getting-started.md) | Installation, init wizard, first app |
| [Concepts](docs/concepts.md) | 7 primitives, 3 composites, YAML-first philosophy |
| [App YAML](docs/configuration/app-yaml.md) | Complete app.yaml field reference |
| [Gateway YAML](docs/configuration/gateway-yaml.md) | Gateway config, Mode A/B, billing |
| [Architecture](docs/architecture.md) | Contributor internals, TypeScript interfaces |
