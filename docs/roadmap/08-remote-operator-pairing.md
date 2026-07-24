# 08 - Remote Operator Pairing

Status: Deferred
Execution: Deferred - queued behind Roadmap 07; no research or implementation
is admitted until the stack governance plane closes.
Created: 2026-07-24

## Objective

Give an operator one provider-neutral way to authenticate a headless or
remote Kiln CLI, GUI, or TUI session (SSH, containers, a secondary device)
without requiring a local browser or a loopback listener on that machine, and
make every operator surface share the identical pairing contract instead of
each surface inventing its own remote-access story.

## Ownership

This track owns the operator-facing pairing/authorization flow for
headless/remote CLI, GUI, and TUI sessions: state/challenge issuance, the
pairing URL, code exchange, and session binding. It does not own harness-native
provider authentication (Codex OAuth, Claude entitlement, OpenCode auth —
Roadmap 03 owns provider identity/access, Roadmap 04 owns harness adapters)
and does not own Model Gateway network exposure or its security model
(Roadmap 03).

## Scope

- A provider-neutral pairing flow: generate a state/challenge pair, present a
  pairing URL whose sensitive parameters ride the URL fragment (never sent to
  a server or logged), let the operator complete authorization in any
  browser, and exchange one pasteable code for a bound session — no local
  loopback listener required on the headless machine.
- CLI, GUI, and TUI all consuming the identical pairing contract so
  remote/headless access is consistent across surfaces.
- Session binding to Roadmap 03's existing provider-neutral access/entitlement
  contract rather than a second identity system.
- Explicit session scope, expiry, revocation, and audit/replay evidence
  consistent with Kiln's evidence doctrine.

## Non-Goals

- No new identity or auth provider; pairing binds to Roadmap 03's
  provider-neutral access contract, it does not duplicate it.
- No remote code execution or tool-approval bypass — pairing only
  authenticates a session; it does not change work-governance or approval
  semantics.
- No replacement of harness-native auth flows (Codex, Claude Code, and
  OpenCode keep their own authentication).
- No implementation, and no repository research work, before Roadmap 07
  closes — this sequencing is an explicit operator decision (2026-07-24), not
  a technical dependency.

## Research Basis

- `cloned/t3code/packages/shared/src/connectAuth.ts` (reviewed 2026-07-24)
  demonstrates a working no-loopback-server pairing pattern for headless CLI
  auth: a `state`/PKCE `challenge` pair travels in the URL fragment so it
  never reaches a server or CDN log, the operator completes authorization in
  any browser, and the CLI validates a single pasted `code.state` blob against
  the state it generated — no local callback server or open port required.
  This is supporting implementation evidence for one workable shape, not
  architecture to copy verbatim.
- Codex, Claude Code, and OpenCode each already support their own headless/
  device-style authentication; this track is about one shared Kiln-level
  pairing flow for Kiln's own surfaces, not a replacement for those.

## Ordered Slices

### Slice 0 - Pairing Contract Research

Status: Deferred behind Roadmap 07.

Define the provider-neutral pairing contract (state/challenge issuance, code
exchange, session scope and expiry) against Roadmap 03's provider-neutral
access contract, survey existing headless-auth patterns for applicability,
and produce a fixture-backed design before any implementation begins.

## Dependencies

- Roadmap 03 owns the provider-neutral access/entitlement contract this track
  must bind sessions to; pairing must not create a second identity owner.
- Roadmap 07 is an explicit sequencing gate: no work on this track starts
  until 07 closes, regardless of technical readiness.

## Promotion Gates

- No implementation begins before Roadmap 07 closes.
- Pairing never becomes a second identity or authority owner; it binds
  exclusively to Roadmap 03's contract.
- No sensitive parameter (state, challenge, code) is logged or persisted
  outside the expected transient exchange.
- CLI, GUI, and TUI present the identical pairing contract; no harness-local
  or surface-local reimplementation.
- Session scope, expiry, and revocation are explicit and auditable.

## Verification

Deferred until Slice 0 research produces a design; then fixture tests for the
pairing contract, cross-surface projection tests for CLI/GUI/TUI parity,
workspace typecheck, and `git diff --check`.

## Completion Criteria

An operator can authenticate a headless or remote Kiln CLI, GUI, or TUI
session through one pairing flow shared across every surface, without a local
loopback listener, bound to Roadmap 03's provider-neutral access contract —
or the idea is explicitly rejected with evidence if research shows it is not
worth building.
