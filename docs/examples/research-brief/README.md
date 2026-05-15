# Research Brief

Evidence-backed brief generation with MCP source tools.

This example shows a governed research surface that can search a local source
catalog, read source records, and save a generated brief draft. It uses
`codex-oauth` as the provider and does not require external search credentials.

## What This Demonstrates

- **Source-grounded tool use** -- the assistant must use declared MCP tools for factual claims
- **Read-only vs destructive authority** -- source reads are read-only; saving a brief is destructive
- **Safety rails** -- configured blocking for credential and private-data requests
- **Web and API channels** -- one app can expose browser and HTTP integration paths
- **Governed memory** -- user-scoped research context persists across turns

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- Codex OAuth credentials (`kiln auth codex login`)

## Quick Start

```bash
cd ../../.. && bun install && cd docs/examples/research-brief
kiln auth codex status
bun run start
```

Open `index.html` in your browser and ask for a brief.

## Try

- "Create a brief about tool authority"
- "Summarize tenant memory isolation with citations"
- "Save a short brief about runtime surfaces"

## Project Structure

```text
research-brief/
  app.yaml          # Provider, safety, MCP tools, teams, capabilities
  gateway.yaml      # Web and API channel bindings
  server.ts         # Starts MCP tools, then gateway
  tools-server.ts   # MCP server for source search/read/save
  mock-sources.ts   # Local source catalog and saved brief store
  index.html        # Browser WebSocket client
```

## API Channel

The gateway also exposes an API path:

```bash
curl -X POST http://localhost:3000/api/research-brief/message \
  -H "Content-Type: application/json" \
  -d '{"message":"Create a cited brief about tool authority","userId":"api-user"}'
```

## Next Steps

- Replace `mock-sources.ts` with a database or governed search provider.
- Add approval before `save_brief` when briefs should be reviewed before storage.
- Add tenant resolution if multiple workspaces need isolated research catalogs.
