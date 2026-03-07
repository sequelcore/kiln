# Phase 6: Channels Competitive Intelligence & Industry Research

**Date:** 2026-03-07
**Author:** Research compilation for Kiln Phase 6 (Instagram DM, Facebook Messenger, Email)
**Status:** Research complete, pending architectural decisions

---

## 1. Competitor Channel Support Matrix (2025-2026)

### Channel Support Comparison

| Platform         | WhatsApp | Instagram | Messenger | Email | SMS | Voice | Telegram | Web Chat | Slack | TikTok | LINE | WeChat | Viber | Discord | RCS |
|------------------|:--------:|:---------:|:---------:|:-----:|:---:|:-----:|:--------:|:--------:|:-----:|:------:|:----:|:------:|:-----:|:-------:|:---:|
| **Intercom**     | Y        | Y         | Y         | Y     | Y   | -     | -        | Y        | Y     | -      | -    | -      | -     | Y       | -   |
| **Zendesk**      | Y        | Y         | Y         | Y     | Y   | Y     | -        | Y        | Y     | -      | -    | -      | -     | -       | -   |
| **Freshdesk**    | Y        | Y         | Y         | Y     | Y   | Y     | -        | Y        | -     | -      | Y    | -      | -     | -       | -   |
| **Respond.io**   | Y        | Y         | Y         | Y     | Y   | Y     | Y        | Y        | -     | Y      | Y    | Y      | Y     | -       | -   |
| **SleekFlow**    | Y        | Y         | Y         | Y     | Y   | -     | Y        | Y        | -     | -      | Y    | Y      | -     | -       | -   |
| **Chatfuel**     | Y        | Y         | Y         | -     | -   | -     | -        | Y        | -     | Y      | -    | -      | -     | -       | -   |
| **ManyChat**     | Y        | Y         | Y         | Y     | Y   | -     | Y        | -        | -     | Y      | -    | -      | -     | -       | -   |
| **Crisp**        | Y        | Y         | Y         | Y     | -   | -     | Y        | Y        | -     | -      | -    | -      | -     | -       | -   |
| **Tidio**        | Y        | Y         | Y         | Y     | -   | -     | -        | Y        | -     | -      | -    | -      | -     | -       | -   |
| **Front**        | Y        | Y         | Y         | Y     | Y   | Y     | -        | Y        | -     | -      | -    | -      | -     | -       | -   |
| **Chatwoot (OS)**| Y        | Y         | Y         | Y     | Y   | -     | Y        | Y        | Y     | -      | Y    | -      | -     | -       | -   |
| **Botpress (OS)**| -        | -         | Y         | -     | -   | -     | Y        | Y        | Y     | -      | -    | -      | -     | -       | -   |
| **Kiln (now)**   | Y        | -         | -         | -     | -   | -     | -        | Y        | Y     | -      | -    | -      | -     | -       | -   |
| **Kiln (Phase6)**| Y        | Y         | Y         | Y     | -   | -     | -        | Y        | Y     | -      | -    | -      | -     | -       | -   |

### Table Stakes vs. Differentiators

**Table stakes (must-have for any serious platform):**
- WhatsApp (already have)
- Email
- Web Chat (already have)
- Instagram DM
- Facebook Messenger

**Differentiators (not yet ubiquitous):**
- TikTok DMs (only Chatfuel, ManyChat, Respond.io)
- RCS (nobody has native yet; emerging)
- Discord (only Intercom Fin)
- Voice/telephony (Zendesk, Freshdesk, Respond.io, Front)
- WeChat (only Respond.io, SleekFlow)

**Gaps Kiln can exploit:**
- Kiln already has Slack (many competitors lack it), making it strong for B2B
- After Phase 6, Kiln will match or exceed Crisp, Tidio, and Chatfuel on channel breadth
- The gap vs. Respond.io is Telegram, TikTok, LINE, WeChat, Voice, Viber -- all niche
- True differentiator: Kiln is the only open-source option with WhatsApp + Instagram + Messenger + Email + Slack + WebSocket all in one engine with multi-tenant isolation

