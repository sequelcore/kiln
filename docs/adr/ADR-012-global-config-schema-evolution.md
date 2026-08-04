# ADR-012: Global Config Schema Evolution and Build-Identified Diagnostics

## Status

Accepted

## Context

A global config containing a legitimately supported field was rejected as
unknown. The field existed in the working tree, in `KilnGlobalConfig`, and in
the compiled `packages/cli/dist`, yet `kiln` rejected it. Rebuilding the package
did not change the outcome.

The cause was runner drift. The operator's `kiln` entrypoint is a launcher shim
that resolves through `~/.bun/install/global/node_modules/@kilnai/cli`, and that
entry was a copied published package rather than a link to the working tree. It
had been installed months earlier at an older major version, so it validated
config against the schema it was compiled with. Rebuilding the repository could
not affect it, because the running code was never the repository's code.

Three structural gaps made this both possible and hard to diagnose.

The runtime field allowlists were hand-maintained duplicates of the TypeScript
interfaces they guarded. Nothing forced the two to agree, so the same class of
failure — a field the schema supports but the validator rejects — was reachable
from a single-file editing mistake, with no compile-time signal.

The unknown-field diagnostic named only the offending key. An unknown field is
ambiguous evidence: it means either the operator wrote a field that does not
exist, or the running build predates a field that does. The message asserted the
first reading and gave the reader nothing with which to test the second.

The config `version` field could not resolve that ambiguity either.
`deliberationPolicy` was added without bumping it, correctly — it is an additive
optional field — but this means an old build and a new build accept the same
`version` while disagreeing about which fields exist.

## Decision

`CANONICAL_GLOBAL_CONFIG_VERSION` marks breaking schema generations only.
Additive optional fields do not bump it. It is therefore not a feature-detection
or staleness signal, and no code may treat a matching `version` as evidence that
the running build understands the document.

Runtime field allowlists are derived from the interfaces they guard, through a
type that fails compilation when the two drift. Adding a field to
`KilnGlobalConfig` without a validator entry is a typecheck error, not a runtime
rejection. The reverse — an allowlist entry with no interface field — is an
excess-property error.

Unknown-field rejection has one emission point, and every such diagnostic names
the build that produced it: version and resolved entrypoint. Because the
staleness signal cannot come from the document, it comes from the validator.

The operator's global `kiln` resolves to the working tree by link, not by
copied package. Dogfooding a control plane against a months-old snapshot of
itself is not a supported configuration; a published copy in the global tree is
treated as a defect.

## Consequences

Schema-validator drift is no longer expressible in source. The remaining drift
surface is entirely operational — which build is installed — and that surface is
now self-reporting in the one message that surfaces it.

Diagnostics get longer. This is accepted: the added text is the evidence needed
to choose between the two readings of an unknown field, and it appears only on a
failure path.

Field allowlists that guard structural shapes rather than declared interfaces
are unchanged. They carry the build identity through the shared emission point,
but they are not compile-time bound to a type, because there is no type to bind
them to.

This ADR does not introduce a build stamp threaded through a compile pipeline.
`packages/cli` has no compile step, and once the global entrypoint is linked to
the working tree the running build cannot lag it. The version and entrypoint
already carried by the diagnostic identify the running build without new
machinery.
