# Incident Triage

Operations triage with API access, runbooks, and auditable MCP mutations.

This example models an internal operator assistant. It can inspect mock service
status, read runbooks, open incident records, and append timeline notes through
declared MCP tools. It uses `codex-oauth` by default.

## What This Demonstrates

- **Operational tool authority** -- read-only status/runbook tools plus destructive incident mutations
- **API channel** -- programmatic incident triage through an HTTP path
- **Safety rails** -- blocks credential disclosure and unsafe destructive-shell requests
- **Governed memory** -- per-operator context is retained across incident turns
- **Runbook discipline** -- the assistant is instructed to inspect status and runbooks before escalation

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- Codex OAuth credentials (`kiln auth codex login`)

## Quick Start

```bash
cd ../../.. && bun install && cd docs/examples/incident-triage
kiln auth codex status
bun run start
```

Open `index.html` in your browser.

## Try

- "Gateway latency is high, triage it"
- "Open a sev2 for memory index lag"
- "What should I check before escalating billing?"

## Project Structure

```text
incident-triage/
  app.yaml         # Provider, safety, MCP tools, teams, capabilities
  gateway.yaml     # Web and API channel bindings
  server.ts        # Starts MCP tools, then gateway
  tools-server.ts  # MCP server for service status, runbooks, incidents
  mock-ops.ts      # Mock service catalog and incident store
  index.html       # Browser WebSocket client
```

## API Channel

```bash
curl -X POST http://localhost:3000/api/incident-triage/message \
  -H "Content-Type: application/json" \
  -d '{"message":"Triage gateway latency and open a sev2 if needed","userId":"ops-api"}'
```

## Production Notes

- Replace `mock-ops.ts` with service health, runbook, and incident-system adapters.
- Keep destructive tools explicit and audited.
- Add channel authentication before exposing the API outside a trusted network.
