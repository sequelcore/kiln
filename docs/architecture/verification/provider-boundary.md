# Verification Provider Boundary

Kiln owns normalized observations. Engines own their execution semantics, and
Assurance owns any later criterion mapping. Runtime admits consequential work;
no provider result bypasses that boundary.

## Gentle AI slice

The supported integration is a read-only consumer of Gentle AI 2.4.0's public
`gentle-ai.review-integration/v2` contract. Kiln first reads repository-
independent capabilities v2.2, checks every required feature, exact package
version, executable SHA-256, and build revision, then requests status v5 for a
workspace overlay rooted at one exact Git base tree.

Successful output is a `kiln.gentle-review-observation/v1` containing provider
identity, contract identity, candidate target/tree/path binding, authority and
receipt identities when present, and the provider's current action,
replayability, and next-transition facts. `findings` and `establishes` are empty
because status v5 does not itself disclose reviewer findings and Kiln does not
invent them.

The adapter fails closed for incompatible capabilities, unsupported mandatory
features, malformed status, non-current/ambiguous/corrupted lineage, candidate
or base-tree mismatch, executable drift, timeout, cancellation, and provider
failure envelopes. Failure messages preserve `mutation_outcome` and
`replayability`; they never treat an unknown mutation as retry-safe.

Kiln does not import Gentle AI authority state and does not call lifecycle-
mutating operations. An operator may use Gentle AI separately to advance its
review. A later Kiln observation reports that external state but grants no
acceptance or execution authority.

Upstream provenance was resolved on 2026-08-26 from official tag `v2.4.0`,
release commit `301fb2ad7f3f3bda71f516d6e2848ef3fa6fe9bb`. Operators must configure the
published executable digest for their exact platform artifact.
