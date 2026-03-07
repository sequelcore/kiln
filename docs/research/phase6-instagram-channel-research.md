# Phase 6: Instagram DM Channel Adapter -- Research Document

**Date:** 2026-03-07
**Author:** Research agent
**Status:** Research complete, ready for architectural review

---

## Executive Summary

The Instagram Messaging API is part of Meta's Messenger Platform (not a standalone product). It uses the same Graph API infrastructure as WhatsApp Cloud API but with a **fundamentally different webhook payload format** (Messenger-style `messaging` array vs. WhatsApp-style `changes` array). The API supports text, images, video, audio, story replies, story mentions, reactions, quick replies, ice breakers, generic templates, and private replies to comments. A strict **24-hour messaging window** applies with a **HUMAN_AGENT tag** extension to 7 days. Rate limits are significantly lower than WhatsApp: **200 automated DMs per hour per account**. Both Business and Creator accounts are supported, but Advanced Access via App Review is required for `instagram_manage_messages`.

---

## 1. Instagram Messaging API -- Current State (2025-2026)

### API Identity

- **Not a standalone API.** Instagram Messaging is a collection of Graph API endpoints built on the Messenger Platform infrastructure. There is no separate "Instagram Direct API" anymore.
- The old Instagram Basic Display API was **retired December 4, 2024**. All integrations must now use the Instagram Graph API or Instagram API with Instagram Login.
- Current Graph API version: **v24.0** (as of early 2026). The send endpoint uses `graph.instagram.com/v24.0/{page_id}/messages`.

### Relationship to Messenger Platform

- Instagram Messaging uses the **Messenger Platform** protocols, not the WhatsApp Cloud API protocols.
- Webhook format follows Messenger conventions (`messaging` array), NOT WhatsApp conventions (`changes` array).
- Same Meta App can handle both Facebook Messenger and Instagram messaging.
- The Handover Protocol from Messenger is available for Instagram.

### Rate Limits

- **200 automated DMs per hour per account** (down from 5,000 -- a 96% reduction as of 2026).
- If you have N connected accounts, total capacity = 200 x N per hour.
- When the hourly limit is reached, automation pauses; queued messages send when the limit resets.
- No ban risk when using the official API within limits.
- Limits reset every hour on the hour.

