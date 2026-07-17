# ADR-008: Managed Invocation Caller Identity

## Status

Accepted

## Context

Managed agent invocation crosses operator surfaces, provider routes, and
external harness adapters. Earlier designs risked mixing three different
identities:

- the operator surface hosting the turn, such as GUI, TUI, or CLI run
- the provider route selected for the child, such as Codex OAuth or OpenCode
- the parent external harness, when Kiln is attached to another harness

Research across cloned harnesses, provider docs, and community patterns showed
that provider routing and harness hosting are independent axes. A Kiln GUI turn
using a Codex OAuth provider route is still hosted by Kiln GUI. Inferring parent
harness identity from provider ids, model ids, config filenames, or UI controls
creates cross-surface drift and can grant or deny managed invocation authority
for the wrong reason.

## Decision

Kiln separates route catalog configuration from runtime attachment identity.

`ManagedInvocationToolOptions` is a caller-neutral route catalog. It contains
routes, unavailable-route diagnostics, agent and skill catalogs, request source,
artifact store, context resolver, and the shared invocation service.

`ManagedInvocationToolAttachment` is the runtime attachment contract. It pairs
caller-neutral options with an explicit `callerIdentity`:

- `kiln-runtime` for Kiln-owned surfaces such as `run`, `gui`, `tui`, and
  `benchmark`
- `external-harness` for a proven harness attachment such as Claude Code,
  Codex, or OpenCode

Runtime admission evaluates managed invocation caller capability from the
attachment identity and route provider id. CLI route catalogs, GUI controls,
TUI controls, and provider selection do not infer parent harness identity.

## Consequences

Route discovery remains shared across CLI, GUI, TUI, and benchmark surfaces.
Managed invocation tools are exposed only through runtime attachments with
explicit caller identity evidence. Kiln runtime callers are not restricted by
cross-harness provider matrices, because they are native Kiln surfaces. External
harness callers are restricted by explicit support tables and fail closed when
the requested child provider is unsupported.

This removes compatibility fallback behavior in favor of a typed boundary. Code
that tries to expose `managed_agent.*` tools with a bare route catalog fails at
compile time.

## Verification

Professional acceptance requires tests proving:

- core snapshots preserve typed caller identity and invocation capability
  evidence
- route catalogs stay caller-neutral across operator surfaces
- runtime tool surfaces require explicit attachments
- unsupported external harness callers are denied before adapter invocation
- GUI, TUI, CLI run, and benchmark attach Kiln runtime identity explicitly

Canonical architecture references:

- `docs/architecture/managed-agents.md`
- `docs/architecture/harness-integration-capabilities.md`
