<p align="center">
  <img src="https://raw.githubusercontent.com/sequelcore/kiln/main/docs/assets/logo.svg" alt="Kiln" width="100" />
</p>

<h1 align="center">@kilnai/widget</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@kilnai/widget"><img src="https://img.shields.io/npm/v/@kilnai/widget.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache-2.0" /></a>
</p>

<p align="center">Embeddable AI chat widget. One script tag, zero dependencies.</p>

---

## What is this?

`@kilnai/widget` adds a chat widget to any website that connects to a [Kiln](https://github.com/sequelcore/kiln) gateway via WebSocket. Built with Shadow DOM for style isolation, auto-reconnects on disconnect, and has zero runtime dependencies.

## Install

### Script tag (recommended)

Pin an exact published version; do not use a moving dist-tag for production
embeds.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@kilnai/widget@<published-version>/dist/widget.iife.js"
  data-gateway="wss://your-gateway.example.com"
  data-app="your-app"
  data-widget-id="your-widget-id"
  async>
</script>
```

That's it. The widget renders a floating chat button in the bottom-right corner.

### npm

```bash
bun add @kilnai/widget
```

```typescript
import { KilnWidget } from "@kilnai/widget";

const widget = new KilnWidget({
  gatewayUrl: "wss://your-gateway.example.com",
  appName: "your-app",
  widgetId: "your-widget-id",
});
```

Construction mounts the widget into `document.body`.

## Configuration

All options can be set via `data-*` attributes on the script tag or passed to the constructor:

| Attribute | Description | Default |
|-----------|-------------|---------|
| `data-gateway` | Gateway WebSocket URL | Required |
| `data-app` | Kiln app name | Required |
| `data-widget-id` | Widget/tenant ID | Required |
| `data-position` | `bottom-right` or `bottom-left` | `bottom-right` |
| `data-theme` | `light` or `dark` | `dark` |
| `data-greeting` | Welcome message (overrides tenant config) | From tenant |
| `data-placeholder` | Input placeholder text | `Type a message...` |
| `data-logo` | Optional header logo URL | Not shown |
| `data-logo-alt` | Accessible text for `data-logo` | App name |

## Features

- **Shadow DOM** -- Styles are fully isolated from the host page
- **Auto-reconnect** -- Reconnects automatically on network interruptions
- **Welcome frame** -- Shows greeting message and FAQ suggestion chips from tenant config
- **Suggestion chips** -- AI-generated follow-up suggestions after each response
- **Multi-tenant** -- Resolves tenant config via `widgetId` for per-business customization
- **Zero dependencies** -- Single IIFE bundle, no React or framework required
- **Budget-aware** -- Shows friendly message when tenant token budget is exhausted

## How it works

```text
Website (your-site.com)
  │ script tag loads widget.iife.js
  │ Shadow DOM renders chat UI
  │ WebSocket connects to gateway
  ▼
Kiln Gateway
  │ Resolves tenant by widgetId
  │ Injects tenant system prompt (name, services, FAQs)
  │ Routes to Kiln app
  ▼
AI Agent responds with text and suggestion chips
```

## Documentation

- [Widget Guide](https://github.com/sequelcore/kiln/blob/main/docs/guides/channels.md)
- [Multi-Tenant Guide](https://github.com/sequelcore/kiln/blob/main/docs/guides/multi-tenant.md)
- [Booking Assistant Example](https://github.com/sequelcore/kiln/tree/main/docs/examples/booking-assistant) -- Working demo with widget

## License

[Apache-2.0](https://github.com/sequelcore/kiln/blob/main/LICENSE)
