# Kiln Examples

These examples show Kiln's current 2.1 package line from the deployable
runtime side: app declarations, gateway bindings, tenant isolation, MCP tools,
safety policy, triggers, and embeddable surfaces.

The examples can be run from source while developing the repository, or adapted
to the published `@kilnai/*@2.1.0` package line.

## Example Map

| Example | Focus | Demonstrates |
|---|---|---|
| [hello-agent](hello-agent/) | Smallest gateway app | App YAML, gateway binding, web channel, governed session path |
| [support-agent](support-agent/) | Tool-using support flow | MCP tools, PII redaction, topic rails, tool authority |
| [booking-assistant](booking-assistant/) | Tenant-aware booking flow | Multi-tenant widget, MCP tools, billing hooks, webhook trigger |
| [multi-app-gateway](multi-app-gateway/) | Multi-app hosting | App isolation, tenant provisioning, web/API channels, Docker shape |
| [whatsapp-bot](whatsapp-bot/) | WhatsApp channel | Meta webhook, tenant resolution, governed memory, owner escalation |
| [research-brief](research-brief/) | Evidence-backed research | Source-grounded MCP tools, citations, saved briefs, API channel |
| [incident-triage](incident-triage/) | Internal operations triage | Runbooks, service status, incident mutations, API channel |
| [configs](configs/) | Operator config | Global routing, managed agents, skills, work-governance policy, app voice policy, and local operator voice policy |
| [operator-routing-profile](operator-routing-profile.md) | Personal Kiln development routing | Codex OAuth primary route, OpenCode Go specialists, task suitability, effort policy, and permission-integrity evidence |

## Run From Source

From the repository root:

```bash
bun install
bun run typecheck
bun run test
bun run build
```

Then enter an example directory and run its start script:

```bash
cd docs/examples/hello-agent
bun run start
```

The examples default to `codex-oauth`, backed by the local ChatGPT Plus OAuth
credential pool. Sign in once before running provider-backed examples:

```bash
kiln auth codex login
kiln auth codex status
```

Example `.env.example` files list only non-provider variables, such as webhook
secrets or demo gateway secrets.

## Current Boundaries

- App and gateway YAML are runtime wiring examples, not Kiln's architecture
  source of truth.
- GUI, TUI, CLI, native, and gateway integrations are operator surfaces over
  shared runtime contracts.
- Tenant files in these examples are demo data. Do not put production secrets in
  tenant JSON or committed YAML.
- Published npm package examples should target `@kilnai/*@2.1.0`. Source
  development should use workspace packages from this repository.
