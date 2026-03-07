# Phase 6: Inbound Email Channel -- Research Document

**Date:** 2026-03-07
**Status:** Research Complete
**Author:** Maria (Sequel Development Assistant)

---

## Table of Contents

1. [Inbound Email Processing Architectures](#1-inbound-email-processing-architectures)
2. [Email Webhook Providers -- Detailed Comparison](#2-email-webhook-providers----detailed-comparison)
3. [Email Parsing Standards](#3-email-parsing-standards)
4. [Email Threading](#4-email-threading)
5. [Sending Email Replies](#5-sending-email-replies)
6. [Multi-Tenant Email Architecture](#6-multi-tenant-email-architecture)
7. [Email-Specific Formatting](#7-email-specific-formatting)
8. [Email Security and Compliance](#8-email-security-and-compliance)
9. [Email vs Messaging Channels -- Key Differences](#9-email-vs-messaging-channels----key-differences)
10. [Production Email Channel Implementations](#10-production-email-channel-implementations)
11. [Academic Research on Email AI](#11-academic-research-on-email-ai)
12. [Recommended Architecture for Kiln](#12-recommended-architecture-for-kiln)

---

## 1. Inbound Email Processing Architectures

### Three Fundamental Approaches

#### A. Webhook-Based (Recommended)

The modern standard. An email provider receives inbound email on your behalf, parses the MIME structure, and POSTs structured JSON to your HTTP endpoint.

**How it works:**
1. Configure MX records (or email forwarding) to point your domain to the provider
2. Provider receives email via SMTP
3. Provider parses MIME into structured data (headers, text body, HTML body, attachments)
4. Provider POSTs JSON to your webhook URL
5. Your server processes the payload and responds with 200

**Latency:** Near real-time (1-5 seconds from email receipt to webhook delivery).

**Providers:** Postmark, SendGrid, Mailgun, Resend, Cloudflare Email Workers, Amazon SES + Lambda, inbound.new, AgentMail.

**Pros:**
- Near real-time processing (seconds, not minutes)
- No infrastructure to maintain (SMTP servers, IMAP connections)
- Pre-parsed payloads (no MIME decoding needed in most cases)
- Built-in retry logic (e.g., Postmark retries 10 times with growing intervals)
- Scales horizontally (just another HTTP endpoint)

**Cons:**
- Vendor dependency for email reception
- Webhook endpoint must be publicly accessible
- Payload size limits (typically 25-30 MB including attachments)
- Must verify webhook authenticity (HMAC signatures)

Sources:
- https://postmarkapp.com/developer/webhooks/inbound-webhook
- https://mailhook.co/blog/email-inbox-design-webhooks-polling-and-storage
- https://inbound.new/email-webhook-api

#### B. IMAP Polling (Legacy)

Traditional approach where your server connects to an IMAP mailbox and polls for new messages.

**How it works:**
1. Set up an IMAP-enabled mailbox (Gmail, Office 365, etc.)
2. Your server connects via IMAP and polls at intervals
3. Download new messages, parse MIME locally
4. Process and mark as read/delete

**Latency:** Depends on polling interval. 10-second interval = up to 10 seconds delay. 60-second interval = up to 60 seconds. IMAP IDLE can reduce this but is unreliable across providers.

**Pros:**
- No webhook endpoint needed (works behind firewalls)
- Direct control over mailbox
- Works with any email provider

**Cons:**
- Higher latency (polling interval bound)
- Must manage IMAP connections (reconnection, timeouts, OAuth token refresh)
- Must parse MIME locally (complex)
- Resource wasteful (most polls return nothing)
- IMAP IDLE support is inconsistent across providers
- Connection limits on many providers

Sources:
- https://www.nylas.com/blog/the-intricacies-of-integrating-with-imap/
- https://mailhook.co/blog/temp-email-receive-webhook-first-polling-fallback

#### C. Hybrid (Webhook-First, Polling Fallback)

The most robust production pattern. Use webhooks for primary delivery with IMAP polling as a fallback to catch missed messages.

**Best for:** Mission-critical email processing where zero message loss is required.

Sources:
- https://mailhook.co/blog/temp-email-receive-webhook-first-polling-fallback

### Recommendation for Kiln

**Webhook-based** is the clear winner for Kiln's architecture:
- Kiln already uses the webhook pattern for WhatsApp (Meta Graph API sends webhooks)
- Near real-time latency matches the existing channel adapter model
- No SMTP/IMAP infrastructure to manage
- Fits the existing Hono route handler pattern in the gateway

---

## 2. Email Webhook Providers -- Detailed Comparison

### Provider Matrix

| Provider | Inbound Webhook | Payload Format | Parsed Body | Attachments | Pricing (inbound) | Threading Support | Notes |
|----------|----------------|----------------|-------------|-------------|-------------------|-------------------|-------|
| **Postmark** | Yes | JSON (POST) | TextBody, HtmlBody, StrippedTextReply, MailboxHash | Inline in JSON (base64) | Included in plan ($15/mo for 10k emails) | MailboxHash for +addressing | Best-in-class parsed payload |
| **SendGrid** | Yes (Inbound Parse) | multipart/form-data | text, html, stripped fields | multipart file uploads | Included ($19.95/mo Essentials for 50k) | Via headers | 30 MB limit, spam scoring option |
| **Mailgun** | Yes (Routes) | form-data or JSON | body-plain, body-html, stripped-* | multipart | $35/mo Foundation for 50k | Via headers | Free tier available |
| **Resend** | Yes (since Nov 2025) | JSON webhook (metadata only) | Must call separate API | Must call separate API | Counts against quota (free: 3k/mo) | Via API | Webhook has metadata only; body/attachments require API calls |
| **Cloudflare Email Workers** | Yes (Worker binding) | Raw MIME (ReadableStream) | Must parse locally | Must parse locally | Free (Email Routing included) | Must handle locally | Best price; requires MIME parsing |
| **Amazon SES** | Yes (S3 + Lambda) | Raw email to S3, metadata to Lambda | Must parse locally | Must parse locally | $0.10 per 1k emails received | Must handle locally | Only in us-east-1, us-west-2, eu-west-1 |
| **inbound.new** | Yes | JSON (POST) | Parsed, structured | Included | Custom pricing | Auto-threading on replies | 2-second delivery, TypeScript SDK |
| **AgentMail** | Yes | JSON (API) | Full parsing | Included | Custom pricing | Built-in threading | Purpose-built for AI agents, Y Combinator backed |

### Deep Dive: Top Candidates

#### Postmark (Recommended Primary)

**Webhook Payload Structure:**
```
{
  "FromName": "John Smith",
  "From": "john@example.com",
  "FromFull": { "Email": "john@example.com", "Name": "John Smith", "MailboxHash": "" },
  "To": "support+tenant123@kilvo.app",
  "ToFull": [{ "Email": "support+tenant123@kilvo.app", "Name": "", "MailboxHash": "tenant123" }],
  "Subject": "Help with my order",
  "MessageID": "unique-message-id@example.com",
  "Date": "Thu, 7 Mar 2026 10:30:00 -0800",
  "TextBody": "I need help with order #12345...",
  "HtmlBody": "<html>...</html>",
  "StrippedTextReply": "Just the latest reply without quoted text",
  "MailboxHash": "tenant123",
  "Headers": [...],
  "Attachments": [{ "Name": "file.pdf", "Content": "base64...", "ContentType": "application/pdf", "ContentLength": 12345 }]
}
```

**Key advantages:**
- `StrippedTextReply` automatically strips quoted reply text (no library needed)
- `MailboxHash` parses plus-addressing (support+tenant123@kilvo.app -> "tenant123"), perfect for multi-tenant routing
- Full body inline in webhook (no separate API call needed, unlike Resend)
- 10 retries with exponential backoff on webhook failures
- Clean JSON format (not multipart/form-data like SendGrid)

**Pricing:** $15/mo (Basic) for 10k emails, both inbound and outbound count. Additional emails $1.20-$1.80 per thousand.

Sources:
- https://postmarkapp.com/developer/webhooks/inbound-webhook
- https://postmarkapp.com/developer/user-guide/inbound/parse-an-email
- https://postmarkapp.com/developer/user-guide/inbound/sample-inbound-workflow

#### Resend (Already in Kiln Ecosystem)

**Critical limitation:** Webhook payload contains metadata only -- no email body, no headers, no attachments. You must make separate API calls to retrieve them. This adds latency and complexity.

**Payload:** Only contains `type: "email.received"`, sender/recipient metadata. Body and attachments require:
- `GET /emails/{id}` for body
- `GET /emails/{id}/attachments` for attachments

**Pricing:** Free tier: 3k emails/month (inbound + outbound combined). Inbound emails count against quota.

**Verdict:** Suboptimal for real-time webhook processing. The two-step fetch pattern adds latency and failure points. However, if Kiln's ecosystem already uses Resend for outbound, it simplifies the stack.

Sources:
- https://resend.com/docs/dashboard/receiving/introduction
- https://resend.com/blog/inbound-emails
- https://alternativeto.net/news/2025/11/resend-adds-inbound-feature-for-webhooks-based-email-receiving-and-processing/

#### Cloudflare Email Workers (Best Free Option)

**How it works:** Cloudflare Email Routing (free) receives email and triggers an Email Worker. The Worker receives a raw MIME `ReadableStream` and can forward, reject, or process the email.

**Key developments (2025):**
- March 2025: Removed restrictions on replying to emails from Workers (enables AI agent use case)
- April 2025: Local development support via `wrangler dev`
- October 2025: Full Cloudflare Email Service announced (private beta)

**Architecture:** Email Routing -> Email Worker -> `fetch()` to Kiln gateway webhook endpoint.

**Catch-all support:** Yes. Worker can receive all emails for a domain.

**Pricing:** Email Routing is free. Workers free tier: 100k requests/day. Paid: $5/mo.

**Tradeoff:** You must parse the raw MIME yourself (using `postal-mime` which runs in Workers). No pre-parsed payload like Postmark.

Sources:
- https://developers.cloudflare.com/email-routing/email-workers/
- https://blog.cloudflare.com/email-service/
- https://developers.cloudflare.com/changelog/post/2025-03-12-reply-limits/

#### SendGrid Inbound Parse

**Payload format:** `multipart/form-data` (not clean JSON like Postmark). Fields include `text`, `html`, `envelope`, `headers`, `subject`, and file attachments.

**Spam checking:** Optional spam scoring included in payload.

**Size limit:** 30 MB total (message + attachments).

**Retry:** Automatic retry on 5XX responses.

**Pricing:** Included in SendGrid plans. Essentials: $19.95/mo for 50k emails.

Sources:
- https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
- https://docs.sendgrid.com/for-developers/parsing-email/inbound-email

---

## 3. Email Parsing Standards

### MIME Structure (RFC 2045-2049)

Emails are MIME-encoded. Common structures:

```
multipart/mixed
  |-- multipart/alternative
  |     |-- text/plain (plain text body)
  |     |-- text/html (HTML body)
  |-- application/pdf (attachment)
  |-- image/png (attachment)
```

- `multipart/alternative`: Same content in different formats (text + HTML). Use text/plain for AI processing, HTML for rendering.
- `multipart/mixed`: Different parts (body + attachments).
- `multipart/related`: HTML body with inline images (CID references).

### TypeScript MIME Parsing Libraries

#### postal-mime (Recommended for Kiln)

- **npm:** `postal-mime` (v2.7.3, actively maintained)
- **Environment:** Node.js, browsers, Workers (runs in Cloudflare Email Workers)
- **Features:** Full RFC 822 parsing, TypeScript types, security limits (maxNestingDepth, maxHeadersSize)
- **Size:** Lightweight, zero dependencies
- **Use case:** If using Cloudflare Email Workers or processing raw MIME directly

Source: https://github.com/postalsys/postal-mime

#### mailparser (by Nodemailer)

- **npm:** `mailparser`
- **Environment:** Node.js only (uses streams)
- **Features:** Full MIME decoding, attachment extraction, encoding handling
- **Use case:** Server-side MIME parsing, heavier than postal-mime

Source: https://github.com/nodemailer/mailparser

#### letterparser

- **npm:** `letterparser`
- **Environment:** Isomorphic (Node.js + browser)
- **Features:** MIME support, TypeScript native
- **Use case:** Lighter alternative to mailparser

Source: https://github.com/mat-sz/letterparser

### Reply Stripping Libraries

When processing email replies, you need to extract only the new content (strip quoted previous messages, signatures).

#### email-reply-parser (by Crisp) -- Recommended

- **npm:** `email-reply-parser`
- **Features:** Strips "On DATE, NAME wrote:" quoted text, supports ~10 locales (EN, FR, ES, PT, IT, JA, ZH), uses RE2 regex engine for ReDoS protection with JavaScript RegExp fallback
- **Handles:** Gmail, Outlook, Apple Mail, Thunderbird reply formats

Source: https://github.com/crisp-oss/email-reply-parser

#### planer

- **npm:** `planer`
- **Features:** Port of Mailgun's Talon Python library, removes reply quotations
- **Note:** Less actively maintained than Crisp's parser

Source: https://github.com/lever/planer

### Character Encoding

- Emails may use UTF-8, ISO-8859-1, Windows-1252, and other encodings
- MIME headers specify encoding via `Content-Type: text/plain; charset=utf-8`
- Both `postal-mime` and `mailparser` handle encoding conversion automatically
- Always normalize to UTF-8 before passing to LLM

**Recommendation for Kiln:** If using Postmark (recommended provider), the webhook payload arrives pre-parsed with `StrippedTextReply` for reply stripping and UTF-8 normalized bodies. No MIME parsing needed. If using Cloudflare Email Workers, use `postal-mime` for parsing + `email-reply-parser` for reply stripping.

---

## 4. Email Threading

### RFC 5322 Threading Headers

Three headers control email threading:

1. **Message-ID**: Unique identifier for each email. Format: `<unique-id@domain>`.
   - Every message SHOULD have a Message-ID
   - Must be globally unique
   - Format: `<local-part@domain>` (looks like an email address but is not one)

2. **In-Reply-To**: Contains the Message-ID of the parent message being replied to.
   - Set when replying to a message
   - Contains exactly one Message-ID

3. **References**: Contains the full chain of Message-IDs in the thread.
   - Built by appending parent's Message-ID to parent's References
   - Enables reconstruction of full thread tree

### How to Build a Thread Chain

```
Original email:
  Message-ID: <msg-001@kilvo.app>

AI Reply:
  Message-ID: <msg-002@kilvo.app>
  In-Reply-To: <msg-001@kilvo.app>
  References: <msg-001@kilvo.app>

User Reply to AI:
  Message-ID: <msg-003@example.com>
  In-Reply-To: <msg-002@kilvo.app>
  References: <msg-001@kilvo.app> <msg-002@kilvo.app>

AI Reply to that:
  Message-ID: <msg-004@kilvo.app>
  In-Reply-To: <msg-003@example.com>
  References: <msg-001@kilvo.app> <msg-002@kilvo.app> <msg-003@example.com>
```

### Message-ID Generation Best Practices

Per RFC 5322 and practical guidance:

```
Format: <{unique-part}@{domain}>
Example: <20260307T103000.a1b2c3d4@kilvo.app>
```

**Recommended algorithm for Kiln:**
- Left side: `{timestamp}.{random-hex}` or `{uuid}` for guaranteed uniqueness
- Right side: Domain you control (e.g., `kilvo.app` or `mail.kilvo.app`)
- Example: `<1741372200.f7a3b2c1d4e5@mail.kilvo.app>`
- Never reuse a Message-ID -- if two messages share the same ID, clients discard one

Sources:
- https://www.wordtothewise.com/2025/08/message-id-syntax
- https://www.jwz.org/doc/mid.html
- https://www.rfc-editor.org/rfc/rfc5322

### How Major Email Clients Group Threads

| Client | Primary Grouping | Fallback | Notes |
|--------|-----------------|----------|-------|
| **Gmail** | References + In-Reply-To headers | Subject line matching | Groups by subject even without headers |
| **Outlook** | Conversation-ID (proprietary) + References | Subject line | Adds `Thread-Topic` and `Thread-Index` headers |
| **Apple Mail** | References + In-Reply-To | Subject line | Most standards-compliant |
| **Thunderbird** | References + In-Reply-To | Subject line | Strict RFC compliance |

**Key insight:** Gmail also groups by subject line. If the Subject starts with "Re: " and matches an existing conversation subject, Gmail may group them even without threading headers. This is both helpful (threads work even with broken headers) and dangerous (unrelated emails with same subject may be grouped).

### Best Practices for AI-Generated Replies

1. **Always set In-Reply-To** to the Message-ID of the email being replied to
2. **Always set References** by appending the replied-to Message-ID to the existing References chain
3. **Keep the Subject** identical with "Re: " prefix (do not modify the subject line)
4. **Generate proper Message-IDs** for every outbound email
5. **Store the Message-ID** of every sent email for future reference chain building
6. **Store inbound Message-IDs** for building References chains

Sources:
- https://www.w3tutorials.net/blog/do-all-email-clients-use-in-reply-to-field-in-email-header/
- https://developers.mailersend.com/guides/creating-email-threads
- https://cr.yp.to/immhf/thread.html

---

## 5. Sending Email Replies

### Required Headers for Threaded Replies

```
From: Support <support+tenant123@kilvo.app>
To: customer@example.com
Subject: Re: Help with my order
Message-ID: <new-unique-id@kilvo.app>
In-Reply-To: <original-message-id@example.com>
References: <chain-of-message-ids>
Auto-Submitted: auto-replied
```

### From Address Strategies

| Strategy | Example | Pros | Cons |
|----------|---------|------|------|
| Reply-enabled | support@kilvo.app | Natural threading, user can reply | Must process inbound |
| Plus-addressed | support+tenant123@kilvo.app | Multi-tenant routing built-in | Visible to user (ugly) |
| Subdomain | support@tenant.kilvo.app | Clean per-tenant isolation | DNS setup per tenant |
| No-reply | noreply@kilvo.app | Simple | Breaks conversation, poor UX |

**Recommendation:** Plus-addressing (`support+{tenantId}@kilvo.app`) for initial implementation. Single domain, single MX setup, multi-tenant routing via MailboxHash. Subdomain approach for premium tenants who want custom branding.

### SPF, DKIM, DMARC Requirements (2025-2026 Landscape)

As of 2025-2026, ALL major email providers enforce authentication:

**Google (Feb 2024):** SPF + DKIM + DMARC required for 5,000+ emails/day senders.
**Yahoo (Feb 2024):** Same requirements as Google.
**Microsoft (May 2025):** SPF + DKIM + DMARC required for 5,000+ emails/day to Outlook.com, Hotmail.com, Live.com. Non-compliant messages routed to Junk.

**Minimum requirements:**
- **SPF:** DNS TXT record listing authorized sending IPs
- **DKIM:** DNS CNAME/TXT records for cryptographic signature verification
- **DMARC:** DNS TXT record with at least `p=none` policy, aligned with SPF or DKIM

**For Kiln:** If using Postmark/Resend/SendGrid for outbound, they handle DKIM signing. You add their SPF/DKIM DNS records to your domain. DMARC policy must be set on your domain.

Sources:
- https://www.egenconsulting.com/blog/email-deliverability-2026.html
- https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730
- https://powerdmarc.com/google-and-yahoo-email-authentication-requirements/

### HTML vs Plain Text for AI Responses

**Plain text:** Simpler, universally supported, appropriate for conversational AI responses. Matches the "messaging" feel.

**HTML:** Richer formatting, better for structured responses (lists, tables, code blocks). Required if AI responses include formatted content.

**Recommended approach for Kiln:**
1. Generate AI response as markdown (natural LLM output)
2. Convert to both plain text and simple HTML
3. Send as `multipart/alternative` (text/plain + text/html)
4. Use minimal HTML -- no complex layouts, inline styles only
5. Include a plain-text footer with unsubscribe info

---

## 6. Multi-Tenant Email Architecture

### Three Routing Strategies

#### A. Plus-Addressing (Recommended for MVP)

```
support+{tenantId}@kilvo.app
```

**How it works:**
- Single domain: `kilvo.app`
- Single MX record setup
- Tenant ID encoded in the "+" portion
- Postmark parses this into `MailboxHash` automatically
- Example: `support+acme-corp@kilvo.app` -> MailboxHash: `acme-corp`

**Pros:**
- Zero DNS setup per tenant
- Single email receiving domain
- Postmark, SendGrid, Mailgun all support plus-addressing
- Easy to implement, easy to scale

**Cons:**
- Visible to end users (some find it confusing)
- Some older email systems don't support "+" in addresses
- Not as branded as custom domains

#### B. Subdomain Per Tenant

```
support@acme.kilvo.app
support@beta.kilvo.app
```

**How it works:**
- Wildcard MX record: `*.kilvo.app -> provider SMTP`
- Extract tenant from subdomain portion
- Each tenant gets a branded email address

**Pros:**
- Cleaner branding per tenant
- Familiar pattern (Zendesk, Intercom use this)
- Wildcard DNS reduces per-tenant setup

**Cons:**
- Wildcard MX records may not work with all providers
- SSL certificates for wildcard subdomains
- More complex DNS management

#### C. Custom Domain Per Tenant (Premium)

```
support@acme.com (tenant's own domain)
```

**How it works:**
- Tenant configures email forwarding from their domain to Kiln's inbound address
- Or: Tenant sets MX records to point to Kiln's email provider
- Kiln processes and replies using tenant's domain (requires DKIM/SPF setup)

**Pros:**
- Best UX -- fully branded
- Professional appearance

**Cons:**
- Requires DNS changes per tenant (MX, SPF, DKIM, DMARC)
- Complex onboarding flow
- Must handle domain verification
- Deliverability risk if tenant's domain reputation is poor

### How Existing Platforms Handle This

**Zendesk:** Email forwarding. Tenants forward from their existing email (support@acme.com) to a Zendesk address. Zendesk adds CNAME records for SPF/DKIM to send on behalf of the tenant's domain. Three-step setup: create support address -> set up forwarding -> add SPF record.

**Intercom:** Uses `intercom-mail.com` shared domain initially, then tenants connect custom domains for branding. Multiple brand support via separate email channels per brand.

**Freshdesk:** Dedicated support email addresses per tenant, with advanced routing rules.

Sources:
- https://support.zendesk.com/hc/en-us/articles/4408886828698
- https://support.zendesk.com/hc/en-us/articles/4408832543770
- https://www.intercom.com/help/en/articles/9744849-connect-your-email-support-channel

### Recommendation for Kiln

**Phase 1 (MVP):** Plus-addressing on a shared domain.
- Single domain: `mail.kilvo.app` (or `support.kilvo.app`)
- Tenant routing: `support+{tenantId}@mail.kilvo.app`
- Postmark webhook with MailboxHash parsing
- Zero per-tenant DNS configuration

**Phase 2:** Subdomain per tenant.
- Wildcard DNS: `*.mail.kilvo.app`
- Tenant routing by subdomain extraction

**Phase 3:** Custom domain support.
- Domain verification flow
- SPF/DKIM/DMARC configuration wizard
- Per-tenant outbound sending configuration

---

## 7. Email-Specific Formatting

### Markdown to HTML Conversion for AI Responses

AI models output markdown naturally. This must be converted to email-safe HTML.

**Recommended pipeline:**
```
LLM Output (Markdown) -> markdown-to-HTML converter -> CSS inliner -> multipart/alternative email
```

**Libraries:**
- **MJML:** Framework for responsive email HTML. Converts MJML markup to cross-client HTML. TypeScript support. Heavyweight but produces the most compatible output.
- **marked/markdown-it:** Lightweight markdown-to-HTML. Fast, but output needs CSS inlining for email compatibility.
- **juice:** CSS inliner that converts `<style>` blocks to inline styles. Essential for email compatibility.

Source: https://mjml.io/

### Email Client Rendering Differences (2025-2026)

**Critical insight:** "Outlook is actually four different rendering engines wearing the same brand name."

| Client | Rendering Engine | CSS Support | Media Queries | Key Limitations |
|--------|-----------------|-------------|---------------|-----------------|
| **Gmail Web** | Custom | Good | **No** | Strips `<style>` blocks, no media queries |
| **Gmail Mobile** | Custom | Good | **Yes** | Better than desktop Gmail |
| **Outlook (Classic)** | **Microsoft Word** | Very poor | No | No border-radius, no background images, limited CSS |
| **Outlook (New)** | Edge/WebView | Good | Yes | Improving, not fully rolled out |
| **Apple Mail** | WebKit | **Excellent** | Yes | Supports flexbox, grid, animations, web fonts |
| **Thunderbird** | Gecko | Good | Yes | Standards-compliant |

**Safe CSS for all clients:**
- Inline styles only (Gmail strips `<style>` blocks)
- Table-based layouts (Word rendering engine in Outlook)
- No flexbox, no grid (Outlook Classic)
- No border-radius (Outlook Classic)
- System fonts only (no @font-face for Outlook)
- No CSS animations
- Background colors work; background images do not (Outlook Classic)

Sources:
- https://dev.to/mailpeek/the-complete-guide-to-email-client-rendering-differences-in-2026-243f
- https://designmodo.com/html-css-emails/
- https://developers.google.com/workspace/gmail/design/css
- https://www.caniemail.com/

### Image Handling

| Method | Gmail | Outlook | Apple Mail | Recommendation |
|--------|-------|---------|------------|----------------|
| **Hosted URL** | Works (blocked by default until user clicks "display images") | Works | Works | **Recommended** |
| **CID embedded** | **Broken** (shows as attachment) | Works | **Stripped** | Avoid |
| **Base64 inline** | Works (with size limits) | Partially | Works | Avoid (bloats email size) |

**Recommendation:** Use hosted URLs for all images. Accept that images may be blocked by default in some clients. Design emails that make sense without images (alt text, text-first design).

Sources:
- https://www.twilio.com/en-us/blog/insights/embedding-images-emails-facts
- https://mailtrap.io/blog/embedding-images-in-html-email-have-the-rules-changed/

### AI Response Email Template Strategy

For Kiln's AI email responses, keep it simple:

```html
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #333;">
  <div style="max-width: 600px;">
    <!-- AI Response Content (converted from markdown) -->
    {responseHtml}

    <!-- Separator -->
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />

    <!-- Footer -->
    <p style="font-size: 12px; color: #999;">
      This message was sent by {tenantName}'s AI assistant powered by Kiln.
      <br/>
      <a href="{unsubscribeUrl}" style="color: #999;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>
```

---

## 8. Email Security and Compliance

### Inbound Email Verification

#### SPF/DKIM/DMARC Verification on Inbound

When receiving inbound email, verify sender authenticity:

- **SPF:** Check if the sending IP is authorized by the sender's domain
- **DKIM:** Verify the cryptographic signature in the email header
- **DMARC:** Check if SPF or DKIM alignment passes per the sender's DMARC policy

**Provider handling:** Most webhook providers (Postmark, SendGrid) include SPF/DKIM/DMARC pass/fail results in the webhook payload. Postmark includes spam scoring. SendGrid optionally includes SpamAssassin results.

**Recommendation:** Log authentication results. Do not reject emails that fail SPF/DKIM (many legitimate senders have misconfigured DNS). Use failure as a signal for spam scoring, not hard rejection.

#### Spam Filtering

- SendGrid offers optional spam checking on inbound (SpamAssassin score in payload)
- Postmark includes spam score in webhook payload
- For additional protection, implement basic heuristics:
  - Reject emails from known spam domains
  - Rate-limit per sender address
  - Ignore emails with `Auto-Submitted: auto-generated` to prevent loops

### Loop Prevention (Critical)

**The #1 failure mode for automated email systems is mail loops.** Two auto-responders replying to each other indefinitely.

**Prevention mechanisms (all must be implemented):**

1. **Auto-Submitted header (RFC 3834):**
   - Set `Auto-Submitted: auto-replied` on all AI-generated emails
   - NEVER respond to emails with `Auto-Submitted` header (any value except "no")

2. **Precedence header:**
   - Set `Precedence: bulk` on automated responses
   - Check inbound for `Precedence: bulk` or `Precedence: auto_reply`

3. **X-Auto-Response-Suppress:**
   - Set `X-Auto-Response-Suppress: All` to suppress Outlook auto-responses

4. **Sender filtering:**
   - Ignore emails from `noreply@`, `no-reply@`, `mailer-daemon@`
   - Ignore emails from `postmaster@`
   - Ignore emails with empty Return-Path (`<>`)

5. **Rate limiting per sender:**
   - Max 1 auto-reply per sender per 24 hours (RFC 3834 recommendation)
   - Track replied-to addresses with TTL

6. **Self-detection:**
   - Never respond to emails from your own sending addresses
   - Check `From`, `Reply-To`, and `Return-Path`

Sources:
- https://datatracker.ietf.org/doc/html/rfc3834
- https://support.zendesk.com/hc/en-us/articles/4408836366362
- https://emailsorters.com/blog/email-loop-what-it-is-how-to-fix/

### CAN-SPAM Compliance (US)

Applies to automated commercial email responses:
- Must include sender's physical postal address
- Must include clear unsubscribe mechanism
- Must honor unsubscribe within 10 business days
- Must not use deceptive subject lines
- Must identify the message as an advertisement (if applicable)

**For AI support responses:** CAN-SPAM primarily targets marketing/commercial email. Transactional or relationship-based messages (like support replies) have fewer requirements. However, include unsubscribe as best practice.

### GDPR Compliance (EU)

- **Lawful basis:** Processing customer emails for support falls under "legitimate interest" or "contractual necessity"
- **Right to erasure:** Must be able to delete all stored email data for a user on request
- **Data minimization:** Store only what is needed for the conversation
- **Retention:** Define and enforce email data retention periods
- **Cross-border:** Email content may be processed by LLM providers in different jurisdictions

### List-Unsubscribe Header (RFC 8058)

Required by Google and Yahoo for bulk senders (5,000+/day) since 2024:

```
List-Unsubscribe: <https://kilvo.app/unsubscribe?id=xxx>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

**RFC 8058** defines one-click unsubscribe via HTTP POST (not GET) to prevent accidental unsubscription by link scanners.

**For Kiln:** Even though AI support replies are transactional (not marketing), including List-Unsubscribe is best practice for deliverability. It signals to email providers that you are a responsible sender.

Sources:
- https://www.mailmodo.com/guides/rfc-8058/
- https://datatracker.ietf.org/doc/html/rfc8058
- https://www.valimail.com/blog/one-click-unsubscribe/

### Outbound Rate Limiting and Reputation

**IP/Domain Warmup:**
- New sending domains need 2-4 weeks of warmup
- Start with 50-100 emails/day, gradually increase
- Maintain consistent daily volume (ISPs track 30-day rolling window)
- After warmup, typical safe limit: 20 emails/inbox/day for cold outreach; higher for transactional/support

**Reputation management:**
- Monitor bounce rates (keep under 2%)
- Handle complaints (use feedback loops)
- Remove invalid addresses promptly
- Don't send to addresses that hard-bounced

Sources:
- https://www.mailpool.ai/blog/email-warm-up-best-practices-complete-2025-guide
- https://documentation.mailgun.com/docs/mailgun/email-best-practices/ip_address

---

## 9. Email vs Messaging Channels -- Key Differences

### Fundamental Differences

| Aspect | Email | Messaging (WhatsApp, WebSocket, Slack) |
|--------|-------|---------------------------------------|
| **Communication model** | Asynchronous (hours/days) | Synchronous/near-real-time (seconds) |
| **Response expectation** | Minutes to hours | Seconds |
| **Message length** | Long-form, multi-paragraph | Short messages, conversational |
| **Formality** | More formal, structured | Casual, conversational |
| **Multi-topic** | Common (multiple questions in one email) | Rare (one topic per message) |
| **Threading** | Header-based (RFC 5322) | Platform-managed sessions |
| **Typing indicators** | None | Yes (WhatsApp, WebSocket) |
| **Read receipts** | Unreliable (tracking pixels) | Native (WhatsApp blue ticks) |
| **Attachments** | Inline (base64/CID) or hosted | Platform-specific upload |
| **Rich content** | HTML with inline CSS | Markdown, platform-specific formatting |
| **Session lifecycle** | Open-ended, can be reopened anytime | Usually has defined session window |
| **Delivery guarantees** | Store-and-forward (reliable) | Connection-dependent |
| **Identity** | Email address | Phone number / user ID / workspace ID |

### Design Pattern Differences for AI Agents

**Multi-topic handling:** Email users frequently ask multiple questions in a single message. The AI must either:
1. **Split and address each question** in structured sections (Intercom's approach)
2. **Summarize all topics** in a single coherent response

Intercom's Fin AI specifically built a component for splitting multi-question emails and processing each separately to avoid context loss.

**Response format:** Email responses should be:
- More comprehensive and self-contained (user may not check for hours)
- Include a greeting and sign-off
- Use structured formatting (headers, bullet lists) for multi-part answers
- Include relevant links and references inline
- Avoid "let me know if you need anything else" repeated patterns

**Email-specific processing:** AI must handle:
- Email signatures (ignore images/links in signatures)
- Forwarded messages (detect "---------- Forwarded message ----------")
- Auto-reply detection (vacation messages, out-of-office)
- Spam/newsletter detection (avoid responding to marketing emails)

**Conversation context:** Unlike messaging where context is maintained per-session, email threads can span days or weeks. The AI needs to:
- Summarize thread history before processing the latest message
- Handle context windows that may exceed LLM limits for long threads
- Detect when a thread topic has changed (new question in old thread)

Sources:
- https://www.intercom.com/blog/fin-over-email-how-we-built/
- https://customerthink.com/synchronous-vs-asynchronous-support-channels-which-is-better-for-agents-and-customers/
- https://devrev.ai/blog/case-asynchronous-ai-agents

---

## 10. Production Email Channel Implementations

### Intercom Fin Over Email (Most Relevant Case Study)

Intercom's blog post "Fin over email: How we built a multichannel AI agent" is the most detailed public description of building an email channel for an AI agent.

**Key architectural decisions:**

1. **Email-specific ML component:** Intercom created a dedicated component in Fin's architecture specifically for email, recognizing that email is fundamentally different from chat.

2. **Multi-question splitting:** Email messages frequently contain multiple questions. Fin processes them separately to avoid losing context on any individual question.

3. **Signature filtering:** Built-in logic to ignore email signatures (especially those with images) that are not relevant to the query.

4. **Spam/auto-reply filtering:** Automatic detection and filtering of spam and automated emails to avoid wasting AI processing.

5. **Format conversion:** Converting chat-style responses (short, separate messages) into a single well-formatted email with heading, body, and signature was "not a trivial task."

6. **Deliverability management:** Email deliverability was "out of Intercom's control," requiring careful management of sending reputation.

7. **RAG architecture:** Same underlying RAG system as chat, with retrieval model, reranker model, and summary model.

Sources:
- https://www.intercom.com/blog/fin-over-email-how-we-built/
- https://www.intercom.com/help/en/articles/9744849-connect-your-email-support-channel

### Zendesk Email Architecture

**Forwarding-based:** Tenants forward emails from their existing addresses to Zendesk. Zendesk processes and responds on behalf of the tenant's domain.

**DNS requirements per tenant:** Four CNAME records for SPF/DKIM authorization.

**Key lesson:** The forwarding approach is simpler than MX record changes for tenant onboarding. Users keep their existing email provider.

Sources:
- https://support.zendesk.com/hc/en-us/articles/4408832543770
- https://support.zendesk.com/hc/en-us/articles/4408886828698

### Superhuman AI Architecture

**Tool classification approach:** Superhuman classifies queries based on user intent to determine which tools or data sources to activate, while extracting relevant parameters (time filters, sender names, attachments) for retrieval.

**Prompt engineering:** Uses "double dipping" -- repeating key instructions in both system prompt and final user message to ensure reliable instruction following. Chatbot rules define system behavior with task-specific guidelines and semantic few-shot examples.

Source: https://www.langchain.com/breakoutagents/superhuman

### AgentMail (Purpose-Built for AI Agents)

**Y Combinator backed.** Purpose-built email infrastructure for AI agents.

**Features:**
- Programmatic inbox creation per agent
- Built-in threading (handles all headers automatically)
- TypeScript SDK (`agentmail` npm package)
- Works with LangChain, LlamaIndex, CrewAI
- Full inbox lifecycle: create, send, receive, thread, parse, filter, label, store

**Architecture insight:** AgentMail treats each AI agent as a first-class email user with its own inbox, rather than routing through a shared support address.

Sources:
- https://www.agentmail.to/
- https://www.ycombinator.com/companies/agentmail
- https://www.agentmail.to/blog/5-best-email-api-for-developers-compared-2026

### Common Pitfalls from Production Deployments

1. **Mail loops** (most critical): Two auto-responders replying to each other. Must implement RFC 3834 headers + rate limiting.
2. **Deliverability degradation:** High bounce rates or spam complaints damage sender reputation. Must validate addresses and handle bounces.
3. **Thread corruption:** Incorrect threading headers cause messages to appear outside the thread. Must maintain accurate Message-ID chains.
4. **Encoding issues:** Non-UTF-8 emails causing garbled text. Must normalize all input to UTF-8.
5. **Attachment bombs:** Large or malicious attachments consuming resources. Must enforce size limits and type restrictions.
6. **Reply parsing failures:** Quoted text not stripped correctly for different email clients. Must test with Gmail, Outlook, Apple Mail reply formats.
7. **Signature noise:** Email signatures (especially with images and legal disclaimers) polluting AI context. Must detect and strip signatures.

---

## 11. Academic Research on Email AI

### AI-Generated Email Quality

**ACM Web Science 2025 paper:** "Emails by LLMs: A Comparison of Language in AI-Generated and Human-Written Emails" (DOI: 10.1145/3717867.3717872) -- examined linguistic differences between AI and human emails.

**Key findings from industry:**
- AI-generated emails have higher clickthrough rates and click-to-open ratios than manually written messages
- 72.5% of marketers used AI in email campaigns in 2024 (Mailmodo State of Email 2025)
- Companies using AI for email personalization see 13% average increase in response rates

Sources:
- https://dl.acm.org/doi/10.1145/3717867.3717872

### Tone and Formality Adaptation

- AI email tools use NLP and ML to detect formality levels (formal, friendly, assertive, empathetic)
- Context-aware suggestions adapt based on recipient relationship and communication purpose
- Formality calibration for relationship stages (adjusting register based on familiarity)
- Customer satisfaction drops 20% when support teams lose AI writing assistance

Sources:
- https://www.jenova.ai/en/resources/ai-email-tone-improver

### Email Thread Summarization

- LLMs are "surprisingly effective" at summarizing long email chains when properly chunked
- Traditional summarization loses details in compression; lacks specificity for personalized responses
- Mem0-style memory approaches (already in Kiln's ContactMemoryService) may be more effective than pure summarization for maintaining context across email threads
- Context rot research shows increasing input tokens degrades LLM performance -- email threads need smart truncation, not full-thread injection

Sources:
- https://mem0.ai/blog/llm-chat-history-summarization-guide-2025
- https://research.trychroma.com/context-rot
- https://github.com/ajfinky/LLM-Email-Thread-Summarization-Comparison

### Response Timing and Customer Satisfaction

- 88% of customers expect a response within 60 minutes
- Average response time across industries is over 12 hours
- AI reduces email response times from hours to seconds
- Smart prioritization reduces manual sorting time by 40%
- Optimal approach: immediate acknowledgment + AI response for simple queries, AI-assisted draft for complex queries

Sources:
- https://atidiv.com/ai-email-automation-improve-response-times/

---

## 12. Recommended Architecture for Kiln

### Provider Recommendation

**Primary: Postmark** for both inbound and outbound email.

Rationale:
- Best webhook payload format (clean JSON with pre-parsed fields)
- `StrippedTextReply` eliminates need for reply-stripping library
- `MailboxHash` provides built-in plus-address parsing for multi-tenant routing
- Retry logic (10 retries with backoff) for webhook reliability
- Included spam scoring
- Known for best-in-class deliverability
- Reasonable pricing ($15/mo for 10k emails)

**Alternative: Resend** if consolidating on a single email provider (already in ecosystem).

Caveat: Resend's webhook-only-metadata pattern requires extra API calls and adds latency. Acceptable for lower-volume use cases.

**Alternative: Cloudflare Email Workers** for self-hosted / zero-cost deployments.

Caveat: Requires MIME parsing with `postal-mime` + reply stripping with `email-reply-parser`. More code, but free.

### Channel Adapter Design

The email channel adapter should follow the same pattern as `WhatsAppChannel` and `SlackChannel`:

```
Inbound flow:
  Email Provider (Postmark) -> Webhook POST -> email-webhook-routes.ts
    -> Parse tenant from MailboxHash (or subdomain)
    -> Resolve TenantConfig from TenantRegistry
    -> Extract message content (StrippedTextReply or TextBody)
    -> Map to IncomingMessage (ContentPart[])
    -> processInboundMessage() (shared pipeline)
    -> Format AI response as email HTML
    -> Send reply via Postmark API (with threading headers)
    -> Emit conversation events

Outbound flow:
  AI Response -> formatForEmail()
    -> Convert markdown to HTML (inline styles)
    -> Wrap in email template
    -> Set threading headers (In-Reply-To, References, Message-ID)
    -> Set compliance headers (Auto-Submitted, List-Unsubscribe)
    -> Send via Postmark API
```

### Data Model Additions

```typescript
// Thread tracking (stored alongside session)
interface EmailThread {
  threadId: string;           // Internal thread ID
  tenantId: string;
  externalUserId: string;     // Sender email address
  subject: string;
  messageIds: string[];       // Chain of Message-IDs for References header
  lastMessageId: string;      // For In-Reply-To
  lastActivity: Date;
  sessionId: string;          // Link to ModeBSession
}

// Inbound email message (parsed from webhook)
interface InboundEmail {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  strippedReply?: string;     // Pre-parsed reply (Postmark)
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  mailboxHash?: string;       // Tenant routing (plus-addressing)
  attachments: EmailAttachment[];
  spamScore?: number;
  headers: Record<string, string>;
}
```

### Multi-Tenant Routing

```
Phase 1: Plus-addressing
  support+{tenantId}@mail.kilvo.app -> MailboxHash -> TenantRegistry.get(tenantId)

Phase 2: Subdomain
  support@{tenant}.mail.kilvo.app -> extract subdomain -> TenantRegistry.get(tenant)

Phase 3: Custom domain
  support@acme.com -> forwarding rule -> resolve by sender domain
```

### Safety & Loop Prevention Checklist

- [ ] Set `Auto-Submitted: auto-replied` on all outbound
- [ ] Set `X-Auto-Response-Suppress: All` on all outbound
- [ ] Check inbound for `Auto-Submitted` header (reject if present)
- [ ] Check inbound for `Precedence: bulk/auto_reply` (reject if present)
- [ ] Ignore `noreply@`, `no-reply@`, `mailer-daemon@`, `postmaster@` senders
- [ ] Ignore empty Return-Path (`<>`)
- [ ] Rate limit: max 1 auto-reply per sender per 24 hours
- [ ] Self-detection: never reply to own sending addresses
- [ ] Set `List-Unsubscribe` + `List-Unsubscribe-Post` headers
- [ ] Include physical address in footer (CAN-SPAM)
- [ ] Support GDPR erasure of stored email data

### Dependencies (New)

| Package | Purpose | Size |
|---------|---------|------|
| `postmark` | Postmark API client (send + webhook types) | ~50 KB |
| `email-reply-parser` | Strip quoted text (fallback if not using Postmark StrippedTextReply) | ~15 KB |
| `juice` | CSS inliner for HTML emails | ~100 KB |
| `marked` or `markdown-it` | Markdown to HTML conversion | ~30-50 KB |

**Optional (if using Cloudflare Email Workers instead of Postmark):**
| `postal-mime` | MIME parsing | ~25 KB |

### Key Risks

1. **Deliverability:** Email deliverability is harder to maintain than messaging APIs. Requires ongoing monitoring of bounce rates, spam complaints, and sender reputation.

2. **Threading complexity:** Maintaining correct Message-ID chains across restarts, failures, and multi-instance deployments requires reliable storage.

3. **Response format:** Converting chat-style AI responses to well-formatted email HTML that renders correctly across all clients is a non-trivial design challenge.

4. **Loop prevention:** A single bug in loop detection can cause runaway email sending, damaging reputation and incurring costs.

5. **Volume management:** Unlike WebSocket (free) or WhatsApp (per-conversation pricing), email has per-message costs and reputation-based throttling.

---

## Sources Index

### Official Documentation
- [Postmark Inbound Webhook](https://postmarkapp.com/developer/webhooks/inbound-webhook)
- [Postmark Parse an Email](https://postmarkapp.com/developer/user-guide/inbound/parse-an-email)
- [SendGrid Inbound Parse](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook)
- [Mailgun Route Actions](https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http)
- [Cloudflare Email Workers](https://developers.cloudflare.com/email-routing/email-workers/)
- [Cloudflare Email Workers Reply Support](https://developers.cloudflare.com/changelog/post/2025-03-12-reply-limits/)
- [Resend Inbound Emails](https://resend.com/docs/dashboard/receiving/introduction)
- [Resend Pricing](https://resend.com/pricing)
- [Amazon SES Inbound](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-lambda.html)
- [RFC 5322 (Internet Message Format)](https://www.rfc-editor.org/rfc/rfc5322)
- [RFC 3834 (Automatic Responses)](https://datatracker.ietf.org/doc/html/rfc3834)
- [RFC 8058 (One-Click Unsubscribe)](https://datatracker.ietf.org/doc/html/rfc8058)
- [Gmail CSS Support](https://developers.google.com/workspace/gmail/design/css)
- [Can I Email](https://www.caniemail.com/)

### Libraries
- [postal-mime (GitHub)](https://github.com/postalsys/postal-mime)
- [mailparser (GitHub)](https://github.com/nodemailer/mailparser)
- [email-reply-parser (Crisp)](https://github.com/crisp-oss/email-reply-parser)
- [planer (Lever)](https://github.com/lever/planer)
- [MJML](https://mjml.io/)
- [AgentMail npm](https://www.npmjs.com/package/agentmail)

### Industry Analysis
- [Intercom: Fin Over Email Architecture](https://www.intercom.com/blog/fin-over-email-how-we-built/)
- [Superhuman AI Architecture (LangChain Case Study)](https://www.langchain.com/breakoutagents/superhuman)
- [AgentMail (Y Combinator)](https://www.ycombinator.com/companies/agentmail)
- [Best Email APIs Compared 2026](https://www.agentmail.to/blog/5-best-email-api-for-developers-compared-2026)
- [Email Client Rendering Differences 2026](https://dev.to/mailpeek/the-complete-guide-to-email-client-rendering-differences-in-2026-243f)
- [Zendesk Email Setup](https://support.zendesk.com/hc/en-us/articles/4408832543770)
- [Email Loop Prevention (Zendesk)](https://support.zendesk.com/hc/en-us/articles/4408836366362)

### Research
- [ACM: Emails by LLMs (2025)](https://dl.acm.org/doi/10.1145/3717867.3717872)
- [Context Rot (Chroma Research)](https://research.trychroma.com/context-rot)
- [LLM Chat History Summarization (Mem0)](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025)
- [Email Deliverability 2026](https://www.egenconsulting.com/blog/email-deliverability-2026.html)
- [Microsoft Sender Requirements 2025](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730)
- [Message-ID Syntax Best Practices](https://www.wordtothewise.com/2025/08/message-id-syntax)
- [Message-ID Recommendations (jwz)](https://www.jwz.org/doc/mid.html)

### Pricing & Comparison
- [Postmark vs SendGrid](https://postmarkapp.com/compare/sendgrid-alternative)
- [Postmark vs Mailgun](https://postmarkapp.com/compare/mailgun-alternative)
- [inbound.new Pricing](https://inbound.new/pricing)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [IP Warmup Guide 2025](https://www.mailpool.ai/blog/email-warm-up-best-practices-complete-2025-guide)
