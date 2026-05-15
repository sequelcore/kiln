# ADR-001: Subprocess Integration Model

## Status

Accepted

## Context

Kiln can execute work through native provider sessions and through external
agent harnesses such as Claude Code, Codex, and OpenCode. Those harnesses own
their own authentication, process model, provider affordances, and session
metadata. Kiln still needs one control-plane model for context admission,
authority, events, replay, cost evidence, and cross-surface presentation.

Treating a harness CLI as the runtime owner would fragment policy and make
operator evidence depend on implementation details of each tool. Treating a
harness as a governed adapter keeps Kiln's runtime model stable while allowing
provider-specific execution behavior.

## Decision

Kiln integrates external harness CLIs as subprocess execution adapters. The
Kiln session remains the source of truth for projected context, authority,
events, memory admission, and operator evidence.

The integration model has these boundaries:

- `packages/cli/src/wrapper/*` owns harness process/session adapters,
  provider-session abstractions, preamble construction, permission
  normalization, and provider-specific event translation.
- A harness subprocess may own its native session id, resume token, model
  selector, and process lifecycle. Those values are provider metadata inside
  the Kiln event stream, not canonical Kiln session identity.
- Every harness turn receives explicit Kiln context through the projected
  preamble and admitted resources. Ambient harness memory is never a substitute
  for `DefaultContextGovernor` evidence.
- Permission prompts and tool decisions are normalized into Kiln authority
  records before execution. Provider-side permission flags may reduce risk, but
  they are not the control-plane policy source.
- Harness stdout, stderr, usage, file-change evidence, approvals, and failures
  are translated into typed Kiln events before any GUI, TUI, native, or CLI
  surface renders them.
- Cross-harness handoff uses Kiln sessions, resources, managed invocation
  context, and coordination memory. It must not depend on hidden CLI state.

## Consequences

Kiln can support different harnesses without changing the runtime contract, but
each adapter must pay the cost of explicit process management and event
normalization. Runtime features must be designed against Kiln contracts first;
provider-native affordances are projected only when they can be represented
with evidence.

## Verification

Professional acceptance for this ADR requires tests that cover:

- preamble/context projection into harness turns
- permission normalization and fail-closed denial behavior
- session resume metadata without changing Kiln session identity
- subprocess failure normalization
- file-change and usage event projection
- managed invocation calls routed through governed authority

Canonical architecture reference: `docs/architecture/harness-integration-capabilities.md`.