Sources:
- [Respond.io Channels](https://respond.io/help/channels)
- [SleekFlow Channels](https://sleekflow.io/en-us/channels-integrations)
- [Intercom Omnichannel](https://www.intercom.com/help/en/articles/6884847-omnichannel-support-for-workflows)
- [Zendesk AI Agents](https://www.zendesk.com/service/ai/ai-agents/)
- [Freshworks Messaging Channels](https://www.freshworks.com/customer-service-suite/features/messaging-channels/)
- [Chatwoot GitHub](https://github.com/chatwoot/chatwoot)
- [ManyChat Channels](https://help.manychat.com/hc/en-us/categories/13556929063068-Channels)
- [Chatfuel Review](https://chatimize.com/reviews/chatfuel/)

---

## 2. Channel Abstraction Patterns in Production

### Industry Patterns

Three major CPaaS providers have established the canonical patterns for multi-channel messaging abstraction:

#### Twilio Conversations API
- **Pattern:** Single unified API. Messages sent as native SMS, WhatsApp, or chat depending on participant's channel.
- **Abstraction model:** `Conversation` (thread) -> `Participant` (channel-bound) -> `Message` (channel-agnostic)
- **Channel routing:** External channels (SMS, WhatsApp, Messenger) mapped to Twilio-controlled proxy addresses. A pair of addresses (external + proxy) uniquely identifies a non-chat Participant.
- **Key insight:** Developers integrate once, participants join over any channel; the API handles channel-specific formatting.

#### Bird (formerly MessageBird) Conversations API
- **Pattern:** Single contact ID per customer, regardless of channel. Conversations auto-created on first message.
- **Abstraction model:** `Contact` (unified) -> `Conversation` (auto-threaded) -> `Message` (with channel metadata)
- **Supported channels:** WhatsApp, Messenger, SMS, Telegram, WeChat, and more.
- **Key insight:** Preserving full conversation context during handoff from bot to human agent.

#### Vonage Messages API
- **Pattern:** Single abstracted API supporting SMS, RCS, WhatsApp, MMS, Messenger, Viber.
- **Built-in failover:** Messages can be resent via alternate channels if delivery fails.
- **Key insight:** Failover logic between channels (e.g., try RCS, fall back to SMS) as a first-class feature.

### Channel Normalization Principles

From all three providers and open-source frameworks:

1. **Canonical message format:** All inbound messages normalized to a common structure (text, media, location, interactive elements)
2. **Metadata preservation:** Channel-specific metadata (message IDs, timestamps, delivery receipts) stored alongside the canonical message
3. **Metadata lost in normalization:** Rich interactive elements (buttons, carousels, quick replies) degrade to text on channels that don't support them
4. **Outbound formatting:** Messages formatted per-channel on the way out, respecting each channel's constraints
5. **Contact identity:** Single contact with multiple channel endpoints

### Relevance to Kiln

Kiln already has `ContentPart[]` (Text, Image, Audio, File) as its canonical message format, plus `IncomingMessage` / `OutgoingMessage` in `engine/domain/channel.ts`. This is well-positioned. The gap is:
- No contact identity layer (same person on WhatsApp and Instagram = two sessions today)
- No failover/channel-switching logic
- No per-channel outbound formatting layer (the `formatForChannel` in `channels/` is minimal)

Sources:
- [Twilio Conversations Overview](https://www.twilio.com/docs/conversations/overview)
- [Twilio Conversations Fundamentals](https://www.twilio.com/docs/conversations/fundamentals)
- [Bird Conversations API](https://docs.bird.com/api/conversations-api/api-reference/conversations-messaging)
- [Vonage Messages API](https://www.vonage.com/communications-apis/messages/)
- [Infobip Multichannel Communication](https://www.infobip.com/blog/multichannel-communication)

---

## 3. Instagram DM for Business - Market Data

### Volume and Growth

- **LATAM conversational commerce:** $18.2 billion estimated volume, 35% YoY growth
- **Instagram DM share of LATAM conversational commerce:** 15% (~$2.7B)
  - WhatsApp: 72%, Instagram DM: 15%, Facebook Messenger: 8%, Other: 5%
- **Instagram DM open rates:** 90% (via automation tools like ManyChat)
- **Instagram DM reply rates:** up to 60%
- **Conversational commerce conversion rates:** up to 98% when combined with automation and personalized follow-ups
- **73% of consumers globally** prefer messaging when communicating with a business (Meta/Kantar study)

### Instagram vs. WhatsApp by Business Function

| Dimension            | Instagram DM                               | WhatsApp                                    |
|----------------------|-------------------------------------------|---------------------------------------------|
| **Primary role**     | Lead generation, discovery                 | Retention, service, repeat orders            |
| **Best for**         | Visual products (fashion, beauty, food)    | Transactional (e-commerce, logistics)        |
| **Entry point**      | Reels, Stories, posts -> DM               | Direct number / QR code / link               |
| **Conversation type**| Quick questions, impulse bookings          | Detailed service, order management           |
| **Typical business** | Lifestyle brands, restaurants, salons      | E-commerce, healthcare, financial services   |

### LATAM-Specific Data

- Argentina: Instagram Live shopping booming; DMs convert discovery into purchases
- Brazil: WhatsApp dominant (78% of businesses selling via WhatsApp); Telegram growing 45% YoY among Gen Z
- Mexico: WhatsApp primary, but Instagram DM growing for service businesses
- Instagram is discovery-first; WhatsApp is retention-first. Many LATAM brands use both as a funnel.

### Instagram DM API Technical Constraints

- **Rate limit:** 200 DMs/hour (reduced from 5,000 in October 2024 -- 96% reduction)
- **24-hour messaging window:** Can only send unlimited messages within 24 hours of user's last message; clock resets on each user reply
- **7-day human agent window:** After 24h, human agents can still respond for up to 7 days using the HUMAN_AGENT message tag
- **Comment/Story triggers:** Limited to 1 automated message per user per 24-hour period
- **API:** Built on the Messenger Platform infrastructure (Instagram Graph API)

Sources:
- [LATAM Conversational Commerce Stats](https://www.aurorainbox.com/en/2026/03/04/ecommerce-statistics-whatsapp-latam/)
- [Instagram DM vs Email ROI](https://www.unkoa.com/instagram-dm-automation-vs-email-in-2025-why-manychat-delivers-90-open-rates-and-60-reply-rates/)
- [Instagram API Rate Limits](https://creatorflow.so/blog/instagram-api-rate-limits-explained/)
- [Instagram DM Automation Rules](https://www.spurnow.com/en/blogs/instagram-dm-automation-rules)
- [Social Media in LATAM](https://awisee.com/blog/social-media-platforms-in-latin-america/)
- [WhatsApp vs Instagram for Business](https://plugdialog.com/newsroom/whatsapp-vs-instagram-for-business-which-one-actually-drives-more-sales)

---

## 4. Email Channel in AI Agent Platforms

### How Competitors Handle Email AI

#### Intercom (Fin over Email)
- Fin processes email inquiries with the same intelligence as chat
- Can read messages, understand requests, send detailed responses, or route to humans
- Email threading is supported natively
- Chat features are stronger; email workflows described as "not as robust"
- Resolution rates averaging 41-51% across all channels

#### Zendesk (Advanced Email AI Agents)
- Email is a first-class AI agent channel (launched 2025)
- Supports "email conversation flows" where AI agent can handle multiple use cases before escalation
- Rich-text formatting automatically applied to AI-generated responses
- Configurable escalation: define how many use cases AI handles before handoff
- Uses `{{ticket.latest_comment_html}}` for HTML rendering in email templates
- Supports plain text and HTML email templates

#### Front
- AI-powered customer operations platform
- Email is the primary channel (Front was email-first)
- Centralizes email, chat, SMS, social media, and voice into shared workspace
- Strong email workflow automation

### Email Formatting Patterns

**HTML vs. Plain Text:**
- Most platforms default to HTML for email responses (richer formatting, brand consistency)
- AI-generated content is typically rendered within HTML email templates (branded headers, footers)
- Plain text fallbacks are always maintained for email clients that don't render HTML
- AI response content itself is typically generated as plain text or light markdown, then wrapped in HTML templates

**Threading Implementation:**
- **Message-ID:** Unique identifier per email; must be generated and tracked
- **In-Reply-To:** Set to the Message-ID of the email being replied to
- **References:** Chain of all Message-IDs in the thread
- **Subject line:** Must match (with `Re:` prefix) for proper client grouping
- Chatwoot's email conversation continuity: looks for conversations matching Referenced/In-Reply-To Message-IDs
- Critical for AI agents: every outbound email must carry proper threading headers or replies fork into new threads

**Email Inbound Processing Patterns:**
- **Webhook-based (recommended):** Services like CloudMailin, inbound.new, or SendGrid Inbound Parse convert incoming email to HTTP POST
- **IMAP polling:** Periodically check mailbox (higher latency, more complex)
- **EmailEngine:** Self-hosted, bridges IMAP/SMTP to REST API with webhooks
- **Provider APIs:** Gmail API, Microsoft Graph API for direct integration

### Email vs. Chat: AI Behavior Differences

| Dimension              | Email                                    | Chat (WhatsApp/Web/Instagram)            |
|------------------------|------------------------------------------|------------------------------------------|
| **Response time**      | Minutes to hours acceptable              | Seconds expected (<15s for AI, <2min total) |
| **Tone**               | More formal, structured                  | Conversational, casual                   |
| **Length**              | Longer, paragraph-based                  | Short messages, multiple exchanges       |
| **Format**             | HTML with branding / plain text          | Markdown-lite, emojis acceptable         |
| **Threading**          | Via email headers (In-Reply-To)          | Via session/conversation ID              |
| **Conversation model** | Asynchronous, batched                    | Real-time, streaming                     |
| **Customer expectation**| Complete answer in one response          | Iterative, can ask follow-ups            |
| **Greeting**           | Full salutation required                 | Optional, often just name                |
| **Sign-off**           | Professional closing expected            | Often omitted                            |

Sources:
- [Intercom Fin over Email](https://www.intercom.com/help/en/articles/9356221-deploy-fin-ai-agent-over-email)
- [Zendesk Email AI Agent Flows](https://support.zendesk.com/hc/en-us/articles/8357758805146-About-email-conversation-flows-for-advanced-AI-agents)
- [Chatwoot Email Conversation Continuity](https://developers.chatwoot.com/self-hosted/configuration/features/email-channel/conversation-continuity)
- [MailerSend Email Threading Guide](https://developers.mailersend.com/guides/creating-email-threads)
- [Intercom Email Threading](https://www.intercom.com/help/en/articles/7996715-email-threading)
- [EmailEngine](https://emailengine.app)
- [CloudMailin](https://www.cloudmailin.com/)
- [inbound.new](https://inbound.new/)

---

## 5. Channel Priority and ROI Analysis

### Channel Engagement Metrics

| Channel     | Open Rate   | Reply Rate  | CSAT Score | AI Resolution Rate | Response Time Expectation |
|-------------|-------------|-------------|------------|--------------------|--------------------------:|
| Email       | 20-25%      | 1-5%        | 74%        | 55-70%             | Minutes to hours          |
| SMS/RCS     | 90-98%      | 30-45%      | N/A        | N/A                | Minutes                   |
| WhatsApp    | 90%+        | 40-60%      | 86%        | 55-70%             | <2 minutes                |
| Instagram DM| 90%         | Up to 60%   | ~82%       | 50-65% (est.)      | <5 minutes                |
| Web Chat    | N/A         | N/A         | 82%        | 55-70%             | <15 seconds               |
| Voice       | N/A         | N/A         | 78%        | 30-50%             | Immediate                 |

### ROI by Channel

- **Email marketing ROI:** 3,600-3,800% ($36-38 per $1 spent); up to 7,000% for top performers
- **WhatsApp:** 5x higher response rates vs. email; 60-70% higher purchase likelihood after interaction
- **SMS:** 98% open rate, but per-message costs are higher
- **RCS:** 70% higher open rates and 10x higher response rates vs. SMS; 50% traffic growth in 2025

### Channel Cost Structure

| Channel     | AI Conversation Cost | Platform Cost              | Notes                                     |
|-------------|---------------------|----------------------------|--------------------------------------------|
| Email       | ~$0 channel fee      | SMTP/IMAP costs minimal   | Highest ROI but lowest engagement           |
| WhatsApp    | Per-message (template)| $0.025/conversation        | Free within 24h service window              |
| Instagram   | Free                 | No per-message fee         | API rate limit constrains volume (200/hr)   |
| Messenger   | Free                 | Marketing msgs now paid    | Bidding system like ads for marketing msgs  |
| Web Chat    | Free                 | No per-message fee         | WebSocket infrastructure cost only          |
| SMS         | $0.005-0.05/msg      | Per-message pricing        | Highest per-unit cost                       |
| AI resolution| $0.50-6.00/resolution| Intercom charges $0.99/res | Usage-based pricing emerging                |

### Channel Strategy by Market

| Market | Primary Channels           | Secondary Channels       | Emerging                |
|--------|----------------------------|--------------------------|-------------------------|
| LATAM  | WhatsApp (72%), Instagram DM (15%) | Messenger (8%)     | Telegram (Gen Z Brazil) |
| USA    | SMS, Email                 | WhatsApp (50% Gen Z), Instagram | RCS                |
| Europe | WhatsApp (varies by country), Email | SMS              | RCS (40% YoY growth)   |

### Recommendation for Kiln/Kilvo

**Phase 6 priority order:**
1. **Instagram DM** -- Highest strategic value for LATAM (15% of conversational commerce). Same Meta API infrastructure as WhatsApp (reduces implementation effort). Critical for Kilvo's SMB target market.
2. **Facebook Messenger** -- Shares Instagram's API infrastructure. 8% of LATAM conversational commerce. Table stakes.
3. **Email** -- Highest ROI channel globally. Required for USA market penetration. Different architectural pattern (async vs. real-time).

Sources:
- [Email Marketing ROI Statistics](https://www.emailmonday.com/email-marketing-roi-statistics/)
- [WhatsApp Customer Service Stats](https://www.aurorainbox.com/en/2026/03/02/whatsapp-customer-service-statistics/)
- [RCS Statistics](https://messageflow.com/blog/rcs-statistics/)
- [Channel Selection by Region (Sinch)](https://sinch.com/blog/communication-channels-by-region/)
- [Infobip Messaging Trends Regional](https://www.infobip.com/messaging-trends-report/regional-snapshot)
- [Business Messaging Adoption Surged 53%](https://www.globenewswire.com/news-release/2025/10/07/3162621/0/en/Business-Messaging-Adoption-Surged-53-in-2025-Respond-io-Report-Finds.html)

---

## 6. Emerging Channels (Beyond Phase 6)

### RCS (Rich Communication Services)

- **Status:** Moving from "inflection era" to "rapid growth era" in 2026
- **Adoption:** Traffic grew 50% in 2025; adoption increased ~30x over past two years
- **Device support:** Android + iPhones with iOS 18+ (peer-to-peer); business messaging protocols still being built out by US carriers
- **Performance:** 70% higher open rates and 10x higher response rates vs. SMS
- **API:** Google's RCS Business Messaging API; top providers include Sinch, Infobip, Bandwidth
- **Recommendation:** Monitor closely. Add when US carrier adoption reaches critical mass (likely late 2026/2027). High strategic value as SMS replacement.

### Apple Messages for Business

- **Status:** Active, but restrictive requirements
- **Key constraints:** Requires approved MSP (Messaging Service Provider); Apple reviews integration twice before launch; only customers can initiate conversations; deleted threads cannot be resumed
- **API:** REST API limited to approved MSPs
- **Recommendation:** Low priority for Kiln as a framework. Better suited as a specific tenant integration if a Kilvo customer requires it.

### Google Business Messages

- **Status:** SUNSET. Fully discontinued July 31, 2024.
- **Recommendation:** Do not implement. Dead channel.

### Telegram Bot API

- **Status:** Thriving. 1 billion MAU (March 2025); 500 million DAU by 2026
- **Market:** Strong in Eastern Europe, Central Asia, and Gen Z Brazil (45% YoY growth)
- **Business usage:** 1.2 billion bot interactions/month; 27% of e-commerce businesses use bots
- **Cost advantage:** Free messaging (no per-message fees unlike WhatsApp)
- **API:** Mature, well-documented Bot API; no MSP requirement
- **Recommendation:** HIGH PRIORITY for Phase 7. Easy to implement (simple HTTP API), free messaging, growing in LATAM Gen Z.

### LINE

- **Market:** Dominant in Japan, Taiwan, Thailand, Indonesia
- **Relevance to Kilvo:** Low (LATAM + USA focus)
- **Recommendation:** Only implement if specific customer demand arises

### WeChat

- **Market:** 1.2 billion users; 83% of China's population
- **International API:** Only WeChat Service Account (International Version) available; Subscription Accounts restricted to mainland China
- **Recommendation:** Not relevant for LATAM/USA markets. Defer indefinitely.

### Discord

- **Status:** Intercom Fin supports Discord natively (threaded, formatted replies)
- **Market:** Gaming, developer communities, crypto; emerging for B2B tech support
- **Recommendation:** Interesting for B2B use cases. Consider for Phase 8+ if demand emerges.

### TikTok DMs

- **Status:** Chatfuel and ManyChat support it
- **Market:** Growing for Gen Z commerce
- **Recommendation:** Monitor. API access may be restrictive.

### Phase Roadmap Suggestion

| Phase | Channels                          | Rationale                              |
|-------|-----------------------------------|----------------------------------------|
| 6     | Instagram DM, Messenger, Email    | Table stakes + LATAM market need       |
| 7     | Telegram, SMS (via Twilio/Vonage) | Free channel + USA market reach        |
| 8     | RCS, TikTok DMs                   | Emerging high-engagement channels      |
| 9+    | Voice, Discord, LINE              | Niche/enterprise demand-driven         |

Sources:
- [RCS Adoption (Bandwidth)](https://www.bandwidth.com/blog/state-of-rcs-business-messaging-features/)
- [Apple Messages for Business (Zendesk Guide)](https://www.zendesk.com/service/messaging/apple-messages-for-business/)
- [Google Business Messages Sunset](https://developers.google.com/business-communications/business-messages/resources/release-notes/update-on-gbm)
- [Telegram Statistics](https://sqmagazine.co.uk/telegram-statistics/)
- [Telegram for Business (Sinch)](https://sinch.com/blog/telegram-bot-for-business/)

---

## 7. Channel-Specific AI Response Quality

### Response Formatting Constraints

| Channel     | Max Length           | Format Support        | Rich Media            | Interactive Elements    |
|-------------|----------------------|-----------------------|-----------------------|------------------------:|
| WhatsApp    | 4,096 chars/msg      | Bold, italic, mono    | Images, video, audio  | Buttons (3), lists (10) |
| Instagram DM| 1,000 chars/msg      | No formatting         | Images, video, audio  | Quick replies (13)      |
| Messenger   | 2,000 chars/msg      | No formatting         | Images, video, audio  | Buttons, carousels      |
| Email       | Unlimited            | HTML, plain text      | Inline images, attachments | Links, CTA buttons  |
| Web Chat    | Unlimited            | Markdown              | Images, video, audio  | Custom components       |
| Slack       | 40,000 chars/msg     | Slack mrkdwn          | Images, files         | Block Kit               |
| SMS         | 160/segment          | None                  | MMS for media         | None                    |

### Channel-Specific System Prompt Adjustments

Based on competitor analysis, effective AI agents modify behavior per channel:

**WhatsApp/Instagram/Messenger:**
- Short paragraphs with line breaks
- Avoid walls of text
- Use lists sparingly
- Conversational, friendly tone
- Quick resolution focus
- Response within seconds

**Email:**
- Full greetings and professional sign-offs
- Structured with paragraphs and headers
- Complete answer in one response (customer may not check again for hours)
- Formal but warm tone
- Include relevant links and reference numbers

**Slack:**
- Can be more technical
- Use code blocks for technical content
- Thread-aware responses
- More casual than email, less casual than WhatsApp

### Competitor Approaches to Per-Channel Tone

- **Intercom Fin:** Same AI model across all channels; formatting is channel-native but tone is uniform
- **Zendesk:** Allows different AI agent configurations per channel type
- **Respond.io:** Single response template with per-channel formatting rules
- **Best practice:** A messaging style guide that defines brand voice, then per-channel formatting rules layered on top. The same "brand personality" but different "registers."

### Recommendation for Kiln

Kiln should support per-channel system prompt modifiers in the App YAML or tenant config:
```yaml
channels:
  whatsapp:
    systemPromptSuffix: "Keep responses under 200 words. Use short paragraphs. Be conversational."
  email:
    systemPromptSuffix: "Use professional email format with greeting and sign-off. Be comprehensive."
  instagram:
    systemPromptSuffix: "Keep responses under 150 words. Be casual and friendly. Use line breaks."
```

Sources:
- [WhatsApp Customer Service Stats](https://www.aurorainbox.com/en/2026/03/02/whatsapp-customer-service-statistics/)
- [Customer Messaging Style Guide (Staffono)](https://www.staffono.ai/blog/messaging/customer-messaging-style-guide-voice-tone-and-templates-that-scale)
- [Intercom Fin 3 Channels](https://www.intercom.com/blog/whats-new-with-fin-3/)

---

## 8. Unified Inbox Patterns

### Architecture Components

From analysis of Chatwoot, Front, Crisp, Respond.io, and Bird:

**1. Contact Deduplication:**
- Single contact profile per customer, even across channels
- Identification via: phone number, email address, or manual agent merge
- Chatwoot: "If that same customer writes through another channel, identified by phone number or name, conversations are unified under the same profile"
- Bird: "Each customer has a single contact ID, keeping communication consistent no matter which channel they use"

**2. Conversation Threading:**
- Each channel creates a separate conversation thread
- Threads linked to the same contact profile
- Agent sees all threads from all channels in the contact's profile
- Some platforms support thread merging (manual or automatic)

**3. Assignment and Routing:**
- Incoming messages auto-assigned to the agent who previously served that customer
- Channel-aware routing: email routed to email team, WhatsApp to chat team (optional)
- Skills-based routing: language, topic, expertise

**4. Channel Indicators:**
- Each message in the unified inbox shows its source channel (icon/badge)
- Agents can see at a glance if the customer is on WhatsApp, Instagram, or email

**5. Analytics Aggregation:**
- Cross-channel metrics: total conversations, resolution time, CSAT
- Per-channel breakdown: volume, response time, resolution rate
- Contact-level journey: which channels did this customer use?

### Chatwoot's Polymorphic Channel Architecture (Reference Implementation)

Chatwoot uses a well-documented pattern worth studying:

- Single `Inbox` model acts as container for different channel types
- Each channel type has its own table (`channel_email`, `channel_whatsapp`) with channel-specific config (API keys, OAuth tokens)
- Pluggable adapters for inbound parsing and outbound formatting
- `SendReplyJob` coordinates outbound delivery through channel-specific adapters
- 63 service objects with uniform `perform` / `perform_reply` interface

### Relevance to Kiln

Kiln's current architecture has:
- `Channel` interface in `engine/domain/channel.ts` (receive/send/stream)
- Separate channel adapters in `runtime/src/channels/`
- `SessionRegistry` for session management
- `TenantRegistry` for tenant config

What's missing for full unified inbox:
- **Contact identity layer:** No concept of a "contact" that spans channels/sessions
- **Cross-channel session linking:** Same person on WhatsApp and Instagram = separate sessions
- **Contact merge/dedup API:** No way to unify contacts
- **Channel indicator metadata:** Sessions don't carry source channel info prominently

These are optional for Phase 6 (channel adapters work without them) but required for Kilvo's unified inbox experience.

Sources:
- [Chatwoot Channel Architecture (DeepWiki)](https://deepwiki.com/chatwoot/chatwoot/3.5-inboxes-and-channels)
- [Front Omnichannel Inbox](https://front.com/product/omnichannel-inbox)
- [Crisp Shared Inbox](https://crisp.chat/en/shared-inbox/)
- [Bird Conversations API](https://docs.bird.com/api/conversations-api/api-reference/conversations-messaging)
- [Respond.io Omnichannel](https://respond.io/blog/omnichannel-support)

---

## 9. Academic Research on Multi-Channel AI

### Key Findings

**"The Role of AI Enabled Chatbots in Omnichannel Customer Service" (Ghosh, Ness, Salunkhe, 2024)**
- Published in Journal of Engineering Research and Reports, Vol. 26, No. 6, pp. 327-345
- AI chatbots have "revolutionary influence" on customer experience management
- Emphasizes the gap between multi-channel (siloed) and omnichannel (integrated) implementations

**Channel Switching Behavior Research (2022-2025)**
- Factors driving channel switching: service quality, price, convenience, and perceived risk
- Customers switch channels to reduce uncertainty (Springer, 2025)
- Push effects (low empathy, low adaptability) and pull effects (connectivity, personalization) drive switching
- 59% of surveyed consumers use both mobile app and mobile website for purchases
- **Key insight for AI agents:** Customers switch channels when they feel the current channel cannot resolve their issue. AI agents that detect unresolvable queries and proactively offer channel alternatives will have higher CSAT.

**Market Size and Adoption:**
- AI for customer service market: $12.06B (2024) -> $47.82B (2030), CAGR 25.8%
- 80% of customer service teams used AI chatbots in 2025 (up from 5% in 2020)
- Gartner projects 80% of routine interactions fully handled by AI by 2026
- Only 13% of businesses successfully carry customer context across all channels
- Only 33% of companies offer fully integrated omnichannel support

**Implication:** There is a massive market opportunity for platforms that actually deliver true omnichannel AI with context continuity. Most platforms claim omnichannel but fail at cross-channel context preservation.

Sources:
- [AI Chatbots in Omnichannel CS (ResearchGate)](https://www.researchgate.net/publication/381096092_The_Role_of_AI_Enabled_Chatbots_in_Omnichannel_Customer_Service)
- [Channel Switching Behavior (Springer)](https://link.springer.com/article/10.1007/s12525-025-00794-8)
- [AI in Customer Service Market Report](https://www.globenewswire.com/news-release/2025/03/07/3038782/28124/en/AI-in-Customer-Service-Market-Report-2025-2030.html)
- [Customer Support Statistics (Pylon)](https://www.usepylon.com/blog/50-customer-support-statistics-trends-for-2025)

---

## 10. Open Source Multi-Channel Frameworks

### Chatwoot (Ruby on Rails)

- **GitHub:** 23k+ stars, very active
- **Channels:** 13+ (WhatsApp, Instagram, Messenger, Email, SMS, Telegram, LINE, web chat, Slack, Twitter, API)
- **Architecture:** Polymorphic `Inbox` -> channel-specific tables. Pluggable adapters with uniform `perform`/`perform_reply` interface. Rails services pattern.
- **Key lesson:** The polymorphic inbox pattern is battle-tested. Each channel adapter handles its own webhook verification, message parsing, and outbound formatting independently.
- **Weakness:** Ruby/Rails stack. No built-in AI orchestration (requires separate chatbot integration via bridge).
- **What Kiln can learn:** Clean separation between inbox (the container) and channel (the adapter). Each channel adapter is self-contained with its own config table.

### Botpress (TypeScript/JavaScript)

- **GitHub:** 13k+ stars
- **Channels:** Messenger, Telegram, Slack, Teams, web chat (via built-in connectors)
- **Architecture:** Modular plugin system. Each channel is a module with `definition.ts` and `src/index.ts`. Connectors handle formatting quirks per channel.
- **Key lesson:** Same bot logic runs everywhere; connectors handle channel-specific formatting. Agent Router (2025) enables multi-agent coordination.
- **Weakness:** Acquired by Workday in 2025 -- open-source future uncertain.
- **What Kiln can learn:** The connector pattern (definition + implementation) maps well to Kiln's existing channel adapter interface.

### Rasa (Python)

- **Channels:** Custom connector architecture with `InputChannel` + `OutputChannel` pattern
- **Architecture:** Each connector subclasses `InputChannel`, implements `blueprint()` and `name()`. Blueprint creates routes for `/` (health) and `/webhook` (receive).
- **Key lesson:** The InputChannel/OutputChannel separation is clean and maps to Kiln's existing Channel interface (receive/send/stream).
- **2025 update:** CALM architecture (Conversational AI with Language Models) combines LLM flexibility with enterprise reliability.
- **What Kiln can learn:** The health check + webhook route pattern per channel. Also, the concept of a "name" method that defines the URL prefix for the channel's routes.

### LangBot (TypeScript)

- **Channels:** 10+ IM platforms (QQ, WeChat, Discord, Telegram, Slack, LINE, Lark, DingTalk)
- **Asia-focused:** Strong coverage of Asian messaging platforms
- **What Kiln can learn:** If expanding to Asian markets, LangBot's channel adapter patterns for LINE, WeChat, and DingTalk are reference implementations.

### Pattern Summary

All open-source frameworks converge on the same architecture:

```
IncomingMessage -> ChannelAdapter.parse() -> NormalizedMessage -> AI/Bot Logic -> NormalizedResponse -> ChannelAdapter.format() -> OutgoingMessage
```

This is exactly what Kiln already does with `Channel.receive()` / `Channel.send()`. The frameworks validate Kiln's existing design.

Sources:
- [Chatwoot GitHub](https://github.com/chatwoot/chatwoot)
- [Chatwoot Architecture (DeepWiki)](https://deepwiki.com/chatwoot/chatwoot/3.5-inboxes-and-channels)
- [Botpress GitHub](https://github.com/botpress/botpress)
- [Rasa Custom Connectors](https://rasa.com/docs/reference/channels/custom-connectors/)
- [Open Source Chatbot Frameworks (Dev.to)](https://dev.to/chattermate/the-top-10-open-source-chatbot-frameworks-of-2025-9jd)

---

## Summary: Strategic Recommendations for Phase 6

### 1. Implementation Priority
Instagram DM > Facebook Messenger > Email. Instagram and Messenger share Meta's API infrastructure, so implementing them together is efficient. Email is architecturally different (async, threading, HTML) and deserves its own focused effort.

### 2. Instagram + Messenger Share Infrastructure
Both are built on Meta's Messenger Platform. The Instagram DM API is built on the "robust infrastructure of the Messenger Platform." This means a single Meta channel adapter with Instagram/Messenger variants is the right architecture.

### 3. Email Requires Async Session Model
Unlike all existing Kiln channels (real-time), email is inherently async. Sessions may span hours or days. The session model needs to support:
- Long-lived sessions (no timeout on email threads)
- Email header tracking (Message-ID, In-Reply-To, References)
- HTML template wrapping for outbound messages
- Per-channel system prompt modifiers (formal tone)

### 4. 200 DMs/Hour Rate Limit is Real
Instagram's 200 DMs/hour limit is severe. Kiln's existing `SlidingWindowRateLimiter` should be wired into the Instagram channel adapter. Consider queuing mechanisms for high-volume tenants.

### 5. Contact Identity is the Next Big Gap
After Phase 6, Kiln will have 8 channels but no way to identify that the same person is messaging on WhatsApp and Instagram. This is the foundation for true omnichannel. Consider introducing a `Contact` entity in Phase 7 or as a cross-cutting concern.

### 6. Per-Channel System Prompt Modifiers
Every competitor adapts AI tone per channel. Kiln should support this via tenant config or app YAML, not hardcoded per adapter.

### 7. Kiln's Competitive Position Post-Phase 6
After Phase 6, Kiln will be the only open-source AI orchestration engine with:
- WhatsApp + Instagram DM + Messenger + Email + Web (WS) + Slack + CLI + API
- Multi-tenant isolation
- Agentic tool execution
- Knowledge retrieval (RAG)
- Safety pipeline
This positions Kiln ahead of Chatwoot (no AI orchestration) and Botpress (uncertain open-source future) in the open-source space.
