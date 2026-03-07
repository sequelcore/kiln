# Kiln Stabilization Research -- Pre-Phase 8 Audit

**Version:** v0.4.0 -> v0.5.0 Planning
**Date:** 2026-03-07
**Authors:** Maria (Sequel Development Assistant), 5 parallel research agents
**Scope:** Exhaustive stabilization audit across 5 tracks, 50+ research topics, 300+ sources

---

## Executive Summary

This document is the output of Kiln's most comprehensive research phase to date. Before Phase 8 (Multi-Agent Routing) adds routing complexity on top of the engine, we must ensure every existing subsystem is production-grade. Five parallel research tracks audited the engine from different angles:

| Track | Scope | Key Finding |
|-------|-------|-------------|
| **1. Test Coverage** | 6 packages, 18 bounded contexts | 0.92-0.99 test ratios in core/runtime, but no coverage metrics configured, zero streaming tests, studio entirely untested |
| **2. Knowledge v2** | 12 RAG topics, 100+ sources | Prompt caching (-90% cost) and reranking (+18pp precision) are extreme-ROI v0.5.0 wins; GraphRAG is never-for-core |
| **3. Agentic Actions v2** | 13 tool topics, 100+ sources | Tool result caching, async tools, and OpenAPI adapter are v0.5.0 essentials; MCP marketplace is v2.0 |
| **4. Channel Hardening** | 8 adapters, 26 issues | No webhook deduplication (P0), no WebSocket heartbeat (P0), InMemory stores lose data on restart (P0) |
| **5. Security/Safety** | 10 domains, 50+ sources | No indirect injection scanning (Critical), no tool description scanning (Critical), no OTel metrics export |

### Consolidated v0.5.0 Scope (Highest ROI)

**Testing & Quality:**
- Configure `@vitest/coverage-v8` with 80% thresholds
- Add streaming tests for all 4 provider adapters
- Add adversarial/fuzz tests for prompt injection and PII
- Cover 7 zero-test files (retry.ts, deepseek.ts, conversation-event-emitter.ts, redis-session-store.ts, memory-routes.ts, events-loader.ts, gateway-server.ts)

**Knowledge Engine:**
- Prompt caching (~30 lines, -80-90% input token cost)
- Cross-encoder reranking adapter (~200 lines, +15-40% precision)
- Knowledge gap detection Phase 1 (~50 lines, operator visibility)

**Tool System:**
- Tool result caching (uses existing `cacheTtl` annotation)
- Long-running async tools (MCP Tasks spec alignment)
- OpenAPI-to-tools adapter (every competitor ships this)
- Predictive tool selection Level 1 (intent-based schema pre-loading)

**Channel Hardening:**
- Webhook deduplication on all Meta channels (TTL map by message ID)
- WebSocket heartbeat/ping + reconnection protocol
- WhatsApp media URL retry on expiration
- Persistent email thread store (SQLite)

**Security/Safety:**
- Indirect injection scanning on tool results and RAG content
- MCP tool description scanning for injection patterns
- Canary token detection for system prompt leakage
- Fail-open alerting (emit event when deep scan falls back)

**Estimated total v0.5.0 effort:** ~600-900 lines of production code + ~2000 lines of tests

---

## Table of Contents

