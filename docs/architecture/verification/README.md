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
| Static artifact quality | Kiln Quality + TypeScript parser | `quality_analyze` | Experimental opt-in closed-profile producer | Facts only |
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

`quality_analyze` examines one TypeScript artifact with every configured
profile. `type-integrity/v1` diagnoses chained type assertions and the more
specific widen-then-assert pattern without double reporting. `complexity/v1`
reports classic per-function cyclomatic complexity above 20 as a review signal;
it does not call the function defective. `test-integrity/v1` reports imported
Vitest `only` calls and literally empty enabled test callbacks. It deliberately
does not condemn disabled or conditional tests, mocks, delegated assertions, or
tests merely lacking a direct `expect` call. It parses in-process with the exact runtime
`@typescript/typescript6` compatibility dependency. The wrapper and its
underlying TypeScript `6.0.3` parser are both pinned so a
published install cannot float the parser behind the recorded profile revision.
It does not load `tsconfig`,
imports, project graphs, plugins, suppressions, thresholds, fixes, or network
resources. A parse or profile failure produces no observation.

The tool name describes observable behavior rather than presumed authorship.
`anti-slop` is research provenance, not a profile identity, and Kiln never emits
an AI-authorship or global-quality score. Profiles are reviewed build-time Kiln
contributions shipped in a release; there is no runtime plugin registry.

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
    quality:
      typescript:
        - type-integrity
        - complexity
        - test-integrity
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
`quality_analyze` has no external executable to probe and is registered only
when the closed TypeScript profile list is present. The agent chooses only the
artifact path; it cannot choose profiles, rules, severities, thresholds, or
exclusions.

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
- "No configured quality diagnostics" means only that the named profile and
  rule revisions emitted none; it is not an overall quality pass.

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

For artifact quality, the required invariant is that a no-diagnostics
observation is emitted only after the named rule revisions parsed the exact
bytes. The permanent surface is one optional profile list, one tool, one strict
observation, two syntax rules, and one exact runtime parser dependency. The
shorter Oxlint JavaScript-plugin route was rejected because its alpha execution
contract cannot guarantee fail-closed coverage. The compatibility parser is
removable when the primary TypeScript compiler exposes a supported AST API or
a simpler stable parser owns this consumer. No lifecycle, persistence, runtime
registry, fallback, fixes, score, or Assurance mapping was added.

The comparative research basis and rejected expansions are recorded in
[Verification Producer Evidence](../../research/foundations/verification-producers.md).
The anti-slop and benchmark calibration is recorded in
[Artifact Quality Evidence](../../research/foundations/artifact-quality-evidence.md).
