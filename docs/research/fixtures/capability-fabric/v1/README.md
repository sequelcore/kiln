# Harness Capability Compatibility Baseline v1

This directory freezes the Slice 0 research boundary for Codex, Claude, and
OpenCode V2. `compatibility-record.schema.json` is the versioned record
contract; `records/` binds exact SDK and runtime versions, official source
provenance, npm integrity, capability classifications, fixture evidence, and
bounded live-evidence status. `fixtures/` contains synthetic, secret-free event
samples and is evidence for record validation only; it is not a replay of a
provider session.

The validator at
`packages/cli/tests/research/capability-fabric-baseline.test.ts` applies the
schema, verifies fixture digests and source-artifact references, binds every
record to `packages/cli/package.json` and `bun.lock`, and rejects eligibility
for experimental contracts.

Source artifact digests are SHA-256 over the bytes at the record's exact tag,
except an artifact explicitly marked `published-npm-package`, which is hashed
from that exact installed npm package. Local clone locations are intentionally
not recorded. Version checks are read-only executable observations, not proof
of provider tool behavior. Live evidence uses `observed`, `failed`, and
`not-run` as terminal facts for the named bounded case. A failed proof remains
failed until a later bounded run passes; a `not-run` entry must not be promoted
without executing the named proof. Results describe only synthetic fixture
outcomes and exclude raw provider payloads and operator-local paths.

Live proof requires an explicit catalog model for every enabled harness. The
runner does not invent model defaults. SDK and executable versions are recorded
separately: an SDK admission does not imply parity with an independently
installed native executable. The Codex SDK adapter uses the exact CLI bundled
with its pinned SDK; native OpenCode and Claude routes retain their observed
executable identities.
