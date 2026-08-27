# Verification Provider Boundary

Kiln owns normalized observations. Engines own their execution semantics, and
Assurance owns any later criterion mapping. Runtime admits consequential work;
no provider result bypasses that boundary.

## Gentle AI slice

The supported integration is a read-only consumer of Gentle AI 2.5.0-rc.1's public
`gentle-ai.review-integration/v2` contract. Kiln first reads repository-
independent capabilities v2.2, checks every required feature, exact package
version, release channel, and executable SHA-256, then requests status v5 for
one exact active lineage and target identity.

Successful output is a `kiln.gentle-review-observation/v2` containing provider
identity, contract identity, candidate target/tree/path binding, authority and
transaction identity, and the provider's current action, replayability, and
next-transition facts. It contains no receipt because this release retires
terminal receipts and delivery gates. `findings` and `establishes` are empty
because status v5 does not itself disclose reviewer findings and Kiln does not
invent them.

The adapter fails closed for incompatible capabilities, unsupported mandatory
features, malformed status, non-current/ambiguous/corrupted lineage, candidate
or lineage mismatch, executable drift, timeout, cancellation, and provider
failure envelopes. Failure messages preserve `mutation_outcome` and
`replayability`; they never treat an unknown mutation as retry-safe.

Kiln does not import Gentle AI authority state and does not call lifecycle-
mutating operations. An operator may use Gentle AI separately to advance its
review. A later Kiln observation reports that external state but grants no
acceptance or execution authority.

Upstream provenance was resolved on 2026-08-26 from immutable prerelease tag
`v2.5.0-rc.1`, tag target `7afe50d1d1d9e60fc55babdf9b1715f668e6d922`.
The official Windows AMD64 artifact is bound by published SHA-256
`15cf5b97240245c7c998f692359fc0e63fccee3cf2bf3238ebf47c4fb5716af2`.
Official release binaries do not expose a usable VCS revision, so Kiln pins the
observable version, release channel, and platform-artifact digest instead of
requiring unverifiable build metadata.
