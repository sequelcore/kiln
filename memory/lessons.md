# Lessons

- Do not add singleton-to-pool migration paths unless real external consumers
  or user data require them. For single-operator/internal-only features, prefer
  a clean canonical storage shape and let the operator relink credentials.
- Do not document or reference a migration command unless the repo has a real
  current producer/consumer pair that requires it. Historical internal config
  shapes alone are not enough; fail fast and point to the canonical contract.
- For Kiln roadmap work, do not frame foundational professional features as
  "MVP" plans. Use foundation, first production increment, and long-term
  expansion language so the plan respects Kiln's control-plane thesis and
  Sequel engineering standards.
- For semantic UI automation, never report action success from focus-only
  behavior or unresolved selector syntax. Normalize model-facing refs from the
  accessibility tree into provider-native selectors and fail clearly when the
  target cannot execute the required semantic pattern.
- For Sequel/Kiln implementation slices, do not introduce compatibility
  wrappers for incomplete internal contracts unless an external published API
  requires them. Replace the contract and update every in-repo call site in the
  same slice so the codebase keeps one canonical path.
- For Kiln roadmap closeout, completion means more than marking slices done:
  move stable doctrine into canonical architecture or guide docs, delete the
  retired roadmap file, compact remaining roadmap numbering, and update
  references before calling the track closed.
