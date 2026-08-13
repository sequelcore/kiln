# 08 - Remote Operator Pairing

Status: Deferred
Execution: Deferred - queued behind Roadmap 07; no research or implementation is admitted until the stack governance plane closes.
Created: 2026-07-24

## Objective

Give an operator one way to authenticate a headless or remote Kiln CLI, GUI, or
TUI session without requiring a local browser or loopback listener on that
machine, with one pairing contract shared by every operator surface.

## Ownership

This track owns state/challenge issuance, the pairing URL, code exchange,
authenticated operator-session identity, scope, expiry, revocation, and session
binding. Operator Runtime consumes that session while retaining route admission,
economic commitment, credential, tool, and dispatch authority.

It does not own harness-native provider authentication or evidence; the stable
[harness integration architecture](../architecture/surfaces/harness-integration-capabilities.md)
owns harness adapters while Core and Runtime own provider-model evidence. It
does not own Model Gateway network exposure or ingress security (see
[Model Gateway architecture](../architecture/providers/model-gateway.md)), and
Model Gateway principals never become operator-session identity.

## Scope

- Generate a state/challenge pair and put sensitive URL parameters in the
  fragment so they do not reach server or CDN logs.
- Complete authorization in any browser and exchange one pasteable code for a
  bound session without opening a callback port on the headless machine.
- Project the same session contract through CLI, GUI, and TUI.
- Make session identity, scope, expiry, revocation, and audit evidence explicit.

## Non-Goals

- No provider identity, entitlement, route, credential, or ingress-principal
  contract.
- No remote code execution, tool-approval bypass, or expansion of Runtime
  authority.
- No replacement for Codex, Claude Code, or OpenCode authentication.
- No repository research or implementation before Roadmap 07 closes.

## Research Basis

`cloned/t3code/packages/shared/src/connectAuth.ts`, reviewed 2026-07-24,
demonstrates a no-loopback CLI flow in which state and a PKCE challenge travel
in the URL fragment and the CLI validates a pasted `code.state` value. It is
evidence for one possible mechanism, not architecture to copy verbatim.

## Ordered Slices

### Slice 0 - Pairing Contract Research

Status: Deferred behind Roadmap 07.

Define the operator-session pairing contract, survey applicable headless-auth
patterns, resolve identity and authority boundaries with Operator Runtime, and
produce a fixture-backed design before implementation.

## Dependencies

- Roadmap 07 is an explicit sequencing gate, not a technical dependency.
- Operator Runtime must expose the authenticated-session boundary consumed by
  operator surfaces without delegating route or execution authority to pairing.
- Model Gateway ingress architecture matters only if a paired surface exposes
  that ingress.

## Promotion Gates

- No implementation begins before Roadmap 07 closes.
- Pairing cannot confer provider, route, credential, economic, tool, or dispatch
  authority.
- State, challenge, and code values are never logged or durably persisted.
- CLI, GUI, and TUI consume one session contract.
- Session scope, expiry, revocation, and audit evidence are explicit.

## Verification

After research admits a design: fixture tests for the pairing contract,
cross-surface CLI/GUI/TUI projection tests, affected typecheck, and
`git diff --check`.

## Completion Criteria

An operator can authenticate a headless or remote Kiln surface through one
pairing flow without a local loopback listener and without coupling operator
identity to provider, route, credential, or ingress identity, or the idea is
rejected with recorded evidence.
