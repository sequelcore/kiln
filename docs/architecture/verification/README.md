# Verification

## Purpose

Kiln's verification plane turns bounded claims about one exact candidate into
typed observations. Verification producers report facts; adopted Assurance
policy decides whether those facts establish an acceptance criterion; Runtime
alone admits consequential execution.

The stable flow is:

```text
obligation -> configured producer -> candidate-bound observation -> Assurance -> decision
```

No engine, adapter, model, or receipt may skip that order or mint acceptance.

## Vocabulary and ownership

- An **engine** performs a check, such as Dafny or Oxlint.
- A **provider adapter** invokes one configured engine and normalizes its
  output into a closed Kiln observation.
- An **observation** states what was checked, over which exact bytes, with
  which engine version and result. It carries an empty `establishes` tuple.
- **Assurance** is adopted work policy. It maps obligations to acceptance
  criteria and evaluates current candidate evidence.
- **Runtime admission** decides whether a later action may execute. Provider
  availability and a clean result are never execution authority by themselves.

The capability catalog owns provider-neutral discovery eligibility. The
developer-tool catalog remains a lexical projection of registered tools and is
not a second selection or trust authority.

## Current providers

| Evidence class | Engine | Kiln tool | Status | Authority |
| --- | --- | --- | --- | --- |
| Formal | Dafny | `formal_verify` | Selectively available; consumed by bounded-work Assurance | Facts only |
| Static | Oxlint | `static_analyze` | Experimental opt-in producer; current calibration does not justify Assurance | Facts only |
| Inferential review | Gentle AI 2.4.0 | `gentle_review` | Experimental opt-in, read-only status producer | Facts only; never Assurance or Runtime authority |

`static_analyze` is intentionally narrow. It analyzes one immutable copied
JavaScript or TypeScript file with a fixed `correctness + suspicious` profile.
It does not load repository configuration, nested configuration, plugins,
type-aware rules, or fixes. Candidate-controlled Oxlint and ESLint disable
tokens are rejected before invocation because inline directives override linter
configuration and could otherwise suppress the fixed profile. Its observation records the source digest, pinned
Oxlint version, profile revision, number of rules, diagnostics, and outcome.

This fixed profile is the smallest reproducible second verifier class. Project
lint policy remains owned by the project's normal lint command; Kiln does not
silently reinterpret that policy as assurance evidence.

## Configuration

Providers are absent unless the operator explicitly configures their native
executable and exact observed version in `~/.kiln/config.yaml`:

```yaml
version: "5"
verification:
  formal:
    dafny:
      executable: C:/tools/dafny.exe
      expectedVersion: 4.11.0
  static:
    oxlint:
      executable: C:/tools/oxlint.exe
      expectedVersion: 1.80.0
  inferential:
    gentleAi:
      executable: C:/tools/gentle-ai.exe
      expectedVersion: 2.4.0
      expectedExecutableDigest: sha256:<published-executable-digest>
      expectedBuildRevision: 301fb2ad7f3f3bda71f516d6e2848ef3fa6fe9bb
```

Each producer class may be configured independently. Kiln probes
`--version`, requires an exact canonical version match, rejects unavailable or
non-native Windows launch paths, and omits the tool when resolution fails.
The tools remain deferred rather than always present in model context.

`gentle_review` negotiates `gentle-ai.review-integration/v2` capabilities v2.2
and reads status v5 for an exact workspace-overlay base tree and expected
target identity. It verifies the configured executable bytes and rejects
version, build, protocol, unknown or malformed mandatory features, candidate,
lineage, timeout, cancellation, and malformed-output failures. It never calls start, finalize, repair,
capture, or validation mutations. See [Provider Boundary](provider-boundary.md).

Private formal-screening fixtures live under the ignored repository root
`.kiln-private/benchmarks/`. Global configuration names the exact absolute
package path, but the loader accepts it only below the canonical
`<repository>/.kiln-private` boundary and outside any declared publish surface.
It rejects links, junctions, special files, path escapes, digest drift, and
visible/private subtree overlap before creating a model-facing workspace.

## Invariants

- Provider registration is closed and operator-owned; a model cannot invent a
  provider, executable, version, evidence class, or trust level.
- Every successful observation names exact covered bytes and a pinned engine
  version.
- Incomplete, malformed, empty, timed-out, cancelled, mutated, or
  version-mismatched runs establish nothing.
- A diagnostic result is a successful observation, not a tool failure and not
  an acceptance decision.
- Stale evidence cannot satisfy a current candidate.
- Inferential model review is independent review evidence, not deterministic
  verification and not authority.

## Deliberate non-generalization

Kiln does not yet expose a generic `VerifierProvider` abstraction. Dafny and
Oxlint have materially different inputs and evidence semantics, and Gentle AI
owns a multi-step candidate/review/receipt lifecycle rather than a single
deterministic check. A shared provider abstraction may be extracted only after
three materially different verifier classes have working Kiln consumers and
measured value. Until then, explicit adapters keep ownership and failure modes
visible.

The first bounded calibration found diagnostics in 3/8 seeded defective
implementations and 5/64 semantic mutants, but no diagnostics in 16 qualified
references. Those diagnostics were unused-parameter symptoms, not proof of the
policy obligations. This does not justify an Assurance mapping. A future
consumer must name a criterion Oxlint can establish on representative project
changes. Gentle AI requires a separately negotiated, read-only evidence-import
contract that preserves its candidate binding without importing its delivery
authority.

## Complexity disposition

The required invariant is that no verifier can self-credit acceptance or run
against ambiguous bytes. Running Oxlint as an ordinary shell command was
simpler locally but could not provide a typed, versioned, candidate-bound
observation. The permanent surface added is one optional config arm, one
registered tool, one strict observation schema, and one process adapter. It
adds no lifecycle, persistence, fallback, provider selection, or Assurance
mapping. The remaining duplication with Dafny is intentional evidence needed
before a real shared seam can be justified.

The comparative research basis and rejected expansions are recorded in
[Verification Producer Evidence](../../research/foundations/verification-producers.md).
