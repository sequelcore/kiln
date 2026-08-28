# Kiln Examples

These examples show the current source runtime: application declarations,
gateway bindings, tenant isolation, strict MCP `2026-07-28` tools, safety policy, triggers, and
embeddable surfaces.

Run them from a source checkout. There is no supported package release for the
current repository state, and the project and package names are provisional.

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
| [configs](configs/) | Operator config | V4 target intent and managed evidence, routing, managed agents, authority profiles, skills, work governance, and voice policy |
| [operator-routing-profile](operator-routing-profile.md) | Sanitized Kiln development team | Explicit targets and agents, independent authority, strict project scope, native ingress aliases, and operational checks |

## Run From Source

From the repository root:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

Then enter an example directory and run its start script:

```bash
cd docs/examples/hello-agent
bun run start
```

The examples default to `codex-oauth`, backed by a local Codex OAuth credential
pool. From the repository root, sign in before running provider-backed examples:

```bash
bun packages/cli/src/index.ts auth codex login
bun packages/cli/src/index.ts auth codex status
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
- Current examples use workspace packages from this repository. Do not rewrite
  them as package-install examples until a future release and package names are
  verified.
