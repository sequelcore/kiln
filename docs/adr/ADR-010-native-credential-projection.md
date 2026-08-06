# ADR-010: Native Credential Projection

## Status

Accepted

## Context

Kiln holds multiple subscription accounts for one provider in a credential
pool and selects among them per call. Operators also run the provider's own
native tools beside Kiln, such as the Codex CLI and desktop app. Those tools
keep a single-account credential store, so when the active subscription is
exhausted the operator re-authenticates by hand to continue working, while
Kiln already holds other usable accounts for the same provider.

Harness-home selection already lets a credential entry point at a harness home
directory, but it only governs child processes Kiln launches. It does not
change which account the operator's own native application runs as.

The gap is common enough that third-party tools exist solely to swap the
native credential file or to run each account under a separate home directory.
Both approaches keep account state outside Kiln, so Kiln cannot reason about
quota, health, or identity for accounts the operator switches between.

Writing into a store owned by another application is a different risk class
from anything else the credential pool does. The store's schema belongs to
that application, it can change across upstream releases, and a malformed
write breaks a working login rather than degrading Kiln alone.

## Decision

Kiln may project one pooled credential into a native harness credential store
as an explicit operator action. `codex-oauth` is the first provider with this
capability, projecting into `~/.codex/auth.json` resolved through `CODEX_HOME`.

The pool remains the source of truth. The native file is a projection, and
projecting never removes the credential from the pool.

Projection is bound by these invariants:

- Absorb before overwrite. The account currently active in the native store is
  admitted into the pool before it is replaced, so switching away never
  destroys an account Kiln does not already hold. Absorption reuses normal
  credential linking, so an already-pooled account is deduplicated rather than
  duplicated.
- Back up before overwrite, through the canonical projection-backup path, with
  bounded retention and owner-only file mode.
- Fail closed on shape. A native store may require fields Kiln does not need
  for its own provider calls. When a required field cannot be produced, the
  native file is not written at all, and the operator is told which accounts
  are blocked. A partially valid credential file is worse than an unchanged
  one.
- Write atomically through a temporary file and rename, so an interrupted
  projection cannot leave a truncated credential file.
- Projection does not change Kiln's own routing. Which account Kiln uses for
  its own calls stays governed by pool selection and routing config.

Native file shape knowledge lives in `@kilnai/cli` beside the other native
projection writers. Runtime exposes the pooled credential and the recovery of
provider-required fields; it does not encode native file layouts.

## Consequences

Operators switch native accounts from Kiln, and every account they switch
through becomes visible to Kiln's pool, including quota and health evidence
that was previously invisible.

Kiln accepts responsibility for mutating state owned by another application.
That responsibility is discharged by validating the parsed native shape,
failing closed when a required field is missing, and keeping a recoverable
backup rather than by assuming upstream stability.

Secret-bearing material now exists outside `~/.kiln/auth/` in projection
backups. Bounded retention and owner-only mode keep that exposure finite
rather than accumulating indefinitely. Owner-only mode is enforced by POSIX;
on Windows these paths rely on the user-profile ACL, consistent with how the
credential store itself is protected.

Adding this capability for another provider requires a new native shape
translation and the same invariants. It is deliberately not a generic
"write any credential anywhere" mechanism.

## Verification

- `packages/cli/tests/config/codex-native-account-sync.test.ts` covers native
  shape translation in both directions and rejection of malformed native files.
- `packages/cli/tests/commands/auth.test.ts` covers absorb, backup location,
  bounded retention, atomic replacement, fail-closed behavior when a required
  field cannot be recovered, and the distinct failure diagnostics.
- `packages/cli/tests/config/native-projection-backup.test.ts` covers retention
  limits, per-source pruning scope, default unbounded retention for config
  projections, and owner-only mode on POSIX.

## Related

- [Provider Credential Pools](../architecture/safety/provider-credential-pools.md)
- [Credential Governance](../architecture/safety/credential-governance.md)
- [Provider Credentials](../guides/config/provider-credentials.md)