**Sources:**
- [Instagram API Rate Limits: 200 DMs/Hour Explained (2026)](https://creatorflow.so/blog/instagram-api-rate-limits-explained/)
- [Instagram DM Automation Rules: Full Guide (2026)](https://www.spurnow.com/en/blogs/instagram-dm-automation-rules)
- [Instagram Messaging - Messenger Platform](https://developers.facebook.com/docs/messenger-platform/instagram/)
- [Messaging - Instagram Platform - Meta for Developers](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/)

---

## 2. Webhook Format for Instagram Messages

### Critical Difference from WhatsApp

The webhook payload structure is **fundamentally different** from WhatsApp. This is the most important architectural finding.

#### WhatsApp Webhook Payload Structure
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "phone_number_id": "..." },
        "contacts": [{ "wa_id": "..." }],
        "messages": [{ "from": "...", "type": "text", "text": { "body": "..." } }]
      },
      "field": "messages"
    }]
  }]
}
```

#### Instagram Webhook Payload Structure (Messenger-style)
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

### Key Structural Differences

| Aspect | WhatsApp | Instagram |
|--------|----------|-----------|
| `object` field | `"whatsapp_business_account"` | `"instagram"` |
| Message location | `entry[].changes[].value.messages[]` | `entry[].messaging[]` |
| Sender ID | `messages[].from` (phone number) | `messaging[].sender.id` (IGSID) |
| Recipient ID | `metadata.phone_number_id` | `messaging[].recipient.id` |
| User identifier | Phone number (wa_id) | Instagram Scoped ID (IGSID) |
| Media delivery | Media ID (requires download via API) | CDN URL in `attachments[].payload.url` |
| Signature header | `x-hub-signature-256` (HMAC-SHA256) | `x-hub-signature` (HMAC-SHA1) -- **different algorithm** |

### Webhook Verification

- **Same flow as WhatsApp:** GET request with `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`.
- This is identical and can be shared.

### Supported Webhook Event Fields

- `messages` -- incoming DMs (text, media, story replies)
- `messaging_postbacks` -- postback buttons
- `messaging_optins` -- opt-in events
- `message_reactions` -- emoji reactions on messages
- `messaging_referrals` -- referral events
- `messaging_handovers` -- handover protocol events
- `standby` -- messages when another app has thread control

### Media Attachments in Webhooks

Media is delivered as CDN URLs within the `message.attachments` array:

```json
{
  "message": {
    "mid": "MESSAGE_ID",
    "attachments": [{
      "type": "image",
      "payload": {
        "url": "https://scontent.xx.fbcdn.net/..."
      }
    }]
  }
}
```

Attachment types: `image`, `video`, `audio`, `file`.

### Story Reply Webhook

When a user replies to a business's Instagram Story:

```json
{
  "message": {
    "mid": "MESSAGE_ID",
    "text": "Nice story!",
    "reply_to": {
      "story": {
        "id": "STORY_ID",
        "url": "https://..."
      }
    }
  }
}
```

### Story Mention Webhook

When a user mentions the business in their Story, a `messaging` event is delivered with story mention metadata.

### Message Flags

- `is_echo` -- messages sent by the business (echoed back)
- `is_deleted` -- message was deleted by user
- `is_unsupported` -- unsupported message type

**Sources:**
- [Instagram Messaging Webhooks - Messenger Platform](https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook/)
- [Webhooks - Instagram Platform](https://developers.facebook.com/docs/instagram-platform/webhooks/)
- [Instagram Platform Webhook Notification Examples](https://developers.facebook.com/docs/instagram-platform/webhooks/examples/)
- [Instagram Message Support | Sinch](https://developers.sinch.com/docs/conversation/channel-support/instagram/message-support)
- [Setup Meta Webhooks for Instagram Messaging](https://innocentanyaele.medium.com/setup-meta-webhooks-for-instagram-messaging-and-respond-to-message-4575bc95c7a2)

---

## 3. Sending Messages via Instagram

### Endpoint

```
POST https://graph.instagram.com/v24.0/{page_id}/messages
```

Where `{page_id}` is the Facebook Page ID linked to the Instagram Business account.

### Authentication

- Uses a **Page Access Token** (not a WhatsApp-specific token).
- Token must have `instagram_manage_messages` permission.

### User Identifier

- Recipients are identified by **IGSID** (Instagram Scoped User ID), not phone numbers.
- Each user gets a unique IGSID per Instagram Business account they message.
- IGSID comes from the `sender.id` field in webhook payloads.

### Sending Text Messages

```json
POST /{page_id}/messages
{
  "recipient": { "id": "IGSID" },
  "message": { "text": "Hello!" }
}
```

### Sending Media Attachments

```json
POST /{page_id}/messages
{
  "recipient": { "id": "IGSID" },
  "message": {
    "attachment": {
      "type": "image",
      "payload": { "url": "https://example.com/image.jpg" }
    }
  }
}
```

Supported attachment types: `image`, `video`, `audio`, `file`.

### Quick Replies

Up to **13 quick reply buttons** per message. Plain text only, max **20 characters** per button (truncated beyond). Quick replies require a `payload` field. Only visible in the Instagram mobile app (not web).

```json
{
  "recipient": { "id": "IGSID" },
  "message": {
    "text": "How can I help?",
    "quick_replies": [
      { "content_type": "text", "title": "Pricing", "payload": "PRICING" },
      { "content_type": "text", "title": "Support", "payload": "SUPPORT" }
    ]
  }
}
```

### Generic Template (Cards/Carousel)

Structured messages with image, title, subtitle, and buttons. Multiple templates create a horizontally scrollable carousel.

```json
{
  "recipient": { "id": "IGSID" },
  "message": {
    "attachment": {
      "type": "template",
      "payload": {
        "template_type": "generic",
        "elements": [{
          "title": "Product Name",
          "image_url": "https://...",
          "subtitle": "Description",
          "buttons": [
            { "type": "web_url", "url": "https://...", "title": "View" },
            { "type": "postback", "title": "Buy", "payload": "BUY_PRODUCT" }
          ]
        }]
      }
    }
  }
}
```

### Ice Breakers

Up to **4 FAQ-style questions** displayed when a user opens the DM window for the first time. Configured via API (not per-message). Helps guide initial conversation topics.

### Private Replies (to Comments)

Allows replying to a public comment with a single private DM. Does NOT open a conversation window -- the user must send a follow-up message to start a conversation. Triggered by `comment_event` webhook callback.

### Formatting Limitations

- **No markdown support** -- plain text only.
- **1,000 character limit** per text message (on mobile; desktop may allow more).
- No bold, italic, or other rich text formatting.
- Emojis are supported and count toward the character limit.

### Proactive Messaging

- **Cannot send unsolicited messages.** The user must initiate contact first.
- Automation must start from a user-initiated action (comment, story reply, DM).
- Within the 24-hour window, free-form responses are allowed.

**Sources:**
- [Send a Message - Messenger Platform - Instagram](https://developers.facebook.com/docs/messenger-platform/instagram/features/send-message/)
- [Messaging - Instagram Platform](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/)
- [Attachment Upload API - Messenger Platform](https://developers.facebook.com/docs/messenger-platform/instagram/features/attachment-upload/)
- [Private Replies - Instagram Platform](https://developers.facebook.com/docs/instagram-platform/private-replies/)
- [Instagram Character Limit (2026)](https://www.outfy.com/blog/instagram-character-limit/)
- [Sending Instagram Messages using the Facebook Graph API](https://medium.com/@ritikkhndelwal/sending-instagram-messages-using-the-facebook-graph-api-and-python-8e362014a9f3)

---

## 4. Instagram Business vs Creator Accounts

### Account Type Support

Both **Business** and **Creator** Instagram Professional accounts support the Messaging API. Personal accounts do NOT.

### Linking Requirements

1. Instagram Business/Creator account must be linked to a **Facebook Page**.
2. The Facebook Page must be managed by a **Meta App** (created in Meta for Developers dashboard).
3. The Meta App must be of type **"Business"**.
4. The developer must have **admin access** to the Facebook Page.

### Required Permissions/Scopes

| Permission | Purpose | Access Level |
|-----------|---------|--------------|
| `instagram_basic` | Basic account info | Standard |
| `instagram_manage_messages` | Read and respond to DMs | **Advanced** (requires App Review) |
| `pages_manage_metadata` | Subscribe to webhooks | **Advanced** (requires App Review) |
| `pages_show_list` | List pages the user manages | Standard |
| `instagram_manage_comments` | Manage comments (for private replies) | **Advanced** (requires App Review) |

### Scope Migration Note

Meta has been updating scope names. New scope values are being introduced to replace existing `business_basic`, `business_content_publish`, `business_manage_comments`, and `business_manage_messages` scope values. Check the latest docs before implementation.

### Key Differences from WhatsApp Setup

| Aspect | WhatsApp | Instagram |
|--------|----------|-----------|
| Account identifier | Phone Number ID | Page ID (linked to IG account) |
| User identifier | Phone number | IGSID |
| Token type | WhatsApp-specific token | Page Access Token |
| Account linking | Phone -> WABA -> App | IG Account -> FB Page -> App |

**Sources:**
- [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/)
- [Instagram Graph API: Complete Developer Guide for 2026](https://elfsight.com/blog/instagram-graph-api-complete-developer-guide-for-2026/)
- [Understanding Instagram Business Login API Permissions](https://medium.com/@python-javascript-php-html-css/understanding-instagram-business-login-api-permissions-is-messaging-scope-mandatory-8b52b2f9b9aa)
- [Instagram API: A Complete Guide for Businesses in 2026](https://tagembed.com/blog/instagram-api/)

---

## 5. Media Handling

### Receiving Media

- Media in incoming messages arrives as **CDN URLs** in `message.attachments[].payload.url`.
- This is different from WhatsApp, which provides a **media ID** that must be fetched separately via `GET /{media_id}`.
- Instagram CDN URLs are hosted on `scontent.xx.fbcdn.net`.

### CDN URL Expiration

- Instagram CDN URLs **expire after 1-3 hours** (not precisely documented).
- Story media URLs expire after **24 hours** (when the story itself expires).
- **Policy:** You are NOT allowed to download, retain, or store media content. You may only store the CDN URL and use it to render media while valid.

### Implications for Kiln

- Unlike WhatsApp (where media must be downloaded via authenticated API call), Instagram media URLs are directly accessible -- no auth header needed for download.
- However, URLs expire quickly, so any audio preprocessing (STT) must happen immediately upon webhook receipt.
- The `createWhatsAppMediaDownloader` pattern is NOT needed for Instagram -- URLs are direct.

### Sending Media

- Images: provide a public URL in the attachment payload.
- Videos: provide a public URL; subject to Instagram's video format requirements.
- Audio: supported via attachment type `audio`.
- The Attachment Upload API allows pre-uploading reusable media assets.

### Size/Format Constraints (Sending)

- Images: JPEG, PNG, GIF (animated GIFs supported in some contexts).
- Videos: MP4 format recommended.
- Specific size limits follow Instagram's standard media constraints (not extensively documented in messaging API docs).

**Sources:**
- [Instagram to RSS - Image URL Expires](https://community.zapier.com/how-do-i-3/instagram-to-rss-image-url-expires-10513)
- [Instagram approval rejected via handling of media CDN URLs](https://github.com/chatwoot/chatwoot/issues/8583)
- [Messaging - Instagram Messaging Inbound - CM.com](https://developers.cm.com/messaging/docs/instagram-messaging-inbound)

---

## 6. 24-Hour Messaging Window

### Core Policy

- After a user sends a message, the business has a **24-hour window** to respond freely.
- Every time the user responds, the **24-hour clock resets** (rolling window).
- After the window closes, the business **cannot send any messages** to that user.

### HUMAN_AGENT Tag Extension

- The `HUMAN_AGENT` message tag extends the window to **7 days** after the user's last message.
- **Critical restriction:** HUMAN_AGENT tag is ONLY for human-sent messages. Automated/bot messages are NOT allowed during the 7-day extended window.
- Using the tag for automated messages violates Meta's policy and can result in enforcement action.

### Comparison with WhatsApp

| Aspect | WhatsApp | Instagram |
|--------|----------|-----------|
| Window duration | 24 hours | 24 hours |
| Extension mechanism | Template messages (pre-approved) | HUMAN_AGENT tag (7 days, human only) |
| Out-of-window messaging | Yes, via approved templates | **No** (no template message equivalent) |
| Proactive messaging | Yes, via templates | **No** -- user must initiate |

### Implications for Kiln

This is a **major architectural difference** from WhatsApp. Instagram has NO equivalent of WhatsApp's template messages for re-engaging users after the window closes. The adapter must:

1. Track the last user message timestamp per conversation.
2. Reject/queue outbound messages if the window has expired.
3. Support the HUMAN_AGENT tag for handoff scenarios (human agent escalation).
4. Surface window expiration status to the product backend via conversation events.

**Sources:**
- [How to send messages outside the 24-hour and 7-day windows](https://help.manychat.com/hc/en-us/articles/14281199732892-How-to-send-messages-outside-the-24-hour-and-7-day-windows-in-Messenger-and-Instagram)
- [Instagram DM Automation Rules: Full Guide (2026)](https://www.spurnow.com/en/blogs/instagram-dm-automation-rules)
- [How to Comply with Instagram DM Rules in 2026](https://chatimize.com/instagram-dm-rules/)
- [What is Human Agent tag in Instagram/Messenger channel | Chatwoot](https://www.chatwoot.com/hc/user-guide/articles/1745225158-what-is-human-agent-tag-in-instagram-messenger-channel)

---

## 7. Meta App Review for Instagram

### Process

- Same Meta App Review portal as WhatsApp.
- You submit a single Meta App that can request both WhatsApp and Instagram permissions.
- Review time: **2-6 weeks** (can be as short as 10 days).

### Required Permissions for Messaging

The following permissions require **Advanced Access** via App Review:

1. `instagram_manage_messages` -- core messaging capability
2. `pages_manage_metadata` -- webhook subscription
3. `instagram_manage_comments` -- needed if using private replies to comments

### Submission Requirements

1. **Screencast video** demonstrating how the app uses each permission (this is the primary review artifact).
2. **Privacy policy** hosted on company website, always accessible.
3. **Clear justification** for each permission -- request only what you need.
4. **Business verification** of the Meta Business account.

### Common Rejection Reasons

- Requesting permissions "just in case" (over-requesting).
- Missing or inaccessible privacy policy.
- Screencast that doesn't clearly demonstrate permission usage.
- Reviewers do NOT explore the app independently -- the screencast is their only reference.

### Overlap with WhatsApp

If the Kiln gateway app already has WhatsApp permissions approved, the Instagram permissions are **additive** -- same app, additional permission requests. The review process is the same portal but Instagram permissions are reviewed independently.

**Sources:**
- [App Review - Instagram Platform](https://developers.facebook.com/docs/instagram-platform/app-review/)
- [Meta App Approval Guide](https://www.saurabhdhar.com/blog/meta-app-approval-guide)
- [Instagram Graph API: Complete Developer Guide for 2026](https://elfsight.com/blog/instagram-graph-api-complete-developer-guide-for-2026/)

---

## 8. Key Limitations and Gotchas

### Message Formatting

- **No markdown.** Plain text only.
- **1,000 character limit** per message on mobile.
- No bold, italic, links with preview, or any rich formatting.
- Emojis count toward character limit.

### Rate Limits (vs WhatsApp)

| Metric | WhatsApp | Instagram |
|--------|----------|-----------|
| Messages per hour | Tier-based (varies by quality) | **200 per account** |
| Daily limit | Based on tier (up to unlimited) | Effectively 4,800/day |
| Scaling | Increase tier via quality | Add more accounts |

### Story Mention/Reply Handling

- Story replies include a `reply_to.story` object with the story ID and URL.
- Story mentions generate a separate webhook event.
- Story media URLs expire when the story expires (24 hours).
- The adapter should extract story context and include it as conversation context.

### Ice Breaker Support

- Up to 4 FAQ-style questions.
- Configured via API call to the Page, not per-message.
- Displayed only on first conversation open.
- Maps well to Kiln's existing welcome frame / suggestion chips pattern.

### Handover Protocol

- Instagram supports the Messenger Handover Protocol.
- Allows transferring thread control between apps (e.g., bot to live agent inbox).
- Relevant for Kiln's existing handoff feature (`session-mode.ts`, `escalation-detector.ts`).
- `standby` webhook events let secondary apps observe conversations.

### Human Agent Escalation Requirements

- **Mandatory:** Every messaging experience must have an escalation path to a human agent.
- Options: human agent handoff, providing a contact number, follow-up emails.
- Meta enforces this during App Review.
- Kiln's existing handoff routes and escalation detection align well with this requirement.

### Quick Reply Limitations

- Only visible on Instagram mobile app, NOT on web/desktop.
- Max 13 buttons, 20 characters each.
- Require a `payload` field (not optional like some other platforms).

### Echo Messages

- Messages sent by the business are echoed back via webhook with `is_echo: true`.
- The adapter must filter these out to avoid infinite loops.
- This is different from WhatsApp, which uses a separate `statuses` array.

### Webhook Signature Algorithm

- Instagram uses `x-hub-signature` with **HMAC-SHA1** (not `x-hub-signature-256` with HMAC-SHA256 like WhatsApp).
- The existing `requireWebhookSignature` middleware may need to support both algorithms, or Instagram may also support SHA-256 -- verify during implementation.

### Deleted Messages

- If a user deletes a message, a webhook with `is_deleted: true` is sent.
- The adapter should handle this gracefully (log + ignore, or surface to product backend).

### Unsupported Message Types

- Some message types arrive as `is_unsupported: true`.
- The adapter should acknowledge these without processing.

**Sources:**
- [Instagram API Limitations & Setup Tips](https://www.interakt.shop/instagram-automation/api-limitations-setup-tips/)
- [Instagram Message Support | Sinch](https://developers.sinch.com/docs/conversation/channel-support/instagram/message-support)
- [Instagram Messaging - CM.com](https://developers.cm.com/messaging/docs/instagram-messaging)

---

## 9. Architectural Implications for Kiln

### What Can Be Shared with WhatsApp Adapter

1. **Webhook verification** -- identical `hub.mode=subscribe` flow.
2. **Budget middleware** -- `checkBudget()` / `reportUsage()` unchanged.
3. **Session registry** -- same `getOrCreate()` pattern (key by IGSID instead of phone).
4. **Tenant registry** -- needs a new `resolveByInstagramId()` method (similar to `resolveByPhone()`).
5. **Memory stores** -- same per-tenant SQLite pattern.
6. **Knowledge pipeline** -- same retrieval pipeline.
7. **Contact memory** -- same, keyed by IGSID.
8. **Conversation event emitter** -- same events, `channel: "instagram"`.
9. **Orchestrator pipeline** -- identical `processMessage()` flow.
10. **Tenant tool factory** -- same webhook tools, rate limiter, allowlist.
11. **Trace context** -- same structured logging.

### What Needs New Implementation

1. **Webhook payload parser** -- completely different structure (`messaging[]` vs `changes[].value.messages[]`).
2. **Instagram API client** -- `sendInstagramMessage()` targeting `graph.instagram.com/{page_id}/messages` with Messenger-style body format.
3. **Message formatter** -- plain text only (no WhatsApp-style formatting like `*bold*`).
4. **Media handling** -- CDN URLs directly (no media download step needed, but URLs expire quickly).
5. **Signature verification** -- may need HMAC-SHA1 support (verify if `x-hub-signature-256` is also available).
6. **Echo filtering** -- must filter `is_echo` messages to prevent loops.
7. **Story context extraction** -- parse `reply_to.story` and story mention metadata.
8. **Messaging window tracking** -- enforce 24-hour window, support HUMAN_AGENT tag.
9. **Quick reply / template support** -- map Kiln suggestion chips to Instagram quick replies.
10. **Ice breaker configuration** -- API call to set up initial FAQ questions per account.

### Tenant Config Extension

```typescript
// Extension to TenantConfig for Instagram
interface InstagramTenantConfig {
  instagramAccountId: string;      // Instagram Business Account ID
  pageId: string;                  // Linked Facebook Page ID
  pageAccessToken: string;         // Page Access Token (env var ref)
  iceBreakers?: Array<{            // Up to 4
    question: string;
    payload: string;
  }>;
}
```

### Suggested File Structure

```
packages/runtime/src/
  channels/
    instagram-channel.ts           // Channel adapter (like whatsapp-channel.ts)
    instagram-api.ts               // Send API client (like whatsapp-api.ts)
  gateway/
    instagram-webhook-routes.ts    // Webhook handler (like whatsapp-webhook-routes.ts)
```

### Estimated Reuse

~70% of the WhatsApp webhook route logic can be reused. The main new work is:
- Webhook payload parsing (different structure)
- Send API client (different endpoint + body format)
- Message formatting (simpler -- plain text only)
- Echo filtering
- Messaging window enforcement

---

## 10. Open Questions for Implementation

1. **Signature algorithm:** Does Instagram also support `x-hub-signature-256` (SHA-256), or only `x-hub-signature` (SHA-1)? Need to verify during implementation.
2. **Widget integration:** Should IGSID be the `externalUserId` in conversation events, or should we map it to a more human-readable identifier?
3. **Rate limit handling:** Should the adapter implement its own rate limiting (200/hr) or rely on Meta's error responses?
4. **Story context:** How should story replies/mentions be surfaced to the LLM? As system context? As a special content part?
5. **Ice breaker management:** Should ice breakers be configured via Kiln gateway.yaml, or managed separately via the Instagram API?
6. **Shared Meta App:** Can the same Meta App + webhook URL handle both WhatsApp and Instagram, distinguished by `object` field? (Almost certainly yes, but verify.)
7. **Follower requirement:** Some sources mention a 1,000-follower minimum for messaging API access. Verify if this still applies in 2026.
