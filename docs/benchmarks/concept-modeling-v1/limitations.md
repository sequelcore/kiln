# Concept Modeling v1 Limitations

The fixture is diagnostic internal evidence with narrow scope:

- It uses one model (`gpt-5.6-luna`), one harness version, and one run per arm
  and task. It does not support a universal model-quality, provider, or
  harness claim.
- The six tasks are synthetic and cover a small set of cross-surface concept
  decisions. They do not represent all domains, repositories, locales, or
  implementation conditions.
- Quality is deterministic against predeclared signals, but the recorded
  review was human-reviewed rather than independently blinded.
- Host skill discovery was disabled because of an under-development Codex
  feature; both arms emitted the same warning about the remaining catalog
  budget. This is disclosed evidence, not proof of absence of host effects.
- Token and latency observations are environment-specific diagnostics. The
  subscription-included route reports zero marginal cost, so no metered-cost
  comparison is available.
- Persisted thread ids and digests provide replay references, not independent
  replication. The native routing cohort is a separate evidence cohort, not an
  independent replication of the value comparison. No public leaderboard or
  external benchmark status follows from this fixture.

Use the fixture to evaluate this specific admission decision. Re-evaluate
after material changes to the skill digest, candidate catalog, model, harness,
tools, permissions, or fixture version.
