# 15 Kiln Safety — Applied Today

## Research Prompt

```
You are a senior research architect studying Kiln's safety and security model through the lens of immune systems.

Kiln's current safety and security architecture:

1. Safety pipeline (safety-pipeline.ts):
   - PII scanner (2-tier: regex fast-path + LLM fallback, 6 types, Luhn validation for credit cards)
   - Content classifier (6 categories)
   - 4 policy rails
   - Grounding rail (post-generation LLM judge, model-routed, fail-open)
   - Pipeline orchestrator: PII → content → rails, fail-open design
   - Indirect injection scanning on tool results

2. Security (security/ bounded context):
   - Audit log: JSONL + hash chain (tamper-evident)
   - Prompt injection defense: 2-tier (regex fast-path + LLM judge)
   - AES-256-GCM secrets encryption
   - Guardian: security coordinator
   - Self-audit capability

3. Auth (gateway/auth-middleware.ts):
   - Composable middleware: requireApiKey, requireBearer, requireWebhookSignature, requireJwt
   - JWT: RS256 via JWKS (jose createRemoteJWKSet) or HS256 via shared secret
   - Timing-safe comparison for API keys
   - Origin allowlist (isOriginAllowed)

4. Tool execution safety:
   - DevToolExecutionBridge: authorization levels (deny, approval-required)
   - Per-tenant tool allowlists (["*"] = all, omitted/empty = none)
   - Sliding window rate limiter (per-tool, per-tenant)
   - ToolAuthorizer interface

5. Session-level safety:
   - AI guard (prevents AI from responding during human_active mode)
   - Repetitive abuse detector
   - Escalation detector (keywords + loop detection)
   - Visitor sanitizer (length limits, format validation, zero-width char removal)

6. Channel-level safety:
   - Meta webhook HMAC-SHA256 verification
   - Webhook deduplication (at-least-once delivery protection)
   - Email loop guard (RFC 3834 auto-reply detection)

Task:
1. Define Kiln's innate immune layer (what it already has that works without learning)
2. Define Kiln's adaptive immune layer (what learns from exposure)
3. Define what should count as self, non-self, and danger signals
4. Map this to prompt injection, tool output scanning, egress control, and approval gating
5. Propose a strict architecture for immune memory and escalation

I care about executable architecture, not metaphor.

End with these sections:
- Mechanisms
- Software Abstractions
- Direct Kiln Mappings
- Risks / Misuse
- Where The Analogy Breaks
- Actionable Research Follow-Ups
```
