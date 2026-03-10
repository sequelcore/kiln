# OpenRouter Provider Adapter — Research Document

**Date:** 2026-03-10
**Status:** Research complete, ready for implementation
**Version target:** v0.18.0

## Executive Summary

OpenRouter provides a unified OpenAI-compatible API (`https://openrouter.ai/api/v1`) with access to 400+ models including 27 free ones. Since Kiln already has `OpenAICompatAdapter`, the OpenRouter adapter is a ~30-line subclass. The real value is unlocking free-tier models for OpenKiln and Kilvo cost optimization via Kiln's existing model routing (ComplexityScorer + RulesRouter).

## Strategic Value

1. **OpenKiln enabler** — personal AI agent running on 100% free models, zero cost
2. **Kilvo cost optimization** — route simple messages to free models, complex to paid
3. **Provider resilience** — OpenRouter has multi-provider fallback built in
4. **Model diversity** — access Qwen, Gemma, Llama, NVIDIA models without separate API keys

## API Compatibility

OpenRouter implements the OpenAI Chat Completions API spec:
- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`
- Auth: `Authorization: Bearer ${apiKey}`
- Streaming: SSE with `stream: true` (identical to OpenAI)
- Tool calling: OpenAI function calling format, `finish_reason: "tool_calls"`
- Model IDs: `provider/model-name` format (e.g., `google/gemma-3-27b-it:free`)

### OpenRouter-Specific Headers (Optional)

| Header | Purpose | Required |
|--------|---------|----------|
| `HTTP-Referer` | App URL for OpenRouter rankings | No |
| `X-Title` | App name for OpenRouter rankings | No |

These are analytics-only. The API works without them. We add them via constructor config for attribution.

### Rate Limits

| Tier | Requests/min | Requests/day |
|------|-------------|-------------|
| Free (no credits purchased) | 20 | 50 |
| Free (10+ credits purchased) | 20 | 1,000 |
| Paid models | Per-model limits | No hard cap |

Kiln's `SlidingWindowRateLimiter` handles tenant-level rate limiting. OpenRouter's 429 responses are already retryable via `OpenAICompatAdapter.retryOptions()`.

## Free Models (March 2026)

### Recommended for Kiln (tool calling support confirmed)

| Model ID | Context | Tools | Vision | Quality | Notes |
|----------|---------|-------|--------|---------|-------|
| Model ID | Context | Tools | Vision | Quality | Notes |
|----------|---------|-------|--------|---------|-------|
| `nvidia/nemotron-3-nano-30b-a3b:free` | 256K | Yes | No | Medium | MoE, fast, battle-tested (60B tok/mo via OpenClaw). Default. |
| `stepfun/step-3.5-flash:free` | 256K | Yes | No | Medium | MoE ~11B active, 1T tok/week, "particularly strong at tool-calling". |
| `arcee-ai/trinity-large-preview:free` | 131K | Yes | No | Medium | 400B MoE (13B active), native function calling, 572B tok/week. |
| `meta-llama/llama-3.3-70b-instruct:free` | 128K | Yes | No | Medium | Proven quality, 70B dense, 1.58B tok/week. |
| `google/gemma-3-27b-it:free` | 131K | Yes | Yes | Medium | Vision support, multilingual. |
| `qwen/qwen3-coder-480b-a35b-instruct:free` | 262K | Yes | No | Medium | Optimized for agentic coding + tool use. |
| `mistralai/mistral-small-3.1-24b:free` | 128K | Yes | No | Medium | Mistral quality, multilingual/Spanish. |

### Meta-Router (Smart Free Routing)

OpenRouter offers `openrouter/auto` (paid, routes to best model per prompt) and a free models router that auto-selects from free models supporting your request's features (tools, vision, etc.). We do NOT use the free router — Kiln's own model routing is superior (ComplexityScorer + RulesRouter + per-tenant config).

## Architecture Decision: OpenAICompatAdapter Extension

### Inheritance Chain

```
ProviderAdapter (interface)
  └── OpenAICompatAdapter (abstract, handles OpenAI-compat API)
        ├── OpenAIAdapter (baseUrl: api.openai.com)
        ├── DeepSeekAdapter (baseUrl: api.deepseek.com)
        └── OpenRouterAdapter (baseUrl: openrouter.ai/api/v1)  ← NEW
```

### What Changes

The `OpenAICompatAdapter` currently hardcodes headers in `sendRequest()` and `streamMessage()`:

```typescript
headers: {
  Authorization: `Bearer ${this.apiKey}`,
  "Content-Type": "application/json",
}
```

OpenRouter needs two additional optional headers. Options:

**Option A: Override `sendRequest` + `streamMessage` in subclass** — duplicates streaming logic, violates DRY.

**Option B: Add `protected buildHeaders()` to base class** — clean extension point, zero impact on existing adapters.

**Decision: Option B.** Extract a `protected buildHeaders(): Record<string, string>` method on `OpenAICompatAdapter`. Default returns auth + content-type. OpenRouter overrides to add `HTTP-Referer` and `X-Title`. This is a non-breaking, backward-compatible change.

### Constructor Config Extension

```typescript
interface OpenRouterConfig {
  readonly apiKey: string;
  readonly defaultModel?: string;
  readonly appUrl?: string;   // → HTTP-Referer header
  readonly appName?: string;  // → X-Title header
}
```

`appUrl` and `appName` are optional — the adapter works without them. They're analytics headers for OpenRouter's ranking system.

## Implementation Plan

### 1. Refactor: `buildHeaders()` on OpenAICompatAdapter

Add `protected buildHeaders(): Record<string, string>` to `OpenAICompatAdapter`. Replace inline header objects in `sendRequest()` and `streamMessage()` with `this.buildHeaders()`. Default implementation:

```typescript
protected buildHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${this.apiKey}`,
    "Content-Type": "application/json",
  };
}
```

