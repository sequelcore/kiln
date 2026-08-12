# Kiln Control-Plane Workflow Skill (2026)

Status: accepted research basis
Cutoff: 2026-08-12
Delivery issue: [#76](https://github.com/sequelcore/kiln/issues/76)

## Decision

Kiln ships `kiln-control-plane-workflow` as a compact provider-neutral built-in.
It teaches agents how to discover and sequence the safe Kiln control-plane
operations exposed in their current session. It does not expose tools, grant
authority, mirror the CLI, or own managed-job state.

The canonical workflow has two projections from one source:

- the progressively loaded built-in skill provides the complete procedure;
- the `kiln-control-plane` MCP server initialization publishes a sub-512-character
  summary so a connected client receives the critical cross-tool invariants even
  before loading the skill.

Core owns that shared text. The MCP bridge and native skill adapters only render
it. This prevents server instructions and projected skills from becoming
independent doctrine.

## Existing Kiln authority

Roadmap 04 already establishes the user-scoped `kiln-control-plane` MCP bridge
for Codex, Claude Code, and OpenCode. The bridge derives project identity from
trusted process context, authenticates to the global Operator Runtime, and
projects only sanitized application operations. Its stable catalog currently
contains:

- status, work-governance, capability, and account-usage inspection;
- managed-job invoke, status, result, cancel, and replay.

The application and Runtime owners retain route admission, credentials,
authority, bounded-work accounting, idempotency, lifecycle, evidence,
cancellation, replay, and terminal truth. CLI, GUI, and TUI may reach the same
owners through typed application surfaces without sharing MCP transport or
model-visible payloads.

The CLI remains the operator administration surface for installation,
configuration, sync, repair, and uninstall. A model must not use shell, a native
harness subprocess, direct HTTP, or the CLI as an implicit fallback for an
unavailable MCP operation.

## Primary-source evidence

The MCP tool specification defines discoverable names, descriptions, input and
output schemas, annotations, structured results, and `isError`. It also says
tool annotations are untrusted unless the server is trusted and recommends a
human ability to deny calls. The skill therefore discovers the current catalog,
uses schemas rather than recalled signatures, preserves structured errors, and
does not interpret metadata as authority.
[MCP Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

MCP Tasks are experimental and require capability negotiation at both protocol
and tool level. Kiln's managed jobs already have a canonical application-owned
identity and lifecycle, so the skill does not reinterpret them as MCP Tasks or
infer task support from general MCP availability.
[MCP Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)

Codex supports local stdio and Streamable HTTP MCP servers and explicitly
recommends server `instructions` for cross-tool workflows, constraints, and
rate limits. It also recommends making the first 512 characters self-contained.
That guidance motivates the shared compact server-instruction projection; it
does not make Codex the semantic owner.
[Codex MCP](https://developers.openai.com/codex/mcp/)

Claude Code supports MCP servers while retaining its own tool-permission and
operator-prompt behavior. OpenCode exposes MCP tools under harness-normalized
names and applies its own permission rules. Therefore the portable skill
matches discovered operation/schema semantics rather than requiring one raw
host-visible tool name.
[Claude Code MCP](https://code.claude.com/docs/en/mcp),
[Claude Code CLI permissions](https://docs.anthropic.com/en/docs/claude-code/cli-usage),
[OpenCode MCP](https://opencode.ai/docs/mcp-servers/), and
[OpenCode permissions](https://opencode.ai/docs/agents/).

These are authoritative behavior and configuration sources, not empirical
evidence that the skill improves task outcomes.

## Procedure contract

The portable workflow requires:

1. discover the current tool catalog and schemas;
2. inspect status, resolved governance, and capability before an
   authority-dependent action;
3. use a bounded objective, a currently exposed configured agent profile, and
   one stable idempotency key per logical managed request;
4. distinguish accepted asynchronous work from completion;
5. reconcile the canonical job id through status, result, cancellation, and
   replay without hidden retries;
6. preserve diagnostics, evidence source, observation time, result availability,
   failure evidence, and returned operator action;
7. report unavailable or unresolved capability honestly and continue directly
   only when resolved governance permits it.

The workflow never selects provider routes, models, credentials, budgets,
permissions, approvals, or configuration. It never converts a setup diagnostic
into permission and never claims that replay is deterministic re-execution.

## Evaluation contract

Deterministic forward scenarios should cover:

1. status/governance/capability inspection before a managed invoke;
2. a harness-prefixed tool catalog whose schemas still identify the operations;
3. accepted work followed by status and result rather than immediate completion;
4. retry of the same logical request with the same idempotency key;
5. unavailable Runtime with a preserved error code and operator action;
6. an absent managed-invoke tool with no CLI or shell fallback;
7. cancellation and replay bound to the authorized job id;
8. degraded status that remains diagnostically useful but grants no authority;
9. a general MCP capability without Kiln tools, producing unsupported rather
   than guessed availability.

Fresh-session conformance is still owned by Roadmap 04. A canonical projection
and deterministic tests do not establish live Codex, Claude Code, or OpenCode
parity.

## Limits

- MCP and native harness behavior is version-sensitive.
- A projected skill cannot install, trust, authorize, or repair an MCP server.
- Server instructions and tool descriptions influence model behavior but do not
  enforce Runtime authority.
- The workflow is useful only when the task actually operates Kiln; it should
  not become generic implicit context for unrelated work.
- No efficiency, success-rate, or safety improvement is claimed without paired
  evaluation evidence.
