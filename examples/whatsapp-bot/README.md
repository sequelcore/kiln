# WhatsApp Business Bot

A complete WhatsApp chatbot for a small business, built with Kiln in under 50 lines of config.

The bot answers questions about services, prices, and hours. It remembers returning customers across conversations (persistent SQLite memory) and notifies the business owner via WhatsApp when a customer wants to book an appointment.

## What this demonstrates

- **Multi-tenant gateway** -- one process serves multiple businesses
- **WhatsApp channel** -- Meta Business API webhook integration
- **Persistent memory** -- SQLite + FTS5, per-tenant, auto-created
- **Builtin tools** -- `notify_owner` sends a real WhatsApp message to the owner
- **Structured tenant config** -- services, prices, hours, FAQs injected into the agent prompt

## Prerequisites

- [Bun](https://bun.sh) 1.1+
- Anthropic API key (`ANTHROPIC_API_KEY`)
- Meta Developer account with a WhatsApp Business app ([setup guide](../../docs/guides/channels.md))
- [ngrok](https://ngrok.com) (for local development)

## Quick Start

### 1. Install

```bash
cd examples/whatsapp-bot
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Create your tenant

Copy the example tenant and customize it for your business:

```bash
mkdir -p ~/.kiln/gateway/my-shop/tenants
cp tenant-example.json ~/.kiln/gateway/my-shop/tenants/my-business.json
# Edit the JSON with your business info, services, prices, hours
```

Set `whatsappPhoneNumberId` to your Meta phone number ID and `whatsappAccessToken` to the env var name holding your token.

### 4. Start the gateway

```bash
bun run dev
```

### 5. Expose via ngrok

```bash
ngrok http 3800
```

### 6. Configure Meta webhook

In Meta Developer Console → WhatsApp → Configuration:
- **Callback URL:** `https://<ngrok-host>/whatsapp/my-shop/webhook`
- **Verify Token:** the value of `MY_WHATSAPP_WEBHOOK_SECRET` in your `.env`
- **Subscribe to:** `messages`

Send a message to the test number -- the bot replies.

## Project Structure

```
whatsapp-bot/
├── server.ts            # Entry point (3 lines)
├── gateway.yaml         # Gateway config
├── apps/
│   └── my-shop/
│       └── app.yaml     # Agent definition (model, memory, team)
├── tenant-example.json  # Example tenant config (copy to ~/.kiln/gateway/)
├── .env.example         # Required environment variables
└── package.json
```

## How it works

1. Customer sends a WhatsApp message
2. Meta POSTs the webhook to your gateway
3. Gateway resolves the tenant by `phone_number_id`
4. `buildTenantSystemPrompt()` assembles the prompt from tenant JSON (persona + services + hours + FAQs)
5. SQLite memory store recalls past conversations with this customer
6. Claude generates a response (with access to `notify_owner` tool)
7. If the customer books an appointment, Claude calls `notify_owner` → owner gets a WhatsApp message
8. Response is sent back to the customer via Meta Cloud API
9. The exchange is saved to memory for future recall

## Customizing

**Change the model:** Edit `provider.model` in `apps/my-shop/app.yaml`. Default is `claude-haiku-4-5-20251001` (fast, cheap). Use `claude-sonnet-4-5-20250514` for higher quality.

**Add more businesses:** Create another tenant JSON in `~/.kiln/gateway/my-shop/tenants/`. Each tenant gets its own memory database, system prompt, and WhatsApp credentials. One gateway process serves all of them.

**Disable memory:** Remove the `memory:` block from `app.yaml`. The bot still works but won't remember past conversations.

**Disable owner notifications:** Remove `escalationContact` from the tenant JSON. The bot will still capture appointment details but won't notify anyone.
