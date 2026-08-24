# ADR-009: Canonical MCP Ownership And Execution

## Status

Accepted

## Context

Kiln has three incomplete MCP paths: a global/project YAML declaration, an
HTTP-only App Gateway client, and an unmanaged native-config generator. Native
Claude Code and OpenCode wrappers also accept partial runtime MCP input, but
normal Kiln sessions do not provide the canonical YAML definitions. The paths
use different configuration shapes, lack provenance and health evidence, and
cannot prove equivalent authorization.

MCP servers control capability descriptions, schemas, annotations, resource
content, prompt content, initialization instructions, and later catalog
changes. These values are untrusted. Native harnesses also differ in transport
shape, merge precedence, project trust, timeout, authentication, lifecycle, and
tool-permission support. A native file therefore cannot be Kiln's source of
truth, and native compatibility cannot define Kiln runtime authority.

## Decision

Kiln owns one canonical MCP bounded context with these boundaries:

- Global `~/.kiln/config.yaml` and the bound private project's `config.yaml`
  are the only durable server-definition authorities. Effective servers retain
  scope and per-field provenance.
- Project definitions may add, inherit, narrow, override permitted fields, or
  disable a global identity. A transport change is a complete replacement;
  an incomplete cross-transport override is rejected.
- Canonical transports are stdio and MCP Streamable HTTP. Legacy HTTP+SSE,
  WebSocket, sampling, elicitation, server-driven roots, and experimental tasks
  are unsupported until separate authority and lifecycle decisions exist.
- Stdio commands and arguments remain arrays at every boundary. Environment,
  header, and authentication secrets use references; committed project config
  cannot contain secret values.
- Every external capability has a server-qualified selector. Discovery and
  admission are separate states. Tool annotations are preserved only as
  untrusted interoperability hints.
- Admitted tools execute as Kiln `DevTool` adapters through canonical effect
  envelopes, invocation-time resolution, authorization, approval, audit, and
  transcript events. Model selection never grants authority. Direct-provider
  execution is independent of native harness configuration.
- Resources and prompts are separately admitted, namespaced, bounded, and
  operator-selected. External resource/prompt text does not become system
  authority.
- Stdio clients are session-owned unless an explicit later policy admits a
  shared lifecycle. Kiln owns startup timeout, stderr evidence, cancellation,
  graceful close, forced orphan prevention, and bounded output. HTTP clients
  own session termination, timeout, cancellation, reconnect policy, identity
  evidence, and redacted diagnostics.
- App Gateway, managed agents, CLI, GUI, and TUI consume the same application
  services and server-qualified authority model. Project, tenant, route, and
  agent scope are explicit inputs; ambient parent authority is not inherited.
- Codex, Claude Code, and OpenCode adapters project complete effective server
  definitions only when representable. Incompatibility is a typed result.
  Projection reuses Kiln backup, managed-field ownership, install state, drift,
  repair, and uninstall services and preserves unmanaged native settings.
- The standalone unmanaged `mcp-config` writer is absorbed into canonical sync
  and removed. Malformed native configuration blocks mutation and is never
  replaced with an empty document.

## Consequences

Canonical resolution must land before runtime or projection adapters. Operator
status can distinguish configured, disabled, invalid, incompatible, admitted,
healthy, discovered, projected, and drifted instead of treating MCP as a
boolean capability.

Harness support may be narrower than Kiln support. A server remains usable by
Kiln-owned execution when a native harness cannot represent it, but the native
projection reports that incompatibility explicitly. Conversely, a native
harness feature cannot widen Kiln's canonical authority.

Descriptor or server-identity changes invalidate admission until the configured
trust policy accepts the new evidence. Large catalogs remain deferred or
searchable rather than being injected unbounded into every model turn.

## Verification

Acceptance requires deterministic tests for canonical validation and merge,
both transports, lifecycle and cancellation, secret redaction, namespaced
collisions, capability changes, admission and denial, per-agent/project/tenant
isolation, direct-provider execution and evidence, governed projections,
malformed native files, drift/repair/uninstall, operator-surface parity, and the
documented supervised Roblox Studio path.

Canonical references:

- `docs/research/foundations/agent-security-and-authority.md`
- `docs/architecture/config-projection.md`
- `docs/architecture/tooling/tool-execution.md`
- `docs/architecture/coordination/agent-tasks.md`
- `docs/architecture/surfaces/app-gateway-runtime.md`
