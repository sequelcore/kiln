# ADR-014: Configuration Schema and Mutation Ownership

## Status

Accepted

## Context

Kiln configuration is currently represented by handwritten interfaces,
partial validators, merge functions, direct writers, generated native files,
and status projections. The same YAML bytes can therefore be accepted by one
surface, rejected by another, or reported as effective without passing runtime
admission. Kiln requires one structural owner and an explicit mutation
lifecycle before adding more configuration surfaces.

Configuration families are separate bounded contexts. Global and project Kiln
configuration are owned by CLI configuration; app and gateway documents are
owned by their Core loaders. Sharing YAML syntax does not make them one schema
or give CLI permission to encode app or gateway semantic rules.

The bounded mechanism fixture in
`packages/cli/tests/config/project-schema-fidelity-spike.test.ts` proves the
mechanism selected here. It covers a scalar, nested object, list, map,
discriminated union, unknown root and nested fields, a known global-only field,
authority widening, comments, ordering, quoting, an anchor, and an alias.

## Decision

Each configuration family has one strict runtime schema in its owning package.
The admitted TypeScript type is inferred from that schema; a parallel
handwritten structural interface and allowlist are not retained. TypeBox is the
project-schema pilot mechanism because its value is already JSON Schema and it
provides static type inference plus runtime validation without a second schema
generator. Adoption beyond the project pilot requires the same bounded proof
in the receiving owner; this ADR does not centralize all configuration schemas
in one package.

Structural parsing accepts `unknown` and returns either an admitted value or
stable path-addressed diagnostics. Unknown and malformed fields reject.
Known cross-context constraints, including global-only fields and authority
narrowing, are evaluated after structural parsing by named semantic admission
functions. Schema refinements do not import Runtime or other bounded contexts.

The schema is also the editor-schema source. Canonical JSON serialization sorts
object keys and is deterministic. Field descriptors are derived from schema
metadata and bind canonical identity, structural owner, semantic owner, scope,
sensitivity, authority impact, activation, default posture, and schema
revision. Generated JSON Schema and descriptors are projections, never runtime
authority, and validation regenerates them before publication.

YAML reads never rewrite bytes. Accepted mutations parse with the existing
`yaml` Document API and edit the AST. Untouched comments, ordering, scalar
style, anchors, aliases, and blank-line structure are preserved. A successful
mutation does not promise byte identity for the edited node or normalized line
ending. A mutation whose target is ambiguous through an alias or unsupported
YAML construct rejects instead of resolving and rewriting the whole document.
Plain object parse/stringify is not a canonical mutation path.

Every mutation enters one typed application port owned by the configuration
family. The operation declares target identity, expected revision, authority
effect, activation, reconciliation requirements, and recovery behavior.
Direct operator actions may commit bounded preferences or authority-narrowing
changes without a proposal when the operation contract says so. Model-called
mutations and authority expansion require proposal and explicit approval.
Both paths use validation, revision fencing, same-directory temporary output,
atomic replacement for one file, and read-back admission.

Multi-artifact work does not claim filesystem-wide atomicity. Its terminal
result distinguishes `rejected`, `committed`, `reconciliation-failed`, and
`rolled-back`. Projection or activation failure cannot be reported as fully
applied. Activation is one of `hot`, `next-turn`, `next-session`, `reconcile`,
or `restart-required` and belongs to the field descriptor, not a UI guess.

Desired operator intent stays in canonical configuration. Reconstructible
discovery, pricing, projection, and freshness material moves to its evidence
owner and is referenced by exact revision where needed. Replacements use one
reader and one writer after publication. There are no compatibility readers or
aliases because Kiln has no external consumers. Durable local state is
re-adopted, migrated, archived, or discarded by an explicit operation after it
is classified; code never silently treats old state as current authority.

ADR-012 remains authoritative for breaking-version semantics and diagnostic
build identity. A matching document version is not freshness evidence.
Unknown-field diagnostics have one owner and continue to include the running
version and resolved module path. The obsolete statement that CLI has no build
step is superseded by the current repository build contract; linkage and build
identity, not that premise, preserve ADR-012's invariant.

## Complexity Disposition

The required invariant is one admitted structure and one mutation lifecycle per
configuration family. Keeping handwritten types plus validators is superficially
smaller, but it cannot prevent schema drift or generate the required editor
contract. Adding one schema mechanism, field metadata, and typed mutation
result is accepted permanent complexity. It removes duplicate structural
types, allowlists, direct whole-object rewrites, and success states that hide
reconciliation failure.

The design deliberately does not add a repository-wide generic configuration
engine, a legacy parser, a generic JSON Patch authority, or a second durable
effective-config store. Cross-context semantics remain plain named functions,
and effective state remains derived.

## Consequences

Slice 1 replaces the project structural interface and partial validator with
the proven mechanism, then deletes the old path. Slice 2 derives its read model
from admitted values and descriptors. Slice 4 replaces direct writers through
the typed application ports. App, gateway, and global migrations remain owned
by their later roadmap slices.

This decision is invalidated if TypeBox cannot preserve stable diagnostics or
deterministic JSON Schema for the complete project contract, or if YAML AST
mutation cannot preserve untouched operator material for a required operation.
In either case the replacement mechanism must pass the same fixture before any
production reader moves.
