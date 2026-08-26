# Static Analysis Calibration 2026

## Decision

Keep Oxlint's `static_analyze` provider opt-in and facts-only. Do not map a
clean observation to bounded-work Assurance for semantic policy obligations.

The fixed `correctness + suspicious` profile completed over 88 candidates from
the private formal-screening v2 development package:

| Candidate class | Candidates | With diagnostics | Rate |
| --- | ---: | ---: | ---: |
| Seeded defective implementations | 8 | 3 | 37.5% |
| Qualified references | 16 | 0 | 0% |
| Semantic mutants | 64 | 5 | 7.8125% |

All eight detections were unused-parameter diagnostics. They identify a useful
code symptom, but do not establish that the related authority, freshness, or
replay rule is correct. Most deliberately wrong programs remained statically
clean. A clean result therefore cannot satisfy these semantic obligations.

## Bound evidence

- Study revision: `oxlint-formal-screening-calibration-v1`
- Package manifest digest:
  `sha256:847946d8dfd0e3f9d611544a259145af080f6f40bf0c663a9d460bbe7938ede0`
- Analyzer: Oxlint `1.80.0`
- Profile: `oxlint.correctness+suspicious/v1`
- Execution: the native Kiln `static_analyze` adapter over immutable copied
  bytes, one source file per observation
- Infrastructure failures: 0
- Raw operator-local report:
  `.kiln-private/benchmarks/formal-screening-private-v2/static-analysis-calibration.json`

This is calibration evidence, not a paired agent study and not evidence of
general precision or recall. The corpus intentionally contains small, pure,
closed-domain policy functions; it does not represent repository integration,
framework misuse, unsafe APIs, or ordinary maintainability defects where
static analysis may provide more value.

## Adoption boundary

The result supports keeping `static_analyze` available as a typed diagnostic
producer. It does not justify a new Assurance obligation, fallback, lifecycle,
or generic verifier abstraction. A future Assurance consumer must name a
specific acceptance criterion that Oxlint can actually establish and must be
calibrated on representative project changes for that criterion.
