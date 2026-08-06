# WhatsApp Business Bot

A WhatsApp channel example for a small business.

The bot answers questions about services, prices, and hours. It uses
tenant-scoped governed memory and can notify the business owner through the
WhatsApp channel when a customer wants to book an appointment.

## What this demonstrates

- **Multi-tenant gateway** -- one process serves multiple businesses
- **WhatsApp channel** -- Meta Business API webhook integration
- **Governed memory** -- per-tenant memory, auto-created by the gateway
- **Builtin tools** -- `notify_owner` sends a real WhatsApp message to the owner
- **Structured tenant config** -- services, prices, hours, FAQs injected into the agent prompt

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- Codex OAuth credentials (`kiln auth codex login`)
- Meta Developer account with a WhatsApp Business app ([setup guide](../../guides/channels/channels.md))
- [ngrok](https://ngrok.com) (for local development)

## Quick Start

### 1. Install

```bash
cd docs/examples/whatsapp-bot
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your WhatsApp webhook secret, access token, and public media URL settings
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

Set `GATEWAY_PUBLIC_URL` in `.env` to the HTTPS ngrok origin. Kiln uses that
origin to generate short-lived signed media URLs when WhatsApp voice output is
enabled.

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
5. Governed tenant memory recalls past conversations with this customer
6. The provider adapter generates a response with access to `notify_owner`
7. If the customer books an appointment, the model calls `notify_owner` and the owner gets a WhatsApp message
8. Response is sent back to the customer via Meta Cloud API
9. If voice output is enabled for WhatsApp, synthesized audio is exposed through
   a signed gateway media URL and sent as a WhatsApp `audio.link`
10. The exchange is saved to memory for future recall

## Customizing

**Change the model:** Edit `provider.model` in `apps/my-shop/app.yaml`. Use a
model from the current model-routing guide or the provider discovery surface.

**Add more businesses:** Create another tenant JSON in `~/.kiln/gateway/my-shop/tenants/`. Each tenant gets isolated governed memory, its own system prompt, and WhatsApp credentials. One gateway process serves all of them.

**Disable memory:** Remove the `memory:` block from `app.yaml`. The bot still works but won't remember past conversations.

**Disable owner notifications:** Remove `escalationContact` from the tenant JSON. The bot will still capture appointment details but won't notify anyone.
