# Phase 6 Research: Meta Unified Platform Architecture

**Date:** 2026-03-07
**Author:** Ricardo Armenta (Sequel)
**Scope:** WhatsApp, Instagram DM, and Facebook Messenger -- what can be shared at the infrastructure level for Kiln's Phase 6 "Shared Meta webhook handler refactoring."

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Meta Webhooks Platform -- Unified Architecture](#2-meta-webhooks-platform----unified-architecture)
3. [Webhook Payload Comparison](#3-webhook-payload-comparison)
4. [Meta Graph API Authentication](#4-meta-graph-api-authentication)
5. [Meta Business Suite Integration](#5-meta-business-suite-integration)
6. [HMAC-SHA256 Verification](#6-hmac-sha256-verification)
7. [Rate Limits Across Channels](#7-rate-limits-across-channels)
8. [Shared Media Infrastructure](#8-shared-media-infrastructure)
9. [Meta's Future Direction -- Interoperability](#9-metas-future-direction----interoperability)
10. [Refactoring Patterns for Multi-Channel Meta Integration](#10-refactoring-patterns-for-multi-channel-meta-integration)
11. [App Configuration for Multiple Channels](#11-app-configuration-for-multiple-channels)
12. [Shared vs Separate Summary Matrix](#12-shared-vs-separate-summary-matrix)
13. [Recommended Architecture for Kiln](#13-recommended-architecture-for-kiln)

---

## 1. Executive Summary

Meta's three messaging channels (WhatsApp, Instagram DM, Messenger) share significant infrastructure at the webhook verification and signature validation layers, but diverge substantially in payload structure, authentication tokens, media handling, rate limits, and send APIs. The refactoring should extract a shared Meta webhook foundation layer while keeping channel-specific adapters for parsing, sending, and media.

**Bottom line:** Approximately 30-40% of the infrastructure can be fully shared (verification handshake, HMAC signature validation, webhook dispatcher). The remaining 60-70% requires channel-specific adapters behind a common interface.

---

## 2. Meta Webhooks Platform -- Unified Architecture

### Can all three channels share one webhook URL?

**No, but they can share one endpoint with routing.** Meta's webhook subscriptions are configured per-product within a single Facebook App. Each product (WhatsApp, Instagram, Messenger) has its own webhook subscription in the App Dashboard. However, all subscriptions can point to the same callback URL since the `object` field in the payload discriminates the channel.

### How does Meta differentiate events by channel?

The top-level `object` field in every webhook payload identifies the source:

| Channel    | `object` value                 |
|------------|-------------------------------|
| WhatsApp   | `"whatsapp_business_account"` |
| Instagram  | `"instagram"`                 |
| Messenger  | `"page"`                      |

This is the primary discriminator. A single webhook endpoint can inspect `payload.object` and route to the appropriate channel handler.

### Webhook subscriptions: per-app or per-product?

Per-product within a single app. In the Meta App Dashboard, each product (WhatsApp, Instagram, Messenger) has its own webhook configuration section where you set the callback URL, verify token, and subscribed fields. You can configure all three products within the same Facebook App.

**Sources:**
- [Meta Webhooks for WhatsApp](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/)
- [Meta Webhooks for Instagram](https://developers.facebook.com/docs/instagram-platform/webhooks/)
- [Meta Webhooks for Messenger](https://developers.facebook.com/docs/messenger-platform/webhooks)
- [Unipile Meta API Integration Guide](https://www.unipile.com/guide-to-meta-api-integration-for-software-editors/)

---

## 3. Webhook Payload Comparison

### WhatsApp Payload Structure

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "<WABA_ID>",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "phone_number_id": "..." },
        "contacts": [{ "profile": { "name": "..." }, "wa_id": "..." }],
        "messages": [{
          "from": "...",
          "type": "text",
          "text": { "body": "..." }
        }],
        "statuses": [{ "id": "...", "status": "delivered", ... }]
      },
      "field": "messages"
    }]
  }]
}
```

**Key:** Uses `entry[].changes[]` pattern. Messages are nested under `changes[].value.messages[]`. Contact info and statuses are siblings of messages.

### Instagram Payload Structure

```json
{
  "object": "instagram",
  "entry": [{
    "id": "<IG_USER_ID>",
    "time": 1622211185048,
    "messaging": [{
      "sender": { "id": "sender-id" },
      "recipient": { "id": "recipient-id" },
      "timestamp": 1622211184495,
      "message": {
        "mid": "message-mid",
        "text": "Hello"
      }
    }]
  }]
}
```

**Key:** Uses `entry[].messaging[]` pattern (NOT `changes`). Each messaging entry has `sender`, `recipient`, and `message` directly. This mirrors the Messenger pattern, not WhatsApp.

### Messenger Payload Structure

```json
{
  "object": "page",
  "entry": [{
    "id": "<PAGE_ID>",
    "time": 1458692752478,
    "messaging": [{
      "sender": { "id": "sender_id" },
      "recipient": { "id": "recipient_id" },
      "timestamp": 1458692752478,
      "message": {
        "mid": "mid.1457764197618:41d102a3e1ae206a38",
        "text": "hello, world!"
      }
    }]
  }]
}
```

**Key:** Nearly identical to Instagram. Uses `entry[].messaging[]` pattern with `sender`/`recipient`/`message`.

### Structural Analysis

| Aspect | WhatsApp | Instagram | Messenger |
|--------|----------|-----------|-----------|
| `object` value | `whatsapp_business_account` | `instagram` | `page` |
| Entry sub-array | `changes[]` | `messaging[]` | `messaging[]` |
| Message location | `changes[].value.messages[]` | `messaging[].message` | `messaging[].message` |
| Sender ID field | `messages[].from` (phone) | `messaging[].sender.id` (IGSID) | `messaging[].sender.id` (PSID) |
| Recipient field | `metadata.phone_number_id` | `messaging[].recipient.id` | `messaging[].recipient.id` |
| Message ID | `messages[].id` (wamid) | `messaging[].message.mid` | `messaging[].message.mid` |
| Contact info | `contacts[]` (separate) | N/A (lookup via API) | N/A (lookup via API) |
| Delivery status | `statuses[]` (inline) | Separate webhook field | Separate webhook event |
| Text content | `text.body` | `message.text` | `message.text` |

**Can a single parser handle all three?** Not directly -- there are two distinct structural families:
1. **WhatsApp family:** `entry[].changes[].value.messages[]` -- deeply nested, contact info inline
2. **Messenger/Instagram family:** `entry[].messaging[].message` -- flatter, sender/recipient inline

A discriminated union on `object` can dispatch to two parsing paths: one for WhatsApp, one shared for Instagram+Messenger.

**Sources:**
- [WhatsApp Webhooks Reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/)
- [Instagram Messaging Webhooks](https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook/)
- [Messenger Webhook Events](https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages/)
- [Chatwoot Webhook Processing](https://deepwiki.com/chatwoot/chatwoot/7.8-webhook-processing-and-message-routing)
- [Setup Meta Webhooks for Instagram](https://innocentanyaele.medium.com/setup-meta-webhooks-for-instagram-messaging-and-respond-to-message-4575bc95c7a2)

---

## 4. Meta Graph API Authentication

### Token Types

| Token Type | Lifetime | Use Case |
|-----------|----------|----------|
| **System User Token** | Non-expiring (can be revoked) | Server-to-server. WhatsApp Cloud API production. Can be scoped to WhatsApp + Instagram + Pages. |
| **Page Access Token** | Short-lived (1-2hr) or long-lived (60 days) | Messenger send API, Instagram messaging (when Page-linked). |
| **User Access Token** | Short-lived (1-2hr) or long-lived (60 days) | Instagram API (login-based). Requires user re-auth on expiry. |
| **Instagram User Token** | Short-lived, exchangeable for 60-day | Instagram-specific. For accounts using Instagram Login flow. |

### Which token type works for each channel?

| Channel | Recommended Token | Alternative |
|---------|------------------|-------------|
| WhatsApp | System User Token (permanent) | User Token (not recommended for prod) |
| Messenger | Page Access Token (long-lived) or System User Token | User Token |
| Instagram | System User Token (if in Business Portfolio) or Instagram User Token | Page Token (if Page-linked via FB Login) |

### Can one token be used across all three channels?

**Partially.** A System User Token generated in Meta Business Manager can access assets across all three channels IF:
1. The System User has been granted access to the WhatsApp Business Account, the Facebook Page, and the Instagram Professional Account
2. The token has the correct permission scopes

However, the required scopes differ per channel:

| Channel | Required Permissions |
|---------|---------------------|
| WhatsApp | `whatsapp_business_messaging`, `whatsapp_business_management` |
| Messenger | `pages_messaging`, `pages_manage_metadata`, `pages_show_list` |
| Instagram | `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata` |

**Practical recommendation:** Use a single System User with all scopes combined, generating one token that covers all channels. This is the cleanest approach for a multi-channel integration.

**Sources:**
- [Meta Access Token Guide](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/)
- [WhatsApp Access Tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/)
- [Instagram Access Token](https://developers.facebook.com/docs/instagram-platform/reference/access_token/)
- [WhatsApp Permanent Token Guide](https://anjoktechnologies.in/blog/-whatsapp-cloud-api-permanent-access-token-step-by-step-system-user-2026-complete-correct-guide-by-anjok-technologies)
- [Sinch: System User vs User Token](https://community.sinch.com/t5/Conversation-API/Should-I-use-a-User-access-token-or-a-System-User-access-token/ta-p/15024)

---

## 5. Meta Business Suite Integration

### Business Portfolio Hierarchy

```
Meta Business Portfolio (formerly Business Manager)
  |-- Facebook Page(s)
  |     |-- Messenger (via Page)
  |     |-- Instagram Professional Account (linked to Page)
  |-- WhatsApp Business Account (WABA)
  |     |-- Phone Number(s)
  |-- Facebook App(s)
        |-- Product: WhatsApp (webhook config)
        |-- Product: Instagram (webhook config)
        |-- Product: Messenger (webhook config)
```

### Key Relationships

- **Facebook Page** is the hub that connects Messenger and Instagram. A Page has Messenger built-in and can link to an Instagram Professional Account.
- **WhatsApp Business Account** is a separate entity from Pages, connected to the Business Portfolio at the top level.
- **Instagram Professional Account** must be linked to a Facebook Page to use the messaging API.

### Meta's Direction for Unified Messaging

Meta's Business Suite provides a unified inbox for Page-linked channels (Messenger + Instagram DM). WhatsApp remains somewhat separate in the Business Suite UI but is increasingly being integrated. The On-Premises WhatsApp API was deprecated October 2025; Cloud API is now the only option.

As of July 2025, WhatsApp pricing shifted from conversation-based to per-template-message billing. The Marketing Messages Lite (MM Lite) API was introduced in April 2025, using Meta's ad optimization AI for WhatsApp marketing messages.

**Sources:**
- [WhatsApp Cloud API Setup](https://chatarmin.com/en/blog/whatsapp-cloudapi)
- [WhatsApp Business API Integration](https://chatarmin.com/en/blog/whats-app-business-api-integration)
- [WhatsApp API Pricing 2026](https://www.engagelab.com/blog/whatsapp-api-pricing)

---

## 6. HMAC-SHA256 Verification

### Is the same app secret used for all three channels?

**Yes.** All three channels use the same Facebook App Secret for HMAC-SHA256 signature verification. The signature is computed against the raw request body using the App Secret as the HMAC key.

### Is the signature format identical?

**Yes, completely identical:**
- Header: `X-Hub-Signature-256`
- Format: `sha256=<hex_digest>`
- Algorithm: HMAC-SHA256(app_secret, raw_body)

### Can Kiln's existing `requireWebhookSignature(appSecret, "x-hub-signature-256")` work for all three?

**Yes, with zero changes.** The existing middleware already:
1. Reads the `x-hub-signature-256` header
2. Strips the `sha256=` prefix
3. Verifies HMAC-SHA256 against the raw body

This is fully compatible with Instagram and Messenger webhooks. This is the strongest area of sharing -- 100% reuse.

### Webhook Verification Handshake (GET)

All three channels use the identical verification handshake:
- `GET` request with query params: `hub.mode=subscribe`, `hub.verify_token=<your_token>`, `hub.challenge=<challenge>`
- Respond with the challenge value if the verify token matches

Kiln's existing verification handler works for all three channels unchanged.

**Sources:**
- [Meta Webhook Signature Verification](https://communityforums.atmeta.com/discussions/dev-general/how-to-verify-a-webhook-request-sign/1171086)
- [Hookdeck SHA256 Verification Guide](https://hookdeck.com/webhooks/guides/how-to-implement-sha256-webhook-signature-verification)
- [WhatsApp Webhook Setup](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/)

---

## 7. Rate Limits Across Channels

### WhatsApp Rate Limits

| Limit Type | Details |
|-----------|---------|
| **Messaging tiers** | 250 / 2K / 10K / 100K / unlimited unique conversations per 24hr rolling window |
| **Tier scope** | Per Business Portfolio (changed Oct 2025, previously per phone number) |
| **Throughput** | Standard: 80 messages/sec (MPS). Unlimited tier: up to 1,000 MPS |
| **Marketing frequency cap** | ~2 marketing templates per user per day (across ALL businesses, not per-business) |
| **Quality score** | Low quality -> tier downgrade or suspension |

### Instagram Rate Limits

| Limit Type | Details |
|-----------|---------|
| **API calls** | 200 calls per hour (down from previous 5,000/hr) |
| **DM automation** | 200 DMs per hour |
| **24-hour window** | Automated responses only within 24hr of user's last message |
| **No tiering** | Flat limits, no tier progression system |

### Messenger Rate Limits

| Limit Type | Details |
|-----------|---------|
| **Standard messaging** | Within 24hr of user's last message (standard messaging window) |
| **Message tags** | Required for messages outside 24hr window (e.g., `CONFIRMED_EVENT_UPDATE`) |
| **API rate limit** | Per-page, based on page's audience size |
| **No quality score** | No quality score system like WhatsApp |

### Key Differences

- **WhatsApp** has the most complex rate limiting (tiers, quality scores, MPS limits)
- **Instagram** has the strictest raw API call limits (200/hr)
- **Messenger** is the most lenient but has strict 24hr window enforcement
- Rate limits are NOT shared across channels -- each channel has independent limits

**Implication for Kiln:** The `SlidingWindowRateLimiter` should be channel-aware. WhatsApp's existing quality/tier system is unique and cannot be generalized.

**Sources:**
- [WhatsApp API Rate Limits](https://www.wati.io/en/blog/whatsapp-business-api/whatsapp-api-rate-limits/)
- [WhatsApp Messaging Limits 2026](https://chatarmin.com/en/blog/whats-app-messaging-limits)
- [Meta API Rate Limits Overview](https://agentsapis.com/meta-api/pricing/)
- [Instagram API Limitations](https://www.interakt.shop/instagram-automation/api-limitations-setup-tips/)

---

## 8. Shared Media Infrastructure

### Media Download Comparison

| Aspect | WhatsApp | Instagram | Messenger |
|--------|----------|-----------|-----------|
| **Download mechanism** | Two-step: GET media ID -> GET CDN URL | Direct URL in API response | Direct URL in webhook payload |
| **Auth for download** | Bearer token required for both steps | Token for API call, URL is public CDN | Token for API call, URL is public CDN |
| **URL expiration** | 5 minutes | Stable (CDN-hosted) | Stable (CDN-hosted) |
| **Media ID format** | Numeric ID via Graph API | Numeric ID via Graph API | `mid.*` format |
| **CDN domain** | `lookaside.fbsbx.com` | `scontent.*.fbcdn.net` | `scontent.*.fbcdn.net` |

### Media Upload/Send Comparison

| Aspect | WhatsApp | Instagram | Messenger |
|--------|----------|-----------|-----------|
| **Send endpoint** | `POST /{phoneNumberId}/messages` | `POST /{pageId}/messages` or `POST /me/messages` | `POST /me/messages` |
| **API host** | `graph.facebook.com` | `graph.instagram.com` | `graph.facebook.com` |
| **Media in payload** | `{ type: "image", image: { link: url } }` | `{ attachment: { type: "image", payload: { url } } }` | `{ attachment: { type: "image", payload: { url } } }` |
| **Upload flow** | Upload to WA media endpoint, get media ID | URL-based or attachment upload | URL-based or attachment upload |

### Can Kiln's `whatsappMediaUrl()` extend to other channels?

**No.** WhatsApp's two-step media download (Graph API metadata -> CDN binary) is unique. Instagram and Messenger provide direct CDN URLs in their webhook payloads. Kiln's `createWhatsAppMediaDownloader` (two-step with Bearer auth) is WhatsApp-specific. Instagram and Messenger can use `createGenericMediaDownloader` or a simpler direct-fetch approach.

**Recommended abstraction:**

```typescript
interface MetaMediaDownloader {
  download(mediaRef: string, channel: MetaChannel): Promise<{ data: Uint8Array; mimeType: string }>;
}
```

With WhatsApp using the two-step process and Instagram/Messenger using direct fetch.

**Sources:**
- [WhatsApp Media Download](https://medium.com/@shreyas.sreedhar/downloading-media-using-whatsapps-cloud-api-webhooks-and-uploading-it-to-aws-s3-bucket-via-nodejs-07c5cbae896f)
- [Instagram Graph API Media](https://elfsight.com/blog/instagram-graph-api-complete-developer-guide-for-2026/)
- [Instagram Media Endpoints](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/)

---

## 9. Meta's Future Direction -- Interoperability

### Messenger.com Shutdown (April 2026)

Meta is shutting down the standalone Messenger.com website in April 2026. Desktop apps (Windows/Mac) were retired in December 2025. Web messaging will be available only via `facebook.com/messages`. The mobile Messenger app continues unchanged.

**API impact:** None expected. The Messenger Platform API remains unchanged. This is a consumer-facing change, not an API change.

### EU DMA Interoperability

Under the Digital Markets Act, Meta has been required to enable third-party messaging interoperability:
- WhatsApp launched interoperability with BirdyChat and Haiket in Europe (November 2025)
- Third-party apps must use E2EE at the same level as WhatsApp
- Year 1 requirements: 1:1 text, images, voice messages, videos, files between individual users
- Future requirements: group messaging and calling

**API impact for Kiln:** None directly. DMA interoperability is for consumer-to-consumer messaging between different apps, not for business API integrations. Kiln's use case (business responding to customer messages) is unaffected.

### Cross-Platform Messaging

Meta has enabled cross-posting across Facebook, Instagram, and WhatsApp, but cross-platform messaging (e.g., WhatsApp user messaging a Messenger user) is NOT available as of March 2026 and there is no public API timeline for this.

### Will Meta eventually unify the APIs?

There are no public announcements about API unification. However, the structural similarity between Instagram and Messenger webhook payloads (both use `entry[].messaging[]`) suggests they share underlying infrastructure. Instagram messaging is explicitly documented as being built on the Messenger Platform architecture:

> "The Instagram DM API is not a separate entity; it is a functionality provided through the Messenger Platform."

This means Instagram and Messenger are already partially unified at the platform level. WhatsApp remains architecturally separate.

**Sources:**
- [Messenger.com Shutdown](https://techcrunch.com/2026/02/19/meta-is-shutting-down-messengers-standalone-website/)
- [WhatsApp Interoperability](https://about.fb.com/news/2025/11/messaging-interoperability-whatsapp-enables-third-party-chats-for-users-in-europe/)
- [Meta DMA Engineering](https://engineering.fb.com/2024/03/06/security/whatsapp-messenger-messaging-interoperability-eu/)
- [End of Messenger.com](https://www.diplotic.com/end-of-messenger-in-2026/)

---

## 10. Refactoring Patterns for Multi-Channel Meta Integration

### How do existing platforms handle multiple Meta channels?

**Chatwoot** (open source, most relevant reference):
- Exposes channel-specific webhook endpoints (e.g., `/webhooks/whatsapp/{phone_number}`)
- Uses a polymorphic channel architecture with a unified interface
- Shared pattern: webhook reception -> authentication -> contact resolution -> message creation
- Channel-specific: inbound parsing and outbound formatting
- Async processing: webhook receivers return immediately; message processing in background jobs

**Unipile** (commercial unified API):
- Single API key, single webhook schema across all Meta channels
- Auto-detects provider and routes messages
- Abstracts away channel differences completely

**go-meta-webhooks** (Go library):
- Type-safe payload verification, validation, and parsing
- Handler interfaces: `EntryHandler`, `ChangesHandler`, `MessagingHandler`
- Scoped handler support: implement only the handlers you need
- Currently Instagram-focused, extensible to other channels

### Recommended Pattern for Kiln

Based on research, the optimal pattern is a **shared dispatcher + channel-specific adapters**:

```
Single webhook URL
  -> HMAC verification (SHARED)
  -> GET verification handshake (SHARED)
  -> POST payload parsing
     -> Discriminate on `object` field
        -> "whatsapp_business_account" -> WhatsAppWebhookAdapter
        -> "instagram"                 -> InstagramWebhookAdapter
        -> "page"                      -> MessengerWebhookAdapter
     -> Each adapter normalizes to a common InboundMetaMessage type
  -> Shared processing pipeline (session, orchestrator, events, reply)
  -> Channel-specific send API
```

### SDK Decision: Official Meta SDKs vs Raw Fetch

**Recommendation: Continue with raw fetch.** Reasons:
1. Kiln already uses raw fetch for WhatsApp successfully
2. Meta does not provide a unified official SDK for all three channels
3. The individual channel SDKs add unnecessary dependency weight
4. The API surface is simple enough (REST + JSON) that raw fetch is cleaner
5. Kiln's `withRetry` pattern provides the resilience layer SDKs would offer

**Sources:**
- [Chatwoot Webhook Processing](https://deepwiki.com/chatwoot/chatwoot/7.8-webhook-processing-and-message-routing)
- [Chatwoot Multi-Channel](https://deepwiki.com/chatwoot/chatwoot/7-configuration-and-customization)
- [go-meta-webhooks](https://github.com/pnmcosta/go-meta-webhooks)
- [Unipile Unified API](https://www.unipile.com/)
- [Meta Webhook Integration Guide](https://www.adarshyadav.dev/blog/webhook-integration-meta-apis)

---

## 11. App Configuration for Multiple Channels

### Can one Facebook App handle all three channels?

**Yes.** A single Facebook App can have WhatsApp, Instagram, and Messenger configured as separate products. Each product has its own webhook configuration within the App Dashboard.

### Product-Level Configuration

In the Meta App Dashboard:
1. Navigate to your App
2. Add products: WhatsApp, Instagram, Messenger
3. Each product has its own section for webhook URL, verify token, and subscribed fields
4. All products share the same App Secret (used for HMAC verification)

### Webhook Subscription Management

| Setting | Shared | Per-Product |
|---------|--------|-------------|
| App Secret | Shared | - |
| Webhook callback URL | Can be same | Configured separately |
| Verify token | Can be same | Configured separately |
| Subscribed fields | - | Per-product (e.g., `messages` for WhatsApp, `messages` for Instagram) |
| Permissions | - | Per-product scopes |

### Test Environments

- **WhatsApp:** Test phone numbers available in the App Dashboard (no real phone required for dev)
- **Instagram:** Requires a real Instagram Professional Account linked to a Facebook Page
- **Messenger:** Requires a real Facebook Page (test pages work)

**Sources:**
- [Configure WhatsApp Webhooks](https://support.bolddesk.com/kb/article/15729/how-to-configure-whatsapp-webhooks-in-meta)
- [WhatsApp Cloud API Webhook Setup](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/)
- [Setup Meta Webhooks for Instagram](https://innocentanyaele.medium.com/setup-meta-webhooks-for-instagram-messaging-and-respond-to-message-4575bc95c7a2)

---

## 12. Shared vs Separate Summary Matrix

| Infrastructure Component | Shareable? | Notes |
|-------------------------|-----------|-------|
| **Webhook verification (GET)** | FULLY SHARED | Identical `hub.mode`/`hub.verify_token`/`hub.challenge` for all 3 |
| **HMAC-SHA256 signature (POST)** | FULLY SHARED | Same App Secret, same `x-hub-signature-256` header, same algorithm |
| **Webhook dispatcher** | FULLY SHARED | Single endpoint, route on `object` field |
| **App Secret** | FULLY SHARED | One App Secret per Facebook App, covers all products |
| **Graph API version** | MOSTLY SHARED | All use `graph.facebook.com/v{version}/`, Instagram can also use `graph.instagram.com` |
| **Payload parsing** | PARTIALLY SHARED | Two families: WhatsApp (`changes[]`) vs IG+Messenger (`messaging[]`) |
| **Send API** | SEPARATE | Different endpoints, different payload shapes, different API hosts |
| **Access tokens** | PARTIALLY SHARED | System User Token can cover all 3, but scopes differ |
| **Media download** | SEPARATE | WhatsApp: 2-step + auth + 5min expiry. IG/Messenger: direct CDN URL |
| **Media upload/send** | SEPARATE | Different payload formats per channel |
| **Rate limiting** | SEPARATE | Completely different systems per channel |
| **24hr messaging window** | PARTIALLY SHARED | IG + Messenger have strict 24hr windows; WhatsApp has templates for out-of-window |
| **Contact/user ID format** | SEPARATE | WhatsApp: phone number. IG: IGSID. Messenger: PSID |
| **Delivery status tracking** | SEPARATE | Different payload structures, different status names |
| **Error handling** | PARTIALLY SHARED | All return Graph API error format, but error codes differ |

---

## 13. Recommended Architecture for Kiln

### Layer 1: Shared Meta Webhook Foundation (new file)

**File:** `runtime/src/gateway/meta-webhook-foundation.ts`

Responsibilities:
- `createMetaWebhookVerification(verifyToken)` -- GET handler (reuse across all 3)
- `requireMetaWebhookSignature(appSecret)` -- POST middleware (wraps existing `requireWebhookSignature`)
- `MetaWebhookDispatcher` -- inspects `object` field, routes to registered channel handlers
- Type: `MetaChannel = "whatsapp" | "instagram" | "messenger"`

### Layer 2: Normalized Message Interface (new types)

```typescript
interface InboundMetaMessage {
  channel: MetaChannel;
  senderId: string;          // phone (WA), IGSID (IG), PSID (Messenger)
  recipientId: string;       // phoneNumberId (WA), igUserId (IG), pageId (Messenger)
  entryId: string;           // WABA ID, IG User ID, or Page ID
  messageId: string;         // wamid, mid, mid
  parts: readonly ContentPart[];
  rawTimestamp: number;
  senderName?: string;       // Only WhatsApp provides inline
}
```

### Layer 3: Channel-Specific Adapters

| Adapter | Parses | Sends Via |
|---------|--------|-----------|
| `WhatsAppWebhookAdapter` | `changes[].value.messages[]` -> `InboundMetaMessage` | `graph.facebook.com/{phoneNumberId}/messages` |
| `InstagramWebhookAdapter` | `messaging[].message` -> `InboundMetaMessage` | `graph.instagram.com/{pageId}/messages` |
| `MessengerWebhookAdapter` | `messaging[].message` -> `InboundMetaMessage` | `graph.facebook.com/me/messages` |

### Layer 4: Shared Processing Pipeline

The existing `processWhatsAppMessage()` function should be generalized into a `processMetaMessage()` that:
1. Resolves tenant (by phone for WA, by IG user ID, by page ID)
2. Builds system prompt
3. Preprocesses audio (channel-aware media downloader)
4. Retrieves knowledge context
5. Runs orchestrator
6. Sends reply via channel-specific send API
7. Emits conversation events with `channel` field

### Migration Path

1. Extract shared webhook foundation from existing `whatsapp-webhook-routes.ts`
2. Refactor `WhatsAppWebhookConfig` to extend a shared `MetaWebhookConfig`
3. Keep WhatsApp working identically during refactor (no behavioral changes)
4. Add Instagram adapter
5. Add Messenger adapter
6. Update `TenantRegistry` to support channel-specific resolution (by phone, by IGSID, by Page ID)
7. Update `gateway.yaml` schema to support multi-channel Meta configuration

### What NOT to Share

- Media download logic (WhatsApp's two-step is fundamentally different)
- Rate limiting strategies (completely different per channel)
- Template messaging (WhatsApp-only feature)
- Delivery status parsing (different payload shapes)
- 24hr window management (different rules per channel)

---

## Appendix: Send API Quick Reference

### WhatsApp
```
POST https://graph.facebook.com/v21.0/{phoneNumberId}/messages
Authorization: Bearer {systemUserToken}
Body: { messaging_product: "whatsapp", to: "{phone}", type: "text", text: { body: "..." } }
```

### Instagram
```
POST https://graph.instagram.com/v24.0/{pageId}/messages
Authorization: Bearer {accessToken}
Body: { recipient: { id: "{igsid}" }, message: { text: "..." } }
```

### Messenger
```
POST https://graph.facebook.com/v21.0/me/messages?access_token={pageToken}
Body: { recipient: { id: "{psid}" }, message: { text: "..." } }
```

Note: Instagram and Messenger share the `{ recipient: { id }, message: { text } }` payload shape. WhatsApp uses `{ messaging_product, to, type, text: { body } }`. The send adapters for IG and Messenger can share a base implementation.