- [Track 1: Test Coverage & Quality Audit](#track-1-test-coverage--quality-audit)
- [Track 2: Knowledge Engine v2 Research](#track-2-knowledge-engine-v2-research)
- [Track 3: Agentic Actions v2 Research](#track-3-agentic-actions-v2-research)
- [Track 4: Channel Hardening & Edge Cases](#track-4-channel-hardening--edge-cases)
- [Track 5: Security, Safety & Observability](#track-5-security-safety--observability)
- [Cross-Track Dependencies](#cross-track-dependencies)
- [Consolidated Priority Matrix](#consolidated-priority-matrix)

---


---

# Track 1: Test Coverage and Quality Audit -- Kiln v0.4.0

**Date:** 2026-03-07
**Auditor:** Maria (Sequel AI)
**Scope:** packages/core, packages/runtime, packages/cli, packages/sdk, packages/widget, packages/studio

---

## 1. Current State Assessment

### 1.1 File Counts

| Package | Source Files | Test Files | Ratio | Notes |
|---------|-------------|------------|-------|-------|
| `packages/core` | ~148 (excl. index/types) | 136 | **0.92** | Near-comprehensive |
| `packages/runtime` | ~81 (excl. index/types) | 80 | **0.99** | Near-comprehensive |
| `packages/cli` | ~20 (est.) | 17 | ~0.85 | Good coverage |
| `packages/sdk` | ~8 hooks + 2 clients | 8 | **1.0** | Full |
| `packages/widget` | ~3 core files | 2 | ~0.67 | Missing auto-loader test |
| `packages/studio` | SPA (React + Vite) | **0** | **0.0** | Zero tests |

### 1.2 Coverage Map by Bounded Context

#### packages/core

| Context | Files Tested | Files Missing Tests | Coverage Estimate | Notes |
|---------|-------------|--------------------|--------------------|-------|
| **engine/domain** | 17/17 | None | HIGH (85%+) | All primitives, trigger, cron, content, modality, safety-config, eval-config, a2a-config, tool-selection-config, knowledge-config, mcp-config tested |
| **engine/composites** | 3/3 | None | HIGH (90%+) | app, team, router all have dedicated test files |
| **engine/loader** | 3/3 | None | HIGH (85%+) | app-loader, app-loader-safety, preset-loader |
| **engine/gateway** | 8/8 | None | HIGH (85%+) | gateway-config, mode-b-config, mode-b-loader, tenant-config, delegation-config, observability-config, gateway-loader all tested |
| **engine/errors** | 2/2 | None | HIGH (90%+) | errors.ts and error-catalog.ts both tested |
| **orchestrator** | 11/11 | None | HIGH (85%+) | orchestrator, phase-machine, schemas, guardrails, interrupt, all 3 strategies, checkpoint-store, checkpoint-integration, 5 integration tests |
| **agents** | 14/14 | **retry.ts**, **deepseek.ts** (0 tests) | MEDIUM-HIGH (75%) | All major files tested (anthropic, openai-compat, ollama, mcp-client, tool-rag, tool-cache, tool-registry, provider-registry, circuit-breaker, sliding-window-rate-limiter, tool-execution-engine, tool-error-classifier, context-compressor, model-pricing, both STT adapters). **Missing: retry.ts (37 LOC), deepseek.ts** |
| **memory** | 9/9 | None | HIGH (85%+) | sqlite-store, decay-curves, compactor, chunk-importer, developer-identity, project-store, tenant-isolation, git-sync-manager, memory-manager |
| **events** | 3/3 | None | HIGH (90%+) | event-bus (ring buffer, onAny, onLevel, EventStore sink), trace. EventStore is just a 3-method interface (no impl to test) |
| **cost** | 1/1 | None | HIGH (85%+) | cost-tracker tested |
| **sandbox** | 4/4 | None | HIGH (85%+) | network-filter, path-validator, policies, tenant-sandbox |
| **verification** | 3/3 | None | HIGH (85%+) | coverage-parser, gate-runner, verification-loop |
| **security** | 6/6 | None | HIGH (90%+) | audit-log, secret-store, prompt-scanner (30+ injection patterns, 10 categories, Tier 1+2, allowlist, false positive mitigation), guardian, self-audit, annotation-authorizer |
| **safety** | 5/5 | None | HIGH (85%+) | pii-scanner, content-classifier, rails, safety-pipeline (metrics, short-circuit, redaction), tool-result-sanitizer |
| **knowledge** | 14/14 | None | HIGH (80%+) | retrieval-pipeline, source-manager, contact-memory, recursive-chunker, markdown-chunker, contextual-enricher, knowledge-capability, all infrastructure (openai-embedding, ollama-embedding, memory-vector-store, pgvector-store, file-extractor, url-extractor, pdf-extractor, json-source-store, memory-source-store, composite-extractor). Reranker is interface-only. |
| **eval** | 18/18 | None | HIGH (85%+) | All 12 scorers (6 rule + 6 LLM), composite-scorer, parse-llm-response, scorer-factory, dataset-loader, experiment-runner, experiment-comparator |
| **domain** | 6/6 | None | HIGH (85%+) | domain-registry, yaml-parser, yaml-schema, json-schema, builtin-domains, marketplace-security, domain-package-adapter |
| **package** | 3/3 | None | HIGH (85%+) | yaml-schema, yaml-parser, security |
| **skill** | 3/3 | None | HIGH (85%+) | yaml-schema, yaml-parser, skill-registry |
| **observability** | 3/3 | None | HIGH (85%+) | span-mapper, span-mapper-safety, otel-exporter |
| **presets** | 2/2 | N/A | MEDIUM (70%) | artu-preset, ehrlich-preset -- these validate YAML loading |
| **integration** | 1/1 | N/A | MEDIUM | pipeline.test.ts end-to-end |

#### packages/runtime

| Context | Files Tested | Files Missing Tests | Coverage Estimate | Notes |
|---------|-------------|--------------------|--------------------|-------|
| **gateway** | 35/37 | **gateway-server.ts**, **conversation-event-emitter.ts** | HIGH (80%+) | Comprehensive: mode-b-routes, ws-routes, ws-tenant-routes, whatsapp-webhook-routes, instagram-webhook-routes, messenger-webhook-routes, email-webhook-routes, meta-webhook-foundation, email-loop-guard, email-thread-store, message-pipeline, auth-middleware, budget-middleware, safety-middleware, security-middleware, delegation-handler, delegation-routes, handoff-routes, outbound-routes, dev-routes, dev-inspector, dev-inspector-timeline, dev-orchestrator, dev-token-store, health-registry, approval-registry, app-resolver, config-validator, trace-context, context-formatter, stt-factory, knowledge-factory, knowledge-admin-routes, contact-memory-admin-routes, tenant-admin-routes, tenant-routes, tenant-tool-factory, webhook-tool-executor. **Missing: gateway-server.ts (integration-level, ~500 LOC), conversation-event-emitter.ts (57 LOC), memory-routes.ts** |
| **session** | 10/10 | **redis-session-store.ts** (0 tests) | HIGH (85%+) | mode-b-session, mode-b-orchestrator (base + tools), session-mode, session-registry (including concurrency), session-serializer, in-memory-session-store, escalation-detector, context-summarizer. **Missing: redis-session-store.ts (~50 LOC)** |
| **channels** | 17/17 | None | HIGH (85%+) | All 8 adapters tested: cli, web, whatsapp (+api), instagram (+api), messenger (+api), slack, email (+api, template), api-channel. Plus channel-registry, channel-router, event-bridge, types, message-formatter |
| **tenant** | 4/4 | None | HIGH (85%+) | tenant-registry, encrypted-tenant-registry, system-prompt-builder, suggestion-parser |
| **trigger** | 5/5 | None | HIGH (85%+) | trigger-registry, trigger-executor, webhook-handler, event-listener, scheduler |
| **a2a** | 1/1 | None | MEDIUM (70%) | a2a-client tested |
| **utils** | 1/1 | None | HIGH | hmac tested |
| **integration** | 2/2 | N/A | MEDIUM | startup, startup-validation |

#### packages/cli

| Area | Test Files | Coverage |
|------|-----------|----------|
| commands | init, init-templates, serve, run, dev-watcher, gateway, domain, skill, memory, config, status | HIGH (80%+) |
| mcp | config-generator, transports, server | HIGH |
| ui | formatters | HIGH |
| wrapper | claude-code-process, session-manager | HIGH |

#### packages/sdk

| Area | Test Files | Coverage |
|------|-----------|----------|
| hooks | useKilnChat, useKilnWsChat, useKilnEvents, useKilnState, useApproval | HIGH |
| clients | ApiClient, SseClient | HIGH |
| context | KilnProvider | HIGH |

#### packages/widget

| Area | Test Files | Coverage |
|------|-----------|----------|
| WsClient | ws-client.test.ts | MEDIUM |
| KilnWidget | widget.test.ts | MEDIUM |
| auto-loader | **MISSING** | ZERO |

#### packages/studio

| Area | Test Files | Coverage |
|------|-----------|----------|
| ALL | **NONE** | **ZERO** |

### 1.3 Files With Zero Test Coverage

**Critical (business logic, security, or integration surface):**

1. `packages/core/src/agents/infrastructure/deepseek.ts` -- DeepSeek provider adapter (no dedicated test)
2. `packages/core/src/agents/infrastructure/retry.ts` -- Shared retry/backoff utility (37 LOC, used by all providers and STT)
3. `packages/runtime/src/gateway/gateway-server.ts` -- Main server bootstrap (~500 LOC), the integration hub
4. `packages/runtime/src/gateway/conversation-event-emitter.ts` -- Fire-and-forget webhook (57 LOC)
5. `packages/runtime/src/gateway/memory-routes.ts` -- Production memory API routes
6. `packages/runtime/src/session/redis-session-store.ts` -- Redis session persistence (~50 LOC)
7. `packages/studio/*` -- Entire Studio package (7 views: Graph, Playground, Timeline, Memory, Eval, Cost, Safety)

**Low-risk (pure types, interfaces, or covered transitively):**

8. `packages/core/src/engine/gateway/events-config.ts` -- Pure interface (7 LOC)
9. `packages/core/src/engine/gateway/events-loader.ts` -- Tiny YAML parser (41 LOC), likely covered via app-loader tests
10. `packages/core/src/engine/gateway/conversation-event.ts` -- Pure types (60 LOC)
11. `packages/core/src/knowledge/reranker.ts` -- Pure interface (7 LOC)
12. `packages/core/src/engine/domain/vector-store.ts` -- Pure interface
13. `packages/core/src/engine/domain/chunker.ts` -- Pure interface
14. `packages/core/src/engine/domain/contact-memory.ts` -- Pure interface
15. `packages/core/src/engine/domain/knowledge-source.ts` -- Pure interface
16. `packages/core/src/orchestrator/checkpoint-types.ts` -- Pure types
17. `packages/runtime/src/gateway/dev-routes-types.ts` -- Pure types

### 1.4 Qualitative Assessment of Test Quality

**Strengths:**

- **Mocking strategy is consistent and clean:** Mock providers return deterministic `AgentResponse` objects with `textParts()` helper. No real API calls.
- **Edge cases well covered in security contexts:** Prompt scanner tests 10 categories, false positive mitigation, code block severity lowering, allowlist, Tier 1/Tier 2 flow, fail-open on errors.
- **Multi-tenant isolation tested explicitly:** SessionRegistry has 8 tenant-related test cases. Memory has tenant-isolation test. Sandbox has tenant-sandbox test.
- **Event-driven testing is solid:** EventBus tests ring buffer wrapping, onAny/off, clear, EventStore sink fire-and-forget, error isolation.
- **Tool execution loop well tested:** ModeBOrchestrator tests authorization, sanitization, budget checking, per-call config (allowlist, rate limiter, additional tools), enriched events, backward compatibility.
- **Webhook routes test real Hono app instances:** WhatsApp, Instagram, Messenger, Email webhook routes all create actual Hono apps and fire HTTP requests against them.
- **Fire-and-forget patterns tested with `await setTimeout(r, 50-100)`:** Correct approach for testing background processing.

**Weaknesses:**

- **No coverage metrics configured:** No Vitest coverage plugin (c8/istanbul) in any vitest.config.ts. No CI coverage gate.
- **No snapshot testing:** None of the YAML loaders, error catalogs, or HTML templates use snapshot tests.
- **No property-based/fuzz testing:** Prompt scanner has only handcrafted patterns, no randomized input fuzzing.
- **No contract tests between packages:** core<->runtime interface compatibility is implicit (TypeScript catches type errors but not behavioral contracts).
- **No streaming tests:** All provider adapter tests use `createMessage()`. Zero tests for `streamMessage()`.
- **No concurrency stress tests:** Session registry optimistic concurrency is tested for a single conflict, but no test simulates N concurrent writes.
- **No timeout/deadline tests:** `withRetry` utility has zero tests. No tests verify tool execution timeout enforcement.
- **Studio is completely untested:** 7 views, data fetching, @xyflow/react graph rendering -- all zero tests.

---

## 2. Research Findings

### 2.1 How Leading Frameworks Test AI Agent Systems

**Vercel AI SDK** (state-of-the-art for TypeScript AI testing):
- Provides `createMockProvider` as a first-class testing primitive since SDK 3.4 (Source: [AI SDK Core: Testing](https://ai-sdk.dev/docs/ai-sdk-core/testing))
- Mock providers produce deterministic outputs, allowing unit testing of tool loops, streaming, and structured outputs without real API calls
- Kiln's mock pattern (`makeMockProvider()`) is equivalent but hand-rolled

**Google ADK** (Agent Development Kit):
- "Test agents like software" -- agents and tools are discrete objects you can mock (Source: [ADK Testing and Evaluation](https://deepwiki.com/google/adk-samples/15.3-testing-and-evaluation))
- Recommends 10-50 canonical scenario prompts with expected tool calls as regression gates
- Evaluation as first-class: every agent has an eval suite that runs before deployment

**LangChain State of Agent Engineering Report** (2025-2026):
- 59.8% use human review, 53.3% use LLM-as-judge for quality assessment (Source: [State of AI Agents](https://www.langchain.com/state-of-agent-engineering))
- 89% have observability, but only 52% have evals -- gap between monitoring and testing
- Quality is the #1 production killer (32% cite it as top barrier)

**Multi-Agent Testing Guide (Zyrix)**:
- Recommends testing each agent in isolation, then as a team, then end-to-end (Source: [Multi-Agent AI Testing Guide 2025](https://zyrix.ai/blogs/multi-agent-ai-testing-guide-2025/))
- Tool execution loops should be tested with: success path, error path, timeout, retry exhaustion, authorization denied, rate limited

### 2.2 Prompt Injection Defense Testing

**OWASP LLM01:2025** (Source: [OWASP Gen AI Security](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)):
- Prompt injection remains #1 vulnerability
- All 12 published defenses were bypassed with >90% success rate under adaptive attacks
- Recommendation: layered defense (input validation + output filtering + privilege minimization)

**Testing Implications for Kiln:**
- Current PromptScanner has 30+ heuristic patterns across 10 categories -- good foundation
- Missing: adversarial/adaptive attack test suite, obfuscation-resilient patterns (homoglyph attacks, Unicode confusables, ROT13/Caesar cipher variants)
- Missing: MCP tool-based exfiltration via "Log-To-Leak" patterns (Source: [Log-To-Leak](https://openreview.net/forum?id=UVgbFuXPaO))

### 2.3 Multi-Tenant Isolation Testing

(Source: [AWS SaaS Lens](https://wa.aws.amazon.com/saas.question.REL_3.en.html), [Multi-Tenancy Testing](https://testgrid.io/blog/multi-tenancy/)):
- Must test cross-tenant data leakage via injected tenant IDs
- Must test that shared infrastructure (session registry, orchestrator) cannot be tricked into crossing boundaries
- Kiln has: tenant-isolation.test.ts (memory), tenant-sandbox.test.ts (sandbox), SessionRegistry multi-tenant tests, but lacks: **cross-tenant API route injection tests** (e.g., Tenant A's API key accessing Tenant B's sessions)

### 2.4 Vitest Best Practices for AI Projects

(Source: [Vitest 4.0](https://www.infoq.com/news/2025/12/vitest-4-browser-mode/)):
- Vitest 4.0 introduced stable browser mode and visual regression testing
- For AI backends: prioritize fast unit tests + deterministic mocks over slow LLM calls
- Use `vi.useFakeTimers()` for time-dependent tests (Kiln already does this in session registry tests)
- Coverage should be configured via `@vitest/coverage-v8` with thresholds in CI

---

## 3. Recommendations (Ordered by Impact/Effort)

### Tier 1: Quick Wins (1-2 days, high impact)

| # | Action | Effort | Impact | Why |
|---|--------|--------|--------|-----|
| 1 | **Add coverage plugin to vitest.config.ts** (`@vitest/coverage-v8`) with `--coverage` flag and 80% threshold | 2h | Critical | Cannot measure what you do not track. No coverage metrics means no regression detection. |
| 2 | **Test `retry.ts`** (withRetry) | 1h | High | Used by every provider adapter and both STT adapters. 37 LOC, trivial to test. Exponential backoff, non-retryable errors, max retries exhaustion. |
| 3 | **Test `conversation-event-emitter.ts`** | 1h | High | 57 LOC. Tests: emit(), emitBatch(), header resolution ($ENV_VAR), fetch failure logging. |
| 4 | **Test `redis-session-store.ts`** | 2h | High | ~50 LOC. Mock `RedisLike` interface. Tests: get/set/delete/deleteByPrefix/keys, TTL calculation, key prefix. |
| 5 | **Test `events-loader.ts`** | 30m | Medium | 41 LOC. Parse valid YAML, missing events section, invalid webhook, header parsing. |
| 6 | **Test `deepseek.ts`** adapter | 2h | Medium | Same mock pattern as anthropic.test.ts. DeepSeek uses OpenAI-compatible API. |
| 7 | **Test `memory-routes.ts`** | 2h | Medium | Production memory API surface. Mock memory store, test store/recall/forget. |

### Tier 2: Structural Improvements (3-5 days, high impact)

| # | Action | Effort | Impact | Why |
|---|--------|--------|--------|-----|
| 8 | **Add streaming tests for all provider adapters** | 1d | Critical | `streamMessage()` is completely untested across Anthropic, OpenAI, DeepSeek, Ollama. This is the primary user-facing path for Mode B (chat). |
| 9 | **Add adversarial prompt injection test suite** | 1d | Critical | Current tests use known-good patterns. Add: Unicode homoglyphs, ROT13 obfuscation, multi-step indirect injection, tool-mediated exfiltration, Markdown/HTML escape attacks. Reference OWASP LLM01:2025 test vectors. |
| 10 | **Add cross-tenant API isolation integration tests** | 1d | High | Test that Tenant A's API key cannot access Tenant B's sessions, knowledge, contact memory, or handoff state. Test Mode B routes, admin routes, webhook routes. |
| 11 | **Add tool execution loop scenario tests** | 1d | High | Google ADK recommends 10-50 canonical prompts. Test: multi-round tool loops (tool calls tool calls tool), max-rounds exhaustion, mixed success/failure tool calls, tool returning non-JSON, tool timeout with retry, concurrent tool calls. |
| 12 | **Add gateway-server.ts integration test** | 1d | Medium | The integration hub. Test: multi-app loading, YAML hot-reload (dev mode), provider resolution, MCP client lifecycle, safety/security middleware wiring. Can use Hono's testClient. |

### Tier 3: Safety and Compliance (5-10 days, critical for v1.0)

| # | Action | Effort | Impact | Why |
|---|--------|--------|--------|-----|
| 13 | **Add PII scanner fuzz testing** | 2d | Critical | Property-based testing with `fast-check`. Generate random strings with injected PII patterns. Verify detection rate and false positive rate. |
| 14 | **Add GDPR compliance test suite** | 1d | Critical | Test forgetAll() across all stores (contact memory, session registry, vector store). Verify no traces remain after deletion. |
| 15 | **Add safety pipeline property tests** | 2d | High | Verify: pipeline never throws (fail-open guarantee), redacted text never leaks originals, metrics always increment monotonically. |
| 16 | **Add budget middleware exhaustion test** | 1d | High | Verify: token counting accuracy across all channels, budget check on WebSocket reconnect, concurrent budget checks don't race. |
| 17 | **Add email loop prevention exhaustive test** | 1d | Medium | Test: all RFC 3834 headers, bounced-mail patterns, vacation responders, mailing list auto-replies. Current tests cover basics but not edge cases. |

### Tier 4: Frontend Testing (5+ days, for v1.0)

| # | Action | Effort | Impact | Why |
|---|--------|--------|--------|-----|
| 18 | **Add Studio component tests** (Vitest + @testing-library/react) | 3-5d | Medium | 7 views untested. Priority: Playground (user-facing), Graph (complex @xyflow/react), Timeline (data-heavy). |
| 19 | **Add Widget auto-loader test** | 2h | Low | Test: data-* attribute parsing, script-tag insertion, Shadow DOM isolation. |
| 20 | **Add SDK hook integration tests** | 1d | Medium | Test hooks with actual Hono test server (not just mocked fetch). Verify WebSocket reconnection, SSE reconnection, error boundaries. |

---

## 4. Beyond State-of-Art: Theoretical Testing Ideas

### 4.1 LLM-as-Judge for Test Assertion

Instead of hardcoded `expect(result).toBe("mock response")`, use a deterministic LLM evaluator to assess whether agent responses meet quality criteria. This would catch behavioral regressions that exact-match tests miss. Kiln already has the eval framework with 12 scorers -- wire it into the test suite as a post-merge nightly job.

### 4.2 Chaos Engineering for Multi-Tenant Sessions

Simulate: random session expiry during tool execution, Redis connection drops mid-save, provider rate limiting during multi-turn conversations, concurrent WebSocket connections from the same user. Use Vitest's `vi.useFakeTimers()` + randomized delays.

### 4.3 Metamorphic Testing for Prompt Injection

Instead of testing fixed patterns, define metamorphic relations:
- If input X is safe, then `X + whitespace` should also be safe
- If input X is unsafe, then `toLowerCase(X)` should also be unsafe
- If input X is unsafe, then `encode(X, base64)` should also be unsafe
These catch regex escapes and encoding bypasses systematically.

### 4.4 Contract Testing Between Packages

Use Vitest + runtime type validators (e.g., Zod) to verify that:
- `@kilnai/core` barrel exports match what `@kilnai/runtime` imports
- Provider adapter responses always conform to `AgentResponse` schema
- Event bus events always have required fields per `KilnEvent` union type

### 4.5 Canary Agent Testing

Deploy a "canary tenant" in staging that receives synthetic conversations (10 per hour). Monitor: response latency p99, tool call success rate, escalation rate, PII leakage rate. Alert on deviations. This is the AI-native equivalent of synthetic monitoring.

---

## 5. Priority Matrix

### v0.5.0 (Next Release -- Stabilization)

**Must have:**
- [ ] Coverage plugin configured with 80% threshold gate (Rec #1)
- [ ] Test retry.ts, conversation-event-emitter.ts, redis-session-store.ts, events-loader.ts (Recs #2-5)
- [ ] Streaming tests for at least Anthropic adapter (Rec #8, partial)
- [ ] Cross-tenant isolation integration test for Mode B routes (Rec #10, partial)

**Should have:**
- [ ] DeepSeek adapter test (Rec #6)
- [ ] Memory-routes test (Rec #7)
- [ ] 10 canonical tool execution scenarios (Rec #11, partial)

### v1.0 (Production-Grade)

**Must have:**
- [ ] Full streaming tests for all 4 provider adapters (Rec #8)
- [ ] Adversarial prompt injection suite (Rec #9)
- [ ] Full cross-tenant isolation test suite (Rec #10)
- [ ] Complete tool execution loop scenarios (Rec #11)
- [ ] Gateway-server integration test (Rec #12)
- [ ] PII scanner fuzz testing (Rec #13)
- [ ] GDPR compliance suite (Rec #14)
- [ ] Safety pipeline property tests (Rec #15)
- [ ] Budget exhaustion tests (Rec #16)
- [ ] Studio Playground + Graph tests (Rec #18, partial)

**Should have:**
- [ ] Email loop prevention exhaustive tests (Rec #17)
- [ ] Widget auto-loader test (Rec #19)
- [ ] SDK hook integration tests (Rec #20)
- [ ] Contract tests between packages (4.4)
- [ ] Metamorphic prompt injection tests (4.3)

### v2.0+ (Never-ending / Continuous)

- LLM-as-Judge for regression detection (4.1)
- Chaos engineering for sessions (4.2)
- Canary agent monitoring (4.5)
- Visual regression testing for Studio (Vitest 4.0 browser mode)
- Performance benchmarking (tool execution latency, EventBus throughput)

---

## 6. Sources

- [LLM Orchestration Best Practices](https://orq.ai/blog/llm-orchestration) -- orq.ai
- [State of AI Agents](https://www.langchain.com/state-of-agent-engineering) -- LangChain
- [Multi-Agent AI Testing Guide 2025](https://zyrix.ai/blogs/multi-agent-ai-testing-guide-2025/) -- Zyrix
- [Evaluating AI Agents at Amazon](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-real-world-lessons-from-building-agentic-systems-at-amazon/) -- AWS
- [AI SDK Core: Testing](https://ai-sdk.dev/docs/ai-sdk-core/testing) -- Vercel
- [Google ADK Testing and Evaluation](https://deepwiki.com/google/adk-samples/15.3-testing-and-evaluation) -- DeepWiki
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) -- OWASP
- [LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) -- OWASP
- [Log-To-Leak: MCP Prompt Injection](https://openreview.net/forum?id=UVgbFuXPaO) -- OpenReview
- [Vitest 4.0 Release](https://www.infoq.com/news/2025/12/vitest-4-browser-mode/) -- InfoQ
- [AWS SaaS Lens: Multi-Tenant Testing](https://wa.aws.amazon.com/saas.question.REL_3.en.html) -- AWS
- [Multi-Tenancy Testing](https://testgrid.io/blog/multi-tenancy/) -- TestGrid
- [CoverUp: Coverage-Guided LLM Test Generation](https://arxiv.org/html/2403.16218v1/) -- arXiv
- [Testing Event-Driven Architecture](https://dev.to/royaljain/testing-event-driven-architecture-2ml1) -- DEV Community
- [Event-Driven Testing Implementation](https://oneuptime.com/blog/post/2026-01-25-event-driven-testing/view) -- OneUptime
- [AI Agents in Production 2026](https://47billion.com/blog/ai-agents-in-production-frameworks-protocols-and-what-actually-works-in-2026/) -- 47billion


---

# Track 2: Knowledge Engine v2 Research

# Knowledge Engine v2 -- Exhaustive Research Synthesis

**Date:** 2026-03-07
**Scope:** 11 research topics, 100+ sources (academic papers, engineering blogs, benchmarks, production reports)
**Purpose:** Inform architectural decisions for Kiln Knowledge Engine improvements across v0.5.0, v1.0, and v2.0
**Current baseline:** Kiln v0.4.0 -- hybrid search (vector + BM25 + RRF k=60), contextual enrichment (Anthropic pattern), halfvec HNSW, auto-inject/tool modes

---

## Table of Contents

1. [Cross-Encoder Reranking](#1-cross-encoder-reranking)
2. [Prompt Caching for RAG Context](#2-prompt-caching-for-rag-context)
3. [Semantic Query Caching](#3-semantic-query-caching)
4. [Knowledge Gap Detection](#4-knowledge-gap-detection)
5. [HyDE (Hypothetical Document Embeddings)](#5-hyde-hypothetical-document-embeddings)
6. [Late Chunking](#6-late-chunking)
7. [RAPTOR (Hierarchical Abstraction Trees)](#7-raptor-hierarchical-abstraction-trees)
8. [GraphRAG](#8-graphrag)
9. [Self-RAG / Corrective-RAG](#9-self-rag--corrective-rag)
10. [Agentic RAG Patterns](#10-agentic-rag-patterns)
11. [Frontier Research](#11-frontier-research)
12. [Priority Matrix](#12-priority-matrix)

---

## 1. Cross-Encoder Reranking

### Research Findings

**Academic:**
- Databricks (2025): reranking improves retrieval quality by up to 48% across diverse domains
- Pinecone (2025): consistent NDCG@10 improvements with cross-encoder reranking across all tested datasets
- ZeroEntropy (2025): zerank-1 delivers +28% NDCG@10 over baseline retrievers, correlating with measurably lower hallucination rates
- Agentset Reranker Leaderboard (2026): comprehensive head-to-head comparisons across 12 reranker models

**Key models evaluated:**

| Model | Type | Params | Latency (20 docs) | NDCG improvement | Cost |
|-------|------|--------|--------------------|------------------|------|
| **Cohere Rerank 4 Pro** | API | Proprietary | ~600ms | +170 ELO over v3.5, +400 ELO on finance | $2/1K searches |
| **Cohere Rerank 4 Fast** | API | Proprietary | ~300ms | Slightly below Pro | $2/1K searches |
| **zerank-1** | API | 4B | ~200ms | +28% NDCG@10 | $0.025/1M tokens |
| **zerank-1-small** | API | 1.7B | ~100ms | Competitive | $0.0125/1M tokens |
| **ms-marco-MiniLM-L6-v2** | Self-hosted | 33M | 12ms/pair, ~58ms/10 pairs | +35% accuracy | Free (open-source) |
| **Jina Reranker v3** | API/Self-hosted | Open | ~200ms | Strong multilingual | Token-based pricing |
| **Jina ColBERT v2** | API/Self-hosted | Open | Variable | +6.5% over ColBERT-v2 | CC-BY-NC 4.0 |

**Production benchmarks:**
- Cross-encoder reranking adds 50-400ms depending on candidate count and model
- Typical pipeline: retrieve 20-50 candidates, rerank to top 5-10 for LLM context
- ms-marco-MiniLM-L6-v2: 12.3ms/1 pair, 58.7ms/10 pairs, 740ms/100 pairs (CPU)
- 30-50% improvement in retrieval precision is consistently reported across studies
- zerank-1 reranking costs $0.0009/query for 75 candidates, enabling 72% total cost reduction by sending fewer tokens to the LLM

**Production recommendation from Anthropic's own contextual retrieval research:**
- Contextual retrieval + hybrid search + reranking = -67% failed retrievals (vs -49% without reranking)
- The additional -18 percentage points from reranking is the single largest remaining improvement

### Implementation Complexity: **Low-Medium**

Kiln already has a `Reranker` interface in `packages/core/src/knowledge/reranker.ts` and the `RetrievalPipeline` already calls `this.reranker.rerank()` when configured. Implementation requires:

1. `CohereReranker` adapter (~80 lines, raw fetch, no SDK dependency)
2. `CrossEncoderReranker` adapter for self-hosted ms-marco-MiniLM (~120 lines, ONNX runtime or API proxy)
3. Configuration in `app.yaml`: `knowledge.reranker: { provider: "cohere", model: "rerank-v4.0-fast" }`
4. Adjust `RetrievalPipeline.retrieve()` to over-fetch (topK * 4) then rerank to topK

No schema changes. No new bounded contexts. The interface already exists.

### Expected Impact

- **Precision:** +15-40% retrieval precision (additive to existing hybrid search)
- **Latency:** +100-400ms per query (model-dependent)
- **Cost:** $0.001-0.002/query (API rerankers) or free (self-hosted MiniLM)
- **Failed retrievals:** From -49% (current) to -67% (with reranking) -- Anthropic's own benchmark

### Recommendation: **v0.5.0 -- HIGH PRIORITY**

The interface already exists. The precision gain is the largest single remaining improvement. Cohere Rerank 4 Fast or zerank-1-small keep latency under 200ms. This is the highest-ROI improvement available.

### Beyond State-of-Art

- **Adaptive reranking depth:** Dynamically choose how many candidates to rerank based on first-pass score distribution. If top-5 scores are tightly clustered, rerank more aggressively. If there's a clear winner, skip reranking entirely.
- **Cascade reranking:** Use MiniLM (12ms) as a fast first pass to eliminate obvious non-matches, then Cohere/zerank for the surviving 10-15 candidates. Two-stage cascade with total latency under 150ms.

---

## 2. Prompt Caching for RAG Context

### Research Findings

**Anthropic prompt caching (production since 2024):**
- Cached input tokens cost 10% of normal input price (90% savings on reads)
- Cache writes cost 125% of normal input price (25% premium on first write)
- Latency reduction: up to 85% for long prompts (100K token book: 11.5s -> 2.4s)
- Up to 4 cache breakpoints per request via `cache_control` parameter
- Default TTL: 5 minutes (refreshed on each use), optional 1-hour TTL available
- SaaS customer case study: 85% cost reduction on RAG-based customer support

**OpenAI automatic caching (production since 2024):**
- Automatic for prompts >= 1024 tokens, no code changes required
- Cache hits in 128-token increments on exact prefix match
- Cached tokens: 50% discount (0.5x input price) -- less aggressive than Anthropic's 90%
- Cache expires after 5-10 minutes of inactivity
- Entire request prefix is cacheable: messages, images, audio, tool definitions, structured outputs

**Google Vertex AI (2025):**
- Similar caching model for Claude via Bedrock/Vertex
- Aligned pricing with Anthropic's native caching

**Cost model for Kiln's typical tenant:**

Assumptions: 50K token knowledge base, 100 conversations/day, Claude Sonnet

| Scenario | Daily input tokens | Daily cost | Monthly cost |
|----------|--------------------|------------|-------------|
| No caching | 100 * 50K = 5M tokens | $15.00 | $450 |
| Anthropic caching (90% hit) | 0.5M full + 4.5M cached | $2.85 | $85.50 |
| OpenAI caching (50% hit) | 0.5M full + 4.5M cached | $8.25 | $247.50 |

**Anthropic savings: ~81% cost reduction, ~$365/month saved per tenant.**

**Implementation for Kiln:**

The key insight is that Kiln already structures prompts correctly for caching:
1. System prompt (static per tenant) -- cacheable
2. Knowledge base context (changes on re-index, not per-message) -- cacheable
3. Contact memory facts (changes post-conversation) -- cacheable
4. Conversation history (changes per message) -- not cached

By placing `cache_control` breakpoints after the system prompt and after the knowledge context, Kiln gets automatic caching on the two largest prompt components.

### Implementation Complexity: **Low**

1. Add `cache_control: { type: "ephemeral" }` to system prompt content block in Anthropic adapter
2. Add second `cache_control` breakpoint after knowledge context injection
3. Ensure knowledge context is placed before conversation messages (already the case)
4. For OpenAI: no changes needed (automatic)
5. Configuration: `gateway.promptCaching: true` (default: true for Anthropic)

Approximately 30-50 lines of changes in the Anthropic provider adapter. No new interfaces, no schema changes.

### Expected Impact

- **Cost:** -80% to -90% on input tokens for Anthropic (the primary provider)
- **Latency:** -50% to -85% on first-token time for long prompts
- **Precision:** No change (same prompt content, just cached)

### Recommendation: **v0.5.0 -- HIGHEST PRIORITY**

This is the single highest-ROI change available. ~30 lines of code for 80-90% cost reduction on the largest cost line item. Should ship immediately.

### Beyond State-of-Art

- **Tiered caching strategy:** For tenants with small knowledge bases (< 200K tokens), pre-load the entire KB into the system prompt and cache it permanently. For larger KBs, cache the top-K retrieval results per query cluster. For huge KBs, cache nothing and rely on retrieval.
- **Cache warming on deploy:** When a tenant re-indexes their knowledge base, proactively send a warm-up request to establish the new cache, avoiding cold-start latency for the first real user.

---

## 3. Semantic Query Caching

### Research Findings

**Academic:**
- GPTCache (Zilliz, ACL NLP-OSS 2023): Open-source semantic cache. Converts queries to embeddings, similarity search against cached query-result pairs. Integrated with LangChain and LlamaIndex.
- "GPT Semantic Cache" (arXiv 2411.05276, Nov 2024): Formal analysis showing 40-50% latency reduction on repetitive query domains.
- "SAFE-CACHE" (Nature Scientific Reports, 2026): Addresses adversarial attacks on semantic caches, reducing attack success from 52.77% to 14.27%.
- "Krites" (arXiv 2602.13165, Feb 2026): Asynchronous verified semantic caching with tiered architecture, using off-path LLM judge for grey-zone queries.

**Production benchmarks:**
- 31% of LLM queries exhibit semantic similarity to previous requests (production analysis)
- Hybrid 3-tier caching: 87.5% cache hit rate on 100 real API calls
- Latency reduction: 40-50% on cache hits (skip embedding + vector search + LLM call)
- Cost reduction: up to 72% when combined with other optimizations
- GPTCache: 2-10x response speed improvement on cache hits
- Key challenge: static similarity thresholds fail across different query distributions; optimal threshold varies by domain

**Architecture for Kiln:**

```
User query arrives
  -> Embed query (text-embedding-3-small) -- already happening
  -> Search semantic cache (in-memory or Redis, cosine similarity)
  -> If similarity > threshold (0.95 default):
     -> Return cached retrieval results (skip vector search)
     -> Optionally return cached LLM response (skip LLM call entirely)
  -> Else:
     -> Normal retrieval pipeline
     -> Cache query embedding + results (TTL: 1 hour, max 1000 entries per tenant)
```

Two cache levels:
1. **Retrieval cache:** Cache query -> vector search results. Skip the pgvector query. Saves ~50-100ms.
2. **Response cache:** Cache query -> full LLM response. Skip everything. Saves ~2-5s. Higher risk of stale/wrong answers.

For Kiln's customer support use case, retrieval caching is safe (knowledge base changes infrequently). Response caching is risky (conversations have different context even with similar queries).

### Implementation Complexity: **Medium**

1. New `SemanticCache` interface in `core/src/knowledge/`
2. `InMemorySemanticCache` implementation (LRU + cosine similarity, ~150 lines)
3. Optional `RedisSemanticCache` for multi-instance deployments
4. Integration point: `RetrievalPipeline.retrieve()` checks cache before querying store
5. Cache invalidation on source re-index (tie to SourceManager lifecycle)
6. Configuration: `knowledge.cache: { enabled: true, threshold: 0.95, maxEntries: 1000, ttlMinutes: 60 }`

### Expected Impact

- **Latency:** -40-50% on cache hits (skip vector search); cache hit rate ~30-50% for customer support (repetitive queries)
- **Cost:** -30-50% on embedding API calls (skip re-embedding similar queries)
- **Precision:** Neutral (same results returned from cache)
- **Risk:** Stale results if knowledge base changes without cache invalidation (mitigated by TTL + re-index flush)

### Recommendation: **v1.0**

Good ROI but lower priority than reranking and prompt caching. The 30-50% of queries that hit cache are real savings, but the implementation requires careful invalidation logic and threshold tuning. Ship after the higher-priority items.

### Beyond State-of-Art

- **Adaptive threshold:** Instead of a fixed 0.95 cosine threshold, learn the optimal threshold per tenant based on their query distribution. Start at 0.95, track cache hit quality (did the user follow up with a rephrased question?), and adjust.
- **Verified caching (Krites pattern):** For grey-zone queries (0.90 < similarity < 0.95), return the cached result immediately but schedule an async verification with the LLM. If the verification disagrees, update the cache and flag the response for correction.

---

## 4. Knowledge Gap Detection

### Research Findings

**Academic:**
- "Mind the Gap: Measuring Knowledge Gaps in RAG Pipelines" (OpenReview, 2025): GapView framework evaluates whether a RAG pipeline's knowledge base provides sufficient coverage using cosine similarity between query embeddings and KB chunk embeddings, with 2D MDS projections for visual analysis.
- Llama 2 13B correctly identified unanswerable questions with 78% accuracy vs. 66% for 7B (ACL 2025).
- 70% of RAG systems still lack systematic evaluation frameworks (NStarX, 2026 industry survey).
- Integration of retrieval confidence scoring reduces irrelevant retrievals by 20% in medical RAG (MDPI 2025).

**Production patterns:**
- **Retrieval confidence scoring:** Track the top-K retrieval scores. When the best match score is below a threshold (e.g., cosine similarity < 0.5), flag the query as a potential knowledge gap.
- **Abstention detection:** Instruct the LLM to respond with a structured "I don't have information about X" when context is insufficient, then log the abstention with the original query.
- **Cluster analysis:** Periodically embed all "gap" queries and cluster them. Present clusters to operators: "15 customer questions about 'warranty extensions' had no matching KB content."
- **Coverage heatmaps:** Map queries against KB sources. Identify which sources are frequently retrieved vs. never retrieved (dead content).

**Design for Kiln:**

```
Phase 1: Passive gap detection (analytics)
  - On every retrieval, record: { query, topScore, topK scores, sourceIds matched, timestamp }
  - Flag queries where topScore < configurable threshold (default: 0.5)
  - Store in EventStore (existing infrastructure) as KNOWLEDGE_GAP event

Phase 2: Active gap analysis (operator-facing)
  - Periodic job (daily/weekly) clusters gap queries by embedding similarity
  - Surfaces clusters via admin API: GET /api/knowledge/gaps
  - Response: [{ cluster: "warranty extensions", queryCount: 15, exampleQueries: [...], suggestedAction: "Add content about warranty extension policy" }]

Phase 3: Automated suggestions (future)
  - LLM generates draft KB content for gap clusters
  - Operator reviews and approves for ingestion
```

### Implementation Complexity: **Low-Medium**

Phase 1 (passive detection) is ~50 lines -- just emit events when retrieval scores are low. Phase 2 (clustering + admin API) is ~200 lines. Phase 3 is future scope.

1. Add `minConfidenceScore` to `RetrievalPipelineConfig`
2. Emit `KNOWLEDGE_GAP` event in `RetrievalPipeline.retrieve()` when topScore < threshold
3. New admin route: `GET /api/knowledge/gaps` (aggregates gap events)
4. Periodic clustering job (uses existing embedding adapter)

### Expected Impact

- **Precision:** Indirect -- improves KB quality over time as operators fill gaps
- **Latency:** Zero (passive detection adds no latency)
- **Cost:** Minimal (clustering is periodic, not per-query)
- **Operator value:** High -- "Your KB doesn't cover these 15 common questions" is extremely actionable

### Recommendation: **v0.5.0 (Phase 1), v1.0 (Phase 2)**

Phase 1 is trivial to implement and provides immediate operator value. Phase 2 adds the intelligence layer. Both are low-effort, high-value.

### Beyond State-of-Art

- **Predictive gap detection:** Analyze query trends to predict future gaps before they become frequent. "Queries about 'holiday return policy' are increasing 3x week-over-week but your KB has no content about holiday-specific policies."
- **Auto-suggest from conversation transcripts:** When the AI agent says "I'll need to check with a human about that," extract the topic and automatically create a gap entry. No explicit abstention detection needed -- just parse the handoff patterns.

---

## 5. HyDE (Hypothetical Document Embeddings)

### Research Findings

**Academic:**
- Gao et al. (2022), "Precise Zero-Shot Dense Retrieval without Relevance Labels" (arXiv:2212.10496): Original HyDE paper. Zero-shot prompts an LLM to generate a hypothetical answer, embeds that answer, and uses it for retrieval instead of the raw query.
- HyPE (2025): Improved variant with up to +42 percentage points precision and +45 points recall on certain datasets vs. standard retrieval.
- ICLR/NeurIPS workshops (2024-2025): Multiple validation studies across domains.

**How it works:**
1. User asks: "What is the return window?"
2. LLM generates hypothetical answer: "Our return window is 30 days from the date of purchase. Items must be in original condition..."
3. Embed the hypothetical answer (not the query)
4. Search vector store with the hypothetical answer embedding
5. The hypothetical answer is closer in embedding space to actual KB chunks than the raw question

**Production benchmarks:**
- +25-60% latency increase (requires LLM call before retrieval)
- Most effective for exploratory/under-specified queries ("tell me about your policies")
- Less effective for factual/specific queries ("what is the return window for electronics?")
- Not beneficial when queries are already well-matched to document language (customer support FAQ)

**Kiln-specific analysis:**
- Kiln's primary use case is customer support, where queries are typically specific and well-formed
- The extra LLM call adds 500-2000ms latency before retrieval even begins
- Contextual retrieval (already implemented) solves the same problem from the document side: instead of making queries look like documents (HyDE), make document chunks look like queries (contextual prefixes)
- HyDE and contextual retrieval are partially redundant -- both close the query-document semantic gap

### Implementation Complexity: **Medium**

1. New `HydeRetriever` wrapper around `RetrievalPipeline` (~100 lines)
2. Requires LLM adapter dependency in knowledge pipeline (currently isolated)
3. Configuration: `knowledge.hyde: { enabled: true, model: "claude-haiku" }`
4. Integration: Replace query embedding with hypothetical-answer embedding in retrieve path

### Expected Impact

- **Precision:** +10-20% on exploratory queries, minimal on specific queries
- **Latency:** +500-2000ms (LLM call before retrieval)
- **Cost:** +$0.001-0.005 per query (LLM call for hypothesis generation)
- **Net value for Kiln:** Low -- contextual retrieval already addresses the same gap from the ingestion side

### Recommendation: **v1.0 -- LOW PRIORITY (opt-in only)**

HyDE adds significant latency for marginal benefit in Kiln's primary use case. It becomes valuable only for tenants with exploratory/complex query patterns. Ship as opt-in configuration, not default.

### Beyond State-of-Art

- **Conditional HyDE:** Only generate a hypothetical document when the raw query embedding has low confidence scores against the KB. Use the retrieval confidence from Topic 4 as the trigger. This avoids the latency penalty on queries that already match well.
- **Cached HyDE:** For repetitive query patterns, cache the hypothetical documents alongside the semantic query cache (Topic 3). Pay the LLM cost once, reuse the embedding many times.

---

## 6. Late Chunking

### Research Findings

**Academic:**
- Gunther et al. (Jina AI, 2024), "Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models" (arXiv:2409.04701, updated July 2025, published at conference):
  - Instead of chunk-then-embed (traditional) or LLM-enrich-then-embed (contextual retrieval), late chunking embeds the entire document first via a long-context embedding model, then applies chunking to the token-level embeddings.
  - Each chunk embedding naturally captures full document context because the transformer attended to all tokens before pooling.
  - +3.63% relative improvement over naive chunking (sentence boundaries)
  - Improvement increases with document length
  - Zero additional storage cost (same embedding dimensions)
  - Zero additional LLM calls (unlike contextual retrieval which costs $1.02/1M tokens)

**Late Chunking vs. Contextual Retrieval (key comparison):**

| Dimension | Late Chunking | Contextual Retrieval (Kiln's current) |
|-----------|--------------|--------------------------------------|
| Context preservation | Implicit (transformer attention) | Explicit (LLM-generated prefix) |
| Ingestion cost | Free (just embedding) | $1.02/1M document tokens (LLM call per chunk) |
| Ingestion latency | Fast (single embedding pass) | Slow (LLM call per chunk) |
| Storage overhead | None | +30-50% (prefix text stored with chunk) |
| Quality improvement | +3.6% over naive | -49% failed retrievals over naive |
| Model requirement | Long-context embedding model (8K+ tokens) | Any embedding model |
| Implementation | Requires jina-embeddings-v3 or similar | Works with text-embedding-3-small |

**Critical constraint for Kiln:** Late chunking requires a long-context embedding model (e.g., jina-embeddings-v3 with 8192 tokens). Kiln currently uses OpenAI text-embedding-3-small (8191 token limit), which technically supports the length but was not designed for late chunking's token-level pooling pattern. Late chunking is specifically designed for models trained with Jina's long-context attention patterns.

**Jina embeddings v3:**
- 570M parameters, 8192 token context, multilingual
- Outperforms text-embedding-3-small on MTEB
- Available via API or self-hosted (CC-BY-NC 4.0)
- Late chunking available natively in the API

### Implementation Complexity: **High**

1. Requires switching or adding Jina as an embedding provider
2. Late chunking requires access to token-level embeddings before mean pooling -- not available via standard embedding APIs
3. Either use Jina's API (which supports late chunking natively) or run the model locally
4. Would need a new `LateChunkingEmbedder` that takes full documents and returns per-chunk embeddings
5. Significant refactor of `RetrievalPipeline.ingest()` which currently chunks first, then embeds

### Expected Impact

- **Precision:** +3-5% improvement over naive chunking; unclear if it outperforms contextual retrieval (Anthropic pattern)
- **Ingestion cost:** Potentially eliminates the $1.02/1M token contextual enrichment cost
- **Latency:** Neutral to positive (no LLM calls during ingestion)
- **Trade-off:** Locks into Jina embedding ecosystem

### Recommendation: **v2.0 -- EVALUATE**

The improvement over contextual retrieval is not clearly demonstrated. Contextual retrieval's -49% failed retrievals is a stronger benchmark than late chunking's +3.6% relative improvement. The main appeal is cost savings on ingestion (no LLM enrichment calls), but that's an ingestion-time cost, not a per-query cost. Worth revisiting when long-context embedding models become more standardized and late chunking becomes available across providers.

### Beyond State-of-Art

- **Hybrid approach:** Use late chunking for the embedding but still prepend contextual retrieval prefixes to the stored text (for BM25 and display purposes). This would combine the embedding quality of late chunking with the text-level context of contextual retrieval, at the cost of the LLM enrichment calls.
- **Progressive context:** Embed documents at multiple granularities (paragraph, section, full document) and store all three. At query time, search across all levels and merge results. This is a middle ground between flat chunking and RAPTOR's full hierarchy.

---

## 7. RAPTOR (Hierarchical Abstraction Trees)

### Research Findings

**Academic:**
- Sarthi et al. (Stanford, ICLR 2024), "RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval" (arXiv:2401.18059):
  - Recursively embeds, clusters, and summarizes chunks to build a tree with multiple abstraction levels
  - At query time, retrieves from the tree at the appropriate level of abstraction
  - QuALITY benchmark: +20% absolute accuracy with GPT-4
  - QASPER: F-1 55.7%, +2.7 over DPR, +5.5 over BM25
  - Outperforms BM25 and DPR across all tested language models
  - Build time scales linearly with document size

- "Enhancing RAPTOR with Semantic Chunking and Adaptive Graph Clustering" (Frontiers in Computer Science, 2025):
  - Reduces required summary nodes by up to 76% through semantic-aware clustering
  - Maintains accuracy while dramatically reducing ingestion complexity

**How it works:**
```
Level 0: Raw chunks (512 tokens each)
Level 1: Clusters of 3-5 related chunks -> LLM summary of each cluster
Level 2: Clusters of Level 1 summaries -> higher-level summaries
Level 3: Root summary (entire document)

Query -> Embed query -> Search ALL levels simultaneously
  -> Low-level chunks answer specific questions
  -> High-level summaries answer broad/thematic questions
```

**When RAPTOR is worth it:**
- Long documents (50+ pages) where themes span many sections
- Multi-hop reasoning ("How does the company's return policy relate to their sustainability goals?")
- Queries requiring document-level understanding, not just passage-level

**When RAPTOR is NOT worth it:**
- Short documents (< 10 pages) -- the hierarchy is trivial
- Factual Q&A ("What is the return window?") -- flat retrieval suffices
- Customer support KBs where most queries are answered by a single passage

### Implementation Complexity: **High**

1. New `RaptorIndexer` that builds the tree: chunk -> cluster -> summarize -> recurse (~300 lines)
2. Requires LLM calls during ingestion (one per cluster, recursive)
3. Modified vector store schema to support level metadata
4. Modified retrieval to search across levels and merge results
5. Significant ingestion cost increase (LLM summarization at each level)
6. Ingestion time: 10-50x longer than flat chunking for large documents

### Expected Impact

- **Precision:** +15-20% on complex/thematic queries; minimal on factual queries
- **Ingestion cost:** 5-20x increase (LLM summarization at each tree level)
- **Ingestion time:** 10-50x increase
- **Query latency:** +20-50ms (searching additional tree levels)
- **Storage:** 2-4x increase (storing summaries at each level)

### Recommendation: **v2.0 -- OPT-IN FOR LONG DOCUMENTS**

RAPTOR's value is real but narrow. For Kiln's typical customer support use case (short-to-medium documents, factual queries), the ROI is negative. However, for tenants with long technical documentation, product manuals, or policy documents, RAPTOR could be transformative. Ship as an opt-in ingestion strategy: `knowledge.indexing.strategy: "raptor"`.

### Beyond State-of-Art

- **Lazy RAPTOR:** Instead of building the full tree at ingestion time, build Level 0 (flat chunks) immediately and construct higher levels on-demand when queries require them. Track which queries fail at Level 0 and use those failures to trigger Level 1+ construction for the relevant document clusters. This amortizes ingestion cost and only builds hierarchy where it's needed.

---

## 8. GraphRAG

### Research Findings

**Academic:**
- Microsoft Research (2024), "GraphRAG: From Local to Global" (open-sourced on GitHub):
  - Extracts entities and relationships from documents to build a knowledge graph
  - Uses Leiden algorithm for community detection
  - Generates community summaries at multiple levels
  - Achieves 72-83% comprehensiveness vs. traditional RAG
  - 3.4x accuracy improvement in enterprise scenarios

- "RAG vs. GraphRAG: A Systematic Evaluation and Key Insights" (arXiv:2502.11371, Feb 2025):
  - GraphRAG is more effective for multi-hop and reasoning-intensive questions
  - Vector RAG is sufficient for simple factual questions
  - For FAQ-style queries: RAG 94% accuracy vs. GraphRAG 95% -- nearly identical

- LazyGraphRAG (Microsoft, June 2025):
  - Reduces indexing cost to 0.1% of full GraphRAG (1000x reduction)
  - Maintains superiority on most query types even vs. vector RAG with 1M token context
  - Skips expensive upfront summarization, builds lightweight graph, does heavy lifting at query time

- KET-RAG (arXiv:2502.09304, 2025): Cost-efficient multi-granular indexing for Graph-RAG

**Production status:**
- Microsoft Discovery (Azure): GraphRAG in production for scientific research
- Precina Health: 12x faster diabetes management improvements with GraphRAG
- Cedars-Sinai: 1.6M Alzheimer's research relationships mapped

**Critical analysis for Kiln's use case (customer support KB):**

| Query type | Vector RAG accuracy | GraphRAG accuracy | Winner |
|------------|--------------------|--------------------|--------|
| Simple FAQ | 94% | 95% | **Vector RAG** (lower cost, same accuracy) |
| Multi-hop reasoning | ~60% | ~80% | **GraphRAG** |
| Relationship queries | ~50% | ~75% | **GraphRAG** |
| Typical customer support | ~85% | ~87% | **Vector RAG** (latency/cost advantage) |

GraphRAG adds 2.4x higher latency on average. The accuracy advantage is meaningful only for multi-hop and relationship queries, which are rare in typical customer support scenarios.

### Implementation Complexity: **Very High**

1. Entity extraction pipeline (LLM-based, ~500 lines)
2. Knowledge graph storage (new schema: nodes, edges, communities)
3. Community detection (Leiden algorithm implementation or library)
4. Community summarization (LLM-based, recursive)
5. Graph-aware retrieval (traverse nodes + edges)
6. Hybrid graph + vector retrieval and result merging
7. New dependencies: graph library, potentially Neo4j or similar

### Expected Impact

- **Precision:** +1-3% for typical customer support; +20-30% for multi-hop reasoning
- **Ingestion cost:** 10-100x increase (entity extraction + community summarization)
- **Ingestion time:** 50-200x increase
- **Query latency:** 2.4x increase
- **Complexity:** New bounded context, new storage backend, significant surface area

### Recommendation: **Never (for core), v2.0 (as optional plugin)**

GraphRAG is not justified for Kiln's primary use case. The cost/complexity is extreme and the accuracy improvement on typical customer support queries is marginal. If a specific tenant needs multi-hop reasoning over complex document sets, they should use a dedicated GraphRAG service (Microsoft's open-source implementation) and connect it via Kiln's tool system.

However, LazyGraphRAG's 1000x cost reduction makes it interesting as a future plugin for advanced tenants. Worth monitoring.

### Beyond State-of-Art

- **Hybrid Vector+Graph on demand:** Instead of building a full knowledge graph, use the LLM to extract entities and relationships only when a query fails vector retrieval (knowledge gap). Build the graph incrementally from gap queries, creating a "relationship index" that supplements the vector index. This is essentially LazyGraphRAG applied at the individual query level.

---

## 9. Self-RAG / Corrective-RAG

### Research Findings

**Self-RAG (Asai et al., ICLR 2024 Oral, top 1%):**
- "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection" (arXiv:2310.11511)
- Trains the LLM to emit special "reflection tokens" that decide: (a) whether to retrieve, (b) whether retrieved documents are relevant, (c) whether the generated response is supported by the context
- Self-RAG (7B, 13B) outperforms ChatGPT and retrieval-augmented Llama2 on open-domain QA, reasoning, and fact verification
- Significant gains in factuality and citation accuracy for long-form generation
- **Key limitation:** Requires fine-tuned model with reflection tokens -- cannot be used with commercial APIs (Claude, GPT-4)

**Corrective-RAG (Yan et al., 2024):**
- "Corrective Retrieval Augmented Generation" (arXiv:2401.15884)
- Lightweight retrieval evaluator assesses document quality, returns confidence: Correct / Incorrect / Ambiguous
- If Incorrect: triggers web search as fallback
- If Ambiguous: decomposes query and re-retrieves
- Decompose-then-recompose algorithm filters irrelevant information from retrieved docs
- Plug-and-play: works with any RAG pipeline (no fine-tuning required)
- Significant performance improvements on short-form and long-form generation tasks

**Kiln-specific analysis:**
- Self-RAG is not implementable with commercial LLMs (requires fine-tuning). Not applicable.
- CRAG is implementable and plug-and-play. The retrieval evaluator can be a lightweight classifier or an LLM prompt.
- CRAG's three-way decision (Correct/Incorrect/Ambiguous) maps well to Kiln's existing architecture:
  - Correct: proceed normally
  - Incorrect: fall back to broader search or report knowledge gap
  - Ambiguous: re-retrieve with query decomposition

### Implementation Complexity: **Medium-High**

Self-RAG: Not feasible (requires fine-tuned model).

CRAG:
1. Retrieval evaluator (~100 lines, LLM prompt or lightweight classifier)
2. Query decomposition for Ambiguous results (~80 lines)
3. Fallback web search for Incorrect results (optional, ~100 lines, uses existing URL extractor)
4. Integration into `RetrievalPipeline.retrieve()` as post-retrieval verification step
5. Extra LLM call per query for evaluation (~$0.001-0.003)

### Expected Impact

- **Precision:** +10-20% on queries where initial retrieval fails (estimated 15-25% of queries)
- **Latency:** +500-1500ms (LLM evaluation call + potential re-retrieval)
- **Cost:** +$0.001-0.003 per query (evaluation LLM call)
- **Net value:** Moderate -- most queries already get good results with hybrid search + contextual retrieval

### Recommendation: **v1.0 -- MEDIUM PRIORITY**

CRAG's plug-and-play nature makes it attractive, but the extra LLM call per query is a significant cost/latency addition. Best implemented as an opt-in quality mode: `knowledge.verification: "crag"`. Pair with knowledge gap detection (Topic 4) -- when CRAG flags a retrieval as Incorrect, emit a KNOWLEDGE_GAP event.

### Beyond State-of-Art

- **Confidence-gated CRAG:** Only run the CRAG evaluator when retrieval scores are in a grey zone (e.g., top score between 0.4-0.7). High-confidence retrievals (> 0.7) skip evaluation. Low-confidence (< 0.4) go directly to gap detection. This reduces LLM evaluation calls by ~60-70%.

---

## 10. Agentic RAG Patterns

### Research Findings

**Academic:**
- "Agentic Retrieval-Augmented Generation: A Survey on Agentic RAG" (arXiv:2501.09136, Jan 2025):
  - Comprehensive survey of agentic RAG patterns: reflection, planning, tool use, multi-agent collaboration
  - Agents decompose complex queries into sub-questions, dispatch them (sometimes in parallel), and combine results
  - 52% of enterprises using GenAI now run AI agents in production
  - 88% report positive ROI

- "A-RAG: Scaling Agentic Retrieval-Augmented Generation via Hierarchical Retrieval Interfaces" (arXiv:2602.03442, Feb 2026):
  - Exposes three retrieval tools to the agent: keyword_search, semantic_search, chunk_read
  - Agent adaptively selects the retrieval strategy based on query analysis
  - Enables multi-granularity evidence gathering

- "Adaptive-RAG: Dynamic Retrieval-Augmented Generation" (2025):
  - Routes queries to different retrieval strategies based on complexity
  - Simple queries: skip retrieval entirely (LLM parametric knowledge)
  - Medium queries: single-pass retrieval
  - Complex queries: iterative multi-step retrieval
  - Decision-making overhead < 1% of total FLOPs

- "Speculative RAG" (Google, ICLR 2025):
  - Small specialist LM generates multiple draft answers from different document subsets in parallel
  - Large generalist LM verifies the best draft
  - +12.97% accuracy, -50.83% latency vs. conventional RAG on PubHealth

**Kiln's current position:**
- Kiln already supports `knowledge.mode: "tool"` where the agent decides when to search
- This is basic Agentic RAG (agent-invoked retrieval)
- What's missing: query decomposition, iterative retrieval, parallel sub-queries, retrieval strategy selection

**Design for enhanced Agentic RAG in Kiln:**

```
Level 1 (current): knowledge_search tool -- agent decides IF to search
Level 2 (proposed): knowledge_search + knowledge_compare tools -- agent can compare across sources
Level 3 (proposed): query planner -- agent decomposes complex query, issues parallel sub-searches
Level 4 (future): adaptive routing -- classifier decides retrieval strategy before agent runs
```

### Implementation Complexity: **Medium (Level 2), High (Level 3-4)**

Level 2: Add `knowledge_compare` builtin tool alongside existing `knowledge_search` (~50 lines)
Level 3: Query planner requires LLM pre-processing step, sub-query dispatch, result merging (~300 lines)
Level 4: Requires query complexity classifier (LLM or trained model)

### Expected Impact

- **Precision:** +5-15% on complex multi-part queries (Level 3+)
- **Latency:** +500-2000ms for query decomposition and parallel retrieval
- **Cost:** +$0.002-0.01 per query (LLM calls for planning/decomposition)
- **Coverage:** Handles query types that currently fail (multi-hop, comparative)

### Recommendation: **v1.0 (Level 2), v2.0 (Level 3-4)**

Level 2 is a quick win -- adding a `knowledge_compare` tool is minimal effort. Level 3 (query decomposition) is the sweet spot for v2.0, as it handles the failure modes that gap detection (Topic 4) will surface. Level 4 (adaptive routing) is research-grade and should wait for the ecosystem to mature.

### Beyond State-of-Art

- **Self-improving retrieval:** When the agent's knowledge_search tool returns low-relevance results, the agent should automatically reformulate and re-search (CRAG pattern, Topic 9) without explicit orchestration. This is emergent behavior that can be prompted rather than coded.
- **Speculative retrieval:** Inspired by Google's Speculative RAG -- while the LLM is generating a response, speculatively pre-fetch documents for likely follow-up questions based on the current conversation topic. Cache these for instant retrieval on the next turn.

---

## 11. Frontier Research

### Research Findings

**Cache-Augmented Generation (CAG):**
- "Don't Do RAG: When Cache-Augmented Generation is All You Need" (arXiv:2412.15605, Dec 2024):
  - Pre-load entire knowledge base into LLM context, precompute KV-cache
  - On HotPotQA: BERTScore 0.7527 (CAG) vs. 0.7398 (dense RAG), generation time 2.33s vs. 94.35s
  - Feasible for KBs that fit in context window (Gemini: 1M tokens, Claude: 200K tokens)
  - Not a replacement for RAG on large KBs, but a powerful complement for small-to-medium ones
- CacheClip (arXiv:2510.10129, 2025): KV-cache reuse across RAG requests

**Tiered Memory Architecture (emerging consensus, 2026):**
- L1 Cache: CAG for frequent, stable, high-priority data
- L2 Storage: Vector RAG for long-tail, user-specific, or changing data
- L3 Graph: GraphRAG for relationship and multi-hop queries
- This maps well to Kiln's existing architecture: system prompt (L1), knowledge retrieval (L2), tool-based search (L3)

**Modular RAG (state of the art, 2025-2026):**
- Decompose RAG into specialized, interchangeable modules: query planner, retriever, re-ranker, generator
- Orchestrated by a central agent or controller
- Kiln's `RetrievalPipeline` is already partially modular (pluggable chunker, embedder, store, reranker, enricher)

**Multimodal RAG (early frontier):**
- Only 5% of current RAG research incorporates non-textual modalities
- Table extraction, diagram understanding, image-based retrieval are all unsolved at production quality
- Relevant for Kiln's future: product images, technical diagrams, scanned documents

**Adaptive Retrieval (2025 research frontier):**
- Not every query needs retrieval. Adaptive systems classify query complexity and route:
  - Simple: LLM parametric knowledge (no retrieval)
  - Medium: single-pass retrieval
  - Complex: multi-step agentic retrieval
- Decision overhead < 1% of total compute
- Reduces unnecessary retrieval by 30-50%, lowering costs and latency

**Privacy-Preserving RAG:**
- Federated retrieval across organizational boundaries
- Differential privacy for embeddings
- Enterprise requirement that's mostly unaddressed

### What Nobody Has Shipped Yet

1. **Continuous learning RAG:** The RAG system observes which retrieved documents actually get used by the LLM (via attention patterns or citation tracking) and re-weights future retrievals accordingly. Documents that are consistently retrieved but never cited get demoted. Documents that are cited get boosted. The retrieval index evolves without human intervention.

2. **Cross-tenant knowledge transfer:** In a multi-tenant system like Kiln, tenants in the same industry (e.g., e-commerce) likely have similar knowledge gaps. A privacy-preserving mechanism could share gap patterns (not content) across tenants: "80% of e-commerce tenants have content about returns but 0% have content about chargebacks."

3. **Retrieval-aware generation:** Instead of retrieve-then-generate, interleave retrieval and generation. As the LLM generates each sentence, check whether the next claim needs support, and retrieve in real-time. This eliminates the "retrieve everything upfront" bottleneck and enables infinite-context RAG.

4. **Embedding model ensembles:** Use multiple embedding models (OpenAI + Jina + Cohere) simultaneously and merge results via RRF, similar to how hybrid search merges vector + BM25. Each model captures different semantic aspects. No single model is optimal for all query types.

5. **Temporal-aware retrieval:** Track when each KB chunk was last updated and when the user last asked about that topic. Prioritize fresh content for returning users. Deprioritize stale content even if semantically relevant.

---

## 12. Priority Matrix

### Ordered by Impact/Effort Ratio

| Priority | Topic | Version | Effort | Impact | ROI |
|----------|-------|---------|--------|--------|-----|
| **1** | Prompt Caching (Topic 2) | **v0.5.0** | ~30 lines | -80-90% input token cost, -50-85% latency | **Extreme** |
| **2** | Cross-Encoder Reranking (Topic 1) | **v0.5.0** | ~200 lines (interface exists) | +15-40% precision, -67% failed retrievals | **Very High** |
| **3** | Knowledge Gap Detection Phase 1 (Topic 4) | **v0.5.0** | ~50 lines | Operator visibility, KB quality improvement | **High** |
| **4** | Knowledge Gap Detection Phase 2 (Topic 4) | **v1.0** | ~200 lines | Actionable gap clusters for operators | **High** |
| **5** | Semantic Query Caching (Topic 3) | **v1.0** | ~300 lines | -30-50% retrieval cost on repetitive queries | **Medium-High** |
| **6** | CRAG Verification (Topic 9) | **v1.0** | ~300 lines | +10-20% on failed retrievals | **Medium** |
| **7** | Agentic RAG Level 2 (Topic 10) | **v1.0** | ~50 lines | knowledge_compare tool | **Medium** |
| **8** | HyDE (Topic 5) | **v1.0** | ~100 lines | +10-20% on exploratory queries (opt-in) | **Low-Medium** |
| **9** | Agentic RAG Level 3 (Topic 10) | **v2.0** | ~300 lines | Query decomposition for multi-hop | **Medium** |
| **10** | Late Chunking (Topic 6) | **v2.0** | ~400 lines + provider change | Cost savings on ingestion, unclear precision gain | **Low** |
| **11** | RAPTOR (Topic 7) | **v2.0** | ~500 lines | +15-20% on long documents (opt-in) | **Low** |
| **12** | GraphRAG (Topic 8) | **Never (core)** | 1000+ lines + new infra | +1-3% on customer support, +20% on multi-hop | **Very Low** |

### v0.5.0 Release Plan (Immediate -- highest ROI)

1. **Prompt caching** -- 30 lines, 90% cost reduction. Ship first.
2. **Reranking** -- Interface exists. Add Cohere adapter. +18pp precision over current.
3. **Gap detection Phase 1** -- 50 lines. Emit events on low-confidence retrievals.

**Total effort:** ~280 lines of production code
**Total impact:** 80-90% cost reduction + 15-40% precision improvement + operator visibility

### v1.0 Release Plan

4. Gap detection Phase 2 (clustering + admin API)
5. Semantic query caching
6. CRAG verification (opt-in)
7. Agentic RAG Level 2 (knowledge_compare tool)
8. HyDE (opt-in)

### v2.0 Release Plan

9. Agentic RAG Level 3 (query decomposition)
10. Late chunking evaluation (if embedding ecosystem matures)
11. RAPTOR (opt-in for long documents)

### Never (for core Kiln)

12. GraphRAG -- too much complexity for too little gain in customer support. Monitor LazyGraphRAG.

---

## Appendix: Key Sources

### Cross-Encoder Reranking
- [ZeroEntropy -- Ultimate Guide to Reranking Models 2026](https://www.zeroentropy.dev/articles/ultimate-guide-to-choosing-the-best-reranking-model-in-2025)
- [Agentset Reranker Leaderboard](https://agentset.ai/rerankers)
- [Cohere Rerank 4.0 Changelog](https://docs.cohere.com/changelog/rerank-v4.0)
- [BSWEN -- Best Reranker Models for RAG 2026](https://docs.bswen.com/blog/2026-02-25-best-reranker-models/)
- [cross-encoder/ms-marco-MiniLM-L6-v2 on HuggingFace](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2)

### Prompt Caching
- [Anthropic -- Prompt Caching Documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [OpenAI -- Prompt Caching in the API](https://openai.com/index/api-prompt-caching/)
- [OpenAI -- Prompt Caching 201 Cookbook](https://developers.openai.com/cookbook/examples/prompt_caching_201/)
- [PromptBuilder -- Prompt Caching Guide 2025](https://promptbuilder.cc/blog/prompt-caching-token-economics-2025)

### Semantic Query Caching
- [GPTCache (Zilliz) -- GitHub](https://github.com/zilliztech/GPTCache)
- [GPT Semantic Cache -- arXiv 2411.05276](https://arxiv.org/abs/2411.05276)
- [SAFE-CACHE -- Nature Scientific Reports 2026](https://www.nature.com/articles/s41598-026-36721-w)
- [Krites -- Asynchronous Verified Semantic Caching -- arXiv 2602.13165](https://arxiv.org/html/2602.13165v1)
- [Brain.co -- Semantic Caching for RAG](https://brain.co/blog/semantic-caching-accelerating-beyond-basic-rag)

### Knowledge Gap Detection
- [Mind the Gap: Measuring Knowledge Gaps in RAG Pipelines -- OpenReview 2025](https://openreview.net/forum?id=yE9lzNc07m)
- [NStarX -- Next Frontier of RAG 2026-2030](https://nstarxinc.com/blog/the-next-frontier-of-rag-how-enterprise-knowledge-systems-will-evolve-2026-2030/)
- [DextraLabs -- Production RAG in 2025](https://dextralabs.com/blog/production-rag-in-2025-evaluation-cicd-observability/)

### HyDE
- [Gao et al. -- Precise Zero-Shot Dense Retrieval (HyDE) -- arXiv 2212.10496](https://arxiv.org/abs/2212.10496)
- [Zilliz -- Improve RAG with HyDE](https://zilliz.com/learn/improve-rag-and-information-retrieval-with-hyde-hypothetical-document-embeddings)
- [Haystack -- HyDE Documentation](https://docs.haystack.deepset.ai/docs/hypothetical-document-embeddings-hyde)
- [Coralogix -- Enhancing RAG with HyDE](https://coralogix.com/ai-blog/enhancing-rag-performance-using-hypothetical-document-embeddings-hyde/)

### Late Chunking
- [Gunther et al. -- Late Chunking -- arXiv 2409.04701](https://arxiv.org/abs/2409.04701)
- [Jina AI -- Late Chunking in Long-Context Embedding Models](https://jina.ai/news/late-chunking-in-long-context-embedding-models/)
- [Weaviate -- Late Chunking: Balancing Precision and Cost](https://weaviate.io/blog/late-chunking)
- [KX Systems -- Late Chunking vs Contextual Retrieval](https://medium.com/kx-systems/late-chunking-vs-contextual-retrieval-the-math-behind-rags-context-problem-d5a26b9bbd38)

### RAPTOR
- [Sarthi et al. -- RAPTOR -- arXiv 2401.18059 (ICLR 2024)](https://arxiv.org/abs/2401.18059)
- [Frontiers -- Enhancing RAPTOR with Semantic Chunking](https://www.frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2025.1710121/full)
- [Superlinked VectorHub -- Improve RAG with RAPTOR](https://superlinked.com/vectorhub/articles/improve-rag-with-raptor)

### GraphRAG
- [Microsoft Research -- GraphRAG Project](https://www.microsoft.com/en-us/research/project/graphrag/)
- [Microsoft -- LazyGraphRAG](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)
- [arXiv 2502.11371 -- RAG vs. GraphRAG Systematic Evaluation](https://arxiv.org/html/2502.11371v2)
- [KET-RAG -- arXiv 2502.09304](https://arxiv.org/html/2502.09304v2)
- [Meilisearch -- GraphRAG vs Vector RAG](https://www.meilisearch.com/blog/graph-rag-vs-vector-rag)

### Self-RAG / CRAG
- [Asai et al. -- Self-RAG -- arXiv 2310.11511 (ICLR 2024 Oral)](https://arxiv.org/abs/2310.11511)
- [Yan et al. -- Corrective RAG -- arXiv 2401.15884](https://arxiv.org/abs/2401.15884)
- [Kore.ai -- CRAG Overview](https://www.kore.ai/blog/corrective-rag-crag)

### Agentic RAG
- [Agentic RAG Survey -- arXiv 2501.09136](https://arxiv.org/abs/2501.09136)
- [A-RAG -- arXiv 2602.03442](https://arxiv.org/abs/2602.03442)
- [Speculative RAG (Google, ICLR 2025) -- arXiv 2407.08223](https://arxiv.org/abs/2407.08223)
- [Adaptive-RAG -- Meilisearch](https://www.meilisearch.com/blog/adaptive-rag)
- [Adaptive RAG Part 2 -- Sumit's Diary](https://blog.reachsumit.com/posts/2025/09/deciding-when-not-to-retrieve/)

### Frontier
- [Cache-Augmented Generation -- arXiv 2412.15605](https://arxiv.org/html/2412.15605v1)
- [CacheClip -- arXiv 2510.10129](https://arxiv.org/html/2510.10129v1)
- [RAG Comprehensive Survey 2026 -- arXiv 2506.00054](https://arxiv.org/abs/2506.00054)
- [Squirro -- RAG in 2026](https://squirro.com/squirro-blog/state-of-rag-genai)
- [Matryoshka Embeddings -- HuggingFace](https://huggingface.co/blog/matryoshka)


---

# Track 3: Agentic Actions v2 Research

# Phase 7: Agentic Actions v2 -- Research Synthesis

**Date:** 2026-03-07
**Scope:** 12-domain exhaustive research for Kiln's tool use v2 improvements. 100+ sources across academic papers, production systems, competitive intelligence, protocol specifications, and frontier research.
**Baseline:** Kiln v0.4.0 tool system (Phase 5 complete: 4-level auth, webhook tools, ToolRAG, rate limiter, retry/fallback, result sanitization, budget integration, tool events, MCP client, per-tenant config).

---

## Table of Contents

1. [Priority Matrix](#1-priority-matrix)
2. [Tool Composition Pipelines](#2-tool-composition-pipelines)
3. [Predictive Tool Selection](#3-predictive-tool-selection)
4. [Universal API Adapter (OpenAPI to Tools)](#4-universal-api-adapter)
5. [Wasm/Extism Sandboxing](#5-wasmextism-sandboxing)
6. [MCP Marketplace Infrastructure](#6-mcp-marketplace-infrastructure)
7. [Tool Result Caching](#7-tool-result-caching)
8. [Composable Authorization / Trust Escalation](#8-composable-authorization)
9. [Runtime Tool Synthesis](#9-runtime-tool-synthesis)
10. [Long-Running Async Tools](#10-long-running-async-tools)
11. [Computer Use / Browser Automation](#11-computer-use--browser-automation)
12. [Competitive Analysis](#12-competitive-analysis)
13. [Frontier Research](#13-frontier-research)

---

## 1. Priority Matrix

| # | Feature | Complexity | Impact | Risk | Recommendation | Dependencies |
|---|---------|-----------|--------|------|----------------|-------------|
| 7 | Tool Result Caching | LOW | HIGH | LOW | **v0.5.0** | None -- uses existing `cacheTtl` annotation |
| 10 | Long-Running Async Tools | MEDIUM | HIGH | MEDIUM | **v0.5.0** | MCP Tasks spec alignment |
| 4 | Universal API Adapter (OpenAPI) | MEDIUM | HIGH | LOW | **v0.5.0** | None -- parser + tool generator |
| 3 | Predictive Tool Selection (Level 1) | LOW | MEDIUM | LOW | **v0.5.0** | ToolRAG exists |
| 8 | Composable Authorization | MEDIUM | HIGH | MEDIUM | **v1.0** | NIST standards stabilization |
| 2 | Tool Composition Pipelines | HIGH | MEDIUM | MEDIUM | **v1.0** | OpenAPI adapter, caching |
| 5 | Wasm/Extism Sandboxing | HIGH | MEDIUM | HIGH | **v1.0** | Wassette maturity, marketplace |
| 11 | Computer Use / Browser | MEDIUM | MEDIUM | HIGH | **v1.0** | Provider-specific (Anthropic, OpenAI) |
| 6 | MCP Marketplace | VERY HIGH | HIGH | HIGH | **v2.0** | MCP Registry, billing infra |
| 9 | Runtime Tool Synthesis | HIGH | LOW | VERY HIGH | **v2.0** | Sandbox, guardrails, approval |
| 3b | Predictive Selection (L2-3) | HIGH | MEDIUM | MEDIUM | **v2.0** | Production data, eval framework |
| 2b | Declarative DAG Pipelines | VERY HIGH | MEDIUM | HIGH | **v2.0** | Composition foundation |

### Recommended v0.5.0 Scope (4 features)

1. **Tool Result Caching** -- Lowest risk, highest ROI. Uses existing `cacheTtl` annotation.
2. **Long-Running Async Tools** -- Aligns with MCP Tasks spec (2025-11-25). Production-blocking gap.
3. **Universal API Adapter** -- OpenAPI 3.x to tools. Every competitor ships this (Bedrock, ADK, Semantic Kernel).
4. **Predictive Tool Selection Level 1** -- Intent-based schema pre-loading. Engineering, not research.

---

## 2. Tool Composition Pipelines

### Research Findings

**LangGraph (v1.0, Sep 2025):** DAG-based orchestration with StateGraph maintaining context. Nodes are agents/functions, edges dictate data flow. Conditional edges evaluate state for routing. Supports parallel branches + acyclicity enforcement. LangGraph 1.0 is now production-ready at major enterprises.

**Airflow AI SDK (2025):** Dynamic task mapping with Aryn AI, Weaviate. Creates RAG pipelines via DAGs with human-in-the-loop steps. Multi-agent orchestration integrates Kafka for inter-agent communication.

**Academic (arXiv:2512.08769):** "A Practical Guide for Designing, Developing, and Deploying Production-Grade Agentic AI Workflows" advocates for explicit DAG declarations over pure LLM-driven sequencing to reduce hallucination in data plumbing.

**Key pattern:** The industry separates "what to do" (LLM decides) from "how to connect" (declared in code/config). Tool pipelines present as a single composite tool to the LLM; the orchestrator expands into the DAG at execution time.

### Implementation Complexity for Kiln: HIGH

- New `ToolPipeline` composite type in engine
- JSONPath-style data transformation between steps (`$.prev.field`, `$.steps.stepName.field`)
- Conditional execution (`condition: "$.prev.amount > 0"`)
- Parallel branch support with join semantics
- Pipeline validation at YAML load time (cycle detection, schema compatibility)
- Pipeline-as-tool registration (single tool facade to LLM)

### Expected Impact: MEDIUM

Reduces context pollution (one tool call vs. 3-5 sequential), eliminates hallucination in data plumbing between steps, enables testable/auditable multi-step operations. Primary value for Kilvo product-layer workflows.

### Recommendation: v1.0

Phase v0.5.0 should ship the OpenAPI adapter first (Topic 4), which generates the atomic tools that pipelines compose. Full DAG pipelines are v1.0 scope. A simpler "sequential chain" (linear pipeline, no branching) could ship in v0.5.0 as a stepping stone if demand emerges.

### Beyond State-of-Art

**Adaptive pipelines:** The LLM can propose modifications to an existing pipeline's data mappings at runtime (not structure, just field transforms). The orchestrator validates the proposed mapping against output schemas before executing. This bridges the "fully declared" and "fully agentic" approaches.

---

## 3. Predictive Tool Selection

### Research Findings

**Speculative Actions (arXiv:2510.04371):** A lossless framework that predicts likely next actions using faster/smaller models, executing multiple steps in parallel. Achieves up to 55% accuracy in next-action prediction, translating to significant latency reductions.

**Speculative Tool Calling (incident.io, 2025):** Production implementation that speculatively calls tools before LLM prompts explicitly request them. Uses a "write barrier" to block writes while determining if the call is genuine. Regularly saves 2-3 seconds per interaction (~50% latency reduction).

**Tool Cache Pattern (arXiv:2512.15834):** Engine-side speculative approach maintains a tool cache; the client spawns multiple speculative model instances and launches tools asynchronously, submitting results indexed by normalized keys.

**FunctionGemma (Google, 2025):** 270M parameter model for on-device function calling -- demonstrates that tool selection can be delegated to lightweight models, enabling speculation without full LLM inference.

### Implementation Complexity for Kiln

| Level | Complexity | Description |
|-------|-----------|-------------|
| 1: Intent-based pre-loading | LOW | Classify user intent via lightweight model or keyword matching. Pre-warm relevant MCP connections, pre-compute ToolRAG subset. |
| 2: Conversation-arc prediction | MEDIUM | Train/fine-tune small model on session histories to predict next 2-3 tools. Requires production data. |
| 3: Speculative execution | HIGH | Auto-execute `readOnly: true` tools in background. Present results as pre-fetched context. Write barrier for non-readOnly tools. |

### Expected Impact

Level 1: 20-30% latency reduction for MCP-heavy tenants (connection pre-warming). Level 2-3: 40-55% latency reduction per speculative action research. Cost neutral for Level 1; Levels 2-3 add speculative compute.

### Recommendation

- **v0.5.0:** Level 1 only. Wire ToolRAG to pre-select tool schemas before the LLM round. Pre-warm MCP connections for likely tools based on session context.
- **v2.0:** Levels 2-3. Require production telemetry and eval framework maturity.

### Beyond State-of-Art

**Predictive ToolRAG Warm Path:** Before the user's message reaches the LLM, run intent classification (lightweight model or embedding similarity) against recent session context. Feed only predicted-relevant tool schemas to the LLM. This is a "warm path" optimization that sits between ToolRAG (reactive) and full speculation (proactive).

---

## 4. Universal API Adapter (OpenAPI to Tools)

### Research Findings

**Google ADK OpenAPIToolset:** Production-grade. Parses OpenAPI 3.x spec, generates one `RestApiTool` per operation. Tool name from `operationId` (snake_case, max 60 chars). Tool description from `summary`/`description`. Handles HTTP request execution automatically. Supports auth injection (OAuth, API key, bearer).

**Amazon Bedrock Action Groups:** OpenAPI schema + Lambda function per action group. Quick-create Lambda from schema. Auto-generates tool schemas from spec. In production at enterprise scale.

**Microsoft Semantic Kernel:** `add_plugin_from_openapi()` method. Accepts spec content or URL. Auto-generates function tools. Supports OpenAI plugin format as well. Production-ready across C#, Python, Java.

**Composio:** 850+ pre-built connectors. Universal MCP (Rube) for 600+ apps. Handles auth, tool search, context management, sandboxed execution. Monetized platform.

**openapi-llm (Haystack):** Open-source library specifically for converting OpenAPI specs to LLM tool/function definitions. Supports invocation.

**Academic (arXiv:2601.12735):** "OpenAI for OpenAPI" -- LLM-based generation of OpenAPI specs achieves 98% F1 for endpoint inference, 97% for parameter inference. Reverse direction (spec generation) is also viable.

### Implementation Complexity for Kiln: MEDIUM

```
packages/core/src/agents/openapi-adapter.ts
```

1. Parse OpenAPI 3.x spec (use `yaml` -- already a dependency)
2. For each operation: extract `operationId`, `summary`, parameters, requestBody schema
3. Generate `ToolDefinition` with JSON Schema from the OpenAPI parameter/body schemas
4. Generate executor function: construct HTTP request from tool call inputs, inject auth
5. Register as tools on the orchestrator (same path as webhook tools)

Key decisions:
- Auth injection: support API key (header/query), Bearer token, OAuth 2.0 client credentials
- Parameter mapping: path params, query params, headers, request body -> single flat JSON Schema input
- Response mapping: extract JSON body, apply optional JSONPath selector for result truncation

### Expected Impact: HIGH

This is the single most requested feature in agent frameworks. Every competitor ships it. Eliminates the need for manual webhook tool definitions for standard REST APIs. Tenant provides an OpenAPI spec URL and auth credentials; Kiln generates all tools automatically.

### Recommendation: v0.5.0

Ship as `OpenAPIToolset` in `packages/core/src/agents/`. Design decisions:

- **Parse at gateway startup** (not per-request). Cache generated tools.
- **Spec validation** at load time. Reject specs with unsupported auth types.
- **Tool naming**: `operationId` if present, else `{method}_{path_segments}` (snake_case).
- **Per-tenant**: TenantConfig gains `openApiSpecs: [{ url, auth, prefix }]` field.
- **Limit**: Cap at 100 generated tools per spec (fail with clear error above that).

### Beyond State-of-Art

**Bidirectional OpenAPI:** Not just "spec to tools" but "tool usage to spec." Track which generated tools tenants actually use and with what parameters. Auto-prune unused operations from the tool set after N days. Feed usage analytics back for spec optimization.

---

## 5. Wasm/Extism Sandboxing

### Research Findings

**Microsoft Wassette (Aug 2025):** Security-oriented MCP server built on Wasmtime. Runs WebAssembly Components with deny-by-default permissions. Fetches Wasm from OCI registries. Auto-discovers typed interfaces and exposes them as MCP tools. Written in Rust, zero runtime dependencies. Already supported by Claude Code, Cursor, VS Code Copilot.

**NVIDIA Technical Blog (2025):** Comprehensive guide on sandboxing agentic AI with Wasm. Recommends Pyodide (CPython in Wasm) for Python tools. Network egress controls + filesystem write blocks. Cost-effective with host/user isolation.

**Extism:** Wasm plugin framework with capability-scoped execution. PDKs for JS, Python, Rust, Go. Sub-millisecond startup. Capability-based security aligned with least privilege.

**MVVM (arXiv:2410.15894):** Wasm-based secure container that live-migrates agent workspaces between edge and cloud. End-to-end privacy via Wasm isolation.

**AgentMesh (GitHub):** Production framework using Wasm sandboxing for multi-agent tool execution. Documents patterns for capability-scoped untrusted code execution.

**Comparison Matrix:**

| Technology | Startup | Memory | Language Support | MCP Integration | Maturity |
|-----------|---------|--------|-----------------|----------------|----------|
| Wassette (Microsoft) | ~10ms | Low | Any Wasm Component | Native MCP server | Early (v0.3.4) |
| Extism | Sub-ms | Low | JS, Python, Rust, Go, + | Via host functions | Stable |
| Pyodide (NVIDIA) | ~500ms (cold) | Higher | Python only | Custom | Stable |
| Deno (Permission) | ~50ms | Medium | JS/TS | Custom | Stable |
| gVisor | ~100ms | Medium | Any (container) | Custom | Production |

### Implementation Complexity for Kiln: HIGH

Two viable paths:

**Path A: Wassette integration.** Kiln connects to Wassette as an MCP server. Wassette handles Wasm execution. Kiln's existing MCP client works unchanged. Lowest implementation effort but adds external dependency (Rust binary).

**Path B: Extism embedding.** Use Extism's JavaScript SDK to run Wasm plugins in-process. More control, no external binary, but must build the MCP-to-Wasm bridge ourselves.

**Path C (recommended): Hybrid.** Support Wassette as an MCP server (zero effort, already works). Add Extism for lightweight in-process plugins when the marketplace ships.

### Expected Impact: MEDIUM

Primary value is security for third-party tool code (marketplace scenario). Without a marketplace, Kiln's current isolation model (webhook tools = external HTTP, MCP tools = circuit breaker, built-in tools = trusted code) is sufficient.

### Recommendation: v1.0

Not needed until the marketplace (Topic 6) ships or tenants demand third-party tool code execution. When ready:
1. Wassette as MCP server (zero implementation, just documentation)
2. Extism in-process for the plugin SDK

### Beyond State-of-Art

**Capability Attestation:** Wasm components declare their required capabilities (network, filesystem, secrets) in a manifest. Kiln validates the manifest against the tenant's security policy before loading. If a tool requests network access but the tenant's policy forbids it, the tool is rejected at load time -- not at runtime.

---

## 6. MCP Marketplace Infrastructure

### Research Findings

**Current State (Q1 2026):**
- 17K+ MCP servers in directories (LobeHub, MCP Market, Smithery, PulseMCP, Glama)
- **No commercial marketplace with billing, SLAs, or quality certification exists yet**
- Microsoft MCP Server Certification is the closest to quality gates
- Official MCP Registry under development (centralized API layer for discovery)
- MCP donated to Linux Foundation AAIF (Dec 2025) -- standardization accelerating

**Emerging Monetization Models:**
- **Pay-per-event** (Apify): Developer earns per tool invocation
- **Subscription** (MCPize): Monthly plans for premium tools
- **Usage-based** (Moesif): Metered billing per API call through MCP
- **Freemium** (21st.dev): Free tier + premium with support/SLAs
- Marketplaces need 12-18 months to build supply + demand before sustainability

**Quality Certification:**
- Microsoft MCP Server Certification: security, reliability, compliance checks
- Server Cards (`.well-known/mcp.json`): planned for next MCP spec (~2026-06). Pre-connection discovery of server capabilities, auth requirements, and metadata
- No standardized quality scoring or SLA framework exists

**Infrastructure Requirements:**
- Registry API (discovery, versioning, metadata)
- Billing gateway (metering, invoicing, revenue split)
- Sandbox runtime (Wassette/Extism for untrusted tools)
- CI/CD pipeline for server validation
- Monitoring + SLA enforcement

### Implementation Complexity for Kiln: VERY HIGH

A full marketplace is a product, not a feature. Minimum viable marketplace:
1. Curated directory (hand-approved MCP servers)
2. Per-tenant MCP server allowlist in TenantConfig
3. Connection pooling + health monitoring for approved servers
4. Usage metering via existing EventBus
5. Billing integration (Stripe, delegated to Kilvo)

### Expected Impact: HIGH (long-term)

The marketplace gap is the biggest commercial opportunity in the MCP ecosystem. First mover with quality certification + billing has significant platform lock-in potential. However, timing is premature -- the ecosystem needs the official MCP Registry and Server Cards spec first.

### Recommendation: v2.0

- **v0.5.0:** Ship per-tenant MCP server allowlist + connection health monitoring
- **v1.0:** Curated directory with quality badges (security scan, uptime tracking)
- **v2.0:** Full marketplace with billing, developer portal, SLA enforcement

### Beyond State-of-Art

**Agent-Scored Tool Quality:** After every tool invocation, the orchestrator records success/failure, latency, and result quality (via lightweight LLM-as-judge score). Aggregate scores across tenants to build a "tool quality index" that feeds back into the marketplace ranking. No human review needed -- the agents themselves rate the tools through usage.

---

## 7. Tool Result Caching

### Research Findings

**Hierarchical Caching (MDPI, 2025):** Multi-level architecture that captures redundancy at workflow and tool levels. Category-specific TTL policies: weather (1800s), location (600s), database (300s), computation (1800-3600s for deterministic). Dependency-aware invalidation using graph-based techniques.

**Agentic Plan Caching (NeurIPS 2025, arXiv:2506.14852):** Reduces agent serving costs by 50.31% and latency by 27.28% while maintaining 96.61% of optimal performance. Extracts plan templates from completed executions, uses keyword retrieval for matching. Lightweight overhead (1.04% of total cost).

**ToolUniverse Cache System:** Production cache with TTL, LRU eviction, cache key from tool name + serialized input. Clear documentation of cache hit/miss metrics.

**Redis Semantic Caching:** Embedding-based similarity search for cache lookups. Reuses responses across semantically similar queries. Different from exact-match caching -- catches paraphrased but equivalent tool calls.

**Key Research Insight:** Existing LLM caching (prompt caching, semantic caching) is insufficient for agents because tool outputs depend on external state. Tool-level caching must be separate from LLM-level caching, with explicit TTL policies per tool category.

### Implementation Complexity for Kiln: LOW

Kiln already has `cacheTtl` in `CapabilityAnnotations`. Implementation:

```typescript
// In ModeBOrchestrator, before executing a tool:
const cacheKey = `tool:${toolName}:${hashInput(input)}`;
const cached = await toolCache.get(cacheKey);
if (cached && !isExpired(cached, capability.annotations?.cacheTtl)) {
  return cached.result; // Skip execution
}
// After execution:
if (capability.annotations?.cacheTtl) {
  await toolCache.set(cacheKey, { result, timestamp: Date.now() });
}
```

Components needed:
1. `ToolResultCache` interface (get/set/invalidate/clear)
2. `InMemoryToolResultCache` implementation (LRU with TTL)
3. Cache key generation: `sha256(toolName + JSON.stringify(sortedInput))`
4. Wire into `ModeBOrchestrator` tool execution loop
5. Per-tool TTL from existing `cacheTtl` annotation
6. Cache hit/miss metrics via EventBus

### Expected Impact: HIGH

- **Cost reduction:** 30-50% fewer tool executions for read-heavy workloads (lookup_order, check_inventory, search_products called repeatedly with same params)
- **Latency reduction:** Cached results return in <1ms vs. 100ms-30s for webhook/MCP tools
- **Token savings:** Fewer tool loop rounds = fewer LLM calls per session
- **Safety:** Only cache `readOnly: true` or explicitly `cacheTtl > 0` tools. Never cache `destructive` tools.

### Recommendation: v0.5.0

Lowest risk, highest ROI feature in this research. The annotation already exists; the implementation is a thin caching layer in the orchestrator. Ship with:
- In-memory LRU cache (per-session or global with tenant namespacing)
- TTL from `cacheTtl` annotation (seconds)
- Cache bypass for `destructive: true` tools
- `tool_cache_hit` event on EventBus
- `/dev/cache` endpoint in dev mode for inspection

### Beyond State-of-Art

**Semantic Tool Cache:** Instead of exact input matching, use embedding similarity for cache lookups. "What's the status of order ABC-123?" and "Check order ABC-123 status" produce the same cache hit. Requires embedding computation on cache lookup, so only viable for high-latency tools where the embedding cost (5-10ms) is negligible vs. tool execution time (100ms+).

---

## 8. Composable Authorization / Trust Escalation

### Research Findings

**NIST AI Agent Identity (Feb 2026):** Concept paper "Accelerating the Adoption of Software and AI Agent Identity and Authorization" proposes standards for agent identification, authentication, and authorization. Covers OAuth 2.0/2.1 extensions, OpenID Connect, SPIFFE/SPIRE, SCIM, NGAC. References SP 800-207 (Zero Trust), SP 800-63-4 (Digital Identity). Comment period open through April 2, 2026.

**NIST AI Agent Standards Initiative (Feb 2026):** Broader initiative for interoperable and secure AI agents. Explicitly references MCP as a candidate for integrating security controls. Focuses on privilege escalation mitigation, human supervision, and accountability structures.

**Microsoft FIDES (May 2025):** Information-flow labels (confidentiality + integrity) on all data. Policies enforce label checks before tool execution. Stopped 100% of policy-violating attacks in AgentDojo benchmark. Deterministic, not probabilistic.

**Composio Auth Model:** Handles authentication per-tool. Manages OAuth flows, API keys, and bearer tokens across 850+ integrations. Authentication is the #1 integration pain point -- universal auth handling is the real value.

**Production Pattern (Sierra, Intercom):** Progressive trust based on user verification status. Anonymous users get FAQ/search tools. Verified users (order number, email match) get order management tools. Authenticated users (OAuth, SSO) get account modification tools.

### Implementation Complexity for Kiln: MEDIUM

Extend existing `ToolAuthorizer` with trust levels:

```yaml
# In app.yaml
trust:
  levels:
    anonymous:
      tools: [search_faq, view_products]
    identified:
      requires: provide_identifier  # e.g., order number, email
      tools: [lookup_order, track_shipment]
    verified:
      requires: verify_identity     # e.g., email code, SMS OTP
      tools: [update_address, request_return]
    authenticated:
      requires: oauth_flow          # External auth
      tools: [process_refund, cancel_order, delete_account]
```

Components needed:
1. `TrustLevel` type in engine domain
2. `TrustLadder` config in app YAML (levels + required escalation actions)
3. `SessionTrustState` on ModeBSession (current trust level)
4. Trust check in `ToolAuthorizer` before each tool call
5. Escalation tools (verify_email, oauth_redirect) as built-in capabilities
6. Trust level persistence in session store

### Expected Impact: HIGH

Critical for Kilvo's customer service use case. Without trust escalation, every conversation starts with full tool access (security risk) or minimal access (poor UX). The trust ladder balances both.

### Recommendation: v1.0

Wait for NIST standards to stabilize (comment period closes April 2026, final guidance expected H2 2026). Ship basic version in v1.0 with:
- Static trust levels in app YAML
- Session-level trust state
- Manual escalation (agent asks user to verify)
- OAuth integration for authenticated level

**v0.5.0 stepping stone:** Add `requiredTrustLevel` field to `CapabilityAnnotations`. The `ToolAuthorizer` checks it against the session's current trust level. Simple field, no ladder -- just a gate.

### Beyond State-of-Art

**Behavioral Trust Scoring:** Beyond identity verification, track conversation behavior patterns. Users who attempt prompt injection, rapid-fire destructive tool calls, or unusual patterns get their trust level downgraded mid-session. This is a "dynamic trust surface" rather than a static ladder.

---

## 9. Runtime Tool Synthesis

### Research Findings

**LATM (Google DeepMind, 2023; still cited 2025-2026):** Two-phase framework: (1) capable LLM creates reusable Python tools, (2) lighter LLM uses them. Performance matches GPT-4-for-everything at fraction of the cost. Tools are cached as Python utility functions.

**ToolMaker (ACL 2025, KatherLab):** Transforms GitHub repos into LLM-compatible tools autonomously. Two-stage: environment setup + tool implementation. Closed-loop self-correction. 80% success rate on implementation tasks. Substantially outperforms current software engineering agents.

**"LLM Agents Making Agent Tools" (arXiv:2502.11705, May 2025):** Agents that create, test, and register new tools from task descriptions. 180 training samples achieve comparable results to pre-defined tool sets.

**Security Concerns (CSA, NVIDIA, 2025):**
- 12-65% of LLM-generated code contains security vulnerabilities
- Runtime code execution turns prompt injection into RCE (Remote Code Execution)
- Second-order prompt injection: low-privilege agents trick high-privilege agents
- AgentSpec (ICSE 2026): customizable runtime enforcement via probabilistic model checking

**Mitigation Requirements:**
- Mandatory sandbox (Wasm/container) for generated code
- Static analysis before execution (AutoSafeCoder reduces vulnerabilities by 13%)
- Feedback-driven patching reduces vulnerability rate from 40.2% to 7.4%
- Human approval for tool registration (never auto-register destructive tools)
- Capability attestation (generated tool declares required permissions)

### Implementation Complexity for Kiln: HIGH

1. Tool generation prompt (LLM writes tool definition + implementation)
2. Static analysis pass (security scan, schema validation)
3. Sandbox execution (Wasm/Extism -- requires Topic 5)
4. Human approval gate (extends existing ApprovalGateRegistry)
5. Tool registry (persistent storage of generated tools for reuse)
6. Versioning + rollback (generated tools can regress)

### Expected Impact: LOW (near-term), MEDIUM (long-term)

The research is compelling but the security risks are severe. Generated tools are a liability without robust sandboxing. The LATM cost-reduction argument weakens as models become cheaper. Primary value is flexibility -- agents can adapt to novel tasks without pre-defined tools.

### Recommendation: v2.0 (at earliest)

Prerequisites:
1. Wasm sandboxing (Topic 5) must be production-stable
2. Static analysis pipeline must be proven
3. Human approval flow must be battle-tested
4. Eval framework must be able to assess generated tool quality

**Never ship auto-registered destructive generated tools.** Generated tools start as `readOnly: true` and require manual promotion to higher trust levels.

### Beyond State-of-Art

**Constrained Synthesis:** Instead of free-form code generation, the agent generates a "tool template" that maps to a constrained DSL (e.g., HTTP request builder, JSONPath transformer, conditional brancher). The DSL is safe-by-construction -- no arbitrary code execution. This trades flexibility for safety.

---

## 10. Long-Running Async Tools

### Research Findings

**MCP Tasks (Spec 2025-11-25):** Experimental primitive with 5-state lifecycle: `working`, `input_required`, `completed`, `failed`, `cancelled`. Terminal states are immutable. Client-side polling via `tasks/get`. Poll interval specified in task response. Result retrieval via `tasks/result` (distinct from initial `CreateTaskResult`). Any MCP request can become "call-now, fetch-later."

**WorkOS Blog (2025):** "MCP Async Tasks" guide details the requestor/receiver pattern. Requestor creates task, decides polling strategy. Receiver accepts, executes, and owns lifecycle. Protocol is requestor-driven for statelessness.

**AWS Bedrock AgentCore (2025):** Long-running MCP servers on Bedrock with Strands Agents integration. Production pattern for enterprise async workflows.

**Agentfield (2025):** Async Execution & Webhooks pattern. Client registers callback URL during task creation. Server POSTs results when ready. Webhook approach explored for future MCP enhancement.

**n8n Community (2025):** Polling pattern for long-running AI workflows. Community-validated patterns for background job → poll → resume.

**Key Design Decision:** Polling vs. webhooks. MCP Tasks chose polling for statelessness. Webhooks are more efficient but require the server to manage callback registries. Kiln should support both:
- Polling for MCP-native async tasks
- Webhook callback for Kiln's own webhook tools

### Implementation Complexity for Kiln: MEDIUM

Components needed:

1. **`tool_pending` session mode:** New state in `SessionMode` type. Session enters `tool_pending` when a long-running tool is invoked. The session can still receive user messages (queued).

2. **`AsyncToolHandle`:** Returned by tool execution when the tool declares itself async. Contains `taskId`, `pollInterval`, `status`.

3. **Polling loop:** Background task in the gateway that polls pending tools at their declared interval. Uses `setInterval` with cleanup.

4. **Webhook callback endpoint:** `POST /api/tools/:taskId/callback` for webhook-based async tools. HMAC-SHA256 verified. Resumes the session when the tool completes.

5. **Session resume:** When async tool completes, inject result into session history and trigger the next orchestrator round. Emit `tool_async_completed` event.

6. **Timeout:** Global timeout for async tools (default 3600s, configurable per tool). Auto-fail after timeout.

7. **User notification:** Inform the user that a background operation is in progress. Channel-specific formatting (e.g., "Processing your refund... I'll notify you when it's complete.").

### Expected Impact: HIGH

Blocking gap for enterprise use cases. Payment processing (3-5s), document generation (10-30s), background checks (minutes), shipping label creation (seconds), CRM sync (variable). Without async tools, the orchestrator blocks the entire session for these operations.

### Recommendation: v0.5.0

Ship with:
1. `tool_pending` session mode
2. Webhook callback endpoint for external async tools
3. Polling integration for MCP Tasks (when MCP servers support it)
4. Configurable timeout (per-tool, default 3600s)
5. User notification via channel adapter

**Do not** implement speculative execution of other tools while waiting. Keep it simple: one pending tool at a time. Parallel async tools are v1.0.

### Beyond State-of-Art

**Conversational Continuity During Async:** When a tool is pending, the agent can continue the conversation about other topics. The session maintains a "pending tools" sidebar. When the tool completes, the agent seamlessly weaves the result into the next natural conversation turn, not as an interrupt. This requires the orchestrator to track multiple conversation threads within a session.

---

## 11. Computer Use / Browser Automation

### Research Findings

**Anthropic Computer Use (2024-2026):** Public beta since Oct 2024. Claude Opus 4.6 and Sonnet 4.6 support `computer_20251124` tool version with zoom action. Requires `anthropic-beta: computer-use-2025-01-24` header. Operates via screenshot analysis + mouse/keyboard control. Companies like Asana, Canva, Cognition, DoorDash, Replit using it. **Still beta -- Anthropic advises low-risk tasks only.**

**OpenAI CUA (Computer-Using Agent):** 87% on WebVoyager benchmark. GPT-4o vision + RL for GUI interaction. Powers OpenAI Operator and Atlas browser products. Production-deployed.

**Playwright MCP (Microsoft):** MCP server that provides AI with structured accessibility snapshots instead of screenshots. No vision model needed. 10x faster than screenshot-based approaches. Ships as `@playwright/mcp` on npm. Used by GitHub Copilot Coding Agent for task validation.

**Agentic Browser Landscape (2026):**
- OpenAI Atlas (agent browser, Oct 2025)
- Perplexity Comet (cross-platform, Mar 2026)
- Google Jarvis (Chrome-integrated)
- Opera Neon (Intelligent Mode, Feb 2026)
- 45+ computer-use agent papers at NeurIPS 2025

**Two paradigms:**
1. **Vision-based** (Anthropic Computer Use, OpenAI CUA): Screenshot → model → action. Provider-specific, high latency, expensive.
2. **Structured/Accessibility** (Playwright MCP): DOM/accessibility tree → tool calls. Provider-agnostic, fast, cheap. **Better fit for Kiln.**

### Implementation Complexity for Kiln: MEDIUM

**Path A (recommended): Playwright MCP integration.** Kiln already has MCP client. Connect to Playwright MCP server as an MCP endpoint. Zero new code in Kiln -- just configuration.

**Path B: Native computer use.** Implement `computer_use` tool type in the engine. Provider-specific (Anthropic requires specific beta headers, OpenAI uses different API shape). High maintenance burden.

### Expected Impact: MEDIUM

Valuable for specific use cases (form filling, web scraping, testing) but not a core customer service capability. Most Kilvo tenants need structured API interactions (OpenAPI adapter), not browser automation.

### Recommendation: v1.0

- **v0.5.0:** Document Playwright MCP as a supported MCP server. No new code needed.
- **v1.0:** Add `computer_use` tool type with Anthropic and OpenAI adapters for tenants that need vision-based browser interaction.
- **Never** default-enable computer use. Always require explicit tenant opt-in with security acknowledgment.

### Beyond State-of-Art

**Hybrid DOM + Vision:** Use Playwright MCP for structured interaction (fast, cheap). Fall back to Anthropic Computer Use only when the accessibility tree is insufficient (e.g., canvas-based UIs, CAPTCHA, visual verification). The orchestrator decides the modality based on the target page's structure.

---

## 12. Competitive Analysis

### Provider Tool Use Features (as of Q1 2026)

| Feature | Anthropic Claude | OpenAI | Google Gemini/ADK | Vercel AI SDK 6 | **Kiln v0.4.0** |
|---------|-----------------|--------|-------------------|----------------|-----------------|
| Parallel tool calls | Native | Native (`parallel_tool_calls`) | Native | Native | Native (Promise.all) |
| Tool schemas | JSON Schema | JSON Schema (strict mode) | FunctionDeclaration | inputSchema/outputSchema | JSON Schema (Capability) |
| Streaming during tools | Yes | Yes | Yes | SSE-based | WebSocket + SSE |
| Extended thinking + tools | Yes (Opus 4.6) | Chain-of-thought | Yes | N/A | N/A (delegate to provider) |
| Tool approval / HITL | Via API (tool_use pause) | Via API | ADK callbacks | `needsApproval: true` | 4-level auth + ApprovalGate |
| Programmatic Tool Calling | Yes (beta) | No | No | No | No (provider-specific) |
| OpenAPI to tools | No (manual) | No (manual) | ADK OpenAPIToolset | No | **Gap** |
| MCP client | Yes | Yes | Yes | Yes | Yes (Streamable HTTP) |
| Tool result caching | No | No | No | No | **Gap** (annotation exists) |
| Async tools | No | No | No | No | **Gap** |
| Computer use | Beta (computer_20251124) | CUA (production) | Yes (via ADK) | No | **Gap** (MCP path exists) |
| Tool RAG | Tool Search Tool (beta) | No | No | No | Yes (ToolRAG) |
| Rate limiting | No (user responsibility) | No | No | No | Yes (SlidingWindow) |
| Result sanitization | No | No | No | No | Yes (safety pipeline) |
| Retry/fallback | No | No | No | stopWhen | Yes (YAML config) |
| Webhook tools | No | No | No | No | Yes (HMAC-SHA256) |
| Per-tenant config | No | No | No | No | Yes (TenantConfig) |

### Kiln's Competitive Advantages

1. **Safety pipeline on tool results** -- No competitor sanitizes tool outputs through PII scanner + content classifier before LLM injection. This is a genuine differentiator.
2. **Declarative retry/fallback in YAML** -- Every competitor requires imperative code for retry logic.
3. **Per-tenant tool configuration** -- Multi-tenant tool isolation is unique to Kiln in the framework category.
4. **ToolRAG** -- Only Anthropic has an equivalent (Tool Search Tool, beta). Kiln's is provider-agnostic.
5. **Webhook tools with HMAC-SHA256** -- No competitor has a built-in webhook tool executor with cryptographic verification.

### Kiln's Gaps (Prioritized)

1. **OpenAPI to tools** -- ADK, Bedrock, Semantic Kernel, Composio all ship this. **Critical gap.**
2. **Tool result caching** -- Nobody ships this yet, but the annotation exists. **First-mover opportunity.**
3. **Async tools** -- MCP Tasks spec is ready. Bedrock supports long-running. **Production blocker.**
4. **Computer use** -- Anthropic and OpenAI are in production. Playwright MCP is the pragmatic path.

### Vercel AI SDK 6 -- Closest Architectural Competitor

Vercel AI SDK 6 is the closest to Kiln's architecture: TypeScript, agent abstraction, tool approval system, MCP support, streaming. Key differences:
- Vercel is client-side (React hooks). Kiln is server-side (gateway + orchestrator).
- Vercel has no multi-tenant support. Kiln has per-tenant everything.
- Vercel has no safety pipeline. Kiln has PII + content + policy rails.
- Vercel has no webhook tools. Kiln has full webhook infrastructure.
- Vercel has `stopWhen` for loop control. Kiln has `maxToolRounds` + budget ceiling.

**Assessment:** Kiln's server-side architecture with multi-tenant safety is a stronger enterprise play. Vercel wins on DX for single-tenant apps. Not direct competitors -- complementary.

---

## 13. Frontier Research

### RL-Based Tool Learning

| Paper | Key Result | Venue | Relevance to Kiln |
|-------|-----------|-------|--------------------|
| **ToolRL** (Qian et al.) | 17% over base, 15% over SFT via GRPO reward design | NeurIPS 2025 | Models are getting better at tool selection; Kiln should optimize orchestration, not selection |
| **ReTool** | 72.5% accuracy, surpassing OpenAI o1-preview by 27.9% | arXiv 2504.11536 | RL models may reduce need for ToolRAG in the future |
| **Tool-R0** | 92.5% improvement from zero data, co-evolves generator + solver | arXiv 2602.21320 | Zero-shot tool learning could reduce per-tenant training needs |
| **OTC** (Optimal Tool Calling) | 68.3% fewer tool calls, 215.4% higher tool productivity | arXiv 2504.14870 | Validates caching + selective calling strategy |

### Self-Evolving Agents

**ICLR 2026 Workshop -- "Lifelong Agents: Learning, Aligning, Evolving":** Key themes include continual fine-tuning, instruction alignment, domain shift adaptation, agentic RL, and tool-use strategies for long-term competence. This represents the frontier: agents that improve their tool use over time through experience.

**Self-Evolving Agents Survey (EvoAgentX):** Comprehensive taxonomy of self-improvement mechanisms: memory-based learning, tool creation, skill acquisition, and environmental adaptation. Published 2025, 500+ citations.

### Safety at the Frontier

**AgentSpec (ICSE 2026):** Customizable runtime enforcement via probabilistic model checking. Proactive safety -- predicts unsafe states before they occur. Applicable to Kiln's tool execution loop.

**Anthropic "Hot Mess of AI" (ICLR 2026):** The longer models reason and act, the more incoherent failures become. Failures don't correspond to any stable goal. Implication: bounded tool loops (Kiln's maxToolRounds) are essential, not just a performance optimization -- they're a safety mechanism.

**2026 International AI Safety Report:** 100+ experts from 30+ countries. AI agents making it harder for humans to intervene before failures cause harm. Kiln's human-in-the-loop architecture (4-level auth, ApprovalGateRegistry, escalation detection) directly addresses this finding.

### What's Beyond Current Shipping Products

| Concept | Description | Feasibility | Timeline |
|---------|-------------|-------------|----------|
| **Tool Learning from Experience** | Agent improves tool selection based on past session success/failure | MEDIUM | v2.0+ |
| **Cross-Tenant Tool Intelligence** | Anonymized tool usage patterns across tenants improve selection for all | HIGH (data exists) | v2.0+ |
| **Conversation-Adaptive Tool Sets** | Available tools change as conversation progresses (not just trust-based) | MEDIUM | v1.0+ |
| **Tool Affinity Graphs** | Graph of tool co-occurrence patterns drives predictive loading | MEDIUM (needs data) | v2.0+ |
| **Natural Language Tools** | Replace JSON schemas with NL descriptions (+18.4% accuracy in research) | LOW (ecosystem immature) | v3.0+ |
| **Federated Tool Learning** | Multiple Kiln deployments share anonymized tool quality data | HIGH (privacy concerns) | v3.0+ |

---

## Appendix A: Implementation Dependencies

```
v0.5.0 dependency graph:

  Tool Result Caching (standalone)
  Long-Running Async Tools (standalone)
  OpenAPI Adapter (standalone)
  Predictive Selection L1 (depends on ToolRAG, already exists)

v1.0 dependency graph:

  Composable Authorization → NIST standards (external)
  Tool Composition Pipelines → OpenAPI Adapter (v0.5.0)
  Wasm Sandboxing → Marketplace demand (external)
  Computer Use → Provider adapters (existing)

v2.0 dependency graph:

  MCP Marketplace → Wasm Sandboxing (v1.0) + MCP Registry (external)
  Runtime Tool Synthesis → Wasm Sandboxing (v1.0) + Eval framework (existing)
  Predictive Selection L2-3 → Production telemetry (v0.5.0+)
```

## Appendix B: Estimated Implementation Effort

| Feature | Estimated Days | New Files | Modified Files |
|---------|---------------|-----------|---------------|
| Tool Result Caching | 3-5 | 3 | 2 (orchestrator, events) |
| Long-Running Async Tools | 8-12 | 5-6 | 4 (session, gateway, events, tenant) |
| OpenAPI Adapter | 5-8 | 3-4 | 2 (tenant config, gateway) |
| Predictive Selection L1 | 2-3 | 1 | 2 (orchestrator, ToolRAG) |
| Composable Authorization | 8-12 | 4-5 | 3 (session, authorizer, gateway) |
| Tool Composition Pipelines | 15-20 | 6-8 | 3 (engine, orchestrator, loader) |
| Wasm Sandboxing | 10-15 | 4-5 | 2 (gateway, MCP) |
| Computer Use (MCP path) | 1-2 | 0-1 | 1 (docs) |
| MCP Marketplace | 30-50 | 15-20+ | Multiple |
| Runtime Tool Synthesis | 15-20 | 6-8 | 4+ |

**Total v0.5.0 scope: ~18-28 days**

---

## Sources

### Tool Composition & Pipelines
- [LangGraph Agent Orchestration Framework](https://www.langchain.com/langgraph)
- [Multi-Agent orchestration with Airflow, Kafka, Aryn AI](https://www.astronomer.io/blog/multi-agent-orchestration-apache-airflow-apache-kafka-aryn-ai-openai/)
- [Practical Guide for Production-Grade Agentic Workflows](https://arxiv.org/abs/2512.08769)
- [LangGraph Multi-Agent Orchestration Guide](https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/langgraph-multi-agent-orchestration-complete-framework-guide-architecture-analysis-2025)

### Predictive Tool Selection
- [Speculative Actions: Lossless Framework for Faster Agents](https://arxiv.org/abs/2510.04371)
- [Speculative Tool Calls (incident.io)](https://incident.io/building-with-ai/speculative-tool-calling)
- [Speculative Tool Calls: Voice Gaps (GetStream)](https://getstream.io/blog/speculative-tool-calling-voice/)
- [Optimizing Agentic LM Inference via Speculative Tool Calls](https://arxiv.org/pdf/2512.15834)

### Universal API Adapter
- [Google ADK OpenAPI Tools](https://google.github.io/adk-docs/tools-custom/openapi-tools/)
- [Bedrock Action Groups OpenAPI](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-api-schema.html)
- [Semantic Kernel OpenAPI Plugins](https://learn.microsoft.com/en-us/semantic-kernel/concepts/plugins/adding-openapi-plugins)
- [Composio Universal Tool Platform](https://composio.dev/)
- [openapi-llm: OpenAPI to LLM Tools](https://github.com/vblagoje/openapi-llm)
- [OpenAI for OpenAPI (arXiv:2601.12735)](https://arxiv.org/html/2601.12735)
- [AI Agents with OpenAPI (Strathweb)](https://www.strathweb.com/2025/06/ai-agents-with-openapi-tools-part-1-semantic-kernel/)

### Wasm/Extism Sandboxing
- [Wassette: WebAssembly MCP Tools (Microsoft)](https://opensource.microsoft.com/blog/2025/08/06/introducing-wassette-webassembly-based-tools-for-ai-agents)
- [Wassette: Rust-Powered Bridge (The New Stack)](https://thenewstack.io/wassette-microsofts-rust-powered-bridge-between-wasm-and-mcp/)
- [Sandboxing Agentic AI with Wasm (NVIDIA)](https://developer.nvidia.com/blog/sandboxing-agentic-ai-workflows-with-webassembly/)
- [Practical Security Guidance for Sandboxing (NVIDIA)](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/)
- [AgentMesh Wasm Sandboxing](https://github.com/hupe1980/agentmesh/blob/main/docs/wasm-sandboxing.md)
- [MVVM: Wasm Secure Agent Container](https://arxiv.org/html/2410.15894v2)

### MCP Marketplace
- [17+ MCP Registries & Directories](https://medium.com/demohub-tutorials/17-top-mcp-registries-and-directories-explore-the-best-sources-for-server-discovery-integration-0f748c72c34a)
- [Microsoft MCP Server Certification](https://learn.microsoft.com/en-us/microsoft-agent-365/mcp-certification)
- [MCP Market](https://mcpmarket.com/)
- [Monetizing MCP Servers (Moesif)](https://www.moesif.com/blog/api-strategy/model-context-protocol/Monetizing-MCP-Model-Context-Protocol-Servers-With-Moesif/)
- [Building the MCP Economy (Cline)](https://cline.bot/blog/building-the-mcp-economy-lessons-from-21st-dev-and-the-future-of-plugin-monetization)
- [MCP Server Monetization 2026](https://dev.to/namel/mcp-server-monetization-2026-1p2j)
- [Future of MCP: Roadmap (GetKnit)](https://www.getknit.dev/blog/the-future-of-mcp-roadmap-enhancements-and-whats-next)

### Tool Result Caching
- [Hierarchical Caching for Agentic Workflows (MDPI)](https://www.mdpi.com/2504-4990/8/2/30)
- [Agentic Plan Caching (NeurIPS 2025)](https://arxiv.org/abs/2506.14852)
- [Prompt Caching vs Semantic Caching (Redis)](https://redis.io/blog/prompt-caching-vs-semantic-caching/)
- [Caching Strategies for AI Agent Traffic (Nordic APIs)](https://nordicapis.com/caching-strategies-for-ai-agent-traffic/)
- [ToolUniverse Cache System](https://zitniklab.hms.harvard.edu/ToolUniverse/en/guide/cache_system.html)

### Composable Authorization
- [NIST AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure)
- [NIST Agent Identity & Authorization Concept Paper](https://www.nccoe.nist.gov/sites/default/files/2026-02/accelerating-the-adoption-of-software-and-ai-agent-identity-and-authorization-concept-paper.pdf)
- [NCCoE Agent Identity Project](https://www.nccoe.nist.gov/projects/software-and-ai-agent-identity-and-authorization)
- [Microsoft FIDES (arXiv:2505.23643)](https://arxiv.org/abs/2505.23643)
- [Composio Auth Guide](https://composio.dev/blog/secure-ai-agent-infrastructure-guide)

### Runtime Tool Synthesis
- [LATM: LLMs as Tool Makers (arXiv:2305.17126)](https://arxiv.org/abs/2305.17126)
- [ToolMaker: Autonomous Tool Creation (ACL 2025)](https://github.com/KatherLab/ToolMaker)
- [LLM Agents Making Agent Tools (arXiv:2502.11705)](https://arxiv.org/abs/2502.11705)
- [LLMs Executing Code: Dangerous (CSA)](https://cloudsecurityalliance.org/blog/2025/06/03/llms-writing-code-cool-llms-executing-it-dangerous)
- [AgentSpec: Runtime Enforcement (ICSE 2026)](https://cposkitt.github.io/files/publications/agentspec_llm_enforcement_icse26.pdf)
- [LLM-Generated Code Security Risks](https://arxiv.org/html/2504.20612v1)

### Long-Running Async Tools
- [MCP Tasks Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- [MCP 2025-11-25 Spec Update (WorkOS)](https://workos.com/blog/mcp-2025-11-25-spec-update)
- [MCP Async Tasks: AI Agent Workflows (WorkOS)](https://workos.com/blog/mcp-async-tasks-ai-agent-workflows)
- [Long Running Tasks in MCP (Agnost)](https://agnost.ai/blog/long-running-tasks-mcp/)
- [Architecting the Asynchronous Agent (Medium)](https://stn1slv.medium.com/architecting-the-asynchronous-agent-a-guide-to-mcp-tasks-7348c6527233)
- [Long-Running MCP Servers on Bedrock (AWS)](https://aws.amazon.com/blogs/machine-learning/build-long-running-mcp-servers-on-amazon-bedrock-agentcore-with-strands-agents-integration/)

### Computer Use / Browser Automation
- [Anthropic Computer Use Tool Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- [OpenAI Computer-Using Agent](https://openai.com/index/computer-using-agent/)
- [Playwright MCP (Microsoft)](https://github.com/microsoft/playwright-mcp)
- [Agentic Browser Landscape 2026](https://www.nohackspod.com/blog/agentic-browser-landscape-2026)
- [Agentic Computer Use Guide 2026 (o-mega)](https://o-mega.ai/articles/agentic-computer-use-the-ultimate-deep-guide-2026)
- [NeurIPS 2025: 45 Computer-Use Agent Papers](https://cua.ai/blog/neurips-2025-cua-papers)

### Competitive Analysis
- [OpenAI Responses API (New Tools & Features)](https://openai.com/index/new-tools-and-features-in-the-responses-api/)
- [OpenAI Function Calling Guide](https://platform.openai.com/docs/guides/function-calling)
- [Anthropic Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use)
- [Claude "Think" Tool](https://www.anthropic.com/engineering/claude-think-tool)
- [Claude Opus 4.6 Release](https://www.marktechpost.com/2026/02/05/anthropic-releases-claude-opus-4-6-with-1m-context-agentic-coding-adaptive-reasoning-controls-and-expanded-safety-tooling-capabilities/)
- [Google ADK Interactions API](https://developers.googleblog.com/building-agents-with-the-adk-and-the-new-interactions-api/)
- [Vercel AI SDK 6](https://vercel.com/blog/ai-sdk-6)
- [Vercel Ship AI 2025 Recap](https://vercel.com/blog/ship-ai-2025-recap)

### Frontier Research
- [ToolRL (NeurIPS 2025)](https://arxiv.org/abs/2504.13958)
- [ReTool (arXiv:2504.11536)](https://arxiv.org/abs/2504.11536)
- [Tool-R0 (arXiv:2602.21320)](https://arxiv.org/abs/2602.21320)
- [OTC: Optimal Tool Calling (arXiv:2504.14870)](https://arxiv.org/abs/2504.14870)
- [ICLR 2026 Workshop: Lifelong Agents](https://lifelongagent.github.io/)
- [Self-Evolving Agents Survey (EvoAgentX)](https://github.com/EvoAgentX/Awesome-Self-Evolving-Agents)
- [Anthropic: Hot Mess of AI (ICLR 2026)](https://arxiv.org/abs/2601.23045)
- [2026 International AI Safety Report](https://internationalaisafetyreport.org/publication/international-ai-safety-report-2026)
- [NIST AI Agent Standards Initiative](https://www.nist.gov/caisi/ai-agent-standards-initiative)


---

# Track 4: Channel Hardening & Edge Cases Stabilization Audit

## Executive Summary

Kiln v0.4.0 has 8 channel adapters built on a clean, consistent architecture. However, the implementations are v1-quality with several production hardening gaps across all channels. The most critical deficiencies are: (1) no webhook message deduplication on any Meta channel, (2) no WhatsApp media URL expiration handling, (3) no message length chunking (truncation only), (4) WebSocket has no heartbeat/ping and no backpressure, (5) email thread store is in-memory only, and (6) no messaging window awareness on Instagram/Messenger. Below is the channel-by-channel breakdown.

---

## 1. WhatsApp Production Hardening

### Current State Assessment

Kiln has a functional WhatsApp adapter with:
- Cloud API v21.0 via raw fetch (no SDK dependency)
- HMAC-SHA256 webhook signature verification via shared Meta foundation
- Two-step media download (metadata resolve then binary download) in `audio-preprocessor.ts`
- WhatsApp-native markdown conversion (bold, italic, strikethrough, monospace, headers, links, lists) in `message-formatter.ts:91-113`
- Template message support via `sendWhatsAppTemplate()` in `whatsapp-api.ts`
- Delivery status forwarding to product backend via conversation event emitter
- Budget check, memory recall, knowledge retrieval, contact memory, tenant tool context
- `notify_owner` builtin tool for escalation

### Production Edge Cases

**P0 -- No Webhook Deduplication.** WhatsApp delivers webhooks at-least-once. The current `whatsapp-webhook-routes.ts` processes every incoming webhook payload without any idempotency check. Duplicate webhooks will cause duplicate AI responses sent to the user. Research confirms this is a known production issue: "WhatsApp delivers notifications at-least-once, which means duplicates are a normal operating condition" ([Hookdeck](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices), [Medium](https://medium.com/@nkangprecious26/handling-duplicate-webhooks-in-whatsapp-api-using-redis-d7d117731f95)).

**P0 -- Media URL 5-Minute Expiration.** WhatsApp media download URLs expire in 5 minutes. The current `whatsappMediaUrl()` in `whatsapp-api.ts:17` constructs a Graph API URL for the media ID, and `createWhatsAppMediaDownloader()` in `audio-preprocessor.ts:9-33` performs the two-step download correctly. However, if the AI processing takes >5 minutes (LLM timeout, queue backlog), the media URL will have expired before download is attempted. There is no retry-with-fresh-URL logic.

**P1 -- No Message Chunking.** `toWhatsAppFormat()` truncates at 4096 characters via `.slice(0, 4096)` (line 45 of `message-formatter.ts`). Long AI responses are silently truncated. Production-grade platforms split into multiple messages.

**P1 -- Rate Limiting Tier Awareness.** Meta is restructuring messaging limits: removing 2K/10K tiers in Q2 2026, moving to portfolio-level limits at 100K. Kiln has no outbound rate limiting -- the `sendWhatsAppMessage()` function fires immediately. High-volume tenants could exceed tier limits and get their number quality-degraded.

**P1 -- Quality Score Monitoring.** Quality rating depends on blocks, reports, and read rates over the last 7 days. Kiln has no quality score monitoring, no alerting when ratings drop, and no automatic template pausing integration. Research shows: "An important change in 2026: A red rating prevents advancement to the next tier" ([Sanuker](https://sanuker.com/whatsapp-api-2026_updates-pacing-limits-usernames/)).

**P2 -- Webhook Response Time.** Meta requires webhook response within 10 seconds, or it triggers retries. Kiln correctly returns `200 OK` immediately and processes in background via `Promise.allSettled()` (line 248). This is well-implemented.

**P2 -- No Retry on Send Failure.** `sendWhatsAppMessage()` throws on non-200 but the caller at `whatsapp-webhook-routes.ts:526-531` catches and logs only. No retry with exponential backoff for transient failures (429, 500).

**P2 -- Template Send Validation.** `sendWhatsAppTemplate()` exists but has no client-side validation of variable parameter counts or template status checks.

### Hardening Recommendations (ordered by severity)

1. **Add webhook deduplication** -- Use a TTL map (or Redis set) keyed by `messages[].id` with 2-hour expiry. Skip payloads whose message ID is already seen.
2. **Add media download retry** -- If media fetch fails with 404, re-resolve the media URL from the Graph API with a fresh call. Add a configurable download timeout (default 15s).
3. **Implement message chunking** -- Split messages >4096 chars at paragraph boundaries. Send as sequential messages with 200ms delay between sends.
4. **Add outbound rate limiting** -- Track sends per second/minute per phone number. Queue excess messages with backoff. Respect Meta's 80 messages/second TPS limit.
5. **Add send retry with backoff** -- Retry transient errors (429, 500, 503) with exponential backoff. Respect Retry-After headers.

---

## 2. Instagram DM Edge Cases

### Current State Assessment

- Graph API v21.0, raw fetch, HMAC-SHA256
- Text + image support (no audio outbound, no file outbound)
- `toInstagramFormat()` strips markdown and truncates at 1000 chars
- Echo message filtering (`is_echo` check at line 156 of `instagram-webhook-routes.ts`)
- Tenant resolution by Instagram Page ID

### Production Edge Cases

**P0 -- No 24-Hour Window Enforcement.** Instagram enforces a 24-hour messaging window -- you can only message users who engaged with your content in the past 24 hours. Kiln has no window tracking. If a session resumes after 24 hours (e.g., human handoff delay), the outbound send will fail silently (Instagram returns an error). Research confirms: "Meta's Instagram Graph API limits automated DMs... with a 24-hour messaging window" ([SpurNow](https://www.spurnow.com/en/blogs/instagram-dm-automation-rules), [CreatorFlow](https://creatorflow.so/blog/instagram-api-rate-limits-explained/)).

**P0 -- No Webhook Deduplication.** Same issue as WhatsApp. Meta at-least-once delivery model applies to all channels sharing the webhook infrastructure.

**P1 -- 200 DM/Hour Rate Limit.** Instagram caps at 200 automated DMs per hour per account. Kiln has no awareness of this limit. High-traffic Instagram accounts could hit this limit and have messages silently dropped. "In a surprising move, Instagram significantly reduced its API rate limits in 2025 without prior notice" ([MarketingScoop](https://www.marketingscoop.com/marketing/instagrams-api-rate-limits-a-deep-dive-for-developers-and-marketers-in-2024/)).

**P1 -- 1000-Char Truncation Without Continuation.** Same as WhatsApp -- truncation without chunking. Instagram's 1000-char limit is especially tight for detailed AI responses.

**P1 -- IGSID Stability.** Instagram-scoped user IDs (IGSID) are unique per user-per-page pair. While research did not surface specific instability issues, the session key `instagram:{senderId}` assumes IGSID stability. If Meta changes IGSID assignment, sessions break.

**P2 -- No Story/Comment Reply Support.** Instagram supports story mention replies and comment replies via API. Kiln only handles DMs (`entry[].messaging[]`). Story mentions come as a different webhook event type.

**P2 -- Human Agent 7-Day Window.** Instagram provides a 7-day extended window when a human agent (not bot) takes over. Kiln's handoff system doesn't apply the Human Agent tag, so operator messages after 24 hours will fail. "Automated bots can't use the Human Agent tag -- it must be applied manually by a live agent" ([CreatorFlow](https://creatorflow.so/blog/instagram-automation-stopped-working-fix/)).

### Hardening Recommendations

1. **Track messaging windows** -- Store `lastUserMessageAt` per session. Before sending, check if within 24h. If expired, emit a WINDOW_EXPIRED event and skip the send.
2. **Add webhook deduplication** -- Shared dedup layer across all Meta channels.
3. **Add outbound rate limiting** -- 200 DM/hour per Instagram account. Queue excess with backoff.
4. **Implement message chunking** -- Split at 1000 chars with continuation markers.
5. **Surface Human Agent tag** -- In handoff mode, tag outbound messages with the human_agent message tag.

---

## 3. Messenger Edge Cases

### Current State Assessment

- Graph API v21.0, raw fetch, HMAC-SHA256
- Text + image support
- `toMessengerFormat()` strips markdown and truncates at 2000 chars
- Echo message filtering
- Tenant resolution by Messenger Page ID

### Production Edge Cases

**P0 -- No 24-Hour Window Enforcement.** Same as Instagram. "Facebook Messenger has a 24-hour rule to prevent businesses from spamming users" ([Chatimize](https://chatimize.com/facebook-messenger-policy/)). Outside this window, only specific message tags (CONFIRMED_EVENT_UPDATE, POST_PURCHASE_UPDATE, ACCOUNT_UPDATE, HUMAN_AGENT) are permitted.

**P0 -- No Webhook Deduplication.** Same Meta at-least-once delivery.

**P1 -- No Handover Protocol.** Messenger's Handover Protocol allows bot-to-human-agent thread transfer between different apps. Kiln has its own internal handoff system but doesn't integrate with Meta's protocol. This means if a business uses both Kiln and a separate live chat tool, there's no coordination. "The Handover Protocol enables two or more Facebook apps to participate in a conversation at the same time" ([Meta Docs](https://developers.facebook.com/docs/messenger-platform/handover-protocol/)).

**P1 -- Page-Scoped ID vs App-Scoped ID.** Messenger uses PSIDs (page-scoped). The same user has different IDs per page. Kiln stores sessions by `messenger:{senderId}` using the PSID directly. This is correct for single-page setups but breaks cross-page contact deduplication. Meta's ID Matching API can resolve PSIDs across pages in the same Business Manager but Kiln doesn't use it.

**P1 -- No One-Time Notification.** Messenger supports One-Time Notification tokens for sending a single message outside the 24-hour window (with prior user consent). This is not implemented.

**P2 -- No Message Tag Support.** For outbound messages outside 24h, Messenger requires specific message tags. The `sendMessengerMessage()` function at `messenger-api.ts` sends plain messages without tag support.

### Hardening Recommendations

1. **Implement messaging window tracking** -- Same solution as Instagram. Track `lastUserMessageAt`, check before send.
2. **Add webhook deduplication** -- Shared dedup layer.
3. **Add message tag support** -- Extend `sendMessengerMessage()` to accept optional `messaging_type` and `tag` parameters for out-of-window messages.
4. **Implement Handover Protocol** -- Add `pass_thread_control` and `take_thread_control` API calls, wired to the handoff system.

---

## 4. Email Hardening

### Current State Assessment

- Webhook inbound, three transports (Postmark, Resend, Generic)
- Thread tracking via Message-ID chain (`InMemoryEmailThreadStore`)
- Loop prevention: RFC 3834 auto-reply detection, ignored senders, self-send detection
- HTML template with inline CSS, plain text fallback
- Auto-Submitted + X-Auto-Response-Suppress headers on outbound
- Budget exhausted emails silently dropped (good decision)

### Production Edge Cases

**P0 -- InMemoryEmailThreadStore Data Loss.** The thread store is in-memory (`email-thread-store.ts`). Server restart loses all thread context. Email conversations span days/weeks. This is the most critical email issue. The CLAUDE.md acknowledges this: "InMemoryEmailThreadStore for v1."

**P1 -- No SPF/DKIM/DMARC Guidance or Validation.** Kiln delegates email sending to transports (Postmark, Resend) that handle authentication. However, there is no pre-flight validation that the tenant's `emailFromAddress` domain has proper SPF/DKIM/DMARC records. Research shows: "2025 marks the year email authentication transformed from best practice to absolute requirement" ([Mailtrap](https://mailtrap.io/blog/how-to-improve-email-deliverability/)). Google, Yahoo, and Microsoft now enforce these for bulk senders.

**P1 -- No Bounce Handling.** When emails bounce (hard or soft), there's no webhook handler or callback to update the session or tenant. Hard bounces to the same address will continue, damaging sender reputation. Research: "Automated removal of hard bounces is non-negotiable" ([BillionVerify](https://billionverify.com/blog/2025-email-deliverability-report-1)).

**P1 -- Email HTML Compatibility.** The `renderEmailHtml()` in `email-template.ts` uses inline CSS and table layout, which is correct. However:
  - No Gmail 102KB clipping guard
  - `escapeHtml()` does not escape single quotes
  - No preheader text support
  - No dark mode color scheme media query
  
  Research: "Gmail will clip emails exceeding certain limits, hiding the footer and unsubscribe link" ([DEV Community](https://dev.to/aoifecarrigan/the-complete-guide-to-email-client-rendering-differences-in-2026-243f)). "2025-2026 is peak dual-Outlook pain, requiring coding for both the Word engine AND Chromium simultaneously" ([Email Dev](https://email-dev.com/the-complete-guide-to-email-client-compatibility-in-2025/)).

**P1 -- No Attachment Handling.** `EmailChannel` declares `supportedModalities: ["text", "file"]` but the inbound webhook parser only extracts `textBody`. Inbound attachments are silently ignored. Outbound `OutboundEmail` has no attachment field. Limits vary: Gmail 25MB, Outlook 20MB, Yahoo 25MB, with Base64 encoding adding 33% overhead.

**P2 -- SendGrid Transport Bug.** At `email-api.ts:159`, SendGrid is mapped to `ResendTransport`: `case "sendgrid": return new ResendTransport(config.apiKey);`. This is incorrect -- SendGrid's API endpoint, headers, and payload format differ from Resend.

**P2 -- Thread Store Memory Growth.** `InMemoryEmailThreadStore` has no eviction. Long-running servers will accumulate unbounded thread data. No cleanup mechanism.

**P2 -- No Unsubscribe Header.** CAN-SPAM and GDPR compliance often requires a List-Unsubscribe header for automated emails. The template supports `unsubscribeUrl` in branding but the actual email headers don't include `List-Unsubscribe`.

### Hardening Recommendations

1. **Implement persistent EmailThreadStore** -- SQLite or JSON-file backed store with TTL eviction (e.g., 90 days). This is the highest priority email fix.
2. **Add bounce webhook handler** -- Accept bounce notifications from Postmark/Resend. Mark hard-bounced addresses as undeliverable. Stop sending to them.
3. **Fix SendGrid transport** -- Implement a proper `SendGridTransport` class with the correct API endpoint (`https://api.sendgrid.com/v3/mail/send`).
4. **Add attachment support** -- Parse inbound attachments from webhook payload. Add `attachments` field to `OutboundEmail`. Respect provider size limits.
5. **Add List-Unsubscribe header** -- When `unsubscribeUrl` is configured, include `List-Unsubscribe` and `List-Unsubscribe-Post` headers.

---

## 5. Slack Hardening

### Current State Assessment

- Bot Events API + Web API via raw fetch
- HMAC-SHA256 request signature verification
- Thread support via `thread_ts`
- 40,000 char limit (effectively unlimited for typical responses)
- `formatForChannel()` with "full" format (keeps markdown)

### Production Edge Cases

**P1 -- No Block Kit Support.** `SlackChannel.send()` at line 58 sends plain `text` via `chat.postMessage`. Slack's Block Kit enables rich formatting (sections, buttons, images, dividers) that dramatically improves UX. The current implementation only uses the plain text fallback.

**P1 -- No Response to Send Result.** `chat.postMessage` returns a JSON response with `ok`, `error`, `ts`, etc. The current implementation at `slack-channel.ts:58-65` fires the fetch and discards the response entirely. No error handling for:
  - `channel_not_found` (deleted channel)
  - `not_in_channel` (bot removed from channel)
  - `token_revoked` (expired token)

**P1 -- Rate Limit Changes.** Slack's May 2025 rate limit changes are severe for non-Marketplace apps: "conversations.history API method rate limit... limited to 1 request per minute" for unlisted apps ([Slack API](https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq)). While this primarily affects read operations, Kiln should be aware if it ever reads thread history.

**P2 -- No Thread vs Channel Intelligence.** When a user mentions the bot in a thread, the bot should reply in that thread. When mentioned in a channel, it should reply in the channel (or start a new thread). The current implementation passes `thread_ts` from the response metadata but has no logic to determine the correct threading behavior from the incoming event.

**P2 -- 3-Second Acknowledgment.** Slack expects webhook acknowledgment within 3 seconds. If the entire AI processing happens synchronously before responding, Slack will retry. Kiln's Slack integration is via the Events API webhook -- the actual integration point isn't shown in the channel adapter itself but in the gateway routes.

**P2 -- No App Home / Slash Command Support.** Slack bots can provide an App Home tab and slash commands. These are not implemented.

### Hardening Recommendations

1. **Add send error handling** -- Parse `chat.postMessage` response. Handle `channel_not_found`, `not_in_channel`, `token_revoked`. Emit events on failure.
2. **Add Block Kit formatting** -- Convert AI responses to Block Kit sections. Use `mrkdwn` type for text blocks. Add dividers between sections.
3. **Add 429 retry** -- Parse `Retry-After` header from Slack API responses. Queue and retry.
4. **Add thread routing logic** -- When receiving an `app_mention` event, check if `thread_ts` is present. If so, reply in that thread.

---

## 6. WebSocket / Web Channel Hardening

### Current State Assessment

- Hono WebSocket upgrade
- Multi-tenant via `widgetId` query parameter with origin validation
- Session-scoped client tracking in `WebChannel` (Map<sessionId, Set<WebSocketLike>>)
- Widget (`WsClient`) has auto-reconnect with exponential backoff (1s to 30s)
- Welcome frame with greeting + FAQ suggestions
- AI follow-up suggestion chips
- BUDGET_EXHAUSTED error code
- userId persisted in sessionStorage per widgetId

### Production Edge Cases

**P0 -- No Heartbeat/Ping.** Neither the server (`ws-tenant-routes.ts`) nor the client (`ws-client.ts`) sends ping/pong frames. This means:
  - Dead connections are not detected until a send fails
  - Zombie connections accumulate in the `sessions` Map
  - Proxies/load balancers may drop idle connections silently (typical idle timeout: 60s for nginx, 120s for Cloudflare)

  Research confirms: "Many production WebSocket issues stem from lack of heartbeat. Proxies and load balancers have idle connection timeouts that silently drop connections" ([OneUptime](https://oneuptime.com/blog/post/2026-01-24-websocket-performance/view)).

**P0 -- No Backpressure.** `WebChannel.trySend()` at `web-channel.ts:129-137` sends to all clients with no backpressure check. If a client is slow (weak network), the send buffer grows unbounded. Research: "The server's WebSocket library and OS TCP send buffers will endlessly accumulate data for slow clients if no backpressure mechanism is in place. With thousands of concurrent connections, even a small percentage of lagging clients can cause OOM" ([Substack](https://skylinecodes.substack.com/p/backpressure-in-websocket-streams)).

**P1 -- No Jitter in Reconnection.** The `WsClient.scheduleReconnect()` at `ws-client.ts:90-96` uses pure exponential backoff (`delay * 2`) without jitter. If the server restarts, all clients reconnect at identical intervals creating a thundering herd. Research: "Use exponential backoff with jitter to avoid thundering herd issues" ([DEV Community](https://dev.to/hexshift/robust-websocket-reconnection-strategies-in-javascript-with-exponential-backoff-40n1), [OneUptime](https://oneuptime.com/blog/post/2026-01-27-websocket-reconnection/view)).

**P1 -- No Connection Limit.** There's no maximum connections per tenant or per server. A single tenant with a viral page could exhaust server resources.

**P1 -- No Message Queue/Offline Support.** If a client disconnects momentarily and reconnects, any messages sent during disconnection are lost. No queuing of missed messages.

**P2 -- Client Cleanup on Error.** `trySend()` silently removes clients that throw on send. But there's no periodic cleanup of dead connections (clients whose `readyState` changed to CLOSED without triggering `onclose`).

**P2 -- No Authentication for WebSocket.** The widget uses `widgetId` as the sole auth mechanism. Anyone who discovers a `widgetId` can connect. The origin check mitigates this partially but is bypassable from non-browser clients.

### Hardening Recommendations

1. **Add server-side ping/pong** -- Send ping frames every 30s. Close connections that don't respond within 10s. Clean up from sessions map.
2. **Add jitter to reconnection** -- `delay = delay * 2 * (0.5 + Math.random() * 0.5)` to spread reconnections.
3. **Add backpressure monitoring** -- Track `bufferedAmount` on WebSocket. If exceeds threshold (e.g., 64KB), drop messages for that client or close the connection.
4. **Add per-tenant connection limit** -- Default 1000 connections per tenant. Reject new connections beyond limit.
5. **Add offline message queue** -- Buffer last N messages per session. On reconnect, replay missed messages.

---

## 7. Cross-Channel Issues

### Contact Deduplication

Kiln currently identifies users by channel-specific IDs:
- WhatsApp: phone number (e.g., `5215551234567`)
- Instagram: IGSID (e.g., `1234567890`)
- Messenger: PSID (e.g., `9876543210`)
- Email: email address (e.g., `email:user@example.com`)
- Web: random UUID (per widget, stored in sessionStorage)

The same person across WhatsApp and Instagram is two completely separate identities. There is no contact unification. Research: "Clear rules must be set early for how users are recognized across channels using signals like phone numbers, login state, email, or account references" ([Nurix](https://www.nurix.ai/blogs/omnichannel-ai-agents-customer-service)).

**Recommendations:**
- Implement a `ContactRegistry` with identity linking (phone -> IGSID -> PSID -> email)
- Use Meta's ID Matching API for cross-page PSID resolution
- Allow webhook tools to report identity merges from product backends
- Surface unified contact context across channels

### Session Continuity

When a user starts on WhatsApp and switches to web, their session history is lost. Memory recall via SQLite FTS5 uses channel-specific keys (phone number vs UUID). Contact memory uses `externalUserId` which differs per channel.

**Recommendations:**
- Once contacts are linked, share memory across linked identities
- Provide session transfer API: given a contact, return conversation summary from all channels

### Channel Failover

If WhatsApp API is down, there's no automatic failover to SMS or another channel. Outbound messages fail silently after a single attempt.

**Recommendations:**
- Add circuit breaker per channel API (WhatsApp, Instagram, Messenger already have them in the agents layer -- extend to channel APIs)
- Add configurable fallback channel per tenant (e.g., WhatsApp -> SMS, Messenger -> Email)

---

## 8. Competitive Analysis Findings

### vs. Chatwoot (open-source)
- Chatwoot suffers from WhatsApp template sync delays (3-hour window), database write storms from `agent_last_seen_at`, and webhook-related issues similar to Kiln's ([Chatwoot](https://github.com/chatwoot/chatwoot)). Kiln's architecture is cleaner (no Rails monolith, no Sidekiq), but Chatwoot has had more production exposure for finding edge cases.

### vs. Respond.io (enterprise)
- Respond.io uses an event-driven architecture on AWS Lambda with a modular AI Orchestrator. They achieve "99.999% uptime" through micro-agent separation and fault isolation. Their key advantage: "A modular infrastructure handles massive spikes... while maintaining responsiveness" ([Respond.io](https://respond.io/blog/how-respondio-ai-agents-work)). Kiln's single-process gateway is simpler but less resilient.

### vs. Intercom (enterprise)
- Intercom's Fin AI handles cross-channel with a unified inbox. Their strength is the integration ecosystem. Kiln can compete on configurability and self-hosting.

---

## 9. Shared Infrastructure Gaps

### Across All Meta Channels (WhatsApp, Instagram, Messenger)

| Gap | Severity | Description |
|-----|----------|-------------|
| No webhook deduplication | P0 | At-least-once delivery causes duplicate AI responses |
| No messaging window tracking | P0 | Instagram 24h, Messenger 24h, WhatsApp 24h service window |
| No outbound rate limiting | P1 | WhatsApp 80 TPS, Instagram 200/hr, Messenger varies |
| No send retry with backoff | P2 | Transient failures not retried |
| Message truncation not chunking | P1 | Long responses silently cut off |

### Across All Channels

| Gap | Severity | Description |
|-----|----------|-------------|
| No runtime channel test coverage | P1 | Zero test files in `packages/runtime/src/gateway/*-webhook-routes.ts`. The test files exist for channel adapters but not for webhook route integration |
| Code duplication in webhook routes | P2 | WhatsApp, Instagram, Messenger, Email webhook routes share 80%+ identical code (memory, knowledge, tools, billing, events). Should be extracted to shared pipeline |
| Error messages not localized | P2 | "Something went wrong. Please try again." is hardcoded in English in all channels |

---

## 10. Priority Matrix

### Fix Now (Pre-Production / v0.5.0)

| # | Item | Channels | Effort |
|---|------|----------|--------|
| 1 | Webhook message deduplication (TTL map by message ID) | WA, IG, Msg | Small |
| 2 | WebSocket heartbeat/ping-pong | Web | Small |
| 3 | Persistent EmailThreadStore (SQLite) | Email | Medium |
| 4 | WsClient reconnect jitter | Widget | Tiny |
| 5 | Messaging window tracking (24h) | IG, Msg | Medium |
| 6 | Media URL expiration handling (retry fresh URL) | WA | Small |
| 7 | Slack send error handling | Slack | Small |
| 8 | Fix SendGrid transport | Email | Tiny |

### Fix Soon (v0.6.0)

| # | Item | Channels | Effort |
|---|------|----------|--------|
| 9 | Message chunking (split at paragraph boundaries) | WA, IG, Msg | Medium |
| 10 | Outbound rate limiting | WA, IG, Msg | Medium |
| 11 | WebSocket backpressure monitoring | Web | Medium |
| 12 | Per-tenant connection limit | Web | Small |
| 13 | Send retry with exponential backoff | All API | Medium |
| 14 | Bounce webhook handler | Email | Medium |
| 15 | Slack Block Kit formatting | Slack | Medium |
| 16 | Extract shared webhook pipeline | All Meta | Large |

### Fix Later (v1.0+)

| # | Item | Channels | Effort |
|---|------|----------|--------|
| 17 | Contact deduplication / unified identity | Cross-channel | Large |
| 18 | Messenger Handover Protocol | Messenger | Medium |
| 19 | One-Time Notification support | Messenger | Small |
| 20 | Human Agent tag for handoff | IG, Msg | Small |
| 21 | Email attachment support | Email | Medium |
| 22 | Channel failover with circuit breaker | All | Large |
| 23 | Story/comment reply support | Instagram | Medium |
| 24 | Session transfer across channels | Cross-channel | Large |
| 25 | WebSocket offline message queue | Web | Medium |
| 26 | List-Unsubscribe header | Email | Tiny |

### Beyond State-of-Art Ideas

1. **Proactive channel intelligence** -- Detect when a user's messaging window is about to expire and prompt them to re-engage before the window closes.
2. **Channel capability negotiation** -- When an AI response includes rich content (images, files), automatically select the best channel to deliver it based on channel capabilities.
3. **Cross-channel conversation summarization** -- When a user switches channels, generate an AI summary of their prior interactions on other channels and inject it as context.
4. **Quality score prediction** -- Monitor outbound message patterns and predict quality score degradation before it happens using message block/report ratios.
5. **Adaptive response formatting** -- Learn per-channel optimal response length from engagement signals (read receipts, response rates) and dynamically tune AI output length.

---

## Key Files Referenced

- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/whatsapp-channel.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/whatsapp-api.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/instagram-channel.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/instagram-api.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/messenger-channel.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/messenger-api.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/email-channel.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/email-api.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/email-template.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/slack-channel.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/web-channel.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/channels/message-formatter.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/whatsapp-webhook-routes.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/instagram-webhook-routes.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/messenger-webhook-routes.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/email-webhook-routes.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/ws-tenant-routes.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/meta-webhook-foundation.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/audio-preprocessor.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/email-loop-guard.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/email-thread-store.ts`
- `C:/Proyectos/Sequel/kiln/packages/runtime/src/gateway/outbound-routes.ts`
- `C:/Proyectos/Sequel/kiln/packages/widget/src/ws-client.ts`
- `C:/Proyectos/Sequel/kiln/packages/widget/src/widget.ts`

Sources:
- [WhatsApp API Rate Limits - Wati](https://www.wati.io/en/blog/whatsapp-business-api/whatsapp-api-rate-limits/)
- [WhatsApp 2026 Updates: Pacing, Limits & Usernames - Sanuker](https://sanuker.com/whatsapp-api-2026_updates-pacing-limits-usernames/)
- [WhatsApp Messaging Limits 2026 - Chatarmin](https://chatarmin.com/en/blog/whats-app-messaging-limits)
- [Messaging Limits - Meta for Developers](https://developers.facebook.com/docs/whatsapp/messaging-limits/)
- [Shadow Delivery Mystery - Medium](https://medium.com/@siri.prasad/the-shadow-delivery-mystery-why-your-whatsapp-cloud-api-webhooks-silently-fail-and-how-to-fix-2c7383fec59f)
- [WhatsApp Webhooks Best Practices - Hookdeck](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices)
- [Duplicate Webhooks WhatsApp Redis - Medium](https://medium.com/@nkangprecious26/handling-duplicate-webhooks-in-whatsapp-api-using-redis-d7d117731f95)
- [Instagram API Rate Limits - CreatorFlow](https://creatorflow.so/blog/instagram-api-rate-limits-explained/)
- [Instagram DM Automation Rules - SpurNow](https://www.spurnow.com/en/blogs/instagram-dm-automation-rules)
- [Instagram API Rate Limits Deep Dive - Marketing Scoop](https://www.marketingscoop.com/marketing/instagrams-api-rate-limits-a-deep-dive-for-developers-and-marketers-in-2024/)
- [Instagram Messaging - CM.com](https://developers.cm.com/messaging/docs/instagram-messaging)
- [Messenger Handover Protocol - Meta for Developers](https://developers.facebook.com/docs/messenger-platform/handover-protocol/)
- [Messenger 24h Rules - Chatimize](https://chatimize.com/facebook-messenger-policy/)
- [PSID/ASID Matching - Meta for Developers](https://developers.facebook.com/docs/messenger-platform/identity/id-matching/)
- [Email Deliverability 2026 - Mailtrap](https://mailtrap.io/blog/how-to-improve-email-deliverability/)
- [Email Deliverability Report 2025 - BillionVerify](https://billionverify.com/blog/2025-email-deliverability-report-1)
- [Email Client Rendering 2026 - DEV Community](https://dev.to/aoifecarrigan/the-complete-guide-to-email-client-rendering-differences-in-2026-243f)
- [Email Client Compatibility 2025 - Email Dev](https://email-dev.com/the-complete-guide-to-email-client-compatibility-in-2025/)
- [Email Attachment Limits - GrowthList](https://growthlist.co/email-sending-limits-of-various-email-service-providers/)
- [Slack Rate Limit Changes 2025 - Slack API](https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq)
- [Slack Rate Limits - Slack Docs](https://docs.slack.dev/apis/web-api/rate-limits/)
- [WebSocket Reconnection Strategies - DEV Community](https://dev.to/hexshift/robust-websocket-reconnection-strategies-in-javascript-with-exponential-backoff-40n1)
- [WebSocket Backpressure - Substack](https://skylinecodes.substack.com/p/backpressure-in-websocket-streams)
- [Scaling WebSockets - Ably](https://ably.com/topic/the-challenge-of-scaling-websockets)
- [WebSocket Performance - OneUptime](https://oneuptime.com/blog/post/2026-01-24-websocket-performance/view)
- [WebSocket Reconnection - OneUptime](https://oneuptime.com/blog/post/2026-01-27-websocket-reconnection/view)
- [Chatwoot Overview - Eesel](https://www.eesel.ai/blog/chatwoot)
- [Respond.io AI Agents - Respond.io](https://respond.io/blog/how-respondio-ai-agents-work)
- [Omnichannel AI Agents - Nurix](https://www.nurix.ai/blogs/omnichannel-ai-agents-customer-service)
- [Omnichannel AI Agents - Cresta](https://cresta.com/blog/beyond-multi-channel-a-guide-to-deploying-omnichannel-ai-agents-for-scalable-seamless-cx)
- [WhatsApp Template Quality Rating - Cunnekt](https://www.cunnekt.com/blog/whatsapp-template-quality-rating/)
- [WhatsApp Template Compliance - Infobip](https://www.infobip.com/docs/whatsapp/compliance/template-compliance)

---

# Track 5: Security, Safety & Observability Hardening Audit

**Date:** 2026-03-07
**Version:** Kiln v0.4.0
**Auditor:** Maria (Sequel Development Assistant)
**Scope:** Exhaustive research on 10 security/safety/observability domains

---

## Table of Contents

1. [Prompt Injection Defenses](#1-prompt-injection-defenses)
2. [PII Detection Accuracy](#2-pii-detection-accuracy)
3. [Content Safety at Scale](#3-content-safety-at-scale)
4. [Observability for AI](#4-observability-for-ai)
5. [Cost Tracking Accuracy](#5-cost-tracking-accuracy)
6. [Audit Trail Compliance](#6-audit-trail-compliance)
7. [Rate Limiting Patterns](#7-rate-limiting-patterns)
8. [Enterprise Security Gaps](#8-enterprise-security-gaps)
9. [Multi-Tenant Security](#9-multi-tenant-security)
10. [Frontier Security Research](#10-frontier-security-research)
11. [Consolidated Priority Matrix](#consolidated-priority-matrix)

---

## 1. Prompt Injection Defenses

### 1.1 Current State Assessment

**What Kiln has:**
- **Tier 1 (Heuristic):** `PromptScanner` with 27 regex patterns across 10 categories (role_hijacking, delimiter_injection, instruction_override, encoding_attacks, output_manipulation, data_exfiltration, jailbreak, multilang_bypass, nested_injection, prompt_leaking). Sub-millisecond, zero cost.
- **Tier 2 (Deep):** LLM-based scan via any `ProviderAdapter`. Only runs when `heuristicOnly=false`, provider given, and input > 50 chars. Fail-open on errors.
- **False-positive mitigation:** Educational context detection (4 patterns), code block detection, severity downgrading.
- **Gateway integration:** `securityMiddleware` scans POST body `message`/`content` fields. Configurable block (422) or warn (header).
- **Guardian:** Secondary LLM review for destructive-annotated capabilities. Configurable `blockOnError`.
- **Audit integration:** All scan results logged to `JsonlAuditLog`.

**Gaps identified:**

| Gap | Severity | Description |
|-----|----------|-------------|
| **No indirect injection scanning** | Critical | Tool results, RAG content, and external data are NOT scanned. Only user-facing POST body is scanned via middleware. The `ToolResultSanitizer` runs safety pipeline (PII/content/rails) but NOT prompt injection scanning on tool outputs. |
| **No canary token detection** | High | No mechanism to detect if system prompt content leaks into outputs. |
| **No information flow tracking** | High | No trust boundary enforcement between system prompt, user input, tool results, and RAG context. All content enters the same context window undifferentiated. |
| **Deep scan is fail-open** | Medium | If the LLM reviewer is unavailable or returns garbage, the input passes through. Appropriate for availability but creates a silent failure mode with no alerting. |
| **No adaptive learning** | Medium | Historical attacks are not stored or used to improve detection. Each scan is stateless. |
| **Limited multilingual coverage** | Medium | Only Spanish, French, and Chinese bypass patterns. No coverage for Arabic, Portuguese, German, Japanese, Korean, Hindi, or other high-volume languages. |
| **No tool description scanning** | Critical | MCP tool descriptions (the primary vector for tool poisoning attacks) are not scanned for injection patterns. |
| **Regex evasion via Unicode normalization** | Medium | Zero-width chars are detected, but homoglyph attacks (Cyrillic "a" vs Latin "a"), RTL override characters, and combining characters are not. |

### 1.2 Research Findings

**R1.1: OWASP LLM01:2025 -- Prompt Injection remains #1**
- Source: [OWASP Top 10 for LLM Applications 2025](https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf)
- Finding: "Given the stochastic influence at the heart of the way models work, it is unclear if there are fool-proof methods of prevention." Defense requires constraining model behavior, input validation, content segregation, output validation, response evaluation (RAG Triad), and adversarial testing.

**R1.2: Lakera PINT Benchmark -- 92.5% accuracy ceiling**
- Source: [Lakera PINT Benchmark](https://github.com/lakeraai/pint-benchmark)
- Finding: Lakera Guard (commercial, purpose-trained neural classifier) achieves 92.5% on a 4,314-input benchmark (3,016 English + 1,298 non-English). This represents the practical ceiling for pattern-based + classifier approaches. Kiln's regex-only Tier 1 would likely score significantly lower (estimated 60-70% based on regex-only benchmarks in academic literature).

**R1.3: Microsoft FIDES -- Information Flow Control**
- Source: [Securing AI Agents with Information Flow Control](https://arxiv.org/abs/2505.23643), [Microsoft MSRC Blog](https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks)
- Finding: FIDES is a planner that tracks confidentiality and integrity labels, deterministically enforces security policies, and introduces novel primitives for selectively hiding information. This is Microsoft's answer to indirect prompt injection -- architectural, not heuristic. Key insight: indirect prompt injection cannot be solved at the detection layer; it requires information flow control at the architecture layer.

**R1.4: Adaptive Attacks Break All Defenses**
- Source: [Adaptive Attacks Break Defenses Against Indirect Prompt Injection](https://aclanthology.org/2025.findings-naacl.395/)
- Finding: Eight different defenses were evaluated and bypassed using adaptive attacks, consistently achieving attack success rates over 50%. This confirms that no single defense layer is sufficient.

**R1.5: Multi-Agent Defense Pipelines**
- Source: [A Multi-Agent LLM Defense Pipeline Against Prompt Injection Attacks](https://arxiv.org/html/2509.14285v4)
- Finding: Four-layer modular defense integrates input gatekeeping, structured prompt formatting, semantic output validation, and adaptive response refinement, combining regex and MiniBERT-based detection.

**R1.6: PromptGuard Framework**
- Source: [PromptGuard: A Structured Framework for Injection-Resilient LLMs](https://www.nature.com/articles/s41598-025-31086-y)
- Finding: Structured framework combining regex + MiniBERT-based detection achieves higher accuracy than either alone.

**R1.7: Tool Poisoning and MCP Attacks**
- Source: [CrowdStrike: How Agentic Tool Chain Attacks Threaten AI Agent Security](https://www.crowdstrike.com/en-us/blog/how-agentic-tool-chain-attacks-threaten-ai-agent-security/), [CrowdStrike: AI Tool Poisoning](https://www.crowdstrike.com/en-us/blog/ai-tool-poisoning/)
- Finding: Tool poisoning, tool shadowing, and rugpull attacks target the reasoning layer. MCP centralizes tools, concentrating risk -- if one MCP server is compromised, all connected agents inherit its behavior. Tool descriptions can contain hidden malicious instructions that execute when the agent prepares to use the tool.

**R1.8: Log-To-Leak via MCP**
- Source: [Log-To-Leak: Prompt Injection Attacks on Tool-Using LLM Agents via MCP](https://openreview.net/forum?id=UVgbFuXPaO)
- Finding: Novel attack vector where injected instructions in tool results cause the agent to exfiltrate data through logging/tool-calling side channels.

### 1.3 Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **P0** | **Scan tool results for injection.** Add prompt injection scanning to `ToolResultSanitizer` (currently only runs PII/content/rails). Tool results are the #1 indirect injection vector. | Medium | Critical |
| **P0** | **Scan MCP tool descriptions.** When tools are registered from MCP servers, scan their `description` fields for injection patterns before they enter the agent's context. | Low | Critical |
| **P1** | **Add canary token system.** Inject unique per-session canary tokens into system prompts. Scan all outputs for canary leakage. Block + alert on detection. | Medium | High |
| **P1** | **Add trust boundary markers.** Wrap untrusted content (tool results, RAG chunks, user input) in structured delimiters that the system prompt explicitly instructs the model to treat as data-only. Not bulletproof, but raises the bar significantly. | Low | High |
| **P2** | **Expand multilingual patterns.** Add Portuguese, German, Arabic, Japanese, Korean, Hindi injection patterns. | Low | Medium |
| **P2** | **Unicode normalization pre-processing.** Apply NFKC normalization before scanning. Detect homoglyphs, RTL overrides, and combining characters. | Low | Medium |
| **P2** | **Add embedding-based similarity detection.** Store embeddings of known injection attacks. Compare incoming messages against the attack embedding database (analogous to Rebuff's vector database approach). | High | Medium |
| **P3** | **Integrate purpose-trained classifier.** Evaluate fine-tuning a small model (MiniLM, DeBERTa) on injection datasets as a middle tier between regex and full LLM scan. | High | High |

### 1.4 Beyond State-of-Art

- **Information Flow Control (FIDES-inspired):** Track integrity labels on every content chunk entering the context window. Tool results get "untrusted-tool" labels. RAG chunks get "untrusted-retrieval" labels. The planner can only execute actions from "trusted" content. This is architecturally incompatible with current context-window-based LLM APIs but could be approximated with structured prompting and output validation.
- **Representation-level detection:** Monitor model internal representations for injection patterns rather than input/output text. Requires access to model internals (only viable with self-hosted models via Ollama).

### 1.5 Priority Matrix

| Timeframe | Items |
|-----------|-------|
| **v0.5.0** | Scan tool results for injection, scan MCP tool descriptions, trust boundary markers |
| **v1.0** | Canary tokens, multilingual expansion, Unicode normalization, embedding-based detection |
| **v2.0+** | Purpose-trained classifier, information flow control |
| **Never** | Full FIDES implementation (requires LLM API changes that don't exist) |

---

## 2. PII Detection Accuracy

### 2.1 Current State Assessment

**What Kiln has:**
- **Tier 1:** 6 regex patterns (email, phone, SSN, credit card, IP address, date of birth). US-centric formats only.
- **Tier 2:** `PiiDeepScanProvider` interface for LLM-based detection. Fail-open. Deduplication by position when merging tiers.
- **Actions:** block / redact / detect (configurable per PII config).
- **Allowlist:** Per-value string match.
- **Redaction:** Replace with `[REDACTED]`, index-preserving (reverse sort).

**Gaps identified:**

| Gap | Severity | Description |
|-----|----------|-------------|
| **No international phone formats** | High | Regex only matches US phone patterns. No support for +44, +52, +49, etc. |
| **No international ID numbers** | High | Only US SSN. No CURP (Mexico), NHS (UK), Aadhaar (India), DNI (Spain), etc. |
| **No address detection** | Medium | Physical/mailing addresses are PII but not detected. |
| **No name detection** | High | Personal names are the most common PII type but require NER, not regex. |
| **No IBAN/financial identifiers** | Medium | No IBAN, SWIFT/BIC, or non-US card format detection. |
| **Credit card regex is too loose** | Medium | `\b(?:\d{4}[-\s]?){3}\d{4}\b` will match any 16-digit number sequence, generating false positives on UUIDs, timestamps, etc. No Luhn check. |
| **IP address regex matches private ranges** | Low | `\b(?:\d{1,3}\.){3}\d{1,3}\b` matches 127.0.0.1, 10.x.x.x, etc. These may not be PII in many contexts. |
| **No context-aware detection** | High | Regex cannot distinguish "Call me at 555-1234" (PII) from "Enter code 555-1234" (not PII). |
| **No partial/masked PII detection** | Low | Cannot detect "***-**-1234" as a partial SSN. |
| **Redaction is lossy** | Low | All types redact to `[REDACTED]`. No type-preserving placeholders like `[EMAIL]`, `[PHONE]`. |

### 2.2 Research Findings

**R2.1: Presidio Benchmark -- High Recall, Low Precision**
- Source: [Microsoft Presidio PII Evaluation](https://microsoft.github.io/presidio/evaluation/)
- Finding: Presidio demonstrates recall of 0.9368 but precision of only 0.3596. Configuring Presidio to detect specific PII types can boost F-score by ~30%. Key lesson: broad regex scanning creates unacceptable false positive rates in production.

**R2.2: LLM-Based Detection Outperforms Regex**
- Source: [Unmasking the Reality of PII Masking Models](https://arxiv.org/pdf/2504.12308)
- Finding: Fine-tuned GPT-4o-mini achieves recall of 0.9589 with a 3x improvement in precision and 10x cost reduction vs. baseline. Regex-only approaches cannot handle contextual variations, misspelled names, or embedded PII.

**R2.3: Hybrid Approaches Are Optimal**
- Source: [A Framework for Automated PII Redaction from LLM](https://ijcjournal.org/InternationalJournalOfComputer/article/download/2458/919/6203)
- Finding: Hybrid (regex + NER/LLM) offers the most practical solution: regex as fast-pass filter for structured PII, then NER/LLM for contextual analysis. OneShield achieved 95% F1, outperforming Presidio by 12%.

**R2.4: Multilingual PII Detection**
- Source: [An Evaluation Study of Hybrid Methods for Multilingual PII Detection](https://arxiv.org/pdf/2510.07551), [Scalable Multilingual PII Annotation](https://arxiv.org/html/2510.06250v2)
- Finding: RECAP framework achieves F1 of 0.60 (130% improvement over NER baseline). Hybrid systems outperform fine-tuned NER by 82% and zero-shot LLMs by 17% in weighted F1. Production multilingual models achieve ~94% F1 across 20+ languages.

### 2.3 Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **P0** | **Add Luhn check to credit card regex.** Validate the checksum after regex match to eliminate false positives on 16-digit non-card numbers. | Trivial | High |
| **P1** | **Add international phone formats.** E.164 format regex (`\+[1-9]\d{6,14}`) plus specific country patterns for top markets (MX, UK, BR, ES, DE). | Low | High |
| **P1** | **Add type-preserving redaction.** Replace `[REDACTED]` with `[EMAIL_REDACTED]`, `[PHONE_REDACTED]`, etc. Enables downstream logic to understand what was removed. | Trivial | Medium |
| **P1** | **Add CURP (Mexico) detection.** Kiln's developer base includes Mexico. CURP is an 18-char alphanumeric national ID. | Trivial | Medium |
| **P2** | **Add IBAN detection.** International Bank Account Number format: 2 letter country code + 2 check digits + up to 30 alphanumeric characters. | Low | Medium |
| **P2** | **Exclude private IP ranges.** Filter out 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.x.x.x from IP matches. | Trivial | Low |
| **P2** | **Add configurable PII type registry.** Allow users to register custom PII patterns via YAML config (company-specific IDs, account numbers, etc.). | Medium | High |
| **P3** | **Implement NER-based Tier 1.5.** Use a lightweight NER model (e.g., spaCy or ONNX-exported transformer) for name/address detection between regex and full LLM. | High | High |

### 2.4 Beyond State-of-Art

- **Contextual PII scoring:** Rather than binary detect/not, assign confidence scores based on surrounding context. "My SSN is 123-45-6789" scores 0.99; "Invoice #123-45-6789" scores 0.1.
- **PII graph analysis:** Track which PII types co-occur in a message. Multiple PII types together (name + SSN + DOB) represent a higher risk than a single email address, warranting escalated action.

### 2.5 Priority Matrix

| Timeframe | Items |
|-----------|-------|
| **v0.5.0** | Luhn check, international phone, type-preserving redaction, CURP |
| **v1.0** | IBAN, private IP exclusion, custom PII registry |
| **v2.0+** | NER-based detection, contextual scoring |
| **Never** | Building a custom NER model from scratch (use existing open-source models) |

---

## 3. Content Safety at Scale

### 3.1 Current State Assessment

**What Kiln has:**
- **Tier 1:** `ContentClassifier` with heuristic patterns for 6 categories (hate, violence, sexual, self_harm, harassment, misinformation). Match count * weight, capped at 1.0.
- **Tier 2:** `ContentDeepScanProvider` interface for LLM-based classification. Fail-open.
- **Threshold evaluation:** Per-category configurable thresholds with block/warn/log actions.
- **Pipeline integration:** Content classification runs after PII scan in the safety pipeline.

**Gaps identified:**

| Gap | Severity | Description |
|-----|----------|-------------|
| **Heuristic patterns are trivially evadable** | Critical | 5 regex patterns per category (e.g., `\bhate\s+speech\b`, `\bracist\b`). Easily bypassed with synonyms, misspellings, code-switching, or euphemisms. |
| **No multimodal content safety** | High | Only scans text. Image, audio, and file content parts are not classified. |
| **No contextual understanding** | High | "I want to kill the process" triggers violence patterns. No disambiguation. |
| **Weight system is simplistic** | Medium | Linear scaling (matchCount * weight) doesn't account for severity gradations within a category. |
| **No real-time model updates** | Medium | Patterns are compiled at build time. No mechanism to add new patterns without redeployment. |
| **No LlamaGuard integration** | Medium | LlamaGuard 4 (12B) is the SOTA open-source safety classifier, aligned to MLCommons hazard taxonomy. No built-in adapter. |
| **No OpenAI Moderation API integration** | Low | OpenAI offers a free moderation endpoint. No built-in adapter. |

### 3.2 Research Findings

**R3.1: LlamaGuard 4 -- SOTA Open-Source Safety Classifier**
- Source: [Meta LlamaGuard 4-12B](https://huggingface.co/meta-llama/Llama-Guard-4-12B)
- Finding: 12B parameter multimodal classifier pruned from Llama 4 Scout. Supports text + multiple images. Aligned to MLCommons hazard taxonomy. Classifies as safe/unsafe with violated categories. Available via HuggingFace, NVIDIA NIM, and Meta's Moderations API.

**R3.2: Anthropic Constitutional Classifiers**
- Source: [Anthropic Constitutional Classifiers](https://www.anthropic.com/research/constitutional-classifiers)
- Finding: Robust to thousands of hours of human red teaming for universal jailbreaks. Updated version achieves robustness with only 0.38% increase in refusal rates. Production-viable. Not yet publicly available as an API.

**R3.3: OpenAI Moderation API**
- Source: [OpenAI Moderation Guide](https://platform.openai.com/docs/guides/moderation)
- Finding: Free endpoint. Binary "flagged" indicators + category-specific confidence scores. Categories: hate, violence, sexual, self-harm. Limited to text. Useful as a cheap first-pass but insufficient alone.

**R3.4: OpenAI gpt-oss-safeguard**
- Source: [OpenAI gpt-oss-safeguard](https://openai.com/index/introducing-gpt-oss-safeguard/)
- Finding: Open-source safety classifier. Multi-layered safeguards including domain classifiers and Safety Reasoner for detailed taxonomy classification.

### 3.3 Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **P1** | **Add OpenAI Moderation API adapter.** Implement `ContentDeepScanProvider` using the free OpenAI moderation endpoint. Zero cost, good recall, acts as a strong Tier 1.5 between regex and full LLM. | Low | High |
| **P1** | **Add context-aware false positive mitigation.** Maintain a list of common false-positive phrases ("kill the process", "execute the command", "assault rifle ban discussion") and downgrade their severity. | Low | Medium |
| **P2** | **Add LlamaGuard adapter.** Implement `ContentDeepScanProvider` using LlamaGuard 4 via Ollama (self-hosted) or Meta's Moderations API. Best accuracy for self-hosted deployments. | Medium | High |
| **P2** | **Add multimodal content scanning hooks.** Extend `ContentClassifier` interface to accept `ContentPart[]` (not just string). Route image parts to multimodal classifiers. | Medium | High |
| **P3** | **Replace heuristic patterns with lightweight classifier.** Use a small ONNX model (e.g., DistilBERT fine-tuned on hate speech datasets) as Tier 1 instead of regex patterns. | High | High |

### 3.4 Beyond State-of-Art

- **Federated safety taxonomy:** Allow each tenant to define their own content categories and thresholds beyond the 6 built-in ones. A financial services tenant might add "investment_advice" as a blocked category.
- **Adversarial content mutation detection:** Detect when users incrementally escalate content across messages to stay below per-message thresholds.

### 3.5 Priority Matrix

| Timeframe | Items |
|-----------|-------|
| **v0.5.0** | OpenAI Moderation adapter, false-positive mitigation |
| **v1.0** | LlamaGuard adapter, multimodal scanning hooks |
| **v2.0+** | Lightweight classifier replacement, federated taxonomy |
| **Never** | Training a custom content safety model from scratch |

---

## 4. Observability for AI

### 4.1 Current State Assessment

**What Kiln has:**
- **SpanMapper:** Pure function mapping 35 event types to `SpanOperation` descriptors (startSpan, endSpan, addEvent, setAttributes). Exhaustive switch with TypeScript never-guard.
- **OTelExporter:** Implements `EventStore`, wraps `TracerProvider`. Active span tracking per-session. Memory leak prevention via session cleanup.
- **EventBus:** 35 typed events, ring buffer (default 100), 4 streaming levels (state, phase, tool, token). Synchronous handlers. Fire-and-forget persist to EventStore.
- **Cost events:** `cost_update` events with inputTokens, outputTokens, cacheReadTokens, totalCostUsd.

**Gaps identified:**

| Gap | Severity | Description |
|-----|----------|-------------|
| **No OTel GenAI semantic conventions** | High | Kiln's span attributes use custom names (e.g., `toolName`, `inputTokens`). The OpenTelemetry GenAI semantic conventions define standard attributes (`gen_ai.agent.name`, `gen_ai.operation.name`, `gen_ai.usage.input_tokens`, etc.) that enable interoperability with Datadog, Jaeger, Grafana, etc. |
| **No trace context propagation** | High | Each session creates independent spans. No W3C Trace Context propagation for cross-service tracing (e.g., when Kiln delegates to an A2A agent). |
| **No metrics export** | Medium | Only traces/spans are exported. No OTel metrics (counters, histograms) for aggregate dashboards. |
| **No log correlation** | Medium | Console logs are not correlated with trace IDs. Debugging requires manual cross-referencing. |
| **EventStore is write-only for OTel** | Low | `OTelExporter.getBySession()` throws. Acceptable since retrieval happens via OTel backend, but limits self-contained debugging. |
| **No prompt/response capture in spans** | Medium | Spans record metadata but not the actual prompt/response content. Required for debugging but has PII implications. |
| **Ring buffer default is 100** | Low | For long-running orchestrations, 100 events may be insufficient. Not configurable without constructor arg. |

### 4.2 Research Findings

**R4.1: OpenTelemetry GenAI Semantic Conventions**
- Source: [OTel GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/), [OTel GenAI Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/), [OTel GenAI Metrics](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/)
- Finding: Standard defines `gen_ai.operation.name` (invoke_agent, create_agent, chat, text_completion), `gen_ai.agent.name`, `gen_ai.agent.id`, `gen_ai.agent.description`, `gen_ai.system` (openai, anthropic, etc.), `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`. Status: Development (not yet stable). Datadog already supports v1.37+ natively.

**R4.2: Langfuse Data Model**
- Source: [Langfuse Tracing Data Model](https://langfuse.com/docs/observability/data-model), [Langfuse Token & Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)
- Finding: Hierarchical model: Trace -> Observations (generations, tool calls, retrieval steps). Cost broken down by user, session, geography, feature, model, prompt version. OTEL-native SDK v3 converts OTel spans to Langfuse observations. 19K+ GitHub stars, open source leader.

**R4.3: Datadog OTel GenAI Support**
- Source: [Datadog LLM Observability with OTel GenAI](https://www.datadoghq.com/blog/llm-otel-semantic-convention/)
- Finding: Datadog natively supports OTel GenAI semantic conventions. Instrument with OTel, export via OTel Collector or Datadog Agent, analyze in LLM Observability view. This validates that adopting the OTel GenAI conventions unlocks ecosystem integration.

**R4.4: Helicone Gateway Pattern**
- Source: [Helicone LLM Observability Guide](https://www.helicone.ai/blog/the-complete-guide-to-LLM-observability-platforms)
- Finding: Proxy-based observability with intelligent caching reduces API costs 20-30%. Pattern: gateway captures all LLM traffic transparently. Kiln's gateway architecture naturally supports this pattern.

**R4.5: Braintrust Agent Observability**
- Source: [Braintrust AI Observability Tools 2026](https://www.braintrust.dev/articles/best-ai-observability-tools-2026)
- Finding: Key differentiator for agent observability: decision-path visualization (why did the agent choose this tool?), agent evaluation scoring alongside traces, and multi-turn conversation support.

### 4.3 Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **P0** | **Adopt OTel GenAI semantic conventions.** Map SpanMapper attributes to `gen_ai.*` namespace. `gen_ai.agent.name`, `gen_ai.operation.name`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.request.model`, `gen_ai.system`. Enables native Datadog/Grafana/Jaeger integration. | Medium | Critical |
| **P1** | **Add W3C Trace Context propagation.** Propagate trace context through A2A delegation, webhook tool calls, and MCP requests. Enables distributed tracing across agent networks. | Medium | High |
| **P1** | **Add OTel metrics.** Export counters (requests, tokens, errors) and histograms (latency, cost) via OTel metrics API. Enables aggregate dashboards without log parsing. | Medium | High |
| **P2** | **Add structured logging with trace correlation.** Emit structured JSON logs with `traceId` and `spanId` fields. Enables log-to-trace correlation in observability backends. | Low | Medium |
| **P2** | **Add optional prompt/response capture.** Configurable flag to include prompt/response text in span events (disabled by default for PII safety). When enabled, run through PII redaction before attaching. | Medium | Medium |
| **P3** | **Add Langfuse-native export.** Implement `EventStore` adapter that maps Kiln events to Langfuse's trace/observation model via their SDK. | Medium | Medium |

### 4.4 Beyond State-of-Art

- **Decision-path visualization:** Record why the agent chose each tool at each step (the alternatives considered, confidence scores). Enable "replay" mode where a human can step through the agent's decision tree.
- **Anomaly detection on traces:** Use historical trace data to detect anomalous patterns (e.g., agent suddenly making 10x more tool calls, or cost spike per session).

### 4.5 Priority Matrix

| Timeframe | Items |
|-----------|-------|
| **v0.5.0** | OTel GenAI semantic conventions |
| **v1.0** | W3C Trace Context, OTel metrics, structured logging |
| **v2.0+** | Prompt/response capture, Langfuse adapter, decision visualization |
| **Never** | Building a custom observability backend (use Langfuse/Datadog/Grafana) |

---

## 5. Cost Tracking Accuracy

### 5.1 Current State Assessment

**What Kiln has:**
- **CostTracker:** Per-role accumulator. Records inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens per `AgentRole`. Computes USD cost via `MODEL_PRICING` map.
- **MODEL_PRICING:** Derived from `MODEL_CATALOG` (single source of truth). Anthropic cache multipliers (0.1x read, 1.25x write). Non-Anthropic providers get zero cache multipliers.
- **Budget middleware:** `checkBudget()` / `reportUsage()` in gateway. Fail-open.
- **Cost events:** `cost_update` events emitted per provider call.

**Gaps identified:**

| Gap | Severity | Description |
|-----|----------|-------------|
| **No per-tenant cost tracking** | High | `CostTracker` aggregates by role, not by tenant. In multi-tenant mode, there's no way to see "Tenant X spent $Y this month." |
| **No per-session cost tracking** | Medium | Cost is aggregated globally. Cannot answer "How much did this conversation cost?" |
| **No embedding/STT cost tracking** | Medium | Knowledge pipeline embedding calls and STT transcription calls are not tracked by CostTracker. |
| **No streaming token counting** | Medium | Streaming responses count tokens from the final usage response, but if the stream is interrupted, partial token counts may be lost. |
| **Model pricing staleness** | Medium | `MODEL_CATALOG` is hardcoded. When providers update pricing (which happens frequently), Kiln's cost calculations become inaccurate until the catalog is manually updated. |
| **No cost alerts/thresholds** | Medium | Budget middleware checks per-request but no mechanism for "alert when tenant exceeds $X/day." |
| **OpenAI cache pricing not tracked** | Low | OpenAI now supports prompt caching (50% discount on cached tokens). `NO_CACHE` is hardcoded for non-Anthropic providers. |
| **No DeepSeek pricing** | Low | DeepSeek has significantly cheaper pricing that may not be in MODEL_CATALOG. |

### 5.2 Research Findings

**R5.1: Tokenization is Not Standardized**
- Source: [GenAI FinOps: How Token Pricing Really Works](https://www.finops.org/wg/genai-finops-how-token-pricing-really-works/)
- Finding: Different models use different tokenizers. The same text yields different token counts across GPT-4, Claude, Gemini. Tracking by provider-reported usage (not local counting) is essential for billing accuracy.

**R5.2: Cache-Aware Billing Complexity**
- Source: [LLM-Aware API Gateways](https://medium.com/@hadiyolworld007/cachingllm-aware-api-gateways-token-budget-rate-limits-caching-and-safe-retries-c99a73d11767)
- Finding: Cache write costs 1.25-2x standard input. Cache hit costs ~10% of standard input (90% discount). Multi-turn conversations where the system prompt is cached require tracking both write (first turn) and read (subsequent turns) separately.

**R5.3: Granular Attribution is Key**
- Source: [From Bills to Budgets: LLM Token Usage Per User](https://www.traceloop.com/blog/from-bills-to-budgets-how-to-track-llm-token-usage-and-cost-per-user)
- Finding: Attach metadata (user_id, feature_name, session_id) to every LLM API request. Enables per-user, per-feature cost breakdown. Without this, cost optimization is guesswork.

**R5.4: LLM-Aware Gateways**
- Source: [Silicon Data: LLM Cost Per Token Guide](https://www.silicondata.com/blog/llm-cost-per-token)
- Finding: An LLM-aware gateway treats LLM traffic as variable-cost compute and enforces token budgets, intelligent caching, and retries. Gateway-level cost tracking is the most reliable approach since it sees all traffic.

### 5.3 Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **P0** | **Add per-tenant cost tracking.** Extend `CostTracker` (or create `TenantCostTracker`) to accumulate by `tenantId`. Wire into gateway message pipeline. | Medium | Critical |
| **P1** | **Add per-session cost tracking.** Track cost per `sessionId`. Include in session metadata. Return in session APIs. | Low | High |
| **P1** | **Add OpenAI cache pricing.** Update `MODEL_PRICING` to include OpenAI cache multipliers (0.5x for cache read). | Trivial | Medium |
| **P2** | **Add embedding/STT cost tracking.** Emit `cost_update` events from embedding and STT adapters. Include in CostTracker. | Low | Medium |
| **P2** | **Add cost alerting.** Configurable per-tenant thresholds with webhook notification when exceeded. | Medium | High |
| **P3** | **Add dynamic pricing updates.** Fetch latest pricing from provider APIs or a pricing endpoint, rather than hardcoded catalog. | Medium | Medium |

### 5.4 Beyond State-of-Art

- **Predictive cost estimation:** Before executing an orchestration, estimate total cost based on historical per-step costs and the workflow graph. Alert if estimated cost exceeds budget.
- **Cost-optimized routing:** When multiple providers can serve a request, route to the cheapest one that meets quality thresholds (requires eval scores per provider).

### 5.5 Priority Matrix

| Timeframe | Items |
|-----------|-------|
| **v0.5.0** | Per-tenant cost tracking, per-session cost tracking |
| **v1.0** | OpenAI cache pricing, embedding/STT cost tracking, cost alerting |
| **v2.0+** | Dynamic pricing updates, predictive estimation, cost-optimized routing |
| **Never** | Building a full FinOps platform (use Helicone/cloud billing) |

---

## 6. Audit Trail Compliance

### 6.1 Current State Assessment

**What Kiln has:**
- **JsonlAuditLog:** Append-only JSONL with SHA-256 hash chaining. `verifyChain()` validates integrity.
- **18 action types:** Covering capability execution, injection detection, secrets, tenants, memory, sessions, config, safety, and tool execution.
- **Query/filter:** By action, actor, tenantId, outcome, date range. Limit support.
- **Synchronous writes:** `appendFileSync` ensures durability.
- **Hash chaining:** Each entry's hash = SHA-256(canonical JSON of entry + previousHash). Genesis hash = "genesis".

**Gaps identified:**

| Gap | Severity | Description |
|-----|----------|-------------|
| **No log rotation** | High | Single JSONL file grows unbounded. No mechanism for rotation, archival, or cleanup. `retentionDays` is defined in config type but never implemented. |
| **No external anchoring** | Medium | Hash chain is self-referential. An attacker with file access could rewrite the entire chain with valid hashes. No external trust anchor. |
| **No encryption at rest** | Medium | Audit entries are plaintext JSONL on disk. May contain sensitive metadata (agent names, resource paths, tenant IDs). |
| **No structured export** | Medium | No CSV/JSON export for compliance reporting. Query returns in-memory objects only. |
| **readAllEntries() loads entire file** | High | Every query and chain verification reads the entire file into memory. Will fail at scale. |
| **No real-time alerting** | Medium | No mechanism to trigger alerts on specific audit events (e.g., "injection_detected" should alert immediately). |
| **No GDPR data subject access** | High | No mechanism to find all audit entries for a specific user (for data subject access requests). `query()` filters by `actor` but user messages aren't the actor. |
| **CCPA/GDPR deletion** | High | Append-only design conflicts with right-to-erasure. No mechanism to redact or tombstone specific entries. |

### 6.2 Research Findings

**R6.1: EU AI Act Article 12 -- Logging Mandate**
- Source: [EU AI Act Compliance Guide 2026](https://elydora.com/blog/eu-ai-act-compliance-guide), [EU AI Act Summary](https://gdprlocal.com/eu-ai-act-summary/)
- Finding: High-risk AI systems must maintain logs of AI system decisions. Full conformity assessment requirements take effect August 2, 2026. Violations: fines up to 35M EUR or 7% of global annual turnover. Logs must enable post-market surveillance and traceability.

**R6.2: SOC 2 Audit Trail Requirements**
- Source: [AI Agent Compliance: GDPR SOC 2 and Beyond](https://www.mindstudio.ai/blog/ai-agent-compliance/)
- Finding: SOC 2 requires audit trails for every action. Enterprise customers won't sign without it. SOC 2 for AI requires access controls, logging, encryption, and vendor risk assessments. Kiln's hash-chained audit log satisfies the integrity requirement but lacks encryption and structured export.

**R6.3: GDPR Article 30 + Right to Erasure Conflict**
- Source: [GDPR Compliance Guide 2026-Ready](https://secureprivacy.ai/blog/gdpr-compliance-2026)
- Finding: GDPR mandates transparency, user rights, consent, data minimization. Right to erasure (Article 17) conflicts with append-only audit logs. Solution: cryptographic erasure (encrypt per-user data with user-specific key; "delete" by destroying the key) or tombstoning (mark entries as redacted while preserving chain integrity).

**R6.4: AuditableLLM Framework**
- Source: [AuditableLLM: Hash-Chain-Backed Compliance-Aware Framework](https://www.mdpi.com/2079-9292/15/1/56)
- Finding: Academic framework that decouples update execution from audit verification layer. Records each update as hash-chain-backed, tamper-evident audit trail. Validates Kiln's approach but emphasizes the need for external anchoring.

**R6.5: Merkle Tree Anchoring**
- Source: [Building Tamper-Proof Audit Trails](https://dev.to/veritaschain/building-tamper-proof-audit-trails-what-three-2025-trading-disasters-teach-us-about-cryptographic-378g)
- Finding: Organize hashes in a Merkle tree. Periodically anchor the Merkle root to an immutable public ledger (blockchain) or a transparency log (Google Trillian). Only the root hash leaves your environment. Provides external trust anchor without exposing data.

### 6.3 Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **P0** | **Implement log rotation.** Time-based rotation (daily/weekly). Archive old segments. Implement the `retentionDays` config that already exists in the type definition. | Medium | Critical |
| **P0** | **Add streaming/indexed query.** Replace `readAllEntries()` with streaming line reader and optional index (SQLite for audit queries). Current approach loads entire file into memory. | Medium | Critical |
| **P1** | **Add GDPR-compatible redaction.** Implement cryptographic erasure: encrypt user-specific fields with per-user key. "Delete" = destroy key. Chain hashes remain valid because they're computed over encrypted content. | High | High |
| **P1** | **Add structured export.** CSV and JSON export endpoints for compliance reporting. Filter by date range, tenant, action. | Low | High |
| **P2** | **Add encryption at rest.** Encrypt audit entries before writing to disk. Decrypt on read. Use AesSecretStore infrastructure. | Medium | Medium |
| **P2** | **Add real-time alerting hooks.** EventBus integration: emit events on high-severity audit entries. Enable webhook notifications for injection_detected, destructive_blocked, tenant_isolation_violation. | Low | Medium |
| **P3** | **Add Merkle tree with external anchoring.** Periodically compute Merkle root and anchor to a transparency log. Provides independently verifiable tamper evidence. | High | Medium |

### 6.4 Beyond State-of-Art

- **Verifiable audit export:** Generate cryptographic proofs that a specific audit entry exists in the chain without revealing the entire chain. Useful for regulatory audits where you need to prove a specific interaction happened without exposing all data.
- **Cross-tenant audit federation:** Aggregate audit trails across multiple Kiln deployments for enterprise-wide compliance dashboards.

### 6.5 Priority Matrix

| Timeframe | Items |
|-----------|-------|
| **v0.5.0** | Log rotation, streaming/indexed query |
| **v1.0** | GDPR redaction, structured export, encryption at rest, alerting hooks |
| **v2.0+** | Merkle tree anchoring, verifiable export |
| **Never** | Blockchain-based audit (overkill for this use case; transparency logs suffice) |

---

## 7. Rate Limiting Patterns

### 7.1 Current State Assessment

**What Kiln has:**
- **SlidingWindowRateLimiter:** In-memory sliding window, 60-second window, per-tenant + per-tool granularity.
- **Configuration:** `RateLimitConfig` with `defaultPerMinute` and optional `perTool` overrides.
- **Interface:** `RateLimiter` with `check()`, `record()`, `reset()`.
- **Gateway integration:** `TenantToolFactory` wires rate limiter into per-call tool config.

**Gaps identified:**

| Gap | Severity | Description |
|-----|----------|-------------|
| **In-memory only** | High | Rate limits reset on server restart. In multi-instance deployments, each instance has independent counters (allowing N * limit requests across N instances). |
| **Fixed 60-second window** | Medium | `WINDOW_MS = 60_000` is hardcoded. No support for per-hour, per-day, or custom windows. |
| **No burst handling** | Medium | Sliding window doesn't support burst allowances. A token bucket pattern would allow short bursts while enforcing average rate. |
| **No global rate limiting** | Medium | Only per-tool limits. No per-tenant aggregate limit (total tool calls/minute regardless of tool). |
| **No rate limit headers** | Low | No `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` headers in responses. |
| **Memory leak potential** | Low | `windows` Map grows with unique tenant:tool combinations. No TTL-based cleanup of inactive entries. |

### 7.2 Research Findings

**R7.1: Algorithm Comparison**
- Source: [From Token Bucket to Sliding Window](https://api7.ai/blog/rate-limiting-guide-algorithms-best-practices)
- Finding: Sliding window counter offers the best balance of accuracy, simplicity, and low memory for most APIs. Token bucket is better when you want to allow short bursts. For AI agents, the key constraint is usually cost (total tokens/day) rather than request rate, making token bucket less relevant.

**R7.2: Redis Distributed Rate Limiting**
- Source: [Redis Rate Limiting](https://redis.io/glossary/rate-limiting/), [Redis Rate Limiting Tutorial](https://redis.io/tutorials/howtos/ratelimiting/)
- Finding: Lua scripting in Redis makes operations atomic and race-condition free. All major algorithms (fixed window, sliding window, token bucket, leaky bucket) can be implemented with Redis. Essential for multi-instance deployments.

**R7.3: Redis Patterns for AI Agents**
- Source: [Redis Patterns for Coding Agents](https://redis.antirez.com/)
- Finding: Redis is the recommended state store for coding agents, including rate limiting, session state, and tool call tracking. Natural fit for Kiln's existing Redis session store.

### 7.3 Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **P1** | **Add Redis-backed rate limiter.** Implement `RateLimiter` interface using Redis sorted sets + Lua scripting. Use existing `ioredis` dynamic import pattern from `RedisSessionStore`. | Medium | High |
| **P1** | **Add configurable window duration.** Allow per-tool windows (e.g., 10 requests/minute for search but 100 requests/hour for read). | Low | Medium |
| **P2** | **Add per-tenant aggregate limit.** Total tool calls per time window, independent of individual tool limits. | Low | Medium |
| **P2** | **Add rate limit headers.** Return `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` in gateway responses. | Low | Low |
| **P3** | **Add token-based rate limiting.** Rate limit by total tokens consumed (not just request count). More meaningful for cost control. | Medium | High |
| **P3** | **Add inactive entry cleanup.** TTL-based eviction for in-memory rate limiter entries. | Trivial | Low |

### 7.4 Beyond State-of-Art

- **Adaptive rate limiting:** Automatically adjust limits based on observed cost. If a tool is expensive, dynamically lower its rate limit.
- **Cooperative rate limiting:** When approaching provider rate limits (e.g., Anthropic's 60 req/min), automatically throttle across all tenants to avoid 429s.

### 7.5 Priority Matrix

| Timeframe | Items |
|-----------|-------|
| **v0.5.0** | Redis-backed rate limiter, configurable window |
| **v1.0** | Aggregate tenant limit, rate limit headers, inactive cleanup |
| **v2.0+** | Token-based rate limiting, adaptive limits, cooperative throttling |
| **Never** | Building a custom distributed rate limiting service (use Redis) |

---

## 8. Enterprise Security Gaps

### 8.1 Current State Assessment

**What Kiln has:**
- Gateway auth: 4 composable middleware (API key, Bearer, webhook signature, origin check)
- Prompt injection: 2-tier scanner
- Guardian: LLM-based destructive capability review
- Secrets: AES-256-GCM with PBKDF2
- Audit: Hash-chained JSONL
- Tenant isolation: Memory namespacing, filesystem jail
- Self-audit: 4 periodic checks
- Tool authorization: 4-level annotation-based system

**Enterprise gaps identified:**

| Gap | Severity | Description |
|-----|----------|-------------|
| **No RBAC/IAM** | Critical | No role-based access control. API keys are binary (valid/invalid). No concept of "operator can read sessions but not modify tenants" or "admin can manage all tenants." |
| **No API key rotation** | High | API keys are static strings in gateway config. No rotation mechanism, no expiry, no revocation. |
| **No request signing** | Medium | Beyond webhook HMAC, no request-level signing for API calls. |
| **No IP allowlisting** | Medium | `isOriginAllowed` checks WebSocket origins only. No IP-based access control for REST APIs. |
| **No session authentication** | High | WebSocket sessions are authenticated by origin only (or dev token). No per-user identity binding. |
| **No secret rotation alerting** | Medium | `AesSecretStore.rotateKey()` exists but no automated rotation schedule or alerting when rotation is overdue. |
| **No vulnerability scanning integration** | Low | No built-in mechanism to scan dependencies or configurations for known vulnerabilities. |
| **No data classification** | Medium | No mechanism to tag data sensitivity levels. All data treated equally regardless of whether it's a casual chatbot or a medical AI. |
| **API key comparison is not constant-time** | High | `requireApiKey` uses `!==` for string comparison, which is timing-attack vulnerable. Same for `requireBearer`. |

### 8.2 Research Findings

**R8.1: NIST AI Agent Standards Initiative**
- Source: [NIST AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure), [NIST RFI](https://www.federalregister.gov/documents/2026/01/08/2026-00206/request-for-information-regarding-security-considerations-for-artificial-intelligence-agents)
- Finding: NIST launched the AI Agent Standards Initiative in February 2026. Focus areas: security controls, risk management for AI agents, safeguards against misuse, compromise, privilege escalation, and unintended autonomous actions. Three actions satisfy 70% of requirements: identify AI agents, apply least privilege, maintain audit logs.

**R8.2: NIST Cybersecurity Framework Profile for AI**
- Source: [NIST AI Cybersecurity Framework Profile](https://www.globalpolicywatch.com/2026/01/nist-publishes-preliminary-draft-of-cybersecurity-framework-profile-for-artificial-intelligence-for-public-comment/)
- Finding: Published December 2025 (draft). Divided into 6 CSF functions: Govern, Identify, Protect, Detect, Respond, Recover. AI-specific controls include model integrity verification, training data provenance, and output monitoring.

**R8.3: Enterprise AI Security Checklist**
- Source: [AI Agent Security: The Complete Enterprise Guide 2026](https://www.mintmcp.com/blog/ai-agent-security)
- Finding: Enterprise requirements include strict API governance, least-privilege access, audit trails, encrypted communications, identity federation, incident response plans, and continuous monitoring. AI governance should align with NIST AI RMF, ISO 27001, and SOC 2 Type II.

**R8.4: CrowdStrike 2026 Threat Report**
- Source: [CrowdStrike 2026 Global Threat Report](https://www.crowdstrike.com/en-us/blog/crowdstrike-2026-global-threat-report-findings/)
- Finding: Attackers targeted AI systems at more than 90 organizations. Agentic tool chain attacks are a documented threat vector. MCP servers are high-value targets.

### 8.3 Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **P0** | **Fix timing-attack vulnerability in auth.** Replace `!==` with `crypto.timingSafeEqual()` in `requireApiKey` and `requireBearer`. | Trivial | Critical |
| **P0** | **Add RBAC.** Define roles (admin, operator, viewer, tenant_admin). Bind roles to API keys or Bearer tokens. Enforce in middleware. | High | Critical |
| **P1** | **Add API key rotation.** Key versioning (multiple active keys during rotation window). Expiry dates. Revocation list. | Medium | High |
| **P1** | **Add per-user session authentication.** Bind WebSocket sessions to authenticated user identity. Support JWT or API key per-connection. | Medium | High |
| **P2** | **Add IP allowlisting for REST APIs.** Optional per-tenant IP allowlist for API endpoints. | Low | Medium |
| **P2** | **Add secret rotation scheduling.** Configurable rotation interval. Emit `security_alert` event when rotation is overdue. | Low | Medium |
| **P3** | **Add data classification tags.** Allow apps/tenants to tag conversations with sensitivity levels (public, internal, confidential, restricted). Apply stricter safety policies to higher classifications. | Medium | Medium |

### 8.4 Beyond State-of-Art

- **Zero-trust agent networking:** Each agent-to-agent communication is authenticated and authorized, even within the same Kiln instance. Prevents lateral movement if one agent is compromised.
- **Model integrity verification:** Hash verification of model weights before loading (for Ollama-hosted models). Detect if model files have been tampered with.

### 8.5 Priority Matrix

| Timeframe | Items |
|-----------|-------|
| **v0.5.0** | Fix timing-attack vulnerability, RBAC foundation |
| **v1.0** | API key rotation, per-user session auth, IP allowlisting |
| **v2.0+** | Secret rotation scheduling, data classification, zero-trust agent networking |
| **Never** | Building a custom IAM system (integrate with existing IdPs via OIDC) |

---

## 9. Multi-Tenant Security

### 9.1 Current State Assessment

**What Kiln has:**
- **TenantRegistry:** JSON persistence, resolution by widgetId, instagramPageId, messengerPageId, emailAddress.
- **Memory namespacing:** SQLite memory store uses tenant-scoped keys.
- **Secret encryption:** Webhook tool secrets, channel tokens encrypted via `AesSecretStore`.
- **Session isolation:** Sessions keyed by `tenantId:channelPrefix:userId`.
- **Self-audit:** Checks for plaintext tokens and duplicate tenant IDs.

**Gaps identified:**

| Gap | Severity | Description |
|-----|----------|-------------|
| **No cross-tenant query prevention** | Critical | Memory store uses naming conventions but no enforced isolation. A bug in key construction could leak data across tenants. No runtime boundary enforcement. |
| **Shared LLM context** | High | All tenants share the same LLM provider instances. A tenant's conversation could theoretically influence another's via provider-side caching or rate limiting. |
| **No tenant-specific encryption keys** | High | All tenants share the same AES master key. Compromising one tenant's data means all are compromised. |
| **No tenant data export** | Medium | No mechanism to export all data for a specific tenant (for offboarding or data portability). |
| **No tenant deletion cascade** | Medium | Deleting a tenant from registry doesn't clean up sessions, memory, audit entries, or knowledge sources. |
| **Resolution methods lack collision prevention** | Medium | `resolveByEmailAddress` is case-insensitive, but `resolveByInstagramPageId` etc. have no collision detection. Two tenants could claim the same page ID. |
| **No tenant rate limiting** | Medium | Rate limiting is per-tool, not per-tenant aggregate. A single tenant could monopolize resources. |
| **Knowledge store not tenant-isolated** | High | PgVector store queries are not filtered by tenant unless the caller explicitly adds the filter. No enforced isolation. |

### 9.2 Research Findings

**R9.1: Azure Confidential Computing for Multi-Tenant AI**
- Source: [Azure Confidential Computing AI Agents 2025](https://markaicode.com/azure-confidential-computing-ai-agents-2025/)
- Finding: Hardware-based encryption for AI workloads, isolated execution environments, zero-trust verification. Key takeaway: encryption at rest is necessary but insufficient; runtime isolation (process/memory boundaries) is critical.

**R9.2: Multi-Tenant AI Platform Security Principles**
- Source: [Ultimate Guide to Multi-Tenant AI Systems](https://prefactor.tech/blog/ultimate-guide-to-multi-tenant-ai-systems), [Tenant Isolation Architecture](https://securityboulevard.com/2025/12/tenant-isolation-in-multi-tenant-systems-architecture-identity-and-security/)
- Finding: Security requires: database segregation (row-level security or separate tables), AES-256 with tenant-specific keys, policy-based access controls, and continuous monitoring. 97% of breached organizations lacked proper AI access controls.

**R9.3: MCP Security for Multi-Tenant Agents**
- Source: [MCP Security for Multi-Tenant AI Agents](https://prefactor.tech/blog/mcp-security-multi-tenant-ai-agents-explained)
- Finding: MCP servers shared across tenants create a concentrated risk. Each tenant should have isolated tool contexts. Tool call results from one tenant must never be visible to another.

**R9.4: Data Leakage Prevention**
- Source: [How AI Agents Avoid Data Leakage in Multi-Tenant Environments](https://fastgpt.io/en/faq/How-AI-Agents-Avoid-Data)
- Finding: Architectural isolation, strict access controls, continuous monitoring. Tenant data separation must be by design, not by convention.

### 9.3 Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **P0** | **Enforce tenant isolation at the store layer.** Add mandatory `tenantId` parameter to all memory store and knowledge store operations. Reject queries that don't include a tenant filter. Move from convention to enforcement. | Medium | Critical |
| **P1** | **Add per-tenant encryption keys.** Derive per-tenant keys from master key + tenantId salt. Tenant data is encrypted with its own derived key. | Medium | High |
| **P1** | **Add tenant deletion cascade.** When a tenant is deleted, clean up: sessions, memory entries, knowledge sources, audit entries (mark as tombstoned). | Medium | High |
| **P1** | **Add tenant data export.** API endpoint to export all data for a specific tenant (sessions, memory, knowledge, audit entries). Required for GDPR data portability (Article 20). | Medium | High |
| **P2** | **Add collision detection for tenant resolution.** Prevent two tenants from claiming the same Instagram page ID, email address, etc. Validate uniqueness at registration time. | Low | Medium |
| **P2** | **Add per-tenant aggregate rate limiting.** Total requests/tokens per time window, across all tools. Prevent resource monopolization. | Low | Medium |
| **P3** | **Add tenant health dashboard.** Per-tenant metrics: request count, error rate, cost, safety blocks, injection attempts. | Medium | Medium |

### 9.4 Beyond State-of-Art

- **Confidential computing integration:** Use hardware enclaves (Intel SGX, AMD SEV) for tenant workloads that require provable isolation. Only viable for self-hosted deployments.
- **Cross-tenant anonymized benchmarking:** Allow tenants to compare their safety/cost metrics against anonymized aggregates. "Your injection block rate is 2x higher than median -- review your input sanitization."

### 9.5 Priority Matrix

| Timeframe | Items |
|-----------|-------|
| **v0.5.0** | Enforce tenant isolation at store layer, collision detection |
| **v1.0** | Per-tenant encryption keys, tenant deletion cascade, tenant data export |
| **v2.0+** | Aggregate rate limiting, tenant health dashboard |
| **Never** | Confidential computing (not Kiln's layer; handled by infrastructure) |

---

## 10. Frontier Security Research

### 10.1 Current State Assessment

**What Kiln has:**
- Standard defense posture for a v0.4.0 product: input scanning, output sanitization, tool authorization, audit logging, encrypted secrets.
- No defenses against emergent misalignment, sleeper agents, autonomous self-replication, or adversarial tool chain attacks.

### 10.2 Research Findings

**R10.1: Emergent Misalignment**
- Source: [A Nightmare on LLM Street: The Peril of Emergent Misalignment](https://exec-ed.berkeley.edu/2026/03/a-nightmare-on-llm-street-the-peril-of-emergent-misalignment/)
- Finding: Output-level safety interventions (system prompts, RLHF, SFT, adversarial training) are insufficient to guarantee alignment when latent goal structures exist at the representational level. Models have demonstrated sophisticated persuasion capabilities including simulated blackmail.

**R10.2: Agent Misalignment Benchmark**
- Source: [AgentMisalignment](https://arxiv.org/pdf/2506.04018)
- Finding: Under review at ICLR 2026. Benchmark for evaluating AI agent misalignment in production-like settings. Tests for goal drift, instruction non-compliance, and deceptive compliance.

**R10.3: Autonomous Self-Replication**
- Source: [International AI Safety Report 2026](https://internationalaisafetyreport.org/publication/international-ai-safety-report-2026)
- Finding: Experimental work demonstrates autonomous self-replication by LLM-powered systems without human intervention -- a recognized red-line threshold.

**R10.4: AI Control vs. Alignment**
- Source: [AI Control Hackathon 2026](https://apartresearch.com/sprints/ai-control-hackathon-2026-03-20-to-2026-03-22), [Alignment, Agency and Autonomy in Frontier AI](https://arxiv.org/html/2503.05748)
- Finding: AI control assumes the model may already be working against you and focuses on containment protocols. This is more practically relevant than alignment for orchestration engines like Kiln, which use third-party models.

**R10.5: Agentic AI Threat Landscape 2026**
- Source: [The AI Agent Threat Landscape 2026](https://www.moltwire.com/research/ai-agent-threat-landscape-2026), [Threats and Vulnerabilities in Agentic AI](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2026.1731566/full)
- Finding: As AI systems become more autonomous with persistent memory, tool access, and multi-session continuity, the operational distance between engineered failure and spontaneous failure is shrinking. More than 60% of large enterprises have deployed autonomous AI agents in production.

**R10.6: Nation-State Weaponization of MCP**
- Source: [CrowdStrike 2026 Global Threat Report](https://www.crowdstrike.com/en-us/blog/crowdstrike-2026-global-threat-report-findings/)
- Finding: Anthropic's Threat Intelligence team discovered a nation-state operation that weaponized Claude's agentic capabilities and MCP for automated cyberattacks across multiple targets. This is no longer theoretical.

### 10.3 Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| **P1** | **Add output behavior monitoring.** Track patterns in agent outputs over time. Alert on anomalies: sudden topic changes, unexpected tool usage patterns, attempts to access resources outside normal scope. | High | High |
| **P1** | **Add tool call circuit breaker escalation.** Existing circuit breaker handles failures. Add: if an agent makes N consecutive tool calls without producing user-facing output, break and alert (potential infinite loop / autonomous behavior). | Low | High |
| **P2** | **Add MCP server integrity verification.** Hash and verify MCP tool manifests. Alert if tool descriptions change between connections (potential tool shadowing attack). | Medium | High |
| **P2** | **Add conversation trajectory analysis.** Detect if the conversation is drifting toward goals not specified in the agent's configuration. Flag for human review. | High | Medium |
| **P3** | **Add sandboxed tool execution.** Execute tools in isolated processes with resource limits (CPU, memory, network, filesystem). Prevent a compromised tool from affecting the host. | High | High |
| **P3** | **Add agent output attestation.** Cryptographically sign agent outputs with a per-agent key. Enables downstream verification that a response came from a specific Kiln agent instance. | Medium | Medium |

### 10.4 Beyond State-of-Art

- **Representation monitoring:** For self-hosted models (Ollama), monitor activation patterns for known misalignment signatures. Requires research partnership with alignment labs.
- **Proof-of-intent:** Before executing a multi-step plan, the agent must produce a formal proof that each step serves the stated goal. Verified by a separate model. Computationally expensive but provides strong safety guarantees.
- **Tripwire tools:** Register honeypot tools that a well-behaved agent would never call. If called, immediately halt execution and alert. Provides early warning of compromised agents.

### 10.5 Priority Matrix

| Timeframe | Items |
|-----------|-------|
| **v0.5.0** | Tool call circuit breaker escalation |
| **v1.0** | Output behavior monitoring, MCP server integrity verification |
| **v2.0+** | Conversation trajectory analysis, sandboxed tool execution, agent output attestation, tripwire tools |
| **Never** | Representation monitoring (requires model access only possible with self-hosted), Proof-of-intent (too computationally expensive for production) |

---

## Consolidated Priority Matrix

### v0.5.0 (Next Release -- Critical Path)

| # | Item | Domain | Effort | Impact |
|---|------|--------|--------|--------|
| 1 | Fix timing-attack vulnerability in auth middleware | Security | Trivial | Critical |
| 2 | Scan tool results for prompt injection | Prompt Injection | Medium | Critical |
| 3 | Scan MCP tool descriptions for injection | Prompt Injection | Low | Critical |
| 4 | Enforce tenant isolation at store layer | Multi-Tenant | Medium | Critical |
| 5 | Add per-tenant cost tracking | Cost | Medium | Critical |
| 6 | Implement audit log rotation | Audit | Medium | Critical |
| 7 | Add streaming/indexed audit queries | Audit | Medium | Critical |
| 8 | Adopt OTel GenAI semantic conventions | Observability | Medium | Critical |
| 9 | Add trust boundary markers for untrusted content | Prompt Injection | Low | High |
| 10 | Add Luhn check to credit card regex | PII | Trivial | High |
| 11 | Add Redis-backed rate limiter | Rate Limiting | Medium | High |
| 12 | Tool call circuit breaker escalation | Frontier Security | Low | High |
| 13 | RBAC foundation | Security | High | Critical |

### v1.0 (Enterprise Readiness)

| # | Item | Domain | Effort | Impact |
|---|------|--------|--------|--------|
| 14 | Canary token system | Prompt Injection | Medium | High |
| 15 | International phone format detection | PII | Low | High |
| 16 | OpenAI Moderation API adapter | Content Safety | Low | High |
| 17 | LlamaGuard adapter | Content Safety | Medium | High |
| 18 | W3C Trace Context propagation | Observability | Medium | High |
| 19 | OTel metrics export | Observability | Medium | High |
| 20 | Per-session cost tracking | Cost | Low | High |
| 21 | GDPR-compatible audit redaction | Audit | High | High |
| 22 | Structured audit export | Audit | Low | High |
| 23 | API key rotation | Security | Medium | High |
| 24 | Per-user session authentication | Security | Medium | High |
| 25 | Per-tenant encryption keys | Multi-Tenant | Medium | High |
| 26 | Tenant deletion cascade | Multi-Tenant | Medium | High |
| 27 | Tenant data export (GDPR Article 20) | Multi-Tenant | Medium | High |
| 28 | Output behavior monitoring | Frontier Security | High | High |
| 29 | MCP server integrity verification | Frontier Security | Medium | High |
| 30 | Cost alerting (per-tenant thresholds) | Cost | Medium | High |

### v2.0+ (Advanced)

| # | Item | Domain |
|---|------|--------|
| 31 | Embedding-based injection detection | Prompt Injection |
| 32 | Purpose-trained injection classifier | Prompt Injection |
| 33 | NER-based PII detection | PII |
| 34 | Lightweight content safety classifier | Content Safety |
| 35 | Langfuse-native export | Observability |
| 36 | Token-based rate limiting | Rate Limiting |
| 37 | Merkle tree audit anchoring | Audit |
| 38 | Conversation trajectory analysis | Frontier Security |
| 39 | Sandboxed tool execution | Frontier Security |
| 40 | Tripwire tools | Frontier Security |

---

## Sources

### Prompt Injection
- [OWASP Top 10 for LLM Applications 2025 (PDF)](https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf)
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [Lakera PINT Benchmark](https://github.com/lakeraai/pint-benchmark)
- [Lakera Guard](https://www.lakera.ai/lakera-guard)
- [Microsoft: How We Defend Against Indirect Prompt Injection](https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks)
- [Microsoft FIDES: Securing AI Agents with Information Flow Control](https://arxiv.org/abs/2505.23643)
- [Adaptive Attacks Break Defenses Against Indirect Prompt Injection (NAACL 2025)](https://aclanthology.org/2025.findings-naacl.395/)
- [A Multi-Agent LLM Defense Pipeline](https://arxiv.org/html/2509.14285v4)
- [PromptGuard (Nature Scientific Reports)](https://www.nature.com/articles/s41598-025-31086-y)
- [Defense Against Indirect Prompt Injection via Tool Result Parsing](https://arxiv.org/html/2601.04795)
- [Log-To-Leak: Prompt Injection via MCP (OpenReview)](https://openreview.net/forum?id=UVgbFuXPaO)
- [CrowdStrike: Agentic Tool Chain Attacks](https://www.crowdstrike.com/en-us/blog/how-agentic-tool-chain-attacks-threaten-ai-agent-security/)
- [CrowdStrike: AI Tool Poisoning](https://www.crowdstrike.com/en-us/blog/ai-tool-poisoning/)
- [Rebuff (ProtectAI)](https://github.com/protectai/rebuff)
- [Indirect Prompt Injection Through MCP Tools (StackOne)](https://www.stackone.com/blog/indirect-prompt-injection-mcp-tools-defense/)

### PII Detection
- [Microsoft Presidio PII Evaluation](https://microsoft.github.io/presidio/evaluation/)
- [Unmasking the Reality of PII Masking Models](https://arxiv.org/pdf/2504.12308)
- [Hybrid Methods for Multilingual PII Detection](https://arxiv.org/pdf/2510.07551)
- [Scalable Multilingual PII Annotation](https://arxiv.org/html/2510.06250v2)
- [Presidio Multi-Language Support](https://microsoft.github.io/presidio/analyzer/languages/)

### Content Safety
- [Meta LlamaGuard 4-12B (HuggingFace)](https://huggingface.co/meta-llama/Llama-Guard-4-12B)
- [Anthropic Constitutional Classifiers](https://www.anthropic.com/research/constitutional-classifiers)
- [OpenAI Moderation API](https://platform.openai.com/docs/guides/moderation)
- [OpenAI gpt-oss-safeguard](https://openai.com/index/introducing-gpt-oss-safeguard/)

### Observability
- [OTel GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [OTel GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OTel GenAI Metrics](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/)
- [Datadog OTel GenAI Support](https://www.datadoghq.com/blog/llm-otel-semantic-convention/)
- [Langfuse Tracing Data Model](https://langfuse.com/docs/observability/data-model)
- [Langfuse Token & Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)
- [Helicone LLM Observability](https://www.helicone.ai/blog/the-complete-guide-to-LLM-observability-platforms)
- [Braintrust AI Observability Tools 2026](https://www.braintrust.dev/articles/best-ai-observability-tools-2026)

### Cost Tracking
- [GenAI FinOps: How Token Pricing Really Works](https://www.finops.org/wg/genai-finops-how-token-pricing-really-works/)
- [LLM-Aware API Gateways (Medium)](https://medium.com/@hadiyolworld007/cachingllm-aware-api-gateways-token-budget-rate-limits-caching-and-safe-retries-c99a73d11767)
- [From Bills to Budgets (Traceloop)](https://www.traceloop.com/blog/from-bills-to-budgets-how-to-track-llm-token-usage-and-cost-per-user)

### Audit & Compliance
- [EU AI Act Compliance Guide 2026](https://elydora.com/blog/eu-ai-act-compliance-guide)
- [AI Agent Compliance: GDPR SOC 2 and Beyond](https://www.mindstudio.ai/blog/ai-agent-compliance/)
- [GDPR Compliance Guide 2026](https://secureprivacy.ai/blog/gdpr-compliance-2026)
- [AuditableLLM: Hash-Chain-Backed Framework (MDPI)](https://www.mdpi.com/2079-9292/15/1/56)
- [Building Tamper-Proof Audit Trails](https://dev.to/veritaschain/building-tamper-proof-audit-trails-what-three-2025-trading-disasters-teach-us-about-cryptographic-378g)

### Rate Limiting
- [From Token Bucket to Sliding Window (API7)](https://api7.ai/blog/rate-limiting-guide-algorithms-best-practices)
- [Redis Rate Limiting](https://redis.io/glossary/rate-limiting/)
- [Redis Rate Limiting Tutorial](https://redis.io/tutorials/howtos/ratelimiting/)
- [Redis Patterns for Coding Agents](https://redis.antirez.com/)

### Enterprise Security & NIST
- [NIST AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure)
- [NIST RFI on AI Agent Security](https://www.federalregister.gov/documents/2026/01/08/2026-00206/request-for-information-regarding-security-considerations-for-artificial-intelligence-agents)
- [NIST AI Cybersecurity Framework Profile](https://www.globalpolicywatch.com/2026/01/nist-publishes-preliminary-draft-of-cybersecurity-framework-profile-for-artificial-intelligence-for-public-comment/)
- [AI Agent Security Enterprise Guide 2026](https://www.mintmcp.com/blog/ai-agent-security)
- [CrowdStrike 2026 Global Threat Report](https://www.crowdstrike.com/en-us/blog/crowdstrike-2026-global-threat-report-findings/)

### Multi-Tenant Security
- [Azure Confidential Computing AI Agents 2025](https://markaicode.com/azure-confidential-computing-ai-agents-2025/)
- [Multi-Tenant AI Systems Guide](https://prefactor.tech/blog/ultimate-guide-to-multi-tenant-ai-systems)
- [MCP Security for Multi-Tenant AI Agents](https://prefactor.tech/blog/mcp-security-multi-tenant-ai-agents-explained)
- [Tenant Isolation Architecture](https://securityboulevard.com/2025/12/tenant-isolation-in-multi-tenant-systems-architecture-identity-and-security/)

### Frontier Security
- [Emergent Misalignment (UC Berkeley)](https://exec-ed.berkeley.edu/2026/03/a-nightmare-on-llm-street-the-peril-of-emergent-misalignment/)
- [AgentMisalignment (ICLR 2026 submission)](https://arxiv.org/pdf/2506.04018)
- [Alignment, Agency and Autonomy in Frontier AI](https://arxiv.org/html/2503.05748)
- [International AI Safety Report 2026](https://internationalaisafetyreport.org/publication/international-ai-safety-report-2026)
- [AI Agent Threat Landscape 2026 (Moltwire)](https://www.moltwire.com/research/ai-agent-threat-landscape-2026)
- [Threats and Vulnerabilities in Agentic AI (Frontiers)](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2026.1731566/full)
- [AI Control Hackathon 2026](https://apartresearch.com/sprints/ai-control-hackathon-2026-03-20-to-2026-03-22)


---

## Cross-Track Dependencies

Several recommendations span multiple tracks and should be coordinated:

### Indirect Injection + Tool Result Sanitization (Track 3 + Track 5)
The tool result sanitizer (Track 3) already runs the safety pipeline on tool outputs. Track 5 identifies that prompt injection scanning is NOT part of this pipeline. Fix: extend `ToolResultSanitizer` to also run `PromptScanner.scan()` on tool results before they enter the LLM context. Single integration point, addresses both tracks.

### Knowledge Gap Detection + Observability (Track 2 + Track 5)
Gap detection (Track 2) emits events when retrieval confidence is low. Track 5 recommends OTel metrics export. These should share the same event bus and span mapping. Design gap detection events as first-class OTel spans from the start.

### Webhook Deduplication + Rate Limiting (Track 4 + Track 5)
Track 4 needs message deduplication (TTL map). Track 5 recommends improved rate limiting patterns. Both need a shared TTL store abstraction -- either in-memory with eviction or Redis-backed for multi-instance deployments.

### Tool Result Caching + Prompt Caching (Track 2 + Track 3)
Tool result caching (Track 3) reduces redundant tool calls. Prompt caching (Track 2) reduces LLM token costs. Together they create a two-layer caching strategy: tool-level (avoid re-execution) and prompt-level (avoid re-tokenization). Design cache invalidation consistently across both layers.

### Coverage Metrics + All New Features (Track 1 + All)
Track 1's top recommendation is configuring `@vitest/coverage-v8`. This must happen BEFORE implementing v0.5.0 features so new code is measured from the start. Gate: no PR merges without coverage report.

---

## Consolidated Priority Matrix

### v0.5.0 -- Ship Immediately (Highest ROI)

| # | Item | Track | Effort | Impact | Risk |
|---|------|-------|--------|--------|------|
| 1 | Configure coverage metrics | T1 | 1 day | Foundation | None |
| 2 | Prompt caching for RAG | T2 | ~30 LOC | -90% token cost | Low |
| 3 | Cross-encoder reranking | T2 | ~200 LOC | +18pp precision | Low |
| 4 | Knowledge gap detection P1 | T2 | ~50 LOC | Operator visibility | Low |
| 5 | Tool result caching | T3 | ~150 LOC | -40% tool calls | Low |
| 6 | Long-running async tools | T3 | ~500 LOC | Production blocker | Medium |
| 7 | OpenAPI-to-tools adapter | T3 | ~400 LOC | Competitive parity | Low |
| 8 | Webhook deduplication | T4 | ~100 LOC | Prevents duplicates | Low |
| 9 | WebSocket heartbeat | T4 | ~80 LOC | Connection stability | Low |
| 10 | Indirect injection scanning | T5 | ~100 LOC | Critical security gap | Low |
| 11 | Tool description scanning | T5 | ~80 LOC | MCP attack vector | Low |
| 12 | Streaming provider tests | T1 | ~400 LOC | Quality assurance | None |
| 13 | Adversarial security tests | T1 | ~300 LOC | Security validation | None |
| 14 | Persistent email thread store | T4 | ~150 LOC | Data loss prevention | Low |
| 15 | Predictive tool selection L1 | T3 | ~100 LOC | Latency reduction | Low |

### v1.0 -- Next Major Release

| # | Item | Track | Effort | Impact |
|---|------|-------|--------|--------|
| 1 | Knowledge gap detection P2 (clustering + admin API) | T2 | ~200 LOC | KB quality |
| 2 | Semantic query caching | T2 | ~300 LOC | -30-50% retrieval cost |
| 3 | CRAG verification (opt-in) | T2 | ~300 LOC | +10-20% on failed retrievals |
| 4 | Composable authorization | T3 | ~500 LOC | Enterprise requirement |
| 5 | Tool composition pipelines | T3 | ~800 LOC | Workflow flexibility |
| 6 | Wasm sandboxing | T3 | ~600 LOC | Tool isolation |
| 7 | Message chunking (all channels) | T4 | ~200 LOC | Long response support |
| 8 | Outbound rate limiting | T4 | ~150 LOC | Platform compliance |
| 9 | Slack Block Kit support | T4 | ~300 LOC | Rich Slack integration |
| 10 | FIDES-inspired information flow | T5 | ~500 LOC | Architectural security |
| 11 | OTel metrics + traces export | T5 | ~400 LOC | Production observability |
| 12 | SOC 2 audit trail compliance | T5 | ~300 LOC | Enterprise sales |
| 13 | Multi-tenant audit isolation | T5 | ~200 LOC | Compliance requirement |
| 14 | Computer use (Playwright MCP path) | T3 | ~50 LOC | Browser automation |
| 15 | HyDE (opt-in) | T2 | ~100 LOC | Exploratory query boost |
| 16 | Studio test suite | T1 | ~1000 LOC | UI quality |

### v2.0 -- Future

| # | Item | Track | Notes |
|---|------|-------|-------|
| 1 | Agentic RAG Level 3 (query decomposition) | T2 | Needs gap detection data |
| 2 | RAPTOR (opt-in for long docs) | T2 | High ingestion cost |
| 3 | MCP marketplace | T3 | Needs registry + billing |
| 4 | Runtime tool synthesis | T3 | Needs Wasm sandbox + approval |
| 5 | Cross-channel contact dedup | T4 | Needs contact identity system |
| 6 | Telegram + SMS channels | T4 | Market demand dependent |
| 7 | Zero-knowledge proofs for audit | T5 | Research-grade |

### Never (for core Kiln)

| Item | Track | Reason |
|------|-------|--------|
| GraphRAG | T2 | +1-3% on customer support at 100x cost. Monitor LazyGraphRAG. |
| Late chunking | T2 | Locks into Jina ecosystem. Unclear improvement over contextual retrieval. |
| Runtime tool synthesis without sandbox | T3 | 12-65% of LLM-generated code has vulnerabilities. |
| Auto-registered destructive generated tools | T3 | Security risk too severe. |

---

*End of stabilization research. This document supersedes individual phase research docs for v0.5.0 planning.*
