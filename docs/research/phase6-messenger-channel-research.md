# Phase 6: Facebook Messenger Channel Adapter -- Research Document

**Date:** 2026-03-07
**Researcher:** Maria (Sequel AI assistant)
**Scope:** Facebook Messenger Platform API only (Instagram DM researched separately)
**Status:** Research complete, no code written

---

## Table of Contents

1. [Messenger Platform -- Current State](#1-messenger-platform--current-state)
2. [Webhook Format](#2-webhook-format)
3. [Send API](#3-send-api)
4. [Messaging Windows and Message Tags](#4-messaging-windows-and-message-tags)
5. [Handover Protocol](#5-handover-protocol)
6. [Page-Scoped User ID (PSID)](#6-page-scoped-user-id-psid)
7. [Media Handling](#7-media-handling)
8. [Messenger vs WhatsApp Cloud API -- Key Differences](#8-messenger-vs-whatsapp-cloud-api--key-differences)
9. [Advanced Features](#9-advanced-features)
10. [Meta App Review](#10-meta-app-review)
11. [Kiln Adapter Design Implications](#11-kiln-adapter-design-implications)

---

## 1. Messenger Platform -- Current State

### API Version

- The Messenger Platform sits on top of the **Meta Graph API**.
- As of early 2026, the current Graph API version is **v24.0**.
- Graph API versions follow a rolling deprecation schedule (~2 years per version).
- Endpoint base URL: `https://graph.facebook.com/v24.0/`

### Relationship to Graph API

- Messenger Platform is a **subset of the Graph API**, not a standalone API. All Messenger endpoints use Graph API URLs and versioning.
- Authentication uses **Page Access Tokens** (long-lived tokens generated via Graph API).
- The same Graph API app can hold permissions for Messenger, Instagram, and WhatsApp -- they are different product surfaces on the same underlying API infrastructure.

### Messenger + Instagram Unification

- Meta has partially unified Messenger and Instagram messaging under the Messenger Platform umbrella.
- Instagram messaging webhooks can be configured under the same app and even the same webhook URL.
- **Differentiation**: The top-level `"object"` field in webhook payloads distinguishes them:
  - `"object": "page"` -- Facebook Messenger event
  - `"object": "instagram"` -- Instagram DM event
- The Send API for Instagram uses a different endpoint (`/{ig-user-id}/messages`) vs Messenger (`/me/messages`).
- Despite partial unification, payload structures differ enough that separate channel adapters are warranted.

### Required Permissions

| Permission | Purpose |
|------------|---------|
| `pages_messaging` | Send/receive messages via Messenger (core requirement) |
| `pages_manage_metadata` | Subscribe to webhooks, update Page settings |
| `pages_read_engagement` | Read Page conversations (needed for some features) |
| `business_management` | Access Business Manager assets, verify Page ownership |

**Sources:**
- [Messenger Platform docs](https://developers.facebook.com/docs/messenger-platform)
- [Graph API versions](https://developers.facebook.com/docs/graph-api/changelog/versions/)
- [Permissions Reference](https://developers.facebook.com/docs/permissions)

---

## 2. Webhook Format

### Webhook Verification (Handshake)

The verification flow is **identical to WhatsApp Cloud API**:

1. Meta sends a `GET` request to your callback URL with query parameters:
   - `hub.mode` = `"subscribe"`
   - `hub.verify_token` = your configured verify token
   - `hub.challenge` = a random string
2. Your server must:
   - Verify `hub.verify_token` matches your stored token
   - Return `hub.challenge` as the **plain text response body** (not JSON-wrapped)
   - Return HTTP 200

This is the same pattern already implemented in `WhatsAppChannel.verifyWebhook()`.

### Payload Signature Verification

- Meta signs all webhook payloads with **HMAC-SHA256** using the App Secret.
- Signature is in the `X-Hub-Signature-256` header, prefixed with `sha256=`.
- Verification: compute `HMAC-SHA256(raw_body, app_secret)` and compare.
- **Critical**: Always use the raw request body (before JSON parsing) for signature computation.
- This is the same mechanism as WhatsApp (`requireWebhookSignature` in `auth-middleware.ts`).

### Incoming Message Payload Structure

```json
{
  "object": "page",
  "entry": [
    {
      "id": "<PAGE_ID>",
      "time": 1458692752478,
      "messaging": [
        {
          "sender": { "id": "<PSID>" },
          "recipient": { "id": "<PAGE_ID>" },
          "timestamp": 1458692752478,
          "message": {
            "mid": "mid.1457764197618:41d102a3e1ae206a38",
            "text": "hello, world!",
            "quick_reply": {
              "payload": "<DEVELOPER_DEFINED_PAYLOAD>"
            },
            "attachments": [
              {
                "type": "image|video|audio|file|location|fallback",
                "payload": {
                  "url": "<ATTACHMENT_URL>",
                  "sticker_id": 369239263222822
                }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

### Key Structural Differences from WhatsApp Webhook

| Aspect | WhatsApp | Messenger |
|--------|----------|-----------|
| Top-level object | `"whatsapp_business_account"` | `"page"` |
| Entry structure | `entry[].changes[].value.messages[]` | `entry[].messaging[]` |
| User ID field | `messages[].from` (phone number) | `messaging[].sender.id` (PSID) |
| Page/Account ID | `entry[].id` (WABA ID) | `entry[].id` (Page ID) |
| Contact info | Inline in `contacts[]` | Separate User Profile API call |
| Message ID | `messages[].id` | `messaging[].message.mid` |

### Webhook Event Types (Subscribe Fields)

| Event | Field | Description |
|-------|-------|-------------|
| Messages | `messages` | Text, attachments, quick_reply responses |
| Postbacks | `messaging_postbacks` | Button taps, Get Started, persistent menu |
| Referrals | `messaging_referrals` | m.me links, ads, parametric codes |
| Opt-ins | `messaging_optins` | Send-to-Messenger plugin, checkbox plugin |
| Read receipts | `message_reads` | User read the message |
| Delivery receipts | `message_deliveries` | Message delivered to user |
| Handovers | `messaging_handovers` | Thread control changes |
| Standby | `standby` | Messages received while not owning thread |

### Postback Payload

```json
{
  "sender": { "id": "<PSID>" },
  "recipient": { "id": "<PAGE_ID>" },
  "timestamp": 1458692752478,
  "postback": {
    "title": "<BUTTON_TITLE>",
    "payload": "<DEVELOPER_DEFINED_PAYLOAD>",
    "referral": {
      "ref": "<REF_DATA>",
      "source": "SHORTLINK",
      "type": "OPEN_THREAD"
    }
  }
}
```

**Sources:**
- [Messenger Webhooks](https://developers.facebook.com/docs/messenger-platform/webhooks)
- [Messages webhook event](https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages/)
- [Postbacks webhook event](https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messaging_postbacks/)
- [Webhook verification guide](https://webhookrelay.com/blog/ingesting-facebook-webhooks/)

---

## 3. Send API

### Endpoint

```
POST https://graph.facebook.com/v24.0/me/messages?access_token=<PAGE_ACCESS_TOKEN>
```

Note: `/me/messages` resolves to the Page associated with the token. Alternative: `/<PAGE_ID>/messages`.

### Request Body Structure

```json
{
  "messaging_type": "<MESSAGING_TYPE>",
  "recipient": { "id": "<PSID>" },
  "message": {
    "text": "Hello!",
    "quick_replies": [
      {
        "content_type": "text",
        "title": "Option A",
        "payload": "OPTION_A"
      }
    ]
  },
  "notification_type": "REGULAR|SILENT_PUSH|NO_PUSH"
}
```

### messaging_type (Required)

| Value | When to use |
|-------|-------------|
| `RESPONSE` | Replying to a user message (within 24h window) |
| `UPDATE` | Proactive message (within 24h window, non-promotional) |
| `MESSAGE_TAG` | Outside 24h window, with approved tag (deprecated Feb 2026) |

### notification_type (Optional)

| Value | Behavior |
|-------|----------|
| `REGULAR` | Sound/vibration (default) |
| `SILENT_PUSH` | On-screen notification, no sound |
| `NO_PUSH` | No notification |

### Text Messages

- **Character limit**: 2,000 characters per text message via Send API
- Template text elements: 640 characters max
- No native markdown support (unlike WhatsApp which supports bold/italic)
- Line breaks via `\n`

### Sender Actions (Typing Indicators)

```json
POST /me/messages
{
  "recipient": { "id": "<PSID>" },
  "sender_action": "typing_on|typing_off|mark_seen"
}
```

- `typing_on`: Shows typing bubble (auto-expires after 20 seconds)
- `typing_off`: Hides typing bubble
- `mark_seen`: Marks the conversation as read
- **Must be sent in a separate request** from message content

### Template Messages

#### Generic Template (Carousel)

```json
{
  "recipient": { "id": "<PSID>" },
  "message": {
    "attachment": {
      "type": "template",
      "payload": {
        "template_type": "generic",
        "elements": [
          {
            "title": "Item Title",
            "subtitle": "Item subtitle",
            "image_url": "https://example.com/image.jpg",
            "default_action": {
              "type": "web_url",
              "url": "https://example.com"
            },
            "buttons": [
              {
                "type": "web_url|postback|phone_number|login|logout",
                "title": "Button Label",
                "url": "https://example.com",
                "payload": "POSTBACK_PAYLOAD"
              }
            ]
          }
        ]
      }
    }
  }
}
```

**Element limits:**
- 1-10 elements per generic template
- Title: 80 characters
- Subtitle: 80 characters
- Buttons: up to 3 per element
- Button title: 20 characters

#### Button Template

- Up to 3 buttons
- Text: 640 characters max
- Button types: `web_url`, `postback`, `phone_number`, `login`, `logout`

#### Other Template Types

- **Receipt template**: Order confirmation with line items, totals, shipping
- **Media template**: Rich media with buttons (image or video)
- **Airline templates**: Boarding pass, itinerary, check-in, flight update

### Quick Replies

- Up to 13 quick reply buttons (was 11, increased in recent versions)
- Content types: `text`, `user_phone_number`, `user_email`
- Title: 20 characters max
- Disappear after user taps one or sends a text message
- Quick reply responses arrive as regular `messages` webhook with `quick_reply.payload`

### Persistent Menu

- Always visible hamburger menu in the composer
- Up to 3 top-level items per locale
- Supports nested menus (up to 5 items per nested level)
- Requires Get Started button to be enabled first
- Configured via Messenger Profile API, not per-message

### Ice Breakers

- Conversation starters shown on first interaction
- List of frequently asked questions
- Appear only on first interaction (or after chat history deleted)
- Priority: API Ice Breakers > Get Started button > Custom Questions (Page Inbox UI)

**Sources:**
- [Send API reference](https://developers.facebook.com/docs/messenger-platform/reference/send-api/)
- [Sender Actions](https://developers.facebook.com/docs/messenger-platform/send-messages/sender-actions)
- [Generic Template](https://developers.facebook.com/docs/messenger-platform/send-messages/template/generic)
- [Quick Replies](https://developers.facebook.com/docs/messenger-platform/reference/buttons/quick-replies)

---

## 4. Messaging Windows and Message Tags

### Standard Messaging Window

- **24-hour window** from the last user message.
- Each new user message resets the window.
- Within the window: send any message type (text, media, templates).
- Outside the window: severely restricted (see below).

### Message Tags (DEPRECATED as of Feb 9, 2026)

Previously available tags (now deprecated globally):

| Tag | Window | Purpose |
|-----|--------|---------|
| `CONFIRMED_EVENT_UPDATE` | 24h | Event reminders, purchased tickets |
| `POST_PURCHASE_UPDATE` | 24h | Transaction confirmations, shipping |
| `ACCOUNT_UPDATE` | 24h | Account changes, suspicious activity |
| `HUMAN_AGENT` | **7 days** | Human agent responses (NOT deprecated) |

**CRITICAL**: The `HUMAN_AGENT` tag is **NOT affected** by the deprecation. Human agents can still reply within 7 days of the last user message. This is essential for Kiln's handoff flow.

### What Replaces Message Tags

- **Marketing Messages** (formerly Recurring Notifications): Paid, permission-based proactive messaging. Currently in beta, limited country availability in 2026.
- **One-Time Notifications (OTN)**: Request permission to send a single message outside the 24h window. User clicks "Notify Me" button.
- **Utility Messages**: Positioned as a replacement for transactional tags but not fully rolled out.

### Recurring Notifications Status

- Discontinued globally as of January 7, 2026 (except AU, EU, JP, KR, UK).
- Replaced by Marketing Messages.

### Implications for Kiln

- AI responses must happen within the 24-hour window (standard chatbot use case).
- Human handoff via `HUMAN_AGENT` tag extends the window to 7 days -- aligns perfectly with Kiln's `human_active` session mode.
- No mechanism for proactive AI-initiated messages outside the window (unlike WhatsApp template messages).

**Sources:**
- [Messenger policy compliance 2026](https://chatimize.com/facebook-messenger-policy/)
- [Message Tags deprecation (Manychat)](https://community.manychat.com/product-updates/meta-s-deprecation-of-the-message-tags-feature-on-messenger-9010)
- [HUMAN_AGENT tag (Chatwoot)](https://www.chatwoot.com/hc/user-guide/articles/1745225158-what-is-human-agent-tag-in-instagram-messenger-channel)
- [OTN documentation](https://developers.facebook.com/docs/messenger-platform/send-messages/one-time-notification/)
- [Recurring Notifications retirement](https://www.facebook.com/business/help/1321849029608125)
- [Marketing Messages FAQ](https://developers.facebook.com/docs/marketing-messages-on-messenger/faq/)

---

## 5. Handover Protocol

### Overview

Allows multiple Facebook apps behind a single Page to collaborate in a conversation. Only one app "owns" the thread at a time.

### Roles

| Role | Count | Capabilities |
|------|-------|--------------|
| **Primary Receiver** | Exactly 1 | Receives all messages, can pass/take thread control |
| **Secondary Receiver(s)** | 0+ | Can only respond when given thread control |

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /{page-id}/pass_thread_control` | Current owner passes control to another app |
| `POST /{page-id}/take_thread_control` | Primary receiver forcibly takes control |
| `POST /{page-id}/request_thread_control` | Secondary receiver requests control from primary |

### Webhook Events

Subscribe to `messaging_handovers` to receive:

```json
{
  "sender": { "id": "<PSID>" },
  "recipient": { "id": "<PAGE_ID>" },
  "timestamp": 1458692752478,
  "pass_thread_control": {
    "new_owner_app_id": "123456789",
    "metadata": "Additional context"
  }
}
```

Similarly for `take_thread_control` and `request_thread_control`.

### Standby Mode

When your app is a secondary receiver, you receive messages via the `standby` webhook (not `messaging`). This lets you monitor the conversation without owning it.

### Mapping to Kiln's Handoff State Machine

| Kiln Session Mode | Messenger Handover Equivalent |
|--------------------|-------------------------------|
| `ai_active` | Kiln app is Primary Receiver (or has thread control) |
| `queued` | `request_thread_control` sent, waiting for human agent app |
| `human_active` | `pass_thread_control` to human agent app; Kiln in standby |
| `resolved` | `pass_thread_control` back to Kiln; session closed |

**Design recommendation**: Kiln should be the **Primary Receiver** so it can:
- Receive all messages by default
- Pass control to a human agent app (e.g., Page Inbox, Sprinklr, Zendesk)
- Take back control when the human agent resolves the issue

### Current Status

The Handover Protocol is **still supported** as of 2026. No deprecation announcements found.

**Sources:**
- [Handover Protocol docs](https://developers.facebook.com/docs/messenger-platform/handover-protocol/)
- [Handover Protocol API reference](https://developers.facebook.com/docs/messenger-platform/reference/handover-protocol)
- [Standby webhook event](https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/standby/)
- [Bottender Handover Protocol guide](https://bottender.js.org/docs/channel-messenger-handover-protocol/)

---

## 6. Page-Scoped User ID (PSID)

### How Users Are Identified

- Every user gets a unique **PSID** for each Facebook Page they interact with.
- PSID is stable for the same user + same Page combination.
- Different from:
  - **ASID** (App-Scoped ID): Used in Facebook Login flows
  - **User ID**: The user's actual Facebook ID (not accessible via Messenger)
  - **IGSID** (Instagram-Scoped ID): Used for Instagram DM

### Cross-Channel Identity

- A single person will have **different IDs** across Messenger (PSID), Instagram (IGSID), and WhatsApp (phone number).
- The **ID Matching API** can match PSIDs across Pages within the same Business Manager account.
- No native cross-channel matching between Messenger PSID and Instagram IGSID (or WhatsApp phone).

### User Profile API

```
GET https://graph.facebook.com/v24.0/<PSID>?fields=first_name,last_name,profile_pic&access_token=<PAGE_ACCESS_TOKEN>
```

**Available fields:**
- `first_name`
- `last_name`
- `profile_pic` (URL, may expire)
- `locale` (requires additional permissions)
- `id` (the PSID itself)

**Note**: Profile information availability depends on user privacy settings and regional regulations (GDPR). Fields may return empty in EU.

### Privacy Considerations

- PSIDs are pseudonymous but persistent -- can be used to track users across sessions.
- GDPR: Must handle data deletion requests. User can revoke messaging consent at any time.
- Profile data should be cached with TTL, not stored permanently.
- For Kiln: PSID maps to `externalUserId` in ContactMemoryService. Must support `forgetAll()` for GDPR compliance.

**Sources:**
- [PSID/ASID Matching](https://developers.facebook.com/docs/messenger-platform/identity/id-matching/)
- [User Profile API](https://developers.facebook.com/docs/messenger-platform/identity/user-profile)
- [PSID explanation (Manychat)](https://help.manychat.com/hc/en-us/articles/14281071624348-PSID-explanation)

---

## 7. Media Handling

### Sending Media (via Send API)

```json
{
  "recipient": { "id": "<PSID>" },
  "message": {
    "attachment": {
      "type": "image|video|audio|file",
      "payload": {
        "url": "https://example.com/file.jpg",
        "is_reusable": true
      }
    }
  }
}
```

### File Size Limits

| Type | Limit | Supported Formats |
|------|-------|-------------------|
| Image | 5 MB (was 8 MB via URL) | JPEG, PNG, GIF |
| Video | 25 MB | MP4, 3GP |
| Audio | 25 MB | AAC, MP4, MPEG, AMR, OGG, OPUS |
| File/Document | 100 MB | PDF, DOC(X), PPT(X), XLS(X), TXT, etc. |

**Note**: Messenger increased its general file sharing limit to 100 MB in 2024, but API limits for specific media types may differ. The 25 MB limits for video/audio are API-specific.

### Reusable Attachments

- Upload once, send multiple times via the **Attachment Upload API**.
- Request: `POST /me/message_attachments` with the file.
- Response contains `attachment_id`.
- Subsequent sends reference `attachment_id` instead of URL:
  ```json
  {
    "message": {
      "attachment": {
        "type": "image",
        "payload": { "attachment_id": "12345" }
      }
    }
  }
  ```
- Reusable attachments do not expire.

### Receiving Media (via Webhook)

- Attachments arrive with a CDN URL in `message.attachments[].payload.url`.
- CDN URLs are **temporary** and expire (unlike WhatsApp which requires a media download step).
- Download media promptly after receiving the webhook.
- No two-step auth required (unlike WhatsApp where you need `GET /media/{id}` with token).

### Comparison to WhatsApp Media Handling

| Aspect | WhatsApp | Messenger |
|--------|----------|-----------|
| Incoming media | Media ID, requires authenticated download | Direct CDN URL (temporary) |
| Outgoing media | URL or media ID | URL or attachment_id |
| Reusable uploads | Not supported | Supported (attachment_id) |
| CDN expiration | N/A (download via API) | URLs expire, download promptly |

**Sources:**
- [Attachment Upload API](https://developers.facebook.com/docs/messenger-platform/reference/attachment-upload-api)
- [Saving Assets](https://developers.facebook.com/docs/messenger-platform/send-messages/saving-assets)
- [Media guidelines (Manychat)](https://help.manychat.com/hc/en-us/articles/14281167455388-Media-guidelines-for-Facebook-Messenger-WhatsApp-and-Instagram-automations)
- [Messenger 100MB file limit](https://www.socialmediatoday.com/news/messenger-increases-file-sharing-limit-to-100mb/745216/)

---

## 8. Messenger vs WhatsApp Cloud API -- Key Differences

### API Architecture

| Aspect | WhatsApp Cloud API | Messenger Platform |
|--------|--------------------|--------------------|
| Base URL | `graph.facebook.com/v24.0/{phone-number-id}` | `graph.facebook.com/v24.0/me` |
| Auth | System User token or App token | Page Access Token |
| Send endpoint | `POST /{phone-id}/messages` | `POST /me/messages` |
| Webhook object | `"whatsapp_business_account"` | `"page"` |
| Webhook structure | `entry[].changes[].value.messages[]` | `entry[].messaging[]` |
| User ID | Phone number (E.164) | PSID (numeric string) |
| Webhook verification | `hub.mode`, `hub.verify_token`, `hub.challenge` | Same |
| Payload signature | `X-Hub-Signature-256` (HMAC-SHA256) | Same |

### Feature Comparison

| Feature | WhatsApp | Messenger |
|---------|----------|-----------|
| End-to-end encryption | Yes (default) | Optional (not default) |
| Template messages (proactive) | Yes (pre-approved templates) | No (OTN/Marketing Messages only) |
| Quick replies | Yes (up to 3 buttons) | Yes (up to 13 buttons) |
| Carousel/generic templates | No (list messages instead) | Yes (up to 10 elements) |
| Button templates | Yes (up to 3 buttons) | Yes (up to 3 buttons) |
| Persistent menu | No | Yes |
| Typing indicators | No native API | Yes (`typing_on`, `typing_off`) |
| Read receipts | Automatic | `mark_seen` sender action |
| Handover protocol | No | Yes |
| Reusable media uploads | No | Yes |
| User profile API | No (phone number only) | Yes (name, profile pic) |
| Message tags (outside 24h) | Template messages | Deprecated (except HUMAN_AGENT) |
| Persona API | No | Yes (different bot identities) |
| Built-in NLP | No | Formerly via Wit.ai |
| Shared webhook URL | Can share same URL | Can share same URL |

### Rate Limits

| Aspect | WhatsApp | Messenger |
|--------|----------|-----------|
| Send rate | Tier-based (80-1000+ msg/sec) | ~250 requests/sec |
| API calls | Tier-based | 200 * engaged_users / 24h |
| Pages API | N/A | 4800 * engaged_users / 24h |

### Can They Share the Same Webhook URL?

Yes. Both use the same webhook verification mechanism and signature format. Differentiation is via the `"object"` field:
- `"whatsapp_business_account"` for WhatsApp
- `"page"` for Messenger
- `"instagram"` for Instagram

This means Kiln could potentially use a single webhook endpoint and route based on the object field.

**Sources:**
- [WhatsApp Cloud API docs](https://developers.facebook.com/docs/whatsapp/cloud-api/)
- [Messenger Platform docs](https://developers.facebook.com/docs/messenger-platform)
- [Rate Limiting -- Graph API](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- [Messenger API Essentials (rollout.com)](https://rollout.com/integration-guides/facebook-messenger/api-essentials)

---

## 9. Advanced Features

### Built-in NLP (Wit.ai)

- Messenger Platform previously offered built-in NLP powered by Wit.ai.
- The integration parsed incoming messages and attached detected intents/entities to the webhook payload.
- **Status in 2025-2026**: Still referenced in docs but largely superseded by custom NLP/LLM solutions.
- **Relevance to Kiln**: None. Kiln uses its own LLM-based processing. Ignore this feature.

### Customer Chat Plugin

- **Deprecated**: Shut down May 9, 2024.
- Was an embeddable widget for websites that opened Messenger conversations.
- **Replacement**: No direct replacement from Meta. Alternatives:
  - m.me links
  - Third-party chat widgets
  - Kiln's own `@kilnai/widget` (which is channel-agnostic)

### m.me Links

- Format: `https://m.me/<PAGE_USERNAME>` or `https://m.me/<PAGE_ID>`
- With referral data: `https://m.me/<PAGE_USERNAME>?ref=<REF_DATA>`
- Clicking opens Messenger conversation with the Page.
- Referral data arrives in the `messaging_referrals` webhook or as part of `postback.referral`.
- **Useful for**: Marketing campaigns, QR codes, email CTAs.

### Persona API

- Create named personas with profile pictures for the bot.
- Messages sent with a persona show the persona's name and avatar instead of the Page name.
- Useful for multi-agent scenarios (e.g., "Support Bot" vs "Sales Bot").
- Create: `POST /me/personas { "name": "Support", "profile_picture_url": "..." }`
- Send with persona: include `"persona_id": "<PERSONA_ID>"` in Send API request.
- **Status**: Still documented, unclear if fully maintained. Test before relying on it.
- **Relevance to Kiln**: Could map to agent identities in multi-agent teams, but low priority.

### Sponsored Messages and Ads

- Businesses can create ads that open Messenger conversations (Click-to-Messenger ads).
- Users arriving from ads trigger a `messaging_referrals` webhook with ad metadata.
- **Note**: Messenger ads for lead generation are being deprecated (v24.0+).
- Not relevant for Kiln's core channel adapter.

**Sources:**
- [Chat Plugin deprecation](https://chative.io/blog/meta-remove-facebook-messenger-chat-plugin)
- [Chat Plugin docs (archived)](https://developers.facebook.com/docs/messenger-platform/discovery/facebook-chat-plugin/)
- [Personas API](https://developers.facebook.com/docs/messenger-platform/send-messages/personas/)
- [Messenger Platform changelog](https://developers.facebook.com/docs/messenger-platform/changelog/)

---

## 10. Meta App Review

### Required Permissions for Messenger

| Permission | Review Required | Notes |
|------------|-----------------|-------|
| `pages_messaging` | Yes | Core messaging -- must demonstrate bot UX |
| `pages_manage_metadata` | Yes | Webhook subscription |
| `pages_read_engagement` | Yes | Reading conversations |
| `business_management` | Yes | Business Manager integration |

### Review Process

1. Create a Meta App in the App Dashboard.
2. Add the "Messenger" product to the app.
3. Configure webhooks and subscribe to events.
4. Submit for App Review with:
   - Detailed description of each permission's use
   - Video walkthrough of the bot experience
   - Test Page and test user credentials
5. Facebook team tests the bot for policy compliance and UX quality.
6. Approval timeline: Days to weeks.

### Can One App Have Both WhatsApp and Messenger?

**Yes.** A single Meta app can include both:
- The "WhatsApp" product (with `whatsapp_business_messaging` permission)
- The "Messenger" product (with `pages_messaging` permission)

Both live under the same App ID and can share the same webhook URL. This simplifies deployment for Kiln gateway operators.

### Key Policies

- Bots must respond within 24 hours (automated or human).
- No promotional content outside the window (post tag deprecation).
- Must provide a way for users to stop receiving messages.
- Must comply with Meta's Platform Terms and Community Standards.

**Sources:**
- [Facebook App Approval (respond.io)](https://respond.io/blog/skip-facebook-bot-verification)
- [Permissions Reference](https://developers.facebook.com/docs/permissions)
- [Chatwoot permissions discussion](https://github.com/orgs/chatwoot/discussions/7916)

---

## 11. Kiln Adapter Design Implications

### What Can Be Reused from WhatsApp Adapter

| Component | Reusable? | Notes |
|-----------|-----------|-------|
| `requireWebhookSignature` (auth-middleware) | Yes, directly | Same X-Hub-Signature-256 mechanism |
| `verifyWebhook()` pattern | Yes, directly | Same hub.mode/hub.verify_token/hub.challenge |
| `Channel` interface | Yes | Same `receive()`, `send()`, `stream()` contract |
| `IncomingMessage` / `OutgoingMessage` | Yes | Same `ContentPart[]` model |
| `audio-preprocessor.ts` | Partially | Media download differs (direct URL vs two-step auth) |
| `budget-middleware.ts` | Yes, directly | Channel-agnostic |
| `conversation-event-emitter.ts` | Yes, directly | Channel-agnostic |
| `message-pipeline.ts` | Yes, directly | Channel-agnostic |
| `tenant-tool-factory.ts` | Yes, directly | Channel-agnostic |
| `session-registry.ts` | Yes, directly | Channel-agnostic |
| `context-formatter.ts` | Yes, directly | Channel-agnostic |

### New Components Needed

1. **`messenger-channel.ts`** -- Channel adapter (similar structure to `whatsapp-channel.ts`)
   - Same `Channel` interface implementation
   - `send()` uses `POST /me/messages` with Page Access Token
   - Support for `typing_on` sender action before responses
   - Support for `mark_seen` on incoming messages

2. **`messenger-webhook-routes.ts`** -- Webhook route handler (parallel to `whatsapp-webhook-routes.ts`)
   - Parse `entry[].messaging[]` structure (different from WhatsApp's `entry[].changes[].value`)
   - Route by message type: `message`, `postback`, `referral`, `optin`
   - Map `sender.id` (PSID) to tenant resolution

3. **`messenger-api.ts`** -- API client (parallel to `whatsapp-api.ts`)
   - `sendMessengerMessage()`: POST to `/me/messages`
   - `sendSenderAction()`: typing indicators
   - `getUserProfile()`: fetch PSID profile (name, avatar)
   - `sendMessengerAttachment()`: media with URL or attachment_id

4. **`messenger-formatter.ts`** -- Message formatting
   - No markdown support (strip or convert)
   - 2,000 char limit for text
   - Template rendering (generic, button) for structured content

### Webhook Payload Mapping

```
Messenger webhook -> Kiln IncomingMessage:
  sender.id          -> userId (PSID)
  recipient.id       -> metadata.pageId
  message.mid        -> metadata.messageId
  message.text       -> parts[0] as TextPart
  message.attachments -> parts[] as Image/Audio/FilePart
  postback.payload   -> metadata.postback
  quick_reply.payload -> metadata.quickReply
```

### Tenant Resolution Strategy

- WhatsApp resolves tenant by `phone_number_id` (from webhook metadata).
- Messenger should resolve tenant by **Page ID** (`entry[].id` or `recipient.id`).
- TenantRegistry needs a `resolveByPageId()` method (parallel to existing `resolveByWidgetId()`).

### Messaging Window Enforcement

- Track last user message timestamp per session.
- Within 24h: send freely with `messaging_type: "RESPONSE"`.
- 24h-7d: only with `HUMAN_AGENT` tag (requires `human_active` session mode).
- After 7d: cannot message user at all.
- On `BUDGET_EXHAUSTED`: inform user within the window or silently fail.

### Handover Protocol Integration

If Kiln is configured as Primary Receiver:

| Kiln Event | Messenger Action |
|------------|------------------|
| Escalation detected | `pass_thread_control` to human agent app ID |
| Human resolves | `take_thread_control` back (or human passes back) |
| Timeout in `queued` | `take_thread_control` + auto-respond |

This is optional/advanced and can be deferred to a later phase.

### Configuration Shape (gateway.yaml)

```yaml
channels:
  messenger:
    pageId: "123456789"
    pageAccessToken: "${MESSENGER_PAGE_ACCESS_TOKEN}"
    appSecret: "${META_APP_SECRET}"
    verifyToken: "${MESSENGER_VERIFY_TOKEN}"
    # Optional
    handover:
      enabled: false
      humanAgentAppId: "987654321"
```

### Priority Assessment

| Feature | Priority | Rationale |
|---------|----------|-----------|
| Text messaging (send/receive) | P0 | Core functionality |
| Webhook verification + signature | P0 | Security requirement |
| Media receive (image, audio, file) | P0 | Users send media |
| Media send (image, audio, file) | P1 | Respond with media |
| Typing indicators | P1 | Good UX |
| Quick replies | P1 | Common pattern for AI suggestion chips |
| User profile fetch | P2 | Nice for contact memory |
| Generic/button templates | P2 | Structured responses |
| Persistent menu | P2 | Configuration, not per-message |
| Handover Protocol | P3 | Advanced, can use Kiln's native handoff initially |
| Persona API | P3 | Nice-to-have for multi-agent |
| Reusable attachments | P3 | Optimization |

---

## Appendix: Key URLs

| Resource | URL |
|----------|-----|
| Messenger Platform docs | https://developers.facebook.com/docs/messenger-platform |
| Send API reference | https://developers.facebook.com/docs/messenger-platform/reference/send-api/ |
| Webhook events reference | https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/ |
| Handover Protocol | https://developers.facebook.com/docs/messenger-platform/handover-protocol/ |
| Graph API versions | https://developers.facebook.com/docs/graph-api/changelog/versions/ |
| Permissions reference | https://developers.facebook.com/docs/permissions |
| Attachment Upload API | https://developers.facebook.com/docs/messenger-platform/reference/attachment-upload-api |
| Messenger Profile API | https://developers.facebook.com/docs/messenger-platform/reference/messenger-profile-api/ |
| User Profile API | https://developers.facebook.com/docs/messenger-platform/identity/user-profile |
| ID Matching API | https://developers.facebook.com/docs/messenger-platform/identity/id-matching/ |
