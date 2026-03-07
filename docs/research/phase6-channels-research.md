# Phase 6 Channels (Instagram DM, Messenger, Email) -- Research Synthesis

**Date:** 2026-03-07
**Scope:** Exhaustive research across 6 domains via parallel swarm agents, 200+ sources, covering Instagram DM API, Messenger Platform, Email infrastructure, Meta unified architecture, competitive intelligence, and theoretical channel vision.
**Purpose:** Inform architectural decisions for Kiln's channel expansion -- the module that determines how many humans the engine can reach and how well it communicates with them.

---

## Table of Contents

1. [Executive Summary: The 20 Decisions](#1-executive-summary)
2. [Meta Shared Webhook Foundation](#2-meta-shared-webhook-foundation)
3. [Instagram DM Channel](#3-instagram-dm-channel)
4. [Facebook Messenger Channel](#4-facebook-messenger-channel)
5. [Email Channel](#5-email-channel)
6. [Channel Abstraction Evolution](#6-channel-abstraction-evolution)
7. [Competitive Intelligence](#7-competitive-intelligence)
8. [Academic Research and Market Data](#8-academic-research-and-market-data)
9. [Beyond the State of the Art](#9-beyond-the-state-of-the-art)
10. [Architectural Recommendations for Kiln](#10-architectural-recommendations)
11. [Implementation Sequence](#11-implementation-sequence)
12. [Open Questions](#12-open-questions)

---

## 1. Executive Summary

### The Landscape in One Paragraph

Channels are the surface area through which an AI engine perceives the world and expresses itself. The industry is converging on a **capability-based progressive enhancement model**, moving away from the lowest-common-denominator abstraction that plagued unified messaging APIs for a decade. Meta's three messaging channels (WhatsApp, Instagram DM, Messenger) share 30-40% infrastructure (webhook verification, HMAC-SHA256 signature, dispatcher) but diverge in payload structure, send APIs, media handling, rate limits, and messaging windows. Instagram and Messenger are structurally siblings (both use `entry[].messaging[]`) built on the Messenger Platform, while WhatsApp is architecturally separate (`entry[].changes[].value.messages[]`). Email is the most architecturally distinct channel -- asynchronous, RFC-governed, HTML-formatted, thread-based -- but also the highest-ROI channel globally ($36-38 per $1 spent). After Phase 6, Kiln will be the only open-source AI orchestration engine with WhatsApp + Instagram DM + Messenger + Email + Web (WS) + Slack + CLI + API, all with multi-tenant isolation, agentic tool execution, RAG knowledge, and safety pipeline.

### The 20 Decisions That Define This Module

| # | Decision | Choice | Confidence | Rationale |
|---|----------|--------|------------|-----------|
| 1 | Webhook architecture | **Single endpoint, `object` field dispatcher** | HIGH | All 3 Meta channels can share one webhook URL. `object` discriminates: `whatsapp_business_account` / `instagram` / `page`. Single HMAC verification. |
| 2 | Signature verification | **HMAC-SHA256 for all 3 Meta channels** | HIGH | Meta Unified research confirms all 3 use `X-Hub-Signature-256` with same App Secret. Kiln's existing `requireWebhookSignature` works unchanged. |
| 3 | Payload parsing strategy | **Two-family parser: WhatsApp vs Messenger/Instagram** | HIGH | WhatsApp uses `entry[].changes[].value.messages[]`. Instagram and Messenger share `entry[].messaging[].message`. Discriminated union on `object`. |
| 4 | Shared Meta foundation layer | **New `meta-webhook-foundation.ts`** | HIGH | Extract verification handshake, HMAC validation, and dispatcher from existing WhatsApp routes. All 3 channels reuse this foundation. |
| 5 | Instagram send API | **`graph.instagram.com/{pageId}/messages`** | HIGH | Messenger-style `{ recipient: { id }, message: { text } }` body. Page Access Token auth. |
| 6 | Messenger send API | **`graph.facebook.com/me/messages`** | HIGH | Same body shape as Instagram. Page Access Token auth. `messaging_type: "RESPONSE"` required. |
| 7 | Media handling | **Channel-specific: WhatsApp two-step, IG/Messenger direct CDN** | HIGH | WhatsApp requires authenticated media download. Instagram/Messenger provide direct CDN URLs (expire 1-3h). Cannot share download logic. |
| 8 | User identity | **Channel-specific: phone (WA), IGSID (IG), PSID (Messenger)** | HIGH | Each channel has a unique, opaque user identifier per-business. Cross-channel identity deferred to Phase 7+. |
| 9 | Tenant resolution | **Channel-specific: resolveByPhone (WA), resolveByPageId (Messenger), resolveByInstagramId (IG)** | HIGH | TenantRegistry needs new resolver methods per channel. Same pattern as existing `resolveByWidgetId`. |
| 10 | Messaging window enforcement | **Per-channel: 24h standard, HUMAN_AGENT 7d extension** | HIGH | Instagram and Messenger share same 24h window + HUMAN_AGENT tag (7d, human only). WhatsApp has templates for out-of-window. |
| 11 | Message formatting | **Per-channel: WA markdown, IG plain (1000 chars), Messenger plain (2000 chars)** | HIGH | Instagram has NO markdown and 1000-char limit. Messenger has NO markdown and 2000-char limit. Must strip formatting per channel. |
| 12 | Echo filtering | **Required for IG and Messenger** | HIGH | Both echo business-sent messages with `is_echo: true`. WhatsApp uses separate `statuses[]`. Must filter to prevent infinite loops. |
| 13 | Rate limiting per channel | **Channel-aware SlidingWindowRateLimiter** | HIGH | Instagram: 200 DMs/hr (severe). Messenger: ~250 req/sec. WhatsApp: tier-based. Independent limits, not shared. |
| 14 | Email inbound provider | **Postmark (webhook-based)** | HIGH | Best webhook payload (clean JSON, `StrippedTextReply`, `MailboxHash` for plus-addressing). $15/mo for 10k emails. Cloudflare Email Workers as free alternative. |
| 15 | Email threading | **RFC 5322: Message-ID + In-Reply-To + References** | HIGH | Every outbound email must carry proper threading headers. Store Message-ID chains per conversation. Subject matching as fallback. |
| 16 | Email multi-tenant routing | **Plus-addressing: `support+{tenantId}@mail.kilvo.app`** | HIGH | Zero per-tenant DNS setup. Postmark `MailboxHash` parses automatically. Subdomain routing as Phase 2. |
| 17 | Email loop prevention | **RFC 3834 + 6-layer defense** | HIGH | Auto-Submitted header, Precedence check, sender filtering, rate limit (1/sender/24h), self-detection. Most critical safety measure. |
| 18 | Email formatting | **Markdown -> HTML (inline CSS) + plain text multipart** | MEDIUM | LLM generates markdown. Convert to HTML with inline CSS (Gmail strips `<style>`). Send as `multipart/alternative`. |
| 19 | Channel capability manifest | **Extend Channel interface with `capabilities` property** | MEDIUM | Progressive enhancement over LCD. Channels declare modalities, formatting, interactivity, temporality. Engine adapts output. Phase 6 starts simple, full manifest in Phase 7. |
| 20 | Per-channel system prompts | **Channel behavioral directives injected into prompt pipeline** | MEDIUM | Each channel adapter provides tone, length, and formatting rules. Merged into system prompt by `systemPromptBuilder`. Configurable per tenant in gateway.yaml. |

### What Changed From the Kilvo Roadmap

The original Phase 6 spec ("Instagram DM adapter, Messenger adapter, Email adapter, shared Meta webhook handler refactoring, ChannelAdapter normalization") is directionally correct. Research upgrades:

1. **Instagram and Messenger share more than expected.** Both are built on Meta's Messenger Platform with identical webhook payload structure (`entry[].messaging[]`). A shared Messenger/Instagram parser can serve both, with channel-specific send APIs.
2. **HMAC-SHA256 is confirmed for all 3 Meta channels.** Initial Instagram research flagged a potential SHA-1 discrepancy (`x-hub-signature`), but unified platform research confirmed all 3 use `X-Hub-Signature-256`. Kiln's existing middleware works unchanged.
3. **Instagram's 200 DMs/hour rate limit is severe.** 96% reduction from previous 5,000/hr. Requires channel-aware rate limiting, not just per-tenant. High-volume tenants need queuing.
4. **Email is architecturally the most distinct channel.** Asynchronous, RFC-governed threading, HTML formatting, loop prevention, deliverability management. Cannot share session model assumptions with messaging channels.
5. **Channel capability manifest should ship in Phase 6 (simplified).** Progressive enhancement avoids the LCD problem that plagues unified messaging APIs. Start with the current `supportedModalities` + `maxMessageLength` + `temporality`, expand in Phase 7.
6. **Per-channel system prompt modifiers are table stakes.** Every competitor (Intercom, Zendesk, Respond.io) adapts AI tone per channel. Kiln should support this via tenant config, not hardcoded per adapter.
7. **Cross-channel identity is deferred to Phase 7.** The identity graph (linking WhatsApp phone, IGSID, PSID, email address to one user) is high-leverage but complex. Phase 6 focuses on channel adapters; Phase 7 adds the identity layer.

---

## 2. Meta Shared Webhook Foundation

### 2.1 The Single-Endpoint Architecture

All 3 Meta channels can share one webhook URL, discriminated by the top-level `object` field:

| Channel | `object` value | Entry structure |
|---------|---------------|-----------------|
| WhatsApp | `"whatsapp_business_account"` | `entry[].changes[].value.messages[]` |
| Instagram | `"instagram"` | `entry[].messaging[].message` |
| Messenger | `"page"` | `entry[].messaging[].message` |

Instagram and Messenger are **structural siblings**: both use `entry[].messaging[]` with `sender.id`, `recipient.id`, and `message` fields. WhatsApp is architecturally separate with its `changes[].value` pattern.

### 2.2 What Is Fully Shared (100% Reuse)

| Component | Status |
|-----------|--------|
| Webhook verification handshake (GET) | Identical: `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge` |
| HMAC-SHA256 signature (POST) | Same App Secret, same `X-Hub-Signature-256` header, same algorithm |
| Webhook dispatcher | Single endpoint, route on `object` field |
| App Secret | One per Facebook App, covers all products |
| Graph API versioning | All use `graph.facebook.com/v{version}/` (Instagram also supports `graph.instagram.com`) |

### 2.3 What Requires Channel-Specific Adapters

| Component | Reason |
|-----------|--------|
| Payload parsing | Two structural families (WhatsApp vs Messenger/Instagram) |
| Send API | Different endpoints, different body shapes, different API hosts |
| Media download | WhatsApp: 2-step + auth + 5min expiry. IG/Messenger: direct CDN URL |
| Rate limiting | Completely different systems per channel |
| Messaging windows | IG/Messenger: strict 24h. WhatsApp: templates for out-of-window |
| User identifiers | Phone (WA), IGSID (IG), PSID (Messenger) |
| Delivery status | Different payload structures and status names |

### 2.4 Token Strategy

A single **System User Token** from Meta Business Manager can cover all 3 channels with combined scopes:

| Channel | Required Scopes |
|---------|----------------|
| WhatsApp | `whatsapp_business_messaging`, `whatsapp_business_management` |
| Messenger | `pages_messaging`, `pages_manage_metadata`, `pages_show_list` |
| Instagram | `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata` |

### 2.5 Normalized Inbound Message Type

```typescript
interface InboundMetaMessage {
  channel: 'whatsapp' | 'instagram' | 'messenger';
  senderId: string;       // phone (WA), IGSID (IG), PSID (Messenger)
  recipientId: string;    // phoneNumberId (WA), igUserId (IG), pageId (Messenger)
  entryId: string;        // WABA ID, IG User ID, or Page ID
  messageId: string;      // wamid, mid, mid
  parts: readonly ContentPart[];
  rawTimestamp: number;
  senderName?: string;    // Only WhatsApp provides inline
}
```

### 2.6 Recommended File Structure

**New shared file:**
```
runtime/src/gateway/meta-webhook-foundation.ts
  - createMetaWebhookVerification(verifyToken)
  - requireMetaWebhookSignature(appSecret) [wraps existing requireWebhookSignature]
  - MetaWebhookDispatcher [inspects object field, routes to channel handler]
  - MetaChannel type = 'whatsapp' | 'instagram' | 'messenger'
```

**Sources:**
- [Meta Webhooks for WhatsApp](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/)
- [Meta Webhooks for Instagram](https://developers.facebook.com/docs/instagram-platform/webhooks/)
- [Meta Webhooks for Messenger](https://developers.facebook.com/docs/messenger-platform/webhooks)
- [Chatwoot Webhook Processing](https://deepwiki.com/chatwoot/chatwoot/7.8-webhook-processing-and-message-routing)

---

## 3. Instagram DM Channel

### 3.1 API Identity

Instagram Messaging is **not a standalone API**. It is built on the Messenger Platform infrastructure, using Graph API endpoints. The old Instagram Basic Display API was retired December 4, 2024. Current version: Graph API v24.0.

### 3.2 Webhook Payload

```json
{
  "object": "instagram",
  "entry": [{
    "id": "PAGE_ID",
    "time": 1234567890,
    "messaging": [{
      "sender": { "id": "IGSID" },
      "recipient": { "id": "INSTAGRAM_BUSINESS_ACCOUNT_ID" },
      "timestamp": 1234567890,
      "message": {
        "mid": "MESSAGE_ID",
        "text": "Hello"
      }
    }]
  }]
}
```

**Webhook event fields:** `messages`, `messaging_postbacks`, `messaging_optins`, `message_reactions`, `messaging_referrals`, `messaging_handovers`, `standby`.

**Message flags:** `is_echo` (business-sent, must filter), `is_deleted` (user deleted), `is_unsupported` (unsupported type).

### 3.3 Send API

```
POST https://graph.instagram.com/v24.0/{page_id}/messages
Authorization: Bearer {accessToken}
Body: { recipient: { id: "IGSID" }, message: { text: "..." } }
```

**Quick replies:** Up to 13 buttons, 20 chars each, plain text only, require `payload` field. Only visible on mobile.

**Generic templates (carousel):** Image, title, subtitle, buttons. Multiple elements create horizontally scrollable carousel.

**Ice breakers:** Up to 4 FAQ-style questions. Configured via API per account, not per-message.

### 3.4 Critical Constraints

| Constraint | Value |
|-----------|-------|
| Rate limit | **200 automated DMs/hour per account** (96% reduction from 5,000) |
| Character limit | 1,000 per message (mobile) |
| Formatting | **No markdown** -- plain text only |
| Messaging window | 24 hours (rolling, resets on user message) |
| HUMAN_AGENT extension | 7 days (human only, NOT for automated messages) |
| Proactive messaging | **Cannot** send unsolicited messages |
| Out-of-window messaging | **None** (no template message equivalent like WhatsApp) |
| Media in webhooks | CDN URLs directly (no auth needed, expire 1-3h) |

### 3.5 Story Support

- **Story replies:** `message.reply_to.story` object with story ID and URL
- **Story mentions:** Separate webhook event when user mentions business in their Story
- **Story media URLs:** Expire when story expires (24 hours)
- Adapter should extract story context and include it as conversation context

### 3.6 Account Requirements

- Instagram Business or Creator account linked to a Facebook Page
- Page managed by a Meta App (type "Business")
- **Advanced Access** required: `instagram_manage_messages`, `pages_manage_metadata`
- App Review required (2-6 weeks): screencast video, privacy policy, business verification

### 3.7 What Can Be Shared with WhatsApp

~70% of processing pipeline logic is reusable: budget middleware, session registry, memory stores, knowledge pipeline, contact memory, conversation event emitter, orchestrator pipeline, tenant tool factory, trace context.

**What needs new implementation:** webhook payload parser, Instagram API client, message formatter (plain text), CDN media handling, echo filtering, story context extraction, messaging window tracking, quick reply/template support, ice breaker configuration.

**Sources:**
- [Instagram Messaging API](https://developers.facebook.com/docs/messenger-platform/instagram/)
- [Instagram API Rate Limits (2026)](https://creatorflow.so/blog/instagram-api-rate-limits-explained/)
- [Instagram DM Automation Rules](https://www.spurnow.com/en/blogs/instagram-dm-automation-rules)

---

## 4. Facebook Messenger Channel

### 4.1 Platform Overview

Messenger Platform is a subset of the Meta Graph API (v24.0). Same Graph API app can hold permissions for Messenger, Instagram, and WhatsApp. Authentication uses Page Access Tokens.

### 4.2 Webhook Payload

```json
{
  "object": "page",
  "entry": [{
    "id": "<PAGE_ID>",
    "time": 1458692752478,
    "messaging": [{
      "sender": { "id": "<PSID>" },
      "recipient": { "id": "<PAGE_ID>" },
      "timestamp": 1458692752478,
      "message": {
        "mid": "mid.1457764197618:41d102a3e1ae206a38",
        "text": "hello, world!"
      }
    }]
  }]
}
```

**Nearly identical structure to Instagram.** Both use `entry[].messaging[]` with `sender.id`/`recipient.id`/`message`. The shared parser for IG and Messenger requires only channel-specific post-processing.

### 4.3 Send API

```
POST https://graph.facebook.com/v24.0/me/messages
Authorization: Bearer {pageAccessToken}
Body: {
  messaging_type: "RESPONSE",
  recipient: { id: "PSID" },
  message: { text: "Hello!" }
}
```

**`messaging_type` values:** `RESPONSE` (reply within 24h), `UPDATE` (proactive within 24h), `MESSAGE_TAG` (deprecated Feb 2026 except `HUMAN_AGENT`).

### 4.4 Messenger-Specific Features

| Feature | Details |
|---------|---------|
| **Typing indicators** | `sender_action: "typing_on"/"typing_off"/"mark_seen"` (separate request) |
| **Quick replies** | Up to 13 buttons, 20 chars each. Content types: `text`, `user_phone_number`, `user_email` |
| **Generic templates** | 1-10 elements, 80-char title/subtitle, 3 buttons each, carousel layout |
| **Button template** | 3 buttons, 640-char text |
| **Persistent menu** | 3 top-level items, nested menus (5 per level), requires Get Started button |
| **Persona API** | Named personas with profile pictures for the bot |
| **Reusable attachments** | Upload once via Attachment Upload API, send multiple times via `attachment_id` |
| **User Profile API** | `GET /{PSID}?fields=first_name,last_name,profile_pic` |

### 4.5 Message Tags (Post-Deprecation, Feb 2026)

All message tags **deprecated** except `HUMAN_AGENT` (7-day window, human-sent only). Replacements:
- **Marketing Messages** (paid, permission-based, limited countries)
- **One-Time Notifications (OTN)** (user opts in via "Notify Me" button)

**Implication for Kiln:** AI responses must happen within 24h window. Human handoff via `HUMAN_AGENT` extends to 7 days. No proactive AI messaging outside the window.

### 4.6 Handover Protocol

Allows multiple apps behind a single Page to collaborate. Only one app "owns" the thread at a time.

| Role | Capabilities |
|------|-------------|
| **Primary Receiver** (1) | Receives all messages, can pass/take thread control |
| **Secondary Receiver(s)** (0+) | Only respond when given thread control |

**Mapping to Kiln's session state machine:**
| Kiln Session Mode | Messenger Action |
|-------------------|-----------------|
| `ai_active` | Kiln has thread control |
| `queued` | `request_thread_control` sent |
| `human_active` | `pass_thread_control` to human agent app |
| `resolved` | Control returned to Kiln |

**Status:** Still supported as of 2026, no deprecation announcements. Optional/advanced for Phase 6 -- Kiln's native handoff works without it.

### 4.7 Messenger vs WhatsApp Comparison

| Aspect | WhatsApp | Messenger |
|--------|----------|-----------|
| Character limit | 4,096 | 2,000 |
| Formatting | Bold/italic/mono | None |
| Quick replies | 3 buttons | 13 buttons |
| Carousels | No (list messages) | Yes (10 elements) |
| Typing indicators | No API | Yes |
| Handover protocol | No | Yes |
| Reusable media | No | Yes |
| Rate limit | Tier-based | ~250 req/sec |
| Out-of-window | Template messages | Deprecated (OTN only) |

### 4.8 Messenger.com Shutdown (April 2026)

Meta shutting down standalone Messenger.com website. Desktop apps retired December 2025. Web messaging only via `facebook.com/messages`. **No API impact** -- Messenger Platform API unchanged.

**Sources:**
- [Messenger Platform docs](https://developers.facebook.com/docs/messenger-platform)
- [Send API reference](https://developers.facebook.com/docs/messenger-platform/reference/send-api/)
- [Handover Protocol](https://developers.facebook.com/docs/messenger-platform/handover-protocol/)
- [Messenger.com Shutdown](https://techcrunch.com/2026/02/19/meta-is-shutting-down-messengers-standalone-website/)

---

## 5. Email Channel

### 5.1 Architecture: Webhook-Based Inbound

Three approaches exist -- webhook-based, IMAP polling, hybrid. **Webhook-based is the clear winner** for Kiln:
- Near real-time (1-5 seconds)
- No SMTP/IMAP infrastructure to manage
- Pre-parsed payloads
- Fits existing Hono route handler pattern

### 5.2 Provider Recommendation: Postmark

| Provider | Payload Format | Body Parsing | Plus-Addressing | Pricing |
|----------|---------------|--------------|----------------|---------|
| **Postmark** | Clean JSON | `StrippedTextReply`, `TextBody`, `HtmlBody` | `MailboxHash` auto-parsed | $15/mo for 10k |
| SendGrid | multipart/form-data | text, html, stripped fields | Via headers | $19.95/mo for 50k |
| Resend | JSON (metadata only) | Requires separate API calls | Via API | 3k/mo free |
| Cloudflare Email Workers | Raw MIME | Must parse with `postal-mime` | Must handle locally | Free |

**Postmark wins** because: clean JSON (not multipart), `StrippedTextReply` eliminates reply-stripping libraries, `MailboxHash` provides built-in multi-tenant routing, 10 retries with backoff, included spam scoring.

**Postmark webhook payload (key fields):**
```json
{
  "From": "john@example.com",
  "To": "support+tenant123@kilvo.app",
  "Subject": "Help with my order",
  "TextBody": "Full email body...",
  "StrippedTextReply": "Just the latest reply",
  "MailboxHash": "tenant123",
  "MessageID": "<unique-id@example.com>",
  "Headers": [...],
  "Attachments": [{ "Name": "file.pdf", "Content": "base64...", "ContentType": "..." }]
}
```

### 5.3 Email Threading (RFC 5322)

Three headers control threading:

1. **Message-ID:** Unique per email (`<timestamp.random@kilvo.app>`)
2. **In-Reply-To:** Message-ID of the parent email
3. **References:** Full chain of Message-IDs in the thread

**Thread chain example:**
```
Original:       Message-ID: <msg-001@kilvo.app>
AI Reply:       Message-ID: <msg-002@kilvo.app>, In-Reply-To: <msg-001@kilvo.app>
User Reply:     Message-ID: <msg-003@example.com>, In-Reply-To: <msg-002@kilvo.app>
                References: <msg-001@kilvo.app> <msg-002@kilvo.app>
```

**Client grouping behavior:** Gmail uses References + subject matching. Outlook uses proprietary Conversation-ID + References. Apple Mail is most RFC-compliant.

### 5.4 Multi-Tenant Email Routing

| Phase | Pattern | DNS Setup |
|-------|---------|-----------|
| 1 (MVP) | `support+{tenantId}@mail.kilvo.app` | Single domain, zero per-tenant setup |
| 2 | `support@{tenant}.mail.kilvo.app` | Wildcard MX record |
| 3 | `support@acme.com` (custom domain) | Per-tenant MX, SPF, DKIM, DMARC |

### 5.5 Email Formatting Pipeline

```
LLM Output (Markdown) -> marked/markdown-it -> HTML -> juice (CSS inliner) -> multipart/alternative email
```

**Safe CSS for all clients:** inline styles only, table-based layouts, no flexbox/grid (Outlook Classic uses Word rendering), system fonts, no border-radius (Outlook), no animations.

### 5.6 Loop Prevention (Critical -- #1 Failure Mode)

**All 6 mechanisms must be implemented:**

1. Set `Auto-Submitted: auto-replied` on all outbound (RFC 3834)
2. Set `X-Auto-Response-Suppress: All` (suppresses Outlook auto-responses)
3. NEVER respond to emails with `Auto-Submitted` header (any value except "no")
4. Check for `Precedence: bulk/auto_reply`
5. Ignore `noreply@`, `no-reply@`, `mailer-daemon@`, `postmaster@`, empty Return-Path
6. Rate limit: max 1 auto-reply per sender per 24 hours (RFC 3834 recommendation)
7. Self-detection: never reply to own sending addresses

### 5.7 Security and Compliance

| Requirement | Details |
|-------------|---------|
| SPF/DKIM/DMARC | Required by Google/Yahoo (Feb 2024) and Microsoft (May 2025) for 5000+ emails/day |
| List-Unsubscribe | RFC 8058 one-click unsubscribe via HTTP POST. Required by Google/Yahoo for bulk senders |
| CAN-SPAM | Physical address, unsubscribe mechanism, non-deceptive subjects |
| GDPR | Right to erasure, data minimization, retention policies |
| Domain warmup | 2-4 weeks, start 50-100 emails/day |

### 5.8 Email vs Messaging: AI Behavior Differences

| Dimension | Email | Messaging |
|-----------|-------|-----------|
| Response time | Minutes to hours acceptable | Seconds expected |
| Tone | Formal, structured | Conversational, casual |
| Length | Multi-paragraph, comprehensive | Short, multiple exchanges |
| Format | HTML with branding | Markdown/plain text |
| Threading | RFC 5322 headers | Session/conversation ID |
| Multi-topic | Common (multiple questions per email) | Rare (one topic per message) |
| Greeting/sign-off | Required | Optional |

**Key lesson from Intercom Fin:** Building email-specific handling for multi-question splitting, signature filtering, spam detection, and format conversion from chat-style to email-style was "not a trivial task."

### 5.9 Email Data Model

```typescript
interface EmailThread {
  threadId: string;
  tenantId: string;
  externalUserId: string;     // Sender email address
  subject: string;
  messageIds: string[];       // Chain for References header
  lastMessageId: string;      // For In-Reply-To
  lastActivity: Date;
  sessionId: string;          // Link to ModeBSession
}
```

**Sources:**
- [Postmark Inbound Webhook](https://postmarkapp.com/developer/webhooks/inbound-webhook)
- [RFC 5322](https://www.rfc-editor.org/rfc/rfc5322)
- [RFC 3834 (Automatic Responses)](https://datatracker.ietf.org/doc/html/rfc3834)
- [Intercom: Fin Over Email](https://www.intercom.com/blog/fin-over-email-how-we-built/)
- [Zendesk Email Architecture](https://support.zendesk.com/hc/en-us/articles/4408832543770)

---

## 6. Channel Abstraction Evolution

### 6.1 The LCD Problem

The foundational challenge: when a system provides one abstraction over components with different capabilities, it forfeits the powerful features of the underlying components.

**Three options:**
1. **Normalization (LCD):** Every message is `{ text: string }`. Works everywhere, wastes every platform's rich features.
2. **Passthrough:** Channel-native payloads. Preserves richness, eliminates abstraction value.
3. **Progressive Enhancement:** Base contract exists (`ContentPart[]`), channels declare capabilities, engine adapts output.

**Option 3 is the correct path.** Kiln's current design leans toward this with `supportedModalities` and `MessageFormat`, but these are coarse-grained.

### 6.2 Toward a Capability Manifest

Instead of just `Modality[]`, channels should declare:

```typescript
interface ChannelCapabilities {
  supportedModalities: readonly Modality[];
  supportedFormatting: readonly FormattingType[];
  maxMessageLength: number | null;
  supportsButtons: boolean;
  maxButtons: number;
  supportsQuickReplies: boolean;
  maxQuickReplies: number;
  supportsCarousels: boolean;
  supportsTypingIndicator: boolean;
  temporality: 'sync' | 'async' | 'hybrid';
  supportsProactiveMessaging: boolean;
  messagingWindow: { durationHours: number; extensionHours?: number } | null;
  riskLevel: 'low' | 'medium' | 'high';
}
```

This manifest allows the engine to make intelligent formatting decisions without per-channel `if/else` branches.

### 6.3 Missing Content Types

Kiln's `ContentPart` union (`Text | Image | Audio | File | ToolUse | ToolResult`) is missing:
- **Video:** WhatsApp, Instagram, and web all handle video natively
- **Location:** WhatsApp supports location sharing
- **Reaction:** Instagram, WhatsApp, Slack support reactions

These can be added incrementally as channels demand them.

### 6.4 Channel-Aware System Prompts

The channel should inject **behavioral directives** into the system prompt:

```
System prompt = Base persona
              + Tenant identity (businessName, name)
              + Channel behavioral directives (tone, length, formatting)
              + Channel capabilities (available modalities, interactivity)
              + Cultural context (locale, regional norms)
```

**Per-channel formality gradient:**

| Channel | Tone | Length | Emoji | Signature |
|---------|------|--------|-------|-----------|
| WhatsApp | Conversational | Short (multiple msgs) | Encouraged | None |
| Instagram DM | Casual | Very short | Heavy | None |
| Messenger | Casual | Short | Moderate | None |
| Email | Formal, complete | Long, structured | Rare | Full sig |
| Slack | Professional | Medium, threaded | Selective | None |
| Web widget | Helpful, branded | Medium | Branded | None |

### 6.5 Temporal Spectrum

```
Immediate          Near-Real-Time          Async-ish             Fully Async
   |                    |                     |                      |
  CLI              WebSocket              WhatsApp               Email
  Voice            Slack (online)         Instagram DM           API webhook
```

AI behavior should adapt: immediate channels get concise single responses; async channels get comprehensive self-contained responses with proper greetings/sign-offs; email skips streaming entirely.

**Sources:**
- [LCD Abstraction](https://mohewedy.medium.com/lcd-least-common-denominator-abstractions-f86edeaeb4a9)
- [Chatwoot Multi-Channel Architecture](https://deepwiki.com/chatwoot/chatwoot/7-configuration-and-customization)
- [Enterprise Integration Patterns](https://www.enterpriseintegrationpatterns.com/patterns/messaging/)

---

## 7. Competitive Intelligence

### 7.1 Channel Support Matrix (2025-2026)

| Platform | WA | IG | Messenger | Email | SMS | Voice | Telegram | Web | Slack |
|----------|:--:|:--:|:---------:|:-----:|:---:|:-----:|:--------:|:---:|:-----:|
| Intercom | Y | Y | Y | Y | Y | - | - | Y | Y |
| Zendesk | Y | Y | Y | Y | Y | Y | - | Y | Y |
| Respond.io | Y | Y | Y | Y | Y | Y | Y | Y | - |
| Chatwoot (OS) | Y | Y | Y | Y | Y | - | Y | Y | Y |
| Botpress (OS) | - | - | Y | - | - | - | Y | Y | Y |
| **Kiln (now)** | Y | - | - | - | - | - | - | Y | Y |
| **Kiln (Phase 6)** | Y | Y | Y | Y | - | - | - | Y | Y |

**Table stakes:** WhatsApp, Email, Web Chat, Instagram DM, Messenger.

**Post-Phase 6 positioning:** Kiln will be the only open-source AI orchestration engine with 8 channels + multi-tenant isolation + agentic tools + RAG + safety pipeline. Ahead of Chatwoot (no AI orchestration) and Botpress (uncertain open-source future after Workday acquisition).

### 7.2 Channel Abstraction Patterns in Production

All major CPaaS providers (Twilio, Bird, Vonage) and open-source frameworks (Chatwoot, Botpress, Rasa) converge on the same architecture:

```
IncomingMessage -> ChannelAdapter.parse() -> NormalizedMessage -> AI Logic -> NormalizedResponse -> ChannelAdapter.format() -> OutgoingMessage
```

This is exactly what Kiln already does with `Channel.receive()` / `Channel.send()`. The frameworks validate Kiln's existing design.

**Chatwoot pattern (13+ channels):** Polymorphic `Inbox` -> channel-specific tables. Each adapter is self-contained with its own config table, webhook verification, message parsing, and outbound formatting.

### 7.3 How Competitors Handle Email AI

- **Intercom Fin:** Email-specific ML component, multi-question splitting, signature filtering, spam detection. Described format conversion as "not trivial."
- **Zendesk:** Forwarding-based. Tenants forward from existing email. Four CNAME records for SPF/DKIM per tenant.
- **Front:** Email-first platform. Centralizes email + chat + SMS + social into shared workspace.

### 7.4 AI Resolution Pricing

| Platform | Model |
|----------|-------|
| Intercom | $0.99/resolution |
| Zendesk | Included in plan (usage limits) |
| Freshdesk | Included in plan |

**Sources:**
- [Respond.io Channels](https://respond.io/help/channels)
- [Intercom Omnichannel](https://www.intercom.com/help/en/articles/6884847-omnichannel-support-for-workflows)
- [Chatwoot GitHub](https://github.com/chatwoot/chatwoot)

---

## 8. Academic Research and Market Data

### 8.1 LATAM Conversational Commerce

- **Total market:** $18.2B, 35% YoY growth
- **Channel share:** WhatsApp 72%, Instagram DM 15% (~$2.7B), Messenger 8%
- **Instagram DM open rates:** 90% (via ManyChat automation)
- **Instagram DM reply rates:** up to 60%
- **73% of consumers globally** prefer messaging when communicating with a business (Meta/Kantar)

### 8.2 Channel Engagement Metrics

| Channel | Open Rate | Reply Rate | CSAT | AI Resolution Rate |
|---------|-----------|-----------|------|-------------------|
| Email | 20-25% | 1-5% | 74% | 55-70% |
| WhatsApp | 90%+ | 40-60% | 86% | 55-70% |
| Instagram DM | 90% | Up to 60% | ~82% | 50-65% (est.) |
| Web Chat | N/A | N/A | 82% | 55-70% |

### 8.3 Market Size

- AI for customer service: $12.06B (2024) -> $47.82B (2030), CAGR 25.8%
- 80% of customer service teams used AI chatbots in 2025
- Only 13% of businesses successfully carry customer context across all channels
- Only 33% of companies offer fully integrated omnichannel support

**Key insight:** Massive market opportunity for platforms that deliver true omnichannel AI with context continuity. Most claim omnichannel but fail at cross-channel context preservation.

### 8.4 Channel Strategy by Market

| Market | Primary | Secondary | Emerging |
|--------|---------|-----------|----------|
| LATAM | WhatsApp (72%), Instagram DM (15%) | Messenger (8%) | Telegram (Gen Z Brazil) |
| USA | SMS, Email | WhatsApp (50% Gen Z), Instagram | RCS |
| Europe | WhatsApp (varies), Email | SMS | RCS (40% YoY) |

### 8.5 Email-Specific Research

- Email marketing ROI: 3,600-3,800% ($36-38 per $1 spent)
- AI-generated emails have higher clickthrough rates than human-written
- 88% of customers expect email response within 60 minutes; average response time is 12+ hours
- Context rot research shows increasing input tokens degrades LLM performance -- email threads need smart truncation

**Sources:**
- [LATAM Conversational Commerce](https://www.aurorainbox.com/en/2026/03/04/ecommerce-statistics-whatsapp-latam/)
- [AI in Customer Service Market](https://www.globenewswire.com/news-release/2025/03/07/3038782/28124/en/AI-in-Customer-Service-Market-Report-2025-2030.html)
- [Channel Switching Behavior (Springer)](https://link.springer.com/article/10.1007/s12525-025-00794-8)
- [Context Rot (Chroma Research)](https://research.trychroma.com/context-rot)

---

## 9. Beyond the State of the Art

### 9.1 Cross-Channel Identity Graph

The most impactful theoretical concept. A single customer has 5 different identifiers across channels (phone, IGSID, PSID, email, session cookie). Without identity resolution, the AI treats them as 5 separate users.

**Recommended architecture (Phase 7+):**
```
IdentityGraph:
  engineUserId: "user_123"
  identities:
    - channel: whatsapp, id: "+526641234567"
    - channel: instagram, id: "igsid_abc123"
    - channel: email, id: "user@example.com"
  confidence: deterministic | probabilistic
  linkedAt: timestamp
  linkedBy: user_action | admin | auto_detected
```

Must be opt-in, tenant-scoped, reversible, auditable, and GDPR-compliant.

### 9.2 Channel Fallback Chains

When a primary channel fails, cascade to alternatives:
```
Primary: WhatsApp (highest engagement)
  -> Fallback after 5 min: SMS (highest deliverability)
  -> Fallback after 30 min: Email (richest content)
```

For Kiln: Instagram 24-hour window closed -> send follow-up via email if identity graph links them.

### 9.3 AI-Initiated Channel Switching

Frontier concept: the AI actively recommends switching channels mid-conversation:
- Complex question on WhatsApp -> "Mind if I send you an email with the full breakdown?"
- Blurry photo on Instagram -> "Could you send this via WhatsApp for better quality?"
- Web widget user leaving -> "Want me to continue on WhatsApp?"

### 9.4 Emerging Channels (Post-Phase 6)

| Priority | Channel | Reach | Strategic Value |
|----------|---------|-------|-----------------|
| P1 | RCS/SMS | 5B+ phones | Very High (SMS evolution, 50% traffic growth in 2025) |
| P1 | Telegram | 1B MAU | Medium (free, strong in Gen Z LATAM) |
| P2 | Matrix/MIMI | Growing | Very High (future-proof, DMA interoperability) |
| P2 | Discord | 200M MAU | Medium (communities, B2B) |
| P3 | Voice | Universal | High (accessibility) |
| P3 | Video AI | Emerging | Medium (HeyGen $95M ARR) |

### 9.5 Protocol-Level Innovation

**MIMI (More Instant Messaging Interoperability):** IETF working group building on MLS protocol. If WhatsApp, iMessage, and Messenger must interoperate under EU DMA, Kiln could build one protocol adapter and reach all federated platforms instead of N per-platform adapters.

**EU DMA Impact:** Apple fined EUR 500M, Meta fined EUR 200M in April 2025 for DMA violations. Commission reviewing extension to online social networking services in 2026.

### 9.6 The "Most Important Module" Thesis

**In an AI orchestration engine, channels determine the ceiling of value the system can deliver.**

An AI with the world's best orchestration but only a CLI channel is limited to developers. Add WhatsApp = 2B people. Add Email = every professional. Add Voice = people who can't type.

**The AI's intelligence is constant. The channels multiply its reach.**

The moat is not in any single adapter (commoditizable) but in:
1. The abstraction quality (200 LOC for new channel vs 2000)
2. Cross-channel intelligence (identity graph, shared memory, context continuity)
3. Channel-aware AI behavior (tone, formatting, cultural adaptation)
4. Ecosystem breadth (each additional channel increases switching costs)

### 9.7 Adversarial Considerations

Each channel introduces unique attack vectors:

| Channel | Primary Attack | Mitigation |
|---------|---------------|------------|
| Email | HTML-embedded prompt injection (hidden `display:none` divs) | Strip hidden elements, render to plain text |
| Instagram | Image-based prompt injection (adversarial text in images) | OCR scan before multimodal processing |
| WhatsApp | Audio prompt injection in voice messages | STT output classification before injection |
| Cross-channel | Identity leakage between channels | Tenant-level `crossChannelContextSharing` config |

**Email is the most dangerous channel for AI agents.** A single malicious email could trigger full system compromise if the AI has tool-use permissions.

**Sources:**
- [Image-based Prompt Injection (arXiv 2603.03637)](https://arxiv.org/html/2603.03637)
- [Email Phishing in AI Agent Era (Penligent)](https://www.penligent.ai/hackinglabs/email-phishing-in-the-ai-agent-era-prompt-injection-invisible-payloads-and-how-penligent-validates-your-defense/)
- [Agent Session Smuggling (Palo Alto Unit42)](https://unit42.paloaltonetworks.com/agent-session-smuggling-in-agent2agent-systems/)
- [MIMI Protocol Draft v5](https://datatracker.ietf.org/doc/draft-ietf-mimi-protocol/)

---

## 10. Architectural Recommendations for Kiln

### 10.1 Meta Webhook Foundation (New File)

**`runtime/src/gateway/meta-webhook-foundation.ts`**:
- `createMetaWebhookVerification(verifyToken)` -- GET handler (shared)
- `requireMetaWebhookSignature(appSecret)` -- POST middleware (wraps existing)
- `MetaWebhookDispatcher` -- inspects `object` field, routes to registered handlers
- Extract from existing `whatsapp-webhook-routes.ts`, keep WhatsApp working identically

### 10.2 Instagram Adapter (3 New Files)

```
runtime/src/channels/instagram-channel.ts       // Channel interface impl
runtime/src/channels/instagram-api.ts            // sendInstagramMessage(), CDN media download
runtime/src/gateway/instagram-webhook-routes.ts  // Webhook handler (uses MetaWebhookDispatcher)
```

### 10.3 Messenger Adapter (3 New Files)

```
runtime/src/channels/messenger-channel.ts       // Channel interface impl
runtime/src/channels/messenger-api.ts            // sendMessengerMessage(), typing indicators
runtime/src/gateway/messenger-webhook-routes.ts  // Webhook handler (uses MetaWebhookDispatcher)
```

### 10.4 Shared IG/Messenger Parser

Instagram and Messenger share the `entry[].messaging[]` payload structure. A shared parser normalizes both to `InboundMetaMessage`, with channel-specific post-processing for media handling and feature differences.

### 10.5 Email Adapter (3 New Files)

```
runtime/src/channels/email-channel.ts           // Channel interface impl
runtime/src/channels/email-api.ts                // sendEmail() via Postmark, threading headers
runtime/src/gateway/email-webhook-routes.ts      // Postmark webhook handler
```

**Plus dependencies:** `postmark` (API client), `juice` (CSS inliner), `marked` (markdown->HTML).

### 10.6 TenantRegistry Extensions

New resolver methods:
- `resolveByPageId(pageId: string)` -- Messenger
- `resolveByInstagramId(instagramId: string)` -- Instagram
- `resolveByEmailDomain(mailboxHash: string)` -- Email

### 10.7 Message Formatter Extensions

Update `formatForChannel()` to support:
- Instagram: strip all markdown, truncate to 1000 chars
- Messenger: strip markdown, truncate to 2000 chars
- Email: convert markdown to HTML, wrap in template, add threading headers

### 10.8 Per-Channel System Prompt Configuration

```yaml
# In gateway.yaml or tenant config
channels:
  whatsapp:
    systemPromptSuffix: "Keep responses under 200 words. Use short paragraphs."
  instagram:
    systemPromptSuffix: "Keep responses under 150 words. Be casual. Use line breaks."
  email:
    systemPromptSuffix: "Use professional email format with greeting and sign-off."
```

---

## 11. Implementation Sequence

### Phase 6a: Meta Webhook Foundation + Instagram (Week 1-2)

1. Extract shared webhook foundation from existing `whatsapp-webhook-routes.ts`
2. Create `meta-webhook-foundation.ts` (verification, HMAC, dispatcher)
3. Refactor WhatsApp routes to use foundation (no behavioral changes)
4. Implement `instagram-channel.ts`, `instagram-api.ts`
5. Implement `instagram-webhook-routes.ts` using shared dispatcher
6. Add `resolveByInstagramId()` to TenantRegistry
7. Add Instagram message formatter (plain text, 1000 char limit)
8. Handle echo filtering (`is_echo`), story context, messaging window
9. Wire Instagram rate limiting (200/hr per account)
10. Tests for all new components

### Phase 6b: Facebook Messenger (Week 2-3)

1. Implement `messenger-channel.ts`, `messenger-api.ts`
2. Implement `messenger-webhook-routes.ts` using shared dispatcher
3. Share IG/Messenger webhook parser (same `entry[].messaging[]` structure)
4. Add `resolveByPageId()` to TenantRegistry
5. Add Messenger message formatter (plain text, 2000 char limit)
6. Implement typing indicators (`typing_on` before responses)
7. Quick reply support (map Kiln suggestion chips)
8. Handle echo filtering, messaging window, `HUMAN_AGENT` tag
9. Tests for all new components

### Phase 6c: Email Channel (Week 3-5)

1. Set up Postmark account and inbound webhook configuration
2. Implement `email-webhook-routes.ts` (parse Postmark webhook payload)
3. Implement multi-tenant routing via `MailboxHash` (plus-addressing)
4. Implement `email-api.ts` (send via Postmark, threading headers)
5. Implement email formatting pipeline (markdown -> HTML -> CSS inlining)
6. Implement loop prevention (all 6 mechanisms)
7. Implement `EmailThread` tracking (Message-ID chains per conversation)
8. Implement `email-channel.ts` (async session model)
9. Add compliance headers (Auto-Submitted, List-Unsubscribe, CAN-SPAM footer)
10. Tests for all new components

### Phase 6d: ChannelAdapter Normalization + Documentation (Week 5-6)

1. Add simplified `ChannelCapabilities` to `Channel` interface
2. Implement per-channel system prompt modifiers
3. Update `formatForChannel()` with channel-aware formatting
4. Update gateway.yaml schema for multi-channel Meta configuration
5. Update CLAUDE.md with new bounded contexts and entry points
6. Documentation: channel setup guides, multi-tenant email guide
7. Version bump to 0.4.0

---

## 12. Open Questions

1. **SHA-1 vs SHA-256 for Instagram:** Meta Unified research confirms all 3 channels use `X-Hub-Signature-256`. Instagram-specific research flagged potential SHA-1 (`x-hub-signature`). **Resolution:** Trust the unified finding, but verify both headers during implementation. Support SHA-256 primary with SHA-1 fallback if needed.

2. **Instagram CDN URL expiration:** Documented as 1-3 hours but imprecise. Audio preprocessing (STT) must happen immediately upon receipt. Need to measure actual expiration in production.

3. **Instagram follower requirement:** Some sources mention 1,000-follower minimum for messaging API access. Verify if this still applies in 2026.

4. **Email session model:** How long should email sessions live? Messaging sessions have 24h windows. Email threads can span weeks. Consider: configurable TTL per channel, or "reopen session on new message in same thread."

5. **Postmark vs Resend:** If Kiln ecosystem already uses Resend for outbound email, is the operational simplicity of one provider worth the suboptimal webhook payload (metadata-only, requires extra API calls)?

6. **Email HTML complexity:** How sophisticated should the email template be? Simple inline CSS (safest) vs MJML (richest)? Start simple, add MJML in v2 if tenants need branded templates.

7. **Handover Protocol priority:** Should Messenger Handover Protocol (bot <-> human agent app coordination) ship in Phase 6 or defer? Kiln's native handoff works without it, but Handover Protocol enables deeper Meta ecosystem integration.

8. **Cross-channel identity timeline:** Phase 7 is the planned slot. Should a minimal identity linking API (manual merge by operator) ship in Phase 6 to support early adopters?

9. **Channel-aware tool gating:** Should email channel have restricted tool permissions by default (higher attack surface from prompt injection)? The safety pipeline already runs, but per-channel risk levels could tighten gates.

10. **Quick reply normalization:** Should Kiln's suggestion chips map 1:1 to Instagram quick replies (13 max) and WhatsApp buttons (3 max), or should the engine auto-truncate based on channel capabilities?

---

## Appendix A: Full Source Index

### Individual Research Documents (Detailed)

| Document | Scope |
|----------|-------|
| `phase6-instagram-channel-research.md` | Instagram DM API deep dive |
| `phase6-messenger-channel-research.md` | Messenger Platform deep dive |
| `phase6-email-channel-research.md` | Email inbound channel deep dive |
| `phase6-meta-unified-platform-research.md` | Shared Meta infrastructure analysis |
| `phase6-channels-competitive-research.md` | Competitive intelligence and market data |
| `phase6-channel-vision-research.md` | Theoretical frontiers and beyond state of art |

### Key Official Documentation

- [Instagram Messaging API](https://developers.facebook.com/docs/messenger-platform/instagram/)
- [Messenger Platform](https://developers.facebook.com/docs/messenger-platform)
- [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/)
- [Meta Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/)
- [Postmark Inbound Webhook](https://postmarkapp.com/developer/webhooks/inbound-webhook)
- [RFC 5322 (Internet Message Format)](https://www.rfc-editor.org/rfc/rfc5322)
- [RFC 3834 (Automatic Responses)](https://datatracker.ietf.org/doc/html/rfc3834)
- [RFC 8058 (One-Click Unsubscribe)](https://datatracker.ietf.org/doc/html/rfc8058)

### Academic and Industry Sources

- [AI in Customer Service Market Report 2025-2030](https://www.globenewswire.com/news-release/2025/03/07/3038782/28124/en/AI-in-Customer-Service-Market-Report-2025-2030.html)
- [LATAM Conversational Commerce Statistics](https://www.aurorainbox.com/en/2026/03/04/ecommerce-statistics-whatsapp-latam/)
- [Channel Switching Behavior (Springer, 2025)](https://link.springer.com/article/10.1007/s12525-025-00794-8)
- [Intercom: Fin Over Email Architecture](https://www.intercom.com/blog/fin-over-email-how-we-built/)
- [Image-based Prompt Injection (arXiv 2603.03637)](https://arxiv.org/html/2603.03637)
- [MIMI Protocol Draft v5](https://datatracker.ietf.org/doc/draft-ietf-mimi-protocol/)
- [Context Rot (Chroma Research)](https://research.trychroma.com/context-rot)