**Files:** `packages/core/src/agents/infrastructure/openai-compat.ts`
**Impact:** Zero behavioral change for OpenAI, DeepSeek adapters.

### 2. OpenRouterAdapter

```typescript
// packages/core/src/agents/infrastructure/openrouter.ts

import { OpenAICompatAdapter } from "./openai-compat.js";

export const NEMOTRON_NANO_FREE = "nvidia/nemotron-3-nano-30b-a3b:free";
export const GEMMA_3_27B_FREE = "google/gemma-3-27b-it:free";
export const QWEN3_CODER_FREE = "qwen/qwen3-coder-480b-a35b-instruct:free";
export const LLAMA_4_SCOUT_FREE = "meta-llama/llama-4-scout-17b-16e-instruct:free";
export const DEEPSEEK_V3_FREE = "deepseek/deepseek-chat-v3-0324:free";

export class OpenRouterAdapter extends OpenAICompatAdapter {
  private readonly appUrl?: string;
  private readonly appName?: string;

  constructor(config: {
    apiKey: string;
    defaultModel?: string;
    appUrl?: string;
    appName?: string;
  }) {
    super({
      apiKey: config.apiKey,
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: config.defaultModel ?? NEMOTRON_NANO_FREE,
      providerName: "openrouter",
    });
    this.appUrl = config.appUrl;
    this.appName = config.appName;
  }

  protected override buildHeaders(): Record<string, string> {
    const headers = super.buildHeaders();
    if (this.appUrl) headers["HTTP-Referer"] = this.appUrl;
    if (this.appName) headers["X-Title"] = this.appName;
    return headers;
  }
}
```

**Files:** `packages/core/src/agents/infrastructure/openrouter.ts` (NEW)

### 3. Model Catalog + Capability Registry

Add 4 free models + the paid `openrouter/auto` meta-router to `MODEL_CATALOG` and `MODEL_CAPABILITIES`.

**Files:**
- `packages/core/src/agents/model-pricing.ts`
- `packages/core/src/agents/model-capability-registry.ts`

### 4. Core Barrel Export

Add OpenRouter exports to `packages/core/src/agents/index.ts`.

### 5. Gateway Wiring

Add `case "openrouter"` to `createProviderFromConfig()` in `gateway-server.ts`. The `ProviderConfig` interface already supports arbitrary `name` strings.

OpenRouter-specific config (`appUrl`, `appName`) resolved from env vars: `OPENROUTER_APP_URL`, `OPENROUTER_APP_NAME`.

**Files:** `packages/runtime/src/gateway/gateway-server.ts`

### 6. Tests

- `openrouter.test.ts` — adapter construction, header override, model constants
- Verify existing `openai-compat` streaming tests still pass (no regression)

### 7. Documentation

Update:
- `docs/guides/configuration-reference.md` — add OpenRouter provider config
- `docs/guides/architecture.md` — update provider adapter list
- `CLAUDE.md` — update agents bounded context description

## What We Do NOT Build

- No OpenRouter-specific streaming logic — inherited from `OpenAICompatAdapter`
- No OpenRouter SDK dependency — pure fetch (already in base class)
- No free router integration (`openrouter/auto`) — Kiln's routing is superior
- No credits management UI — out of scope
- No BYOK (Bring Your Own Key) support — future enhancement if needed

## Cost Tracking

Free models have `inputPer1M: 0, outputPer1M: 0` in `MODEL_CATALOG`. `CostTracker` already handles zero-cost models correctly. The existing model routing RulesRouter can include cost-based rules like "route to free model when complexity < 3".

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Free model rate limits (20 req/min) | SlidingWindowRateLimiter + 429 retry |
| Free models drop tool support | ModelCapabilityRegistry filters ineligible models |
| OpenRouter API changes | OpenAI-compat spec is stable; `:free` suffix is documented |
| Free model quality variance | ComplexityScorer routes complex prompts to paid models |

## Estimated Scope

- 1 new file (~40 lines): `openrouter.ts`
- 1 refactored file (~5 lines): `openai-compat.ts` (extract `buildHeaders()`)
- 4 modified files (~20 lines total): model-pricing, capability-registry, agents/index, gateway-server
- 1 new test file (~80 lines): `openrouter.test.ts`
- 3 docs updated

**Total: ~145 lines of production code + ~80 lines of tests.**
